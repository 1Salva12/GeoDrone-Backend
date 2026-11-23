const { Router } = require('express');
const db = require('../db');
const { ownedFlight } = require('../services/access');
const { elevationAt } = require('../services/dsm');
const { area, distance, perimeter, projectToUtm, validatePoints } = require('../services/geospatial');
const { asyncHandler, httpError } = require('../utils/http');

const router = Router();

router.post('/calculate', asyncHandler(async (req, res) => {
  const points = validatePoints(req.body.points, 1);
  const altitudes = req.body.points.map((point) => {
    const altitude = point.altitude == null || point.altitude === '' ? 0 : Number(point.altitude);
    if (!Number.isFinite(altitude)) throw httpError(400, 'La altitud de cada punto debe ser numérica.');
    return altitude;
  });
  const { reference, projected } = projectToUtm(points);
  let distance2d = 0;
  let distance3d = 0;
  for (let index = 1; index < projected.length; index += 1) {
    const current = projected[index];
    const previous = projected[index - 1];
    const horizontal = Math.hypot(current.x - previous.x, current.y - previous.y);
    distance2d += horizontal;
    const currentAltitude = altitudes[index];
    const previousAltitude = altitudes[index - 1];
    distance3d += Math.hypot(horizontal, currentAltitude - previousAltitude);
  }
  const closedPolygon = points.length >= 3;
  const polygonPerimeter = closedPolygon ? perimeter(points).value : distance2d;
  const polygonArea = closedPolygon ? area(points).value : 0;
  const elevations = altitudes;
  const deltaElevation = elevations.length ? Math.max(...elevations) - Math.min(...elevations) : 0;
  const flightId = req.body.flightId == null ? null : Number(req.body.flightId);
  if (flightId !== null) await ownedFlight(flightId, req.user.id);
  const values = {
    distance2d,
    distance3d,
    perimeter: polygonPerimeter,
    areaM2: polygonArea,
    areaHectares: polygonArea / 10000,
    deltaElevation
  };
  const details = { epsg: reference.epsg, projected, ...values };
  const result = await db.one(`
    INSERT INTO mediciones (flight_id, user_id, type, geometry_json, result_value, unit, details_json)
    VALUES (?, ?, 'summary', ?, ?, 'm', ?) RETURNING id
  `, [flightId, req.user.id, JSON.stringify(points), polygonArea, JSON.stringify(details)]);
  res.json({ id: result.id, ...values, epsg: reference.epsg });
}));

router.get('/', asyncHandler(async (req, res) => {
  let rows;
  if (req.query.flightId !== undefined) {
    const flightId = Number(req.query.flightId);
    await ownedFlight(flightId, req.user.id);
    rows = await db.many('SELECT * FROM mediciones WHERE flight_id = ? AND user_id = ? ORDER BY id DESC', [flightId, req.user.id]);
  } else {
    rows = await db.many(`
      SELECT m.* FROM mediciones m
      LEFT JOIN flights f ON f.id = m.flight_id
      LEFT JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = ? OR (m.flight_id IS NULL AND m.user_id = ?) ORDER BY m.id DESC
    `, [req.user.id, req.user.id]);
  }
  res.json(rows.map(parseMeasurement));
}));

function parseMeasurement(row) {
  return {
    ...row,
    geometry: JSON.parse(row.geometry_json),
    details: JSON.parse(row.details_json)
  };
}

router.post('/', asyncHandler(async (req, res) => {
  const flightId = Number(req.body.flightId);
  const flight = await ownedFlight(flightId, req.user.id);
  const type = String(req.body.type || '');
  const points = req.body.points;
  let calculated;
  let details;

  if (type === 'distance') {
    calculated = distance(points);
    details = { epsg: calculated.epsg, projected: calculated.projected };
  } else if (type === 'perimeter') {
    calculated = perimeter(points);
    details = { epsg: calculated.epsg, projected: calculated.projected };
  } else if (type === 'area') {
    calculated = area(points);
    details = { epsg: calculated.epsg, projected: calculated.projected };
  } else if (type === 'elevation_difference') {
    const validated = validatePoints(points, 2);
    if (validated.length !== 2) throw httpError(400, 'elevation_difference requiere exactamente dos puntos.');
    if (!flight.dsm_path) throw httpError(409, 'Carga el DSM GeoTIFF del vuelo antes de medir elevaciones.');
    const elevations = await Promise.all(validated.map((point) => elevationAt(flight.dsm_path, point)));
    calculated = { value: Math.abs(elevations[1] - elevations[0]), unit: 'm' };
    details = { elevations, delta: elevations[1] - elevations[0] };
  } else {
    throw httpError(400, 'type debe ser distance, perimeter, area o elevation_difference.');
  }

  const saved = await db.one(`
    INSERT INTO mediciones (flight_id, user_id, type, geometry_json, result_value, unit, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
  `, [flightId, req.user.id, type, JSON.stringify(points), calculated.value, calculated.unit, JSON.stringify(details)]);
  res.status(201).json(parseMeasurement(saved));
}));

router.get('/:measurementId', asyncHandler(async (req, res) => {
  const row = await db.one(`
    SELECT m.* FROM mediciones m
    LEFT JOIN flights f ON f.id = m.flight_id
    LEFT JOIN projects p ON p.id = f.project_id
    WHERE m.id = ? AND (p.user_id = ? OR (m.flight_id IS NULL AND m.user_id = ?))
  `, [Number(req.params.measurementId), req.user.id, req.user.id]);
  if (!row) throw httpError(404, 'Medición no encontrada.');
  res.json(parseMeasurement(row));
}));

router.delete('/:measurementId', asyncHandler(async (req, res) => {
  const row = await db.one(`
    SELECT m.id FROM mediciones m
    LEFT JOIN flights f ON f.id = m.flight_id
    LEFT JOIN projects p ON p.id = f.project_id
    WHERE m.id = ? AND (p.user_id = ? OR (m.flight_id IS NULL AND m.user_id = ?))
  `, [Number(req.params.measurementId), req.user.id, req.user.id]);
  if (!row) throw httpError(404, 'Medición no encontrada.');
  await db.execute('DELETE FROM mediciones WHERE id = ?', [row.id]);
  res.status(204).end();
}));

module.exports = router;

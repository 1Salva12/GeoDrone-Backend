const proj4 = require('proj4');
const { httpError } = require('../utils/http');

function validatePoints(points, minimum) {
  if (!Array.isArray(points) || points.length < minimum) {
    throw httpError(400, `Se requieren al menos ${minimum} puntos.`);
  }
  return points.map((point) => {
    if (!point || point.lat === null || point.lat === '' || point.lon === null || point.lon === '') {
      throw httpError(400, 'Cada punto requiere latitud y longitud numéricas.');
    }
    const lat = Number(point && (point.lat !== undefined ? point.lat : point.latitude));
    const lon = Number(point && (point.lon !== undefined ? point.lon : point.longitude));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -80 || lat > 84 || lon < -180 || lon > 180) {
      throw httpError(400, 'Cada punto debe tener latitud entre -80 y 84 y longitud entre -180 y 180.');
    }
    return { lat, lon };
  });
}

function utmReference(points) {
  const latitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const longitudes = points.map((point) => point.lon);
  const longitude = longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length;
  let zone = Math.min(60, Math.max(1, Math.floor((longitude + 180) / 6) + 1));
  if (latitude >= 56 && latitude < 64 && longitude >= 3 && longitude < 12) zone = 32;
  if (latitude >= 72 && latitude <= 84) {
    if (longitude >= 0 && longitude < 9) zone = 31;
    else if (longitude >= 9 && longitude < 21) zone = 33;
    else if (longitude >= 21 && longitude < 33) zone = 35;
    else if (longitude >= 33 && longitude < 42) zone = 37;
  }
  const epsg = (latitude >= 0 ? 32600 : 32700) + zone;
  return { zone, epsg, projection: `+proj=utm +zone=${zone} ${latitude < 0 ? '+south ' : ''}+datum=WGS84 +units=m +no_defs` };
}

function projectToUtm(points) {
  const reference = utmReference(points);
  const projected = points.map(({ lat, lon }) => {
    const [x, y] = proj4('EPSG:4326', reference.projection, [lon, lat]);
    return { x, y };
  });
  return { reference, projected };
}

function distance(points) {
  const validated = validatePoints(points, 2);
  const { reference, projected } = projectToUtm(validated);
  let meters = 0;
  for (let index = 1; index < projected.length; index += 1) {
    meters += Math.hypot(projected[index].x - projected[index - 1].x, projected[index].y - projected[index - 1].y);
  }
  return { value: meters, unit: 'm', epsg: reference.epsg, projected };
}

function polygonPoints(points) {
  const validated = validatePoints(points, 3);
  if (validated.length > 3) {
    const first = validated[0];
    const last = validated[validated.length - 1];
    if (first.lat === last.lat && first.lon === last.lon) validated.pop();
  }
  if (validated.length < 3) throw httpError(400, 'El polígono debe contener al menos tres vértices distintos.');
  return validated;
}

function perimeter(points) {
  const validated = polygonPoints(points);
  const { reference, projected } = projectToUtm(validated);
  let meters = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    meters += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return { value: meters, unit: 'm', epsg: reference.epsg, projected };
}

function area(points) {
  const validated = polygonPoints(points);
  const { reference, projected } = projectToUtm(validated);
  let doubleArea = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    doubleArea += current.x * next.y - next.x * current.y;
  }
  return { value: Math.abs(doubleArea) / 2, unit: 'm2', epsg: reference.epsg, projected };
}

module.exports = { area, distance, perimeter, projectToUtm, validatePoints };

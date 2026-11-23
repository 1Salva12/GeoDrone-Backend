const { Router } = require('express');
const db = require('../db');
const { ownedFlight, ownedProject } = require('../services/access');
const { asyncHandler, httpError } = require('../utils/http');

const router = Router();

async function projectDto(project) {
  const count = await db.one('SELECT COUNT(*) AS count FROM flights WHERE project_id = ?', [project.id]);
  return {
    id: String(project.id),
    name: project.name,
    description: project.description,
    locationName: project.location_name || '',
    createdAt: new Date(project.created_at).toISOString(),
    flightCount: Number(count.count)
  };
}

async function flightDto(flight) {
  const count = await db.one('SELECT COUNT(*) AS count FROM images WHERE flight_id = ?', [flight.id]);
  const status = {
    created: 'PENDING',
    queued: 'PENDING',
    running: 'PROCESSING',
    completed: 'COMPLETED',
    failed: 'FAILED',
    canceled: 'FAILED',
    processing_error: 'FAILED'
  }[flight.status] || 'PENDING';
  return {
    id: String(flight.id),
    projectId: String(flight.project_id),
    flightName: flight.name,
    date: flight.flight_date || new Date(flight.created_at).toISOString().slice(0, 10),
    droneModel: flight.drone_model || '',
    altitudeMeters: flight.altitude_meters || 0,
    overlapPercentage: flight.overlap_percentage || 0,
    photoCount: Number(count.count),
    status,
    progressPercentage: status === 'COMPLETED' ? 100 : status === 'PROCESSING' ? 50 : 0
  };
}

router.get('/projects', asyncHandler(async (req, res) => {
  const projects = await db.many('SELECT * FROM projects WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.json(await Promise.all(projects.map(projectDto)));
}));

router.post('/projects', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const locationName = String(req.body.locationName || '').trim();
  if (!name || name.length > 150 || description.length > 2000 || locationName.length > 200) {
    throw httpError(400, 'Datos de proyecto no válidos.');
  }
  const project = await db.one(
    'INSERT INTO projects (user_id, name, description, location_name) VALUES (?, ?, ?, ?) RETURNING *',
    [req.user.id, name, description, locationName]
  );
  res.status(201).json(await projectDto(project));
}));

router.get('/projects/:projectId', asyncHandler(async (req, res) => {
  const project = await ownedProject(Number(req.params.projectId), req.user.id);
  res.json(await projectDto(project));
}));

router.get('/projects/:projectId/flights', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  await ownedProject(projectId, req.user.id);
  const flights = await db.many('SELECT * FROM flights WHERE project_id = ? ORDER BY id DESC', [projectId]);
  res.json(await Promise.all(flights.map(flightDto)));
}));

router.post('/projects/:projectId/flights', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  await ownedProject(projectId, req.user.id);
  const name = String(req.body.flightName || '').trim();
  const flightDate = String(req.body.date || '').trim();
  const droneModel = String(req.body.droneModel || '').trim();
  const altitude = Number(req.body.altitudeMeters);
  const overlap = Number(req.body.overlapPercentage);
  if (!name || name.length > 150 || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate) ||
      !Number.isFinite(altitude) || altitude < 0 || !Number.isFinite(overlap) || overlap < 0 || overlap > 100) {
    throw httpError(400, 'Datos de vuelo no válidos.');
  }
  const flight = await db.one(`
    INSERT INTO flights (project_id, name, flight_date, drone_model, altitude_meters, overlap_percentage)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING *
  `, [projectId, name, flightDate, droneModel, altitude, overlap]);
  res.status(201).json(await flightDto(flight));
}));

router.get('/flights/:flightId/status', asyncHandler(async (req, res) => {
  const flight = await ownedFlight(Number(req.params.flightId), req.user.id);
  const photoCountResult = await db.one('SELECT COUNT(*) AS count FROM images WHERE flight_id = ?', [flight.id]);
  const photoCount = Number(photoCountResult.count);
  const task = await db.one('SELECT * FROM processing_tasks WHERE flight_id = ? ORDER BY id DESC LIMIT 1', [flight.id]);
  let status = (await flightDto(flight)).status;
  let progressPercentage = status === 'COMPLETED' ? 100 : 0;
  let processedPhotos = status === 'COMPLETED' ? photoCount : 0;
  let orthomosaicUrl = null;
  let errorMessage = null;

  if (task) {
    const { normalizedStatus, taskInfo } = require('../services/nodeodm');
    const info = await taskInfo(task.task_uuid);
    const taskStatus = normalizedStatus(info);
    status = ({ queued: 'PENDING', running: 'PROCESSING', completed: 'COMPLETED', failed: 'FAILED', canceled: 'FAILED' })[taskStatus] || status;
    const reportedProgress = Number(info.progress && (info.progress.percent || info.progress));
    progressPercentage = status === 'COMPLETED' ? 100
      : Number.isFinite(reportedProgress) ? Math.max(0, Math.min(99, reportedProgress))
        : status === 'PROCESSING' ? 50 : 0;
    processedPhotos = Math.round(photoCount * progressPercentage / 100);
    if (status === 'COMPLETED') orthomosaicUrl = `/api/vuelos/${flight.id}/resultados/descarga`;
    if (status === 'FAILED') errorMessage = task.error || 'NodeODM no pudo procesar las imágenes.';
    await db.execute(
      'UPDATE processing_tasks SET status = ?, info_json = ?, updated_at = NOW() WHERE id = ?',
      [taskStatus, JSON.stringify(info), task.id]
    );
    await db.execute('UPDATE flights SET status = ?, updated_at = NOW() WHERE id = ?', [taskStatus, flight.id]);
  }

  res.json({
    id: String(flight.id),
    status,
    progressPercentage,
    totalPhotos: photoCount,
    processedPhotos,
    orthomosaicUrl,
    errorMessage
  });
}));

module.exports = router;

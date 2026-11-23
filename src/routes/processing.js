const { Router } = require('express');
const db = require('../db');
const { ownedFlight } = require('../services/access');
const { contoursFromDsm } = require('../services/contours');
const { normalizedStatus, pipeResults, taskInfo } = require('../services/nodeodm');
const { asyncHandler, httpError } = require('../utils/http');

const router = Router();

async function latestTask(flightId) {
  const task = await db.one('SELECT * FROM processing_tasks WHERE flight_id = ? ORDER BY id DESC LIMIT 1', [flightId]);
  if (!task) throw httpError(404, 'Este vuelo todavía no tiene una tarea de procesamiento.');
  return task;
}

router.get('/vuelos/:flightId/procesamiento', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  await ownedFlight(flightId, req.user.id);
  const task = await latestTask(flightId);
  const info = await taskInfo(task.task_uuid);
  const status = normalizedStatus(info);
  await db.execute(
    'UPDATE processing_tasks SET status = ?, info_json = ?, error = ?, updated_at = NOW() WHERE id = ?',
    [status, JSON.stringify(info), status === 'failed' ? JSON.stringify(info.error || info) : null, task.id]
  );
  await db.execute('UPDATE flights SET status = ?, updated_at = NOW() WHERE id = ?', [status, flightId]);
  res.json({ taskId: task.task_uuid, status, info });
}));

router.get('/vuelos/:flightId/resultados', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  await ownedFlight(flightId, req.user.id);
  const task = await latestTask(flightId);
  const info = await taskInfo(task.task_uuid);
  const status = normalizedStatus(info);
  if (status !== 'completed') throw httpError(409, `El procesamiento aún no está completo (estado: ${status}).`);
  await db.execute(
    'UPDATE processing_tasks SET status = ?, info_json = ?, updated_at = NOW() WHERE id = ?',
    [status, JSON.stringify(info), task.id]
  );
  res.json({
    taskId: task.task_uuid,
    status,
    outputs: info.outputs || info.output || [],
    downloadUrl: `/api/vuelos/${flightId}/resultados/descarga`,
    dsmUploadUrl: `/api/vuelos/${flightId}/dsm`
  });
}));

router.get('/vuelos/:flightId/resultados/descarga', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  await ownedFlight(flightId, req.user.id);
  const task = await latestTask(flightId);
  if (normalizedStatus(await taskInfo(task.task_uuid)) !== 'completed') {
    throw httpError(409, 'El archivo estará disponible al finalizar el procesamiento.');
  }
  await pipeResults(task.task_uuid, res);
}));

router.get('/vuelos/:flightId/curvas', asyncHandler(async (req, res) => {
  const flight = await ownedFlight(Number(req.params.flightId), req.user.id);
  if (!flight.dsm_path) throw httpError(409, 'Carga el DSM GeoTIFF del vuelo antes de generar curvas de nivel.');
  const interval = Number(req.query.interval || 1);
  res.json(await contoursFromDsm(flight.dsm_path, interval));
}));

module.exports = router;

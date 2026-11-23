const { Router } = require('express');
const db = require('../db');
const { ownedFlight, ownedProject } = require('../services/access');
const { asyncHandler, httpError } = require('../utils/http');

const router = Router();

router.get('/proyectos/:projectId/vuelos', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  await ownedProject(projectId, req.user.id);
  res.json(await db.many('SELECT * FROM flights WHERE project_id = ? ORDER BY id DESC', [projectId]));
}));

router.post('/proyectos/:projectId/vuelos', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  await ownedProject(projectId, req.user.id);
  const name = String(req.body.name || '').trim();
  const flightDate = req.body.flightDate ? String(req.body.flightDate) : null;
  if (!name || name.length > 150) throw httpError(400, 'El nombre del vuelo es obligatorio (máximo 150 caracteres).');
  if (flightDate && !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) throw httpError(400, 'flightDate debe usar el formato YYYY-MM-DD.');
  const flight = await db.one(
    'INSERT INTO flights (project_id, name, flight_date) VALUES (?, ?, ?) RETURNING *',
    [projectId, name, flightDate]
  );
  res.status(201).json(flight);
}));

router.get('/vuelos/:flightId', asyncHandler(async (req, res) => {
  res.json(await ownedFlight(Number(req.params.flightId), req.user.id));
}));

router.put('/vuelos/:flightId', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  const flight = await ownedFlight(flightId, req.user.id);
  const name = String(req.body.name || '').trim();
  const flightDate = req.body.flightDate ? String(req.body.flightDate) : null;
  if (!name || name.length > 150) throw httpError(400, 'El nombre del vuelo es obligatorio (máximo 150 caracteres).');
  if (flightDate && !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) throw httpError(400, 'flightDate debe usar el formato YYYY-MM-DD.');
  await db.execute('UPDATE flights SET name = ?, flight_date = ?, updated_at = NOW() WHERE id = ?', [name, flightDate, flightId]);
  res.json({ ...flight, name, flight_date: flightDate });
}));

router.delete('/vuelos/:flightId', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  await ownedFlight(flightId, req.user.id);
  await db.execute('DELETE FROM flights WHERE id = ?', [flightId]);
  res.status(204).end();
}));

module.exports = router;

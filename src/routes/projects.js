const { Router } = require('express');
const db = require('../db');
const { ownedProject } = require('../services/access');
const { asyncHandler, httpError } = require('../utils/http');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(await db.many('SELECT * FROM projects WHERE user_id = ? ORDER BY id DESC', [req.user.id]));
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  if (!name || name.length > 150 || description.length > 2000) throw httpError(400, 'Nombre o descripción de proyecto no válidos.');
  const project = await db.one(
    'INSERT INTO projects (user_id, name, description) VALUES (?, ?, ?) RETURNING *',
    [req.user.id, name, description]
  );
  res.status(201).json(project);
}));

router.get('/:projectId', asyncHandler(async (req, res) => {
  res.json(await ownedProject(Number(req.params.projectId), req.user.id));
}));

router.put('/:projectId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  await ownedProject(projectId, req.user.id);
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  if (!name || name.length > 150 || description.length > 2000) throw httpError(400, 'Nombre o descripción de proyecto no válidos.');
  await db.execute('UPDATE projects SET name = ?, description = ?, updated_at = NOW() WHERE id = ?', [name, description, projectId]);
  res.json(await ownedProject(projectId, req.user.id));
}));

router.delete('/:projectId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  await ownedProject(projectId, req.user.id);
  await db.execute('DELETE FROM projects WHERE id = ?', [projectId]);
  res.status(204).end();
}));

module.exports = router;

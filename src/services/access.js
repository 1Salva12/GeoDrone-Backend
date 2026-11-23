const db = require('../db');
const { httpError } = require('../utils/http');

async function ownedProject(projectId, userId) {
  const project = await db.one('SELECT * FROM projects WHERE id = ? AND user_id = ?', [projectId, userId]);
  if (!project) throw httpError(404, 'Proyecto no encontrado.');
  return project;
}

async function ownedFlight(flightId, userId) {
  const flight = await db.one(`
    SELECT f.* FROM flights f
    JOIN projects p ON p.id = f.project_id
    WHERE f.id = ? AND p.user_id = ?
  `, [flightId, userId]);
  if (!flight) throw httpError(404, 'Vuelo no encontrado.');
  return flight;
}

module.exports = { ownedFlight, ownedProject };

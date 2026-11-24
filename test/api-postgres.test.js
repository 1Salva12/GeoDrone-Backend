const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { newDb } = require('pg-mem');

const tempDir = path.join(os.tmpdir(), `geodrone-api-${process.pid}`);
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/geodrone';
process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');

const memoryDatabase = newDb();
const { Pool: MemoryPool } = memoryDatabase.adapters.createPg();
require('pg').Pool = MemoryPool;

const db = require('../src/db');
const app = require('../src/app');
let server;
let baseUrl;

test('contrato de Cordenadas para PostgreSQL pasa con pg-mem', async (t) => {
  await db.initialize();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.pool.end();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Cordenadas', email: 'mobile@example.com', password: 'secure-password-123' })
  });
  assert.equal(registration.status, 200);
  const registered = await registration.json();
  assert.equal(typeof registered.user.id, 'string');
  assert.equal(registered.user.email, 'mobile@example.com');
  const { token } = registered;
  const authHeaders = { authorization: `Bearer ${token}` };

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'mobile@example.com', password: 'secure-password-123' })
  });
  assert.equal(login.status, 200);
  assert.equal(typeof (await login.json()).token, 'string');

  const expiredToken = jwt.sign({}, process.env.JWT_SECRET, { subject: '1', expiresIn: -1 });
  const expiredResponse = await fetch(`${baseUrl}/api/projects`, {
    headers: { authorization: `Bearer ${expiredToken}` }
  });
  assert.equal(expiredResponse.status, 401);

  const projectResponse = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Levantamiento', description: 'Prueba', locationName: 'Zona Norte' })
  });
  assert.equal(projectResponse.status, 200);
  const project = await projectResponse.json();
  assert.equal(project.locationName, 'Zona Norte');
  assert.match(project.createdAt, /^\d{4}-\d{2}-\d{2}$/);

  const projectListResponse = await fetch(`${baseUrl}/api/projects`, { headers: authHeaders });
  assert.equal(projectListResponse.status, 200);
  assert.equal((await projectListResponse.json())[0].id, project.id);

  const projectDetailResponse = await fetch(`${baseUrl}/api/projects/${project.id}`, { headers: authHeaders });
  assert.equal(projectDetailResponse.status, 200);
  assert.equal((await projectDetailResponse.json()).name, project.name);

  const flightResponse = await fetch(`${baseUrl}/api/projects/${project.id}/flights`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      flightName: 'Vuelo 1',
      date: '2026-11-22',
      droneModel: 'DJI',
      altitudeMeters: 80,
      overlapPercentage: 75
    })
  });
  assert.equal(flightResponse.status, 200);
  const flight = await flightResponse.json();
  assert.equal(flight.projectId, project.id);
  assert.equal(flight.status, 'PENDING');

  const flightsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/flights`, { headers: authHeaders });
  assert.equal(flightsResponse.status, 200);
  assert.equal((await flightsResponse.json())[0].flightName, 'Vuelo 1');

  const statusResponse = await fetch(`${baseUrl}/api/flights/${flight.id}/status`, { headers: authHeaders });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).status, 'PENDING');

  const measurementResponse = await fetch(`${baseUrl}/api/measurements/calculate`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      points: [
        { id: '1', name: 'P1', latitude: 19, longitude: -99, altitude: 100 },
        { id: '2', name: 'P2', latitude: 19, longitude: -98.999, altitude: 110 },
        { id: '3', name: 'P3', latitude: 19.001, longitude: -98.999, altitude: 120 }
      ]
    })
  });
  assert.equal(measurementResponse.status, 200);
  const measurement = await measurementResponse.json();
  assert.ok(measurement.distance2d > 100);
  assert.ok(measurement.distance3d > measurement.distance2d);
  assert.ok(measurement.areaM2 > 0);

  const persisted = await db.one('SELECT COUNT(*) AS count FROM mediciones WHERE user_id = ?', [1]);
  assert.equal(Number(persisted.count), 1);
});

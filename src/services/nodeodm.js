const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const config = require('../config');
const { httpError } = require('../utils/http');

function authHeaders() {
  return config.nodeOdmToken ? { Authorization: `Bearer ${config.nodeOdmToken}` } : {};
}

async function submitTask(files) {
  const form = new FormData();
  for (const file of files) {
    const bytes = await fs.readFile(file.path);
    form.append('images', new Blob([bytes]), path.basename(file.path));
  }
  form.append('options', JSON.stringify(config.nodeOdmOptions));

  const response = await fetch(`${config.nodeOdmUrl}/task/new`, {
    method: 'POST',
    headers: authHeaders(),
    body: form
  });
  const body = await response.text();
  if (!response.ok) throw httpError(502, `NodeODM rechazó el procesamiento (${response.status}): ${body}`);

  let taskUuid = body.trim();
  try {
    const parsed = JSON.parse(body);
    taskUuid = parsed.uuid || parsed.taskUuid || parsed.id;
  } catch {
    taskUuid = body.trim().replace(/^"|"$/g, '');
  }
  if (!taskUuid || !/^[\w-]+$/.test(taskUuid)) {
    throw httpError(502, 'NodeODM devolvió un identificador de tarea inválido.');
  }
  return taskUuid;
}

async function taskInfo(taskUuid) {
  const response = await fetch(`${config.nodeOdmUrl}/task/${encodeURIComponent(taskUuid)}/info`, {
    headers: authHeaders()
  });
  const text = await response.text();
  if (!response.ok) throw httpError(502, `No fue posible consultar NodeODM (${response.status}): ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, 'NodeODM devolvió información de tarea inválida.');
  }
}

function normalizedStatus(info) {
  const status = info && info.status;
  const code = typeof status === 'object' && status !== null ? status.code : status;
  const descriptions = { 10: 'queued', 20: 'running', 30: 'completed', 40: 'failed', 50: 'canceled' };
  if (descriptions[Number(code)]) return descriptions[Number(code)];
  const value = typeof status === 'string' ? status.toLowerCase() : '';
  return ['queued', 'running', 'completed', 'failed', 'canceled'].includes(value) ? value : 'unknown';
}

async function pipeResults(taskUuid, response) {
  const upstream = await fetch(`${config.nodeOdmUrl}/task/${encodeURIComponent(taskUuid)}/download/all.zip`, {
    headers: authHeaders()
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    throw httpError(502, `NodeODM no pudo entregar los resultados (${upstream.status}): ${detail}`);
  }
  response.setHeader('Content-Type', 'application/zip');
  response.setHeader('Content-Disposition', `attachment; filename="vuelo-${taskUuid}-resultados.zip"`);
  Readable.fromWeb(upstream.body).pipe(response);
}

module.exports = { normalizedStatus, pipeResults, submitTask, taskInfo };

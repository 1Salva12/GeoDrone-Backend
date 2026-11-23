const multer = require('multer');
const { httpError } = require('../utils/http');

function errorHandler(error, _req, res, _next) {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: error.message });
  }
  if (error.code === '23505') {
    return res.status(409).json({ error: 'El recurso ya existe.' });
  }
  if (typeof error.code === 'string' && error.code.startsWith('08')) {
    console.error('Error de conexión con PostgreSQL.', error);
    return res.status(503).json({ error: 'La base de datos no está disponible temporalmente.' });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: status >= 500 ? 'Error interno del servidor.' : error.message });
}

function notFound(_req, _res, next) {
  next(httpError(404, 'Ruta no encontrada.'));
}

module.exports = { errorHandler, notFound };

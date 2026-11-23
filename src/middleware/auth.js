const jwt = require('jsonwebtoken');
const config = require('../config');
const { httpError } = require('../utils/http');

function authenticate(req, _res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return next(httpError(401, 'Se requiere un token Bearer.'));

  try {
    const payload = jwt.verify(match[1], config.jwtSecret);
    req.user = { id: Number(payload.sub), email: payload.email };
    return next();
  } catch {
    return next(httpError(401, 'Token inválido o expirado.'));
  }
}

module.exports = authenticate;

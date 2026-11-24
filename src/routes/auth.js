const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { asyncHandler, httpError } = require('../utils/http');

const router = Router();

function credentials(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'El correo electrónico no es válido.');
  if (password.length < 8 || password.length > 128) {
    throw httpError(400, 'La contraseña debe tener entre 8 y 128 caracteres.');
  }
  return { email, password };
}

function issueToken(user) {
  return jwt.sign({ email: user.email }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn
  });
}

router.post('/register', asyncHandler(async (req, res) => {
  const { email, password } = credentials(req.body);
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 100) throw httpError(400, 'El nombre debe tener entre 2 y 100 caracteres.');
  if (await db.one('SELECT id FROM users WHERE email = ?', [email])) {
    throw httpError(409, 'Ya existe una cuenta con ese correo.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.one(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING id',
    [name, email, passwordHash]
  );
  const user = { id: result.id, name, email };
  res.json({ user: { ...user, id: String(user.id) }, token: issueToken(user) });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = credentials(req.body);
  const user = await db.one('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw httpError(401, 'Correo o contraseña incorrectos.');
  }
  res.json({
    user: { id: String(user.id), name: user.name, email: user.email },
    token: issueToken(user)
  });
}));

module.exports = router;

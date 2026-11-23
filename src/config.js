const path = require('node:path');
require('dotenv').config();

const root = path.resolve(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads')),
  nodeOdmUrl: (process.env.NODEODM_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  nodeOdmToken: process.env.NODEODM_TOKEN || '',
  nodeOdmOptions: JSON.parse(process.env.NODEODM_OPTIONS || '[{"name":"dsm","value":true}]'),
  corsOrigin: process.env.CORS_ORIGIN || '*'
};

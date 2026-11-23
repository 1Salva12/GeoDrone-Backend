const config = require('./config');
const db = require('./db');

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('Configura JWT_SECRET con al menos 32 caracteres en el archivo .env.');
}

db.initialize().then(() => {
  const app = require('./app');
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`GeoDrone API escuchando en http://localhost:${config.port}`);
  });
  const shutdown = () => {
    server.close(() => {
      db.pool.end().finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}).catch((error) => {
  console.error('No se pudo inicializar la base de datos.', error);
  process.exitCode = 1;
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const authenticate = require('./middleware/auth');
const { errorHandler, notFound } = require('./middleware/errors');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const flightRoutes = require('./routes/flights');
const imageRoutes = require('./routes/images');
const processingRoutes = require('./routes/processing');
const measurementRoutes = require('./routes/measurements');
const reportRoutes = require('./routes/reports');
const mobileRoutes = require('./routes/mobile');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin }));
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), authRoutes);
app.use('/api', authenticate);
app.use('/api', mobileRoutes);
app.use('/api/proyectos', projectRoutes);
app.use('/api', flightRoutes);
app.use('/api', imageRoutes);
app.use('/api', processingRoutes);
app.use('/api/mediciones', measurementRoutes);
app.use('/api/measurements', measurementRoutes);
app.use('/api/reportes', reportRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;

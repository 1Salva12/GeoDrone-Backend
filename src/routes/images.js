const fs = require('node:fs');
const path = require('node:path');
const { Router } = require('express');
const multer = require('multer');
const exifr = require('exifr');
const db = require('../db');
const config = require('../config');
const { ownedFlight } = require('../services/access');
const { submitTask } = require('../services/nodeodm');
const { validateDsm } = require('../services/dsm');
const { asyncHandler, httpError } = require('../utils/http');

const router = Router();

function storageForFlight() {
  return multer.diskStorage({
    destination(req, _file, callback) {
      const directory = path.join(config.uploadDir, 'flights', String(req.params.flightId));
      fs.mkdirSync(directory, { recursive: true });
      callback(null, directory);
    },
    filename(_req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${require('node:crypto').randomUUID()}${extension}`);
    }
  });
}

const imageUpload = multer({
  storage: storageForFlight(),
  limits: { fileSize: 100 * 1024 * 1024, files: 500 },
  fileFilter(_req, file, callback) {
    if (!['.jpg', '.jpeg', '.png', '.tif', '.tiff'].includes(path.extname(file.originalname).toLowerCase())) {
      return callback(httpError(400, 'Solo se aceptan imágenes JPG, PNG o TIFF.'));
    }
    callback(null, true);
  }
});

const dsmUpload = multer({
  storage: storageForFlight(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!['.tif', '.tiff'].includes(path.extname(file.originalname).toLowerCase())) {
      return callback(httpError(400, 'El DSM debe ser un GeoTIFF (.tif o .tiff).'));
    }
    callback(null, true);
  }
});

const requireFlightOwner = asyncHandler(async (req, _res, next) => {
  await ownedFlight(Number(req.params.flightId), req.user.id);
  next();
});

router.get('/vuelos/:flightId/imagenes', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  await ownedFlight(flightId, req.user.id);
  res.json(await db.many(
    'SELECT id, flight_id, original_name, latitude, longitude, created_at FROM images WHERE flight_id = ? ORDER BY id',
    [flightId]
  ));
}));

const receiveImages = asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  await ownedFlight(flightId, req.user.id);
  if (!req.files || req.files.length === 0) throw httpError(400, 'Adjunta al menos una imagen usando el campo "imagenes".');

  const imageMetadata = [];
  try {
    for (const file of req.files) {
      const metadata = await exifr.parse(file.path, { gps: true });
      const latitude = metadata && metadata.latitude;
      const longitude = metadata && metadata.longitude;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw httpError(400, `La imagen "${file.originalname}" no contiene coordenadas GPS EXIF válidas.`);
      }
      imageMetadata.push({ file, latitude, longitude });
    }
  } catch (error) {
    await Promise.all(req.files.map((file) => require('node:fs/promises').rm(file.path, { force: true })));
    if (error.status) throw error;
    throw httpError(400, 'No fue posible leer los metadatos GPS de una imagen.');
  }

  const stored = [];
  for (const { file, latitude, longitude } of imageMetadata) {
    const image = await db.one(`
      INSERT INTO images (flight_id, original_name, stored_path, latitude, longitude)
      VALUES (?, ?, ?, ?, ?) RETURNING id
    `, [flightId, file.originalname, file.path, latitude, longitude]);
    stored.push({ id: image.id, originalName: file.originalname, latitude, longitude });
  }

  try {
    const taskUuid = await submitTask(req.files);
    await db.execute('INSERT INTO processing_tasks (flight_id, task_uuid, status) VALUES (?, ?, ?)', [flightId, taskUuid, 'queued']);
    await db.execute("UPDATE flights SET status = 'queued', updated_at = NOW() WHERE id = ?", [flightId]);
    res.json({
      images: stored,
      uploadedCount: stored.length,
      failedPhotos: [],
      message: 'Fotos subidas correctamente',
      processing: { status: 'queued', taskId: taskUuid, statusUrl: `/api/vuelos/${flightId}/procesamiento` }
    });
  } catch (error) {
    await db.execute("UPDATE flights SET status = 'processing_error', updated_at = NOW() WHERE id = ?", [flightId]);
    throw error;
  }
});

router.post('/vuelos/:flightId/imagenes', requireFlightOwner, imageUpload.array('imagenes', 500), receiveImages);
router.post('/flights/:flightId/photos', requireFlightOwner, imageUpload.array('photos', 500), receiveImages);

router.post('/vuelos/:flightId/dsm', requireFlightOwner, dsmUpload.single('dsm'), asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  const flight = await ownedFlight(flightId, req.user.id);
  if (!req.file) throw httpError(400, 'Adjunta el archivo GeoTIFF en el campo "dsm".');
  await validateDsm(req.file.path);
  await db.execute('UPDATE flights SET dsm_path = ?, updated_at = NOW() WHERE id = ?', [req.file.path, flight.id]);
  res.status(201).json({ message: 'DSM guardado.', fileName: req.file.originalname });
}));

module.exports = router;

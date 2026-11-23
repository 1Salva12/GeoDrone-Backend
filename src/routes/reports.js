const { Router } = require('express');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { ownedFlight } = require('../services/access');
const { asyncHandler } = require('../utils/http');

const router = Router();

async function measurementsFor(flightId, userId) {
  await ownedFlight(flightId, userId);
  return db.many(
    'SELECT * FROM mediciones WHERE flight_id = ? AND user_id = ? ORDER BY created_at, id',
    [flightId, userId]
  );
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return `"${text.replace(/"/g, '""')}"`;
}

router.get('/:flightId.csv', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  const rows = await measurementsFor(flightId, req.user.id);
  const lines = [
    ['id', 'tipo', 'resultado', 'unidad', 'geometria_wgs84', 'detalles', 'fecha'].map(csvCell).join(','),
    ...rows.map((row) => [
      row.id, row.type, row.result_value, row.unit, row.geometry_json, row.details_json, row.created_at.toISOString()
    ].map(csvCell).join(','))
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vuelo-${flightId}-mediciones.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

router.get('/:flightId.pdf', asyncHandler(async (req, res) => {
  const flightId = Number(req.params.flightId);
  const rows = await measurementsFor(flightId, req.user.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="vuelo-${flightId}-mediciones.pdf"`);
  const pdf = new PDFDocument({ margin: 48 });
  pdf.pipe(res);
  pdf.fontSize(20).text(`Reporte de mediciones - Vuelo ${flightId}`);
  pdf.moveDown();
  if (rows.length === 0) {
    pdf.fontSize(11).text('No hay mediciones registradas para este vuelo.');
  } else {
    for (const row of rows) {
      pdf.fontSize(12).text(`${row.type}: ${row.result_value} ${row.unit}`);
      pdf.fontSize(9).fillColor('gray').text(`Fecha: ${row.created_at.toISOString()}`);
      pdf.fillColor('black').text(`Geometría WGS84: ${row.geometry_json}`);
      pdf.moveDown(0.7);
    }
  }
  pdf.end();
}));

module.exports = router;

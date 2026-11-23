const geotiff = require('geotiff');
const proj4 = require('proj4');
const { httpError } = require('../utils/http');

async function contoursFromDsm(filePath, interval) {
  if (!Number.isFinite(interval) || interval <= 0) throw httpError(400, 'El intervalo de curvas debe ser mayor que cero.');
  const tiff = await geotiff.fromFile(filePath);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (width * height > 4000000) throw httpError(413, 'El DSM supera el límite de 4 millones de celdas para generar curvas.');
  const keys = image.getGeoKeys();
  const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey;
  if (!epsg || epsg === 32767) throw httpError(422, 'El DSM requiere un GeoTIFF con código EPSG conocido.');
  const sourceProjection = `EPSG:${epsg}`;
  const [originX, originY] = image.getOrigin();
  const [resolutionX, resolutionY] = image.getResolution();
  const raster = await image.readRasters({ samples: [0] });
  const values = raster[0];
  const noData = typeof image.getGDALNoData === 'function' ? Number(image.getGDALNoData()) : null;
  const isValid = (value) => Number.isFinite(Number(value)) && (noData === null || Number(value) !== noData);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const item of values) {
    const value = Number(item);
    if (isValid(value)) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  if (!Number.isFinite(minimum)) throw httpError(422, 'El DSM no contiene elevaciones válidas.');

  const firstLevel = Math.ceil(minimum / interval) * interval;
  const levelCount = Math.floor((maximum - firstLevel) / interval) + 1;
  if (levelCount > 500) throw httpError(400, 'El intervalo produciría más de 500 niveles; aumenta el intervalo.');

  const features = [];
  const maxSegments = 100000;
  for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
    const level = firstLevel + levelIndex * interval;
    for (let row = 0; row < height - 1; row += 1) {
      for (let col = 0; col < width - 1; col += 1) {
        const samples = [
          { x: col, y: row, z: Number(values[row * width + col]) },
          { x: col + 1, y: row, z: Number(values[row * width + col + 1]) },
          { x: col + 1, y: row + 1, z: Number(values[(row + 1) * width + col + 1]) },
          { x: col, y: row + 1, z: Number(values[(row + 1) * width + col]) }
        ];
        if (samples.some((sample) => !isValid(sample.z))) continue;
        const intersections = [];
        for (let edge = 0; edge < 4; edge += 1) {
          const first = samples[edge];
          const second = samples[(edge + 1) % 4];
          if ((first.z < level && second.z >= level) || (second.z < level && first.z >= level)) {
            const fraction = (level - first.z) / (second.z - first.z);
            intersections.push({ x: first.x + fraction * (second.x - first.x), y: first.y + fraction * (second.y - first.y) });
          }
        }
        for (let index = 0; index + 1 < intersections.length; index += 2) {
          const segment = intersections.slice(index, index + 2).map((pixel) => {
            const projected = [originX + (pixel.x + 0.5) * resolutionX, originY + (pixel.y + 0.5) * resolutionY];
            return proj4(sourceProjection, 'EPSG:4326', projected);
          });
          features.push({
            type: 'Feature',
            properties: { elevation: level, unit: 'm' },
            geometry: { type: 'LineString', coordinates: segment }
          });
          if (features.length > maxSegments) throw httpError(413, 'La generación superó el límite de 100000 segmentos de curva.');
        }
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

module.exports = { contoursFromDsm };

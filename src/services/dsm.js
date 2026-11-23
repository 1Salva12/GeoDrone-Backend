const fs = require('node:fs/promises');
const geotiff = require('geotiff');
const proj4 = require('proj4');
const { httpError } = require('../utils/http');

async function elevationAt(path, point) {
  const tiff = await geotiff.fromFile(path);
  const image = await tiff.getImage();
  const geoKeys = image.getGeoKeys();
  const epsg = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
  if (!epsg || epsg === 32767) throw httpError(422, 'El DSM requiere un GeoTIFF con código EPSG conocido.');

  let [x, y] = [point.lon, point.lat];
  if (epsg !== 4326) [x, y] = proj4('EPSG:4326', `EPSG:${epsg}`, [x, y]);

  const [originX, originY] = image.getOrigin();
  const [resolutionX, resolutionY] = image.getResolution();
  const pixelX = Math.floor((x - originX) / resolutionX);
  const pixelY = Math.floor((y - originY) / resolutionY);
  if (pixelX < 0 || pixelY < 0 || pixelX >= image.getWidth() || pixelY >= image.getHeight()) {
    throw httpError(422, 'El punto está fuera de la cobertura del DSM.');
  }

  const raster = await image.readRasters({ window: [pixelX, pixelY, pixelX + 1, pixelY + 1], samples: [0] });
  const value = Number(raster[0][0]);
  const noData = typeof image.getGDALNoData === 'function' ? image.getGDALNoData() : null;
  if (!Number.isFinite(value) || (noData !== null && value === Number(noData))) {
    throw httpError(422, 'El DSM no contiene elevación válida en el punto indicado.');
  }
  return value;
}

async function validateDsm(path) {
  try {
    const tiff = await geotiff.fromFile(path);
    const image = await tiff.getImage();
    if (image.getWidth() < 1 || image.getHeight() < 1) throw new Error('Empty raster');
    return true;
  } catch (error) {
    await fs.rm(path, { force: true });
    throw httpError(400, `El archivo DSM no es un GeoTIFF válido: ${error.message}`);
  }
}

module.exports = { elevationAt, validateDsm };

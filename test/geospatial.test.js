const test = require('node:test');
const assert = require('node:assert/strict');
const { area, distance, perimeter, projectToUtm } = require('../src/services/geospatial');

const square = [
  { lat: 19, lon: -99 },
  { lat: 19, lon: -98.999 },
  { lat: 19.001, lon: -98.999 },
  { lat: 19.001, lon: -99 }
];

test('proyecta WGS84 a UTM y conserva el EPSG de zona/hemisferio', () => {
  const projected = projectToUtm([{ lat: 19, lon: -99 }]);
  assert.equal(projected.reference.epsg, 32614);
  assert.ok(Number.isFinite(projected.projected[0].x));
  assert.ok(Number.isFinite(projected.projected[0].y));
  assert.equal(projectToUtm([{ lat: 60, lon: 6 }]).reference.epsg, 32632);
  assert.equal(projectToUtm([{ lat: 78, lon: 15 }]).reference.epsg, 32633);
});

test('calcula distancia de una línea en metros UTM', () => {
  const result = distance(square.slice(0, 2));
  assert.equal(result.unit, 'm');
  assert.ok(result.value > 100 && result.value < 120);
});

test('calcula perímetro cerrado y área Shoelace sin depender del orden', () => {
  const forwardArea = area(square);
  const reverseArea = area([...square].reverse());
  const closedPerimeter = perimeter([...square, square[0]]);
  assert.ok(forwardArea.value > 10000 && forwardArea.value < 13000);
  assert.ok(Math.abs(forwardArea.value - reverseArea.value) < 0.01);
  assert.ok(closedPerimeter.value > 400 && closedPerimeter.value < 450);
  assert.equal(forwardArea.unit, 'm2');
});

test('rechaza geometrías y latitudes fuera de UTM', () => {
  assert.throws(() => distance([{ lat: 19, lon: -99 }]), /al menos 2/);
  assert.throws(() => area([{ lat: 89, lon: 0 }, { lat: 89, lon: 1 }, { lat: 88, lon: 1 }]), /latitud/);
  assert.throws(() => distance([{ lat: null, lon: -99 }, { lat: 19, lon: -98 }]), /numéricas/);
});

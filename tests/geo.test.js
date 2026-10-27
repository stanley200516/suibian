import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RADIUS_KM } from '../js/config.js';
import { estimateMinutes, haversineKm, offsetKm, radiusKmForMinutes, randomPointInCircle } from '../js/geo.js';
import { REGIONS } from '../js/regions.js';

const TW = REGIONS.TW.travel;

const taipeiStation = { lat: 25.0478, lng: 121.517 };
const taipei101 = { lat: 25.0339, lng: 121.5645 };

test('haversine：台北車站到台北 101 約 5 公里', () => {
  const d = haversineKm(taipeiStation, taipei101);
  assert.ok(d > 4.8 && d < 5.2, `got ${d}`);
});

test('radiusKmForMinutes 是 estimateMinutes 的反函數', () => {
  for (const [code, region] of Object.entries(REGIONS)) {
    for (const [id, mode] of Object.entries(region.travel)) {
      for (const minutes of [15, 30, 60, 120]) {
        const r = radiusKmForMinutes(minutes, mode);
        if (r === 0 || r === MAX_RADIUS_KM) continue;
        const back = estimateMinutes(r, mode);
        assert.ok(Math.abs(back - minutes) < 1e-6, `${code} ${id} ${minutes}min → ${r}km → ${back}`);
      }
    }
  }
});

test('合理的半徑範圍', () => {
  const walk15 = radiusKmForMinutes(15, TW.walk);
  assert.ok(walk15 > 0.7 && walk15 < 1.0, `walk 15min = ${walk15}`);
  const scooter60 = radiusKmForMinutes(60, TW.scooter);
  assert.ok(scooter60 > 15 && scooter60 < 35, `scooter 60min = ${scooter60}`);
  assert.equal(radiusKmForMinutes(180, TW.car), MAX_RADIUS_KM);
  assert.equal(radiusKmForMinutes(5, TW.transit), 0, '大眾運輸 5 分鐘到不了');
});

test('offsetKm 與 randomPointInCircle', () => {
  const p = offsetKm(taipeiStation, 3, 4);
  assert.ok(Math.abs(haversineKm(taipeiStation, p) - 5) < 0.05);
  for (let i = 0; i < 200; i++) {
    const q = randomPointInCircle(taipeiStation, 2);
    assert.ok(haversineKm(taipeiStation, q) <= 2.01);
  }
});

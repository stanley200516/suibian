import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_MODES } from '../js/config.js';
import { haversineKm, radiusKmForMinutes } from '../js/geo.js';
import { filterCandidates, mergeUnique } from '../js/picker.js';
import { createDemoProvider } from '../js/providers/demo.js';
import { REGIONS, categoriesFor } from '../js/regions.js';

const origin = { lat: 25.0478, lng: 121.517 };

test('示範資料：結果在半徑內、符合類型、每輪最多 20 筆、可重現', async () => {
  const demo = createDemoProvider();
  const args = { center: origin, origin, radiusM: 1000, types: ['japanese_restaurant'], rankBy: 'distance' };
  const a = await demo.searchNearby(args);
  const b = await demo.searchNearby(args);
  assert.ok(a.length > 0 && a.length <= 20);
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  for (const p of a) {
    assert.ok(haversineKm(origin, p) <= 1);
    assert.ok(p.types.includes('japanese_restaurant'));
  }
});

test('示範資料：走路 15 分鐘的午餐時段有足夠候選', async () => {
  const demo = createDemoProvider();
  const mode = APP_MODES.food;
  const travel = REGIONS.TW.travel.walk;
  const radiusM = radiusKmForMinutes(15, travel) * 1000;
  const lists = await Promise.all(
    ['popularity', 'distance'].map((rankBy) =>
      demo.searchNearby({ center: origin, origin, radiusM, types: categoriesFor('TW', 'food')[0].types, rankBy }),
    ),
  );
  const pool = mergeUnique(lists);
  const tueNoon = new Date(2026, 9, 27, 12, 0); // 裝置時區的週二中午
  const cands = filterCandidates(pool, {
    origin, travel, maxMinutes: 15, when: { type: 'now' }, stayMin: mode.stayMin, now: tueNoon,
  });
  assert.ok(cands.length >= 10, `只有 ${cands.length} 個候選`);
});

test('示範資料：已知地點可以設定為出發點，名稱跟著語言', async () => {
  const zh = createDemoProvider({ lang: 'zh-TW' });
  assert.equal((await zh.geocode('臺北 101')).label, '台北101');
  assert.equal((await zh.geocode('東京駅')).label, '東京車站');
  assert.equal(await zh.geocode('火星'), null);
  const en = createDemoProvider({ lang: 'en' });
  assert.equal((await en.geocode('tokyo station')).label, 'Tokyo Station');
  assert.equal((await en.geocode('times square')).label, 'Times Square');
  const ja = createDemoProvider({ lang: 'ja' });
  assert.equal((await ja.geocode('渋谷')).label, '渋谷');
});

test('示範資料：店名與類型名稱依語言產生', async () => {
  const args = { center: origin, origin, radiusM: 3000, types: ['ramen_restaurant'], rankBy: 'distance' };
  const [zh] = await createDemoProvider({ lang: 'zh-TW' }).searchNearby(args);
  const [en] = await createDemoProvider({ lang: 'en' }).searchNearby(args);
  const [ja] = await createDemoProvider({ lang: 'ja' }).searchNearby(args);
  assert.equal(zh.typeLabel, '拉麵店');
  assert.equal(en.typeLabel, 'Ramen restaurant');
  assert.equal(ja.typeLabel, 'ラーメン店');
  assert.match(en.address, /fictional/);
  assert.equal(zh.lat, en.lat, '同一個地點，只有名稱不同');
});

test('示範資料：每個地區的每個類型都找得到地點', async () => {
  const demo = createDemoProvider();
  for (const code of Object.keys(REGIONS)) {
    for (const mode of ['food', 'trip']) {
      for (const cat of categoriesFor(code, mode)) {
        const found = await demo.searchNearby({ center: origin, origin, radiusM: 50000, types: cat.types, rankBy: 'popularity' });
        assert.ok(found.length > 0, `${code} ${mode} ${cat.id} 沒有示範地點`);
      }
    }
  }
});

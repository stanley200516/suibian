import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, categoriesFor, detectRegion, guessRegionFromTimezone, isCategoryId } from '../js/regions.js';

const CITIES = {
  TW: {
    台北: [25.0478, 121.517],
    高雄: [22.6273, 120.3014],
    花蓮: [23.9872, 121.6015],
    澎湖: [23.5711, 119.5793],
    金門: [24.4328, 118.3171],
    馬祖南竿: [26.1597, 119.9512],
  },
  JP: {
    東京: [35.6812, 139.7671],
    札幌: [43.0618, 141.3545],
    函館: [41.7687, 140.7288],
    福岡: [33.5902, 130.4017],
    長崎: [32.7503, 129.8779],
    五島: [32.6953, 128.8406],
    那霸: [26.2124, 127.6809],
    石垣: [24.3448, 124.1572],
  },
  INTL: {
    廈門: [24.4798, 118.0894],
    福州: [26.0745, 119.2965],
    上海: [31.2304, 121.4737],
    首爾: [37.5665, 126.978],
    釜山: [35.1796, 129.0756],
    濟州: [33.4996, 126.5312],
    海參崴: [43.1155, 131.8855],
    紐約: [40.758, -73.9855],
    倫敦: [51.5074, -0.1278],
    馬尼拉: [14.5995, 120.9842],
  },
};

test('依經緯度判斷地區', () => {
  for (const [expected, cities] of Object.entries(CITIES)) {
    for (const [name, [lat, lng]] of Object.entries(cities)) {
      assert.equal(detectRegion({ lat, lng }), expected, name);
    }
  }
});

test('用時區猜地區', () => {
  assert.equal(guessRegionFromTimezone('Asia/Taipei'), 'TW');
  assert.equal(guessRegionFromTimezone('Asia/Tokyo'), 'JP');
  assert.equal(guessRegionFromTimezone('Europe/Paris'), 'INTL');
  assert.equal(guessRegionFromTimezone(undefined), 'INTL');
});

test('機車只在台灣出現，各地區預設交通方式都存在', () => {
  assert.ok(REGIONS.TW.travel.scooter);
  assert.equal(REGIONS.JP.travel.scooter, undefined);
  assert.equal(REGIONS.INTL.travel.scooter, undefined);
  for (const [code, r] of Object.entries(REGIONS)) {
    for (const mode of ['food', 'trip']) assert.ok(r.travel[r.defaults[mode]], `${code} ${mode} 預設交通方式不存在`);
  }
});

test('類型清單：第一個是「都可以」，每個類型都有 Google 類型代碼', () => {
  for (const code of Object.keys(REGIONS)) {
    for (const mode of ['food', 'trip']) {
      const list = categoriesFor(code, mode);
      assert.equal(list[0].id, 'any');
      assert.equal(new Set(list.map((c) => c.id)).size, list.length, `${code} ${mode} 有重複的類型`);
      for (const c of list) {
        assert.ok(Array.isArray(c.types) && c.types.length, `${code} ${mode} ${c.id} 沒有 Google 類型`);
        assert.ok(c.types.length <= 50, 'Google 一次最多 50 個類型');
      }
    }
  }
  assert.deepEqual(categoriesFor('TW', 'food')[0].types, ['restaurant']);
  assert.ok(categoriesFor('JP', 'trip')[0].types.includes('spa'), '日本的「都可以」包含溫泉');
  assert.ok(!categoriesFor('INTL', 'trip')[0].types.includes('spa'));
});

test('各地區的料理類型有在地特色', () => {
  const ids = (code) => categoriesFor(code, 'food').map((c) => c.id);
  assert.ok(ids('TW').includes('chinese_tw'));
  assert.ok(ids('JP').includes('ramen') && ids('JP').includes('izakaya'));
  assert.ok(ids('INTL').includes('mexican'));
  assert.ok(isCategoryId('food', 'ramen'));
  assert.ok(!isCategoryId('food', 'nature'));
  assert.ok(isCategoryId('trip', 'any'));
});

// 用假的 fetch 驗證 osm.js 的查詢內容與資料轉換（不會連網）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOsmProvider, osmSelectorsFor } from '../js/providers/osm.js';
import { REGIONS, categoriesFor } from '../js/regions.js';

const shinjuku = { lat: 35.6905, lng: 139.6995 };

const ELEMENTS = [
  {
    type: 'node', id: 1, lat: 35.691, lon: 139.7,
    tags: { amenity: 'restaurant', cuisine: 'ramen;gyoza', name: '喜多方ラーメン', 'name:en': 'Kitakata Ramen', opening_hours: 'Mo-Su 10:00-23:00', 'addr:city': '新宿区', 'addr:quarter': '西新宿', 'addr:housenumber': '1' },
  },
  { type: 'node', id: 2, lat: 35.689, lon: 139.701, tags: { amenity: 'fast_food', name: 'つるまる饂飩' } },
  { type: 'way', id: 3, center: { lat: 35.6852, lon: 139.71 }, tags: { leisure: 'park', name: '新宿御苑', wikidata: 'Q1', wikipedia: 'ja:新宿御苑', opening_hours: 'Tu-Su 09:00-16:00; Mo off' } },
  { type: 'node', id: 4, lat: 35.69, lon: 139.7, tags: { amenity: 'restaurant', name: '社員食堂', access: 'private' } },
  { type: 'node', id: 5, lat: 35.69, lon: 139.7, tags: { amenity: 'restaurant' } }, // 沒有店名
  { type: 'node', id: 1, lat: 35.691, lon: 139.7, tags: { amenity: 'restaurant', name: '重複' } },
];

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      ok: next.status === 200,
      status: next.status,
      json: async () => {
        if (next.truncated) throw new SyntaxError('Unexpected end of JSON input');
        return next.body;
      },
    };
  };
  return { impl, calls };
}

test('搜尋：查詢包含對應的 OSM 條件、範圍與店名要求', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { elements: ELEMENTS } }]);
  const osm = createOsmProvider({ lang: 'ja', fetchImpl: impl, nominatimIntervalMs: 0 });
  await osm.searchNearby({ center: shinjuku, radiusM: 870.4, types: ['ramen_restaurant'] });
  const query = new URLSearchParams(calls[0].body).get('data');
  assert.match(query, /\["cuisine"~"ramen",i\]/);
  assert.match(query, /\["name"\]\(around:870,35\.690500,139\.699500\)/);
  assert.match(query, /out center tags/);
});

test('搜尋：轉換成 app 的地點格式，排除沒店名、不對外開放與重複的', async () => {
  const { impl } = fakeFetch([{ status: 200, body: { elements: ELEMENTS } }]);
  const osm = createOsmProvider({ lang: 'zh-TW', fetchImpl: impl });
  const places = await osm.searchNearby({ center: shinjuku, radiusM: 2000, types: ['restaurant', 'park'], rankBy: 'distance' });
  assert.deepEqual(places.map((p) => p.id).sort(), ['osm-node-1', 'osm-node-2', 'osm-way-3']);

  const ramen = places.find((p) => p.id === 'osm-node-1');
  assert.equal(ramen.name, '喜多方ラーメン', '中文介面沒有繁中名稱時用當地名稱');
  assert.equal(ramen.typeLabel, '拉麵');
  assert.equal(ramen.address, '新宿区 西新宿 1');
  assert.equal(ramen.rating, null);
  assert.equal(ramen.hours.periods.length, 7);

  const park = places.find((p) => p.id === 'osm-way-3');
  assert.equal(park.lat, 35.6852, '區域用中心點');
  assert.equal(park.typeLabel, '公園');
  assert.equal(places.find((p) => p.id === 'osm-node-2').hours, null, '沒有營業時間 = 未知');
  assert.equal(places[0].id, 'osm-node-1', '依距離排序');
});

test('搜尋：名稱與類型跟著介面語言', async () => {
  const { impl } = fakeFetch([{ status: 200, body: { elements: ELEMENTS } }]);
  const [ramen] = await createOsmProvider({ lang: 'en', fetchImpl: impl }).searchNearby({ center: shinjuku, radiusM: 500, types: ['restaurant'], rankBy: 'distance' });
  assert.equal(ramen.name, 'Kitakata Ramen');
  assert.equal(ramen.typeLabel, 'Ramen');
});

test('搜尋：知名度排序（有維基資料的排前面）', async () => {
  const { impl } = fakeFetch([{ status: 200, body: { elements: ELEMENTS } }]);
  const places = await createOsmProvider({ fetchImpl: impl }).searchNearby({ center: shinjuku, radiusM: 2000, types: ['restaurant', 'park'], rankBy: 'popularity' });
  assert.equal(places[0].id, 'osm-way-3');
});

const NOMINATIM_HITS = [
  {
    osm_type: 'node', osm_id: 10, lat: '35.6912', lon: '139.7003', category: 'amenity', type: 'restaurant', name: '一蘭',
    extratags: { cuisine: 'ramen', opening_hours: '24/7' }, namedetails: { name: '一蘭', 'name:en': 'Ichiran' },
    address: { city: '新宿区', quarter: '新宿', road: '靖国通り', house_number: '3' },
  },
  { osm_type: 'node', osm_id: 11, lat: '35.69', lon: '139.70', category: 'amenity', type: 'restaurant', name: 'TRATTORIA', extratags: { cuisine: 'italian' }, namedetails: { name: 'TRATTORIA' } },
];

test('Overpass 失敗時改用 Nominatim，結果一樣經過類型篩選', async () => {
  const search = (impl) =>
    createOsmProvider({ lang: 'en', fetchImpl: impl, nominatimIntervalMs: 0 }).searchNearby({ center: shinjuku, radiusM: 800, types: ['ramen_restaurant'] });

  for (const overpassFailure of [{ status: 504 }, new TypeError('Failed to fetch'), { status: 200, truncated: true }, { status: 200, body: { elements: [], remark: 'runtime error: Query timed out' } }]) {
    const { impl, calls } = fakeFetch([overpassFailure, { status: 200, body: NOMINATIM_HITS }]);
    const places = await search(impl);
    assert.deepEqual(places.map((p) => p.id), ['osm-node-10'], '義大利餐廳被篩掉，只留拉麵');
    assert.equal(places[0].name, 'Ichiran');
    assert.equal(places[0].typeLabel, 'Ramen');
    assert.equal(places[0].address, '新宿区 新宿 靖国通り 3');
    assert.ok(places[0].hours, '營業時間來自 extratags');

    const url = new URL(calls[1].url);
    assert.equal(url.host, 'nominatim.openstreetmap.org');
    assert.equal(url.searchParams.get('q'), 'restaurant');
    assert.equal(url.searchParams.get('accept-language'), 'en');
    assert.equal(url.searchParams.get('bounded'), '1');
    assert.equal(url.searchParams.get('viewbox').split(',').length, 4);
  }
});

test('Overpass 失敗後一段時間內直接用 Nominatim；「都可以」會查餐廳和速食', async () => {
  const { impl, calls } = fakeFetch([{ status: 502 }, { status: 200, body: [] }, { status: 200, body: [] }, { status: 200, body: NOMINATIM_HITS }, { status: 200, body: [] }]);
  const osm = createOsmProvider({ fetchImpl: impl, nominatimIntervalMs: 0 });
  await osm.searchNearby({ center: shinjuku, radiusM: 800, types: ['restaurant'] });
  const places = await osm.searchNearby({ center: shinjuku, radiusM: 800, types: ['restaurant'] });
  const hosts = calls.map((c) => new URL(c.url).host);
  assert.deepEqual(hosts, ['overpass-api.de', 'nominatim.openstreetmap.org', 'nominatim.openstreetmap.org', 'nominatim.openstreetmap.org', 'nominatim.openstreetmap.org']);
  assert.deepEqual(calls.slice(1).map((c) => new URL(c.url).searchParams.get('q')), ['restaurant', 'fast food', 'restaurant', 'fast food']);
  assert.equal(places.length, 2);
});

test('地址去掉重複的部分', async () => {
  const hit = { ...NOMINATIM_HITS[0], address: { city: '新宿区', suburb: '新宿', quarter: '新宿', road: '新宿通り', house_number: '3' } };
  const { impl } = fakeFetch([{ status: 502 }, { status: 200, body: [hit] }, { status: 200, body: [] }]);
  const [place] = await createOsmProvider({ lang: 'ja', fetchImpl: impl, nominatimIntervalMs: 0 }).searchNearby({ center: shinjuku, radiusM: 800, types: ['restaurant'] });
  assert.equal(place.address, '新宿区 新宿 新宿通り 3');
});

test('Overpass 和 Nominatim 都失敗才回報錯誤代碼', async () => {
  const search = (impl) => createOsmProvider({ fetchImpl: impl, nominatimIntervalMs: 0 }).searchNearby({ center: shinjuku, radiusM: 500, types: ['restaurant'] });
  await assert.rejects(search(fakeFetch([{ status: 504 }, { status: 503 }, { status: 503 }]).impl), (e) => e.code === 'osm-busy');
  await assert.rejects(search(fakeFetch([new TypeError('x'), new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]).impl), (e) => e.code === 'osm-network');
});

test('改用 Nominatim 時最多查 3 種類型，而且每次間隔一段時間', async () => {
  const responses = [{ status: 504 }, ...Array.from({ length: 5 }, () => ({ status: 200, body: [] }))];
  const { impl, calls } = fakeFetch(responses);
  const times = [];
  const timedImpl = (url, init) => {
    times.push(Date.now());
    return impl(url, init);
  };
  const types = ['tourist_attraction', 'park', 'museum', 'zoo', 'aquarium'];
  await createOsmProvider({ fetchImpl: timedImpl, nominatimIntervalMs: 60 }).searchNearby({ center: shinjuku, radiusM: 20000, types });
  const phrases = calls.slice(1).map((c) => new URL(c.url).searchParams.get('q'));
  assert.deepEqual(phrases, ['attraction', 'park', 'museum']);
  assert.ok(times[3] - times[2] >= 55, '兩次 Nominatim 之間有間隔');
});

test('地名查詢：Nominatim 參數與結果', async () => {
  const { impl, calls } = fakeFetch([
    { status: 200, body: [{ lat: '35.6812', lon: '139.7671', name: '東京駅', display_name: '東京駅, 丸の内, 千代田区' }] },
    { status: 200, body: [] },
  ]);
  const osm = createOsmProvider({ lang: 'ja', fetchImpl: impl, nominatimIntervalMs: 0 });
  assert.deepEqual(await osm.geocode('東京駅', { near: shinjuku }), { lat: 35.6812, lng: 139.7671, label: '東京駅' });
  const url = new URL(calls[0].url);
  assert.equal(url.host, 'nominatim.openstreetmap.org');
  assert.equal(url.searchParams.get('q'), '東京駅');
  assert.equal(url.searchParams.get('accept-language'), 'ja', '沒有日文名稱時用當地名稱，不混英文');
  assert.ok(url.searchParams.get('viewbox'), '以出發點附近為優先');
  assert.equal(await osm.geocode('不存在的地方'), null);
});

test('導航用座標，確保導到正確位置', () => {
  const osm = createOsmProvider();
  const url = new URL(osm.directionsUrl(shinjuku, { lat: 35.691, lng: 139.7, name: 'X' }, 'walking'));
  assert.equal(url.searchParams.get('destination'), '35.691,139.7');
  assert.equal(url.searchParams.get('travelmode'), 'walking');
});

test('每個地區的每個類型都有 OSM 對應條件', () => {
  for (const code of Object.keys(REGIONS)) {
    for (const mode of ['food', 'trip']) {
      for (const cat of categoriesFor(code, mode)) {
        assert.ok(osmSelectorsFor(cat.types).length > 0, `${code} ${mode} ${cat.id} 沒有 OSM 條件`);
      }
    }
  }
});

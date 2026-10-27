// 用假的 Google Maps SDK 驗證 google.js 的請求參數與資料轉換（不會連網）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleProvider } from '../js/providers/google.js';

let lastRequest;
let nextError;

const fakePlace = {
  id: 'ChIJtest',
  displayName: '測試拉麵',
  location: { lat: () => 25.04, lng: () => 121.51 },
  formattedAddress: '台北市中正區測試路 1 號',
  rating: 4.3,
  userRatingCount: 120,
  priceLevel: 'MODERATE',
  primaryTypeDisplayName: '拉麵店',
  types: ['ramen_restaurant', 'restaurant'],
  regularOpeningHours: {
    periods: [{ open: { day: 2, hour: 11, minute: 0 }, close: { day: 2, hour: 21, minute: 0 } }],
    weekdayDescriptions: ['星期一: 休息'],
  },
  utcOffsetMinutes: 480,
  businessStatus: 'OPERATIONAL',
  googleMapsURI: 'https://maps.google.com/?cid=1',
  photos: [{ getURI: ({ maxWidth }) => `https://photo.test/${maxWidth}`, authorAttributions: [{ displayName: '小明' }] }],
};

globalThis.window = globalThis;
globalThis.google = {
  maps: {
    importLibrary: async (name) => {
      assert.equal(name, 'places');
      return {
        SearchNearbyRankPreference: { DISTANCE: 'DISTANCE', POPULARITY: 'POPULARITY' },
        Place: {
          searchNearby: async (req) => {
            lastRequest = req;
            if (nextError) throw nextError;
            return { places: [fakePlace] };
          },
          searchByText: async (req) => {
            lastRequest = req;
            return { places: req.textQuery === '找不到' ? [] : [fakePlace] };
          },
        },
      };
    },
  },
};

beforeEach(() => {
  lastRequest = null;
  nextError = null;
});

test('searchNearby 的請求參數', async () => {
  const g = createGoogleProvider('test');
  await g.searchNearby({ center: { lat: 25, lng: 121 }, radiusM: 87654.3, types: ['restaurant'], rankBy: 'distance' });
  assert.equal(lastRequest.locationRestriction.radius, 50000, '半徑上限 50 公里');
  assert.deepEqual(lastRequest.includedTypes, ['restaurant']);
  assert.equal(lastRequest.rankPreference, 'DISTANCE');
  assert.equal(lastRequest.maxResultCount, 20);
  for (const f of ['regularOpeningHours', 'utcOffsetMinutes', 'location', 'businessStatus']) {
    assert.ok(lastRequest.fields.includes(f), `缺少欄位 ${f}`);
  }
  assert.equal(lastRequest.language, 'en', '預設語言');
  assert.equal('region' in lastRequest, false, '沒有地區代碼就不帶');
  await g.searchNearby({ center: { lat: 25, lng: 121 }, radiusM: 1234.5, types: ['cafe'], rankBy: 'popularity', regionCode: 'jp' });
  assert.equal(lastRequest.locationRestriction.radius, 1235);
  assert.equal(lastRequest.rankPreference, 'POPULARITY');
  assert.equal(lastRequest.region, 'jp');
});

test('語言跟著介面設定', async () => {
  const g = createGoogleProvider('test', { language: 'ja' });
  await g.searchNearby({ center: { lat: 35, lng: 139 }, radiusM: 1000, types: ['restaurant'] });
  assert.equal(lastRequest.language, 'ja');
});

test('轉換成 app 內部的地點格式', async () => {
  const g = createGoogleProvider('test');
  const [p] = await g.searchNearby({ center: { lat: 25, lng: 121 }, radiusM: 1000, types: ['restaurant'] });
  assert.equal(p.id, 'ChIJtest');
  assert.equal(p.name, '測試拉麵');
  assert.equal(p.lat, 25.04);
  assert.equal(p.typeLabel, '拉麵店');
  assert.equal(p.ratingCount, 120);
  assert.deepEqual(p.hours.periods[0], { open: { day: 2, hour: 11, minute: 0 }, close: { day: 2, hour: 21, minute: 0 } });
  assert.equal(p.utcOffsetMinutes, 480);
  assert.equal(g.photoUrl(p), 'https://photo.test/800');
});

test('導航與地圖連結', () => {
  const g = createGoogleProvider('test');
  const url = new URL(g.directionsUrl({ lat: 25, lng: 121 }, { id: 'ChIJtest', name: '測試拉麵' }, 'two-wheeler'));
  assert.equal(url.searchParams.get('destination_place_id'), 'ChIJtest');
  assert.equal(url.searchParams.get('travelmode'), 'two-wheeler');
  assert.equal(url.searchParams.get('origin'), '25,121');
  assert.equal(g.mapsUrl({ mapsUrl: 'https://maps.google.com/?cid=1' }), 'https://maps.google.com/?cid=1');
});

test('錯誤會分類成 code，讓畫面依語言顯示', async () => {
  const g = createGoogleProvider('test');
  const search = () => g.searchNearby({ center: { lat: 25, lng: 121 }, radiusM: 1000, types: ['restaurant'] });
  nextError = new Error('PLACES_SEARCH_NEARBY: PERMISSION_DENIED: Places API (New) has not been used');
  await assert.rejects(search, (err) => err.code === 'denied');
  nextError = new Error('RESOURCE_EXHAUSTED');
  await assert.rejects(search, (err) => err.code === 'quota');
  nextError = new Error('something odd');
  await assert.rejects(search, (err) => err.code === 'generic' && err.detail === 'something odd');
});

test('geocode', async () => {
  const g = createGoogleProvider('test');
  assert.deepEqual(await g.geocode('台北車站'), { lat: 25.04, lng: 121.51, label: '測試拉麵' });
  assert.equal(lastRequest.textQuery, '台北車站');
  assert.equal('locationBias' in lastRequest, false);
  await g.geocode('Central Station', { near: { lat: 35.68, lng: 139.76 }, regionCode: 'jp' });
  assert.deepEqual(lastRequest.locationBias, { center: { lat: 35.68, lng: 139.76 }, radius: 50000 });
  assert.equal(lastRequest.region, 'jp');
  assert.equal(await g.geocode('找不到'), null);
});

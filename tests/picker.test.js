import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS } from '../js/regions.js';
import { offsetKm } from '../js/geo.js';
import { departureFor, filterCandidates, mergeUnique, pickRandom } from '../js/picker.js';

const origin = { lat: 25.0478, lng: 121.517 };
const TW = 480;
const tueNoon = new Date(Date.UTC(2026, 9, 27, 4, 0)); // 台灣時間週二 12:00

const openAllDay = { periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }] };
const closesAt1215 = {
  periods: [{ open: { day: 2, hour: 11, minute: 0 }, close: { day: 2, hour: 12, minute: 15 } }],
};

const place = (id, eastKm, extra = {}) => ({
  id,
  name: id,
  ...offsetKm(origin, eastKm, 0),
  rating: 4.2,
  ratingCount: 100,
  hours: openAllDay,
  utcOffsetMinutes: TW,
  businessStatus: 'OPERATIONAL',
  ...extra,
});

const base = {
  origin,
  travel: REGIONS.TW.travel.walk,
  maxMinutes: 15,
  when: { type: 'now' },
  stayMin: 30,
  now: tueNoon,
};

test('超過時間上限的會被排除', () => {
  const ids = filterCandidates([place('near', 0.3), place('far', 2)], base).map((p) => p.id);
  assert.deepEqual(ids, ['near']);
});

test('用抵達時間判斷營業，且要營業夠久', () => {
  const ids = filterCandidates([place('ok', 0.3), place('closing', 0.3, { hours: closesAt1215 })], base).map((p) => p.id);
  assert.deepEqual(ids, ['ok']);
});

test('指定時間：用指定的出發時間判斷', () => {
  const at = new Date(2026, 9, 27, 11, 0); // 輸入「11:00」，視為店家當地時間
  const ids = filterCandidates([place('closing', 0.3, { hours: closesAt1215 })], {
    ...base,
    when: { type: 'at', at },
    stayMin: 30,
  }).map((p) => p.id);
  assert.deepEqual(ids, ['closing']);
});

test('營業時間未知：依設定決定要不要列入', () => {
  const unknown = place('unknown', 0.3, { hours: null });
  assert.equal(filterCandidates([unknown], base).length, 0);
  assert.equal(filterCandidates([unknown], { ...base, includeUnknownHours: true }).length, 1);
  assert.equal(filterCandidates([unknown], { ...base, when: { type: 'any' } }).length, 1);
});

test('評分、評論數、停業與排除名單', () => {
  const list = [
    place('low', 0.2, { rating: 3.1 }),
    place('noRating', 0.2, { rating: null }),
    place('fewReviews', 0.2, { ratingCount: 3 }),
    place('closedForever', 0.2, { businessStatus: 'CLOSED_PERMANENTLY' }),
    place('excluded', 0.2),
    place('good', 0.2),
  ];
  const ids = filterCandidates(list, {
    ...base,
    minRating: 4,
    minReviews: 10,
    excludeIds: new Set(['excluded']),
  }).map((p) => p.id);
  assert.deepEqual(ids, ['good']);
});

test('附上估計時間與距離', () => {
  const [p] = filterCandidates([place('a', 0.5)], base);
  assert.ok(Math.abs(p.distKm - 0.5) < 0.01);
  assert.equal(p.etaMin, Math.round(((0.5 * 1.3) / 4.5) * 60));
  assert.equal(p.openState, true);
});

test('指定時間是目的地當地時間，不受手機時區影響', () => {
  const at = new Date(2026, 9, 31, 10, 0); // 輸入「10/31 10:00」
  const nyc = { utcOffsetMinutes: -240 }; // 紐約（夏令時間）
  assert.equal(departureFor(nyc, { type: 'at', at }).toISOString(), '2026-10-31T14:00:00.000Z');
  const taipei = { utcOffsetMinutes: 480 };
  assert.equal(departureFor(taipei, { type: 'at', at }).toISOString(), '2026-10-31T02:00:00.000Z');
  assert.equal(departureFor({ utcOffsetMinutes: null }, { type: 'at', at }), at, '沒有時區資料就用手機時區');
  assert.equal(departureFor(nyc, { type: 'now' }, tueNoon), tueNoon);
});

test('pickRandom 會避開最近抽過的，全部避不開時才重複', () => {
  const cands = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  for (let i = 0; i < 50; i++) {
    assert.equal(pickRandom(cands, { avoidIds: ['a', 'b'] }).id, 'c');
  }
  assert.ok(['a', 'b', 'c'].includes(pickRandom(cands, { avoidIds: ['a', 'b', 'c'] }).id));
  assert.equal(pickRandom([], {}), null);
});

test('mergeUnique 依 id 去重', () => {
  const merged = mergeUnique([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]]);
  assert.deepEqual(merged.map((p) => p.id), [1, 2, 3]);
});

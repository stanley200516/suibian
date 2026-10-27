import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, createI18n, detectLang, detectUnits } from '../js/i18n.js';
import { REGIONS, TRAVEL_IDS, categoriesFor } from '../js/regions.js';

const placeholders = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

test('三種語言的字典 key 完全一致', () => {
  const base = Object.keys(LANGS['zh-TW'].dict).sort();
  for (const [id, { dict }] of Object.entries(LANGS)) {
    assert.deepEqual(Object.keys(dict).sort(), base, `${id} 的 key 跟繁中不一致`);
  }
});

test('翻譯不會用到繁中沒有的插入值', () => {
  const zh = LANGS['zh-TW'].dict;
  for (const [id, { dict }] of Object.entries(LANGS)) {
    for (const [key, value] of Object.entries(dict)) {
      for (const name of placeholders(value)) {
        assert.ok(placeholders(zh[key]).has(name), `${id} ${key} 多了 {${name}}`);
      }
    }
  }
});

test('畫面會用到的地區、交通方式、類型都有翻譯', () => {
  for (const { dict } of Object.values(LANGS)) {
    for (const code of Object.keys(REGIONS)) {
      assert.ok(dict[`region.${code}`], `缺 region.${code}`);
      for (const mode of ['food', 'trip']) {
        for (const c of categoriesFor(code, mode)) assert.ok(dict[`cat.${c.id}`], `缺 cat.${c.id}`);
      }
    }
    for (const id of TRAVEL_IDS) assert.ok(dict[`travel.${id}`], `缺 travel.${id}`);
  }
});

test('detectLang', () => {
  assert.equal(detectLang(['zh-TW']), 'zh-TW');
  assert.equal(detectLang(['zh-Hant-HK', 'en']), 'zh-TW');
  assert.equal(detectLang(['ja-JP']), 'ja');
  assert.equal(detectLang(['fr-FR', 'ja', 'en']), 'ja', '跳過不支援的語言');
  assert.equal(detectLang(['ko-KR']), 'en', '都不支援就用英文');
  assert.equal(detectLang([]), 'en');
});

test('detectUnits：美國、英國用英里', () => {
  assert.equal(detectUnits('en-US'), 'imperial');
  assert.equal(detectUnits('en'), 'imperial', 'en 預設是美國');
  assert.equal(detectUnits('en-GB'), 'imperial');
  assert.equal(detectUnits('en-AU'), 'metric');
  assert.equal(detectUnits('zh-TW'), 'metric');
  assert.equal(detectUnits('ja-JP'), 'metric');
  assert.equal(detectUnits('not a locale!'), 'metric');
});

test('t：插入值與缺 key 時的退路', () => {
  const { t } = createI18n({ lang: 'zh-TW' });
  assert.equal(t('result.vetoed', { name: '阿嬤牛肉麵' }), '好，不去「阿嬤牛肉麵」');
  assert.equal(t('banner.osm').includes('{link}'), true, '沒給的插入值保留原樣');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('距離：公制與英制', () => {
  const metric = createI18n({ lang: 'zh-TW', units: 'metric' });
  assert.equal(metric.formatDistance(0.234), '230 公尺');
  assert.equal(metric.formatDistance(2.345), '2.3 公里');
  const ja = createI18n({ lang: 'ja', units: 'metric' });
  assert.equal(ja.formatDistance(0.87), '870m');
  const imperial = createI18n({ lang: 'en', units: 'imperial' });
  assert.equal(imperial.formatDistance(0.05), '150 ft');
  assert.equal(imperial.formatDistance(1.609344), '1.0 mi');
  assert.equal(imperial.formatDistance(24.6), '15.3 mi');
});

test('時間格式：中日 24 小時制、美式 12 小時制', () => {
  assert.equal(createI18n({ lang: 'zh-TW' }).formatTime(21, 0), '21:00');
  assert.equal(createI18n({ lang: 'ja' }).formatTime(9, 30), '9:30');
  assert.equal(createI18n({ lang: 'en' }).formatTime(21, 0), '9:00 PM');
  assert.equal(createI18n({ lang: 'en', deviceLocale: 'en-GB' }).formatTime(21, 0), '21:00', '英國裝置用 24 小時制');
});

test('星期與時間長度', () => {
  assert.equal(createI18n({ lang: 'zh-TW' }).weekday(2), '週二');
  assert.equal(createI18n({ lang: 'ja' }).weekday(6), '土');
  assert.equal(createI18n({ lang: 'en' }).weekday(0), 'Sun');
  const zh = createI18n({ lang: 'zh-TW' });
  assert.equal(zh.formatMinutes(15), '15 分鐘內');
  assert.equal(zh.formatMinutes(60), '1 小時內');
  assert.equal(zh.formatMinutes(90), '1 小時 30 分內');
  assert.equal(createI18n({ lang: 'ja' }).formatMinutes(90), '1時間30分以内');
  assert.equal(createI18n({ lang: 'en' }).formatMinutes(45), 'Within 45 min');
});

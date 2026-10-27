import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenAt } from '../js/hours.js';
import { parseOpeningHours } from '../js/providers/osm-hours.js';

// 2026-10-26 是星期一；用裝置時區（utcOffsetMinutes = null）判斷
const at = (day, hour, minute = 0) => new Date(2026, 9, 25 + day, hour, minute);
const open = (value, day, hour, minute) => isOpenAt(parseOpeningHours(value), at(day, hour, minute), null);

test('24/7', () => {
  assert.equal(open('24/7', 3, 4), true);
});

test('只有時間，沒有星期 = 每天', () => {
  assert.equal(open('11:00-21:00', 0, 12), true);
  assert.equal(open('11:00-21:00', 3, 21), false);
  assert.equal(open('11:00-21:00', 3, 10, 59), false);
});

test('星期範圍與多個時段', () => {
  const v = 'Mo-Fr 11:00-14:00,17:00-22:00; Sa,Su 11:00-22:00';
  assert.equal(open(v, 1, 12), true);
  assert.equal(open(v, 1, 15), false, '週一午休');
  assert.equal(open(v, 6, 15), true, '週六沒有午休');
  assert.equal(open(v, 0, 21, 30), true);
});

test('公休日與後面的規則覆蓋前面', () => {
  assert.equal(open('Tu-Su 11:00-21:00; Mo off', 1, 12), false);
  assert.equal(open('Tu-Su 11:00-21:00; Mo off', 2, 12), true);
  assert.equal(open('Mo-Su 10:00-20:00; We closed', 3, 12), false);
  assert.equal(open('Mo-Su 10:00-20:00; We closed', 4, 12), true);
});

test('跨午夜營業', () => {
  assert.equal(open('18:00-02:00', 2, 23), true);
  assert.equal(open('18:00-02:00', 3, 1, 30), true);
  assert.equal(open('18:00-02:00', 3, 2), false);
  assert.equal(open('Mo-Sa 17:00-26:00', 6, 23), true, '26:00 寫法');
  assert.equal(open('Mo-Sa 17:00-26:00', 0, 1), true, '週六晚上延續到週日凌晨');
  assert.equal(open('Mo-Su 00:00-24:00', 4, 23, 59), true);
});

test('跨週末的星期範圍、國定假日規則略過', () => {
  assert.equal(open('Sa-Mo 10:00-18:00', 0, 12), true);
  assert.equal(open('Sa-Mo 10:00-18:00', 1, 12), true);
  assert.equal(open('Sa-Mo 10:00-18:00', 2, 12), false);
  const v = 'Mo-Fr 07:00-22:00; Su,PH 08:00-21:00';
  assert.equal(open(v, 0, 7, 30), false, '週日 8 點才開');
  assert.equal(open(v, 6, 12), false, '週六沒寫 = 公休');
  assert.equal(open('PH off; Mo-Fr 09:00-18:00', 1, 10), true);
});

test('常見的寬鬆寫法', () => {
  assert.equal(open('Mo-Su: 10:00-20:00', 2, 12), true, '星期後面有冒號');
  assert.equal(open('Mo-Fr 11:00 - 14:00', 2, 12), true, '減號兩邊有空白');
  assert.equal(open('mo-fr 9:00-17:00', 2, 9, 30), true, '小寫、一位數小時');
  assert.equal(open('Mo-Fr 10:00-20:00, Sa 10:00-14:00', 6, 12), true, '逗號接下一條規則');
  assert.equal(open('Mo-Fr 10:00-20:00, Sa 10:00-14:00', 6, 15), false);
});

test('看不懂的寫法回傳 null（當作沒有資料）', () => {
  for (const v of ['', 'sunrise-sunset', 'Jan-Mar 10:00-16:00', 'Mo-Fr 10:00+', '"by appointment"', 'Mon-Fri 9:00-17:00', 'Mo-Fr', 'PH off', null, undefined, 42]) {
    assert.equal(parseOpeningHours(v), null, String(v));
  }
});

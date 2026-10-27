import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closingTime, dayHours, isOpenAt, isOpenThrough } from '../js/hours.js';

const TW = 480; // UTC+8
// 台灣時間 → Date（2026-10-26 是星期一）
const tw = (day, hour, minute = 0) => new Date(Date.UTC(2026, 9, 25 + day, hour - 8, minute));

const daily = (ranges, closedDays = []) => {
  const periods = [];
  for (let d = 0; d < 7; d++) {
    if (closedDays.includes(d)) continue;
    for (const [oh, om, ch, cm] of ranges) {
      periods.push({
        open: { day: d, hour: oh, minute: om },
        close: { day: ch >= 24 ? (d + 1) % 7 : d, hour: ch % 24, minute: cm },
      });
    }
  }
  return { periods };
};

const lunchDinner = daily([[11, 0, 14, 0], [17, 0, 21, 0]], [1]); // 週一公休
const lateNight = daily([[18, 0, 26, 0]]); // 18:00–隔天 02:00
const allDay = { periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }] };

test('tw helper 對應到正確的星期', () => {
  assert.equal(tw(1, 12).getUTCDay(), 1);
  assert.equal(tw(0, 12).getUTCDay(), 0);
});

test('一般營業時段', () => {
  assert.equal(isOpenAt(lunchDinner, tw(2, 12), TW), true);
  assert.equal(isOpenAt(lunchDinner, tw(2, 15), TW), false);
  assert.equal(isOpenAt(lunchDinner, tw(2, 21), TW), false, '打烊那一分鐘不算營業');
  assert.equal(isOpenAt(lunchDinner, tw(2, 20, 59), TW), true);
});

test('公休日', () => {
  assert.equal(isOpenAt(lunchDinner, tw(1, 12), TW), false);
});

test('跨午夜營業', () => {
  assert.equal(isOpenAt(lateNight, tw(2, 23), TW), true);
  assert.equal(isOpenAt(lateNight, tw(3, 1, 30), TW), true);
  assert.equal(isOpenAt(lateNight, tw(3, 2, 0), TW), false);
});

test('跨星期六午夜（週六晚上營業到週日凌晨）', () => {
  assert.equal(isOpenAt(lateNight, tw(6, 23), TW), true);
  assert.equal(isOpenAt(lateNight, tw(7, 1), TW), true, '週日凌晨 1 點');
});

test('24 小時營業與未知', () => {
  assert.equal(isOpenAt(allDay, tw(3, 4), TW), true);
  assert.equal(isOpenAt(null, tw(3, 4), TW), null);
  assert.equal(isOpenAt({ periods: [] }, tw(3, 4), TW), null);
});

test('抵達後要營業夠久才算', () => {
  assert.equal(isOpenThrough(lunchDinner, tw(2, 13, 0), 30, TW), true);
  assert.equal(isOpenThrough(lunchDinner, tw(2, 13, 45), 30, TW), false, '14:00 打烊，只剩 15 分鐘');
  assert.equal(isOpenThrough(lunchDinner, tw(2, 13, 30), 30, TW), true, '剛好吃到打烊');
  assert.equal(isOpenThrough(null, tw(2, 13), 30, TW), null);
});

test('打烊時間', () => {
  assert.deepEqual(closingTime(lunchDinner, tw(2, 18), TW), { hour: 21, minute: 0 });
  assert.equal(closingTime(lunchDinner, tw(2, 15), TW), null);
  assert.deepEqual(closingTime(allDay, tw(2, 15), TW), { allDay: true });
  assert.deepEqual(closingTime(lateNight, tw(3, 1), TW), { hour: 2, minute: 0 }, '跨午夜的時段');
});

test('當日營業時段', () => {
  assert.deepEqual(dayHours(lunchDinner, tw(2, 9), TW), {
    day: 2,
    allDay: false,
    ranges: [
      { open: { hour: 11, minute: 0 }, close: { hour: 14, minute: 0 } },
      { open: { hour: 17, minute: 0 }, close: { hour: 21, minute: 0 } },
    ],
  });
  assert.deepEqual(dayHours(lunchDinner, tw(1, 9), TW), { day: 1, allDay: false, ranges: [] }, '公休');
  assert.deepEqual(dayHours(allDay, tw(1, 9), TW), { day: 1, allDay: true, ranges: [] });
  assert.equal(dayHours(null, tw(1, 9), TW), null);
});

test('沒有 utcOffsetMinutes 時用裝置時區', () => {
  const local = new Date(2026, 9, 27, 12, 0); // 裝置時區的週二中午
  assert.equal(isOpenAt(lunchDinner, local, undefined), true);
});

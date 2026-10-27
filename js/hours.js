// 營業時間判斷。hours 的格式沿用 Google Places 的 regularOpeningHours：
// { periods: [{ open: { day, hour, minute }, close: { day, hour, minute } | null }], weekdayText?: string[] }
// day：0 = 星期日。只有 open 沒有 close 代表 24 小時營業。
// 所有函式在資料不足時回傳 null（未知），而不是 false。

const DAY_MIN = 24 * 60;
const WEEK_MIN = 7 * DAY_MIN;

const pointToWeekMinute = (p) => p.day * DAY_MIN + p.hour * 60 + p.minute;

/** 把時間轉成店家當地時間的「一週第幾分鐘」與星期幾 */
function localParts(date, utcOffsetMinutes) {
  if (Number.isFinite(utcOffsetMinutes)) {
    const t = new Date(date.getTime() + utcOffsetMinutes * 60000);
    return { day: t.getUTCDay(), minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes() };
  }
  return { day: date.getDay(), minuteOfDay: date.getHours() * 60 + date.getMinutes() };
}

function findOpenPeriod(hours, date, utcOffsetMinutes) {
  const periods = hours?.periods;
  if (!periods?.length) return undefined;
  const { day, minuteOfDay } = localParts(date, utcOffsetMinutes);
  const m = day * DAY_MIN + minuteOfDay;
  for (const period of periods) {
    if (!period.open) continue;
    if (!period.close) return period;
    const o = pointToWeekMinute(period.open);
    let c = pointToWeekMinute(period.close);
    if (c <= o) c += WEEK_MIN; // 跨過星期六午夜
    if ((m >= o && m < c) || (m + WEEK_MIN >= o && m + WEEK_MIN < c)) return period;
  }
  return null;
}

/** 指定時間是否營業：true / false / null（未知） */
export function isOpenAt(hours, date, utcOffsetMinutes) {
  const period = findOpenPeriod(hours, date, utcOffsetMinutes);
  return period === undefined ? null : period !== null;
}

/** 從 start 開始的 minutes 分鐘內是否都在營業（每 15 分鐘檢查一次） */
export function isOpenThrough(hours, start, minutes, utcOffsetMinutes) {
  const offsets = [];
  for (let t = 0; t < minutes; t += 15) offsets.push(t);
  if (minutes > 0) offsets.push(minutes - 1);
  for (const t of offsets) {
    const open = isOpenAt(hours, new Date(start.getTime() + t * 60000), utcOffsetMinutes);
    if (open !== true) return open;
  }
  return true;
}

/** 若指定時間營業中，回傳打烊時間 { hour, minute } 或 { allDay: true }；否則 null */
export function closingTime(hours, date, utcOffsetMinutes) {
  const period = findOpenPeriod(hours, date, utcOffsetMinutes);
  if (!period) return null;
  if (!period.close) return { allDay: true };
  return { hour: period.close.hour, minute: period.close.minute };
}

/**
 * 某一天的營業時段：{ day, allDay, ranges: [{ open: { hour, minute }, close: { hour, minute } }] }。
 * ranges 為空代表公休；沒有資料時回傳 null。
 */
export function dayHours(hours, date, utcOffsetMinutes) {
  const periods = hours?.periods;
  if (!periods?.length) return null;
  const { day } = localParts(date, utcOffsetMinutes);
  if (periods.some((p) => p.open && !p.close)) return { day, allDay: true, ranges: [] };
  const ranges = periods
    .filter((p) => p.open?.day === day)
    .sort((a, b) => a.open.hour * 60 + a.open.minute - (b.open.hour * 60 + b.open.minute))
    .map((p) => ({
      open: { hour: p.open.hour, minute: p.open.minute },
      close: { hour: p.close.hour, minute: p.close.minute },
    }));
  return { day, allDay: false, ranges };
}

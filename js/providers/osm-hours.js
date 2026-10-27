// OpenStreetMap 的 opening_hours 標籤 → 跟 Google 相同的 { periods } 格式（見 hours.js）。
// 只支援最常見的寫法，例如：
//   24/7
//   Mo-Fr 11:00-14:00,17:00-22:00; Sa,Su 11:00-22:00
//   Tu-Su 11:00-21:00; Mo off
//   18:00-02:00
// 遇到看不懂的寫法（月份、日出日落、註解…）一律回傳 null，當作「沒有營業時間資料」，
// 寧可不知道也不要判斷錯。國定假日（PH）規則會略過。

const DAYS = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const DAY = '(?:mo|tu|we|th|fr|sa|su|ph|sh)';
const DAY_ITEM = `${DAY}(?:\\s*-\\s*${DAY})?`;
// 規則開頭的星期，例如「Mo-Fr」「Sa,Su,PH」「Mo-Su:」
const DAY_SELECTOR = new RegExp(`^(${DAY_ITEM}(?:\\s*,\\s*${DAY_ITEM})*)(?:\\s*:)?(?:\\s+|$)`, 'i');
const TIME_RANGE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
// 「Mo-Fr 10:00-20:00, Sa 10:00-14:00」這種用逗號接下一條規則的寫法
const ADDITIONAL_RULE = /(?<=\d)\s*,\s*(?=(?:mo|tu|we|th|fr|sa|su|ph|sh)\b)/i;

/** 回傳星期陣列；只有假日（PH/SH）時回傳空陣列；看不懂回傳 undefined */
function parseDays(selector) {
  const days = new Set();
  for (const item of selector.toLowerCase().split(',')) {
    const [from, to] = item.split('-').map((s) => s.trim());
    if (from === 'ph' || from === 'sh') {
      if (to) return undefined;
      continue;
    }
    if (!(from in DAYS) || (to && !(to in DAYS))) return undefined;
    if (!to) {
      days.add(DAYS[from]);
      continue;
    }
    // 範圍可以跨週末，例如 Sa-Mo
    for (let d = DAYS[from]; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === DAYS[to]) break;
    }
  }
  return [...days];
}

/** 一條規則 → { days, ranges: [[開始分鐘, 結束分鐘]] }；'skip' 代表只有假日；undefined 代表看不懂 */
function parseRule(rule) {
  let days = [0, 1, 2, 3, 4, 5, 6];
  let rest = rule;
  const match = rule.match(DAY_SELECTOR);
  if (match) {
    days = parseDays(match[1]);
    if (days === undefined) return undefined;
    rest = rule.slice(match[0].length).trim();
  }
  if (!days.length) return 'skip';
  if (/^(off|closed)$/i.test(rest)) return { days, ranges: [] };
  if (!rest) return undefined;

  const ranges = [];
  for (const part of rest.split(',')) {
    const t = part.trim().replace(/\s*-\s*/g, '-').match(TIME_RANGE);
    if (!t) return undefined;
    const [startH, startM, endH, endM] = t.slice(1).map(Number);
    if (startM > 59 || endM > 59 || startH > 23 || endH > 48) return undefined;
    ranges.push([startH * 60 + startM, endH * 60 + endM]);
  }
  return { days, ranges };
}

export function parseOpeningHours(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^24\/7$/.test(text)) return { periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }] };

  // 後面的規則會覆蓋前面同一天的規則；沒被提到的日子是公休
  const week = Array.from({ length: 7 }, () => null);
  for (const rule of text.split(/;|\|\|/).flatMap((r) => r.split(ADDITIONAL_RULE))) {
    if (!rule.trim()) continue;
    const parsed = parseRule(rule.trim());
    if (parsed === undefined) return null;
    if (parsed === 'skip') continue;
    for (const day of parsed.days) week[day] = parsed.ranges;
  }
  if (week.every((ranges) => ranges === null)) return null;

  const periods = [];
  week.forEach((ranges, day) => {
    for (const [start, rawEnd] of ranges ?? []) {
      // 結束時間小於等於開始時間，或超過 24:00，代表營業到隔天
      const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
      periods.push({
        open: { day, hour: Math.floor(start / 60), minute: start % 60 },
        close: { day: (day + Math.floor(end / 1440)) % 7, hour: Math.floor((end % 1440) / 60), minute: end % 60 },
      });
    }
  });
  return { periods };
}

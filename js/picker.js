import { estimateMinutes, haversineKm } from './geo.js';
import { isOpenThrough } from './hours.js';

/**
 * 出發時間。指定時間（when.at 的年月日時分）視為目的地當地的時鐘時間，
 * 這樣人在東京規劃紐約行程時，輸入 10:00 就是紐約的 10:00。
 */
export function departureFor(place, when, now = new Date()) {
  if (when.type !== 'at' || !when.at) return now;
  if (!Number.isFinite(place.utcOffsetMinutes)) return when.at;
  const a = when.at;
  const wallClockUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate(), a.getHours(), a.getMinutes());
  return new Date(wallClockUtc - place.utcOffsetMinutes * 60000);
}

/**
 * 依條件篩選候選地點，並附上 distKm、etaMin、arrival、openState。
 * when：{ type: 'now' | 'at' | 'any', at?: Date }
 * 營業時間是用「抵達時間」判斷，而且抵達後至少還要營業 stayMin 分鐘。
 */
export function filterCandidates(places, opts) {
  const {
    origin,
    travel,
    maxMinutes,
    when,
    stayMin = 0,
    includeUnknownHours = false,
    minRating = 0,
    minReviews = 0,
    excludeIds = new Set(),
    now = new Date(),
  } = opts;

  const result = [];
  for (const place of places) {
    if (excludeIds.has(place.id)) continue;
    if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
    if (minRating > 0 && !(place.rating >= minRating)) continue;
    if (minReviews > 0 && !((place.ratingCount ?? 0) >= minReviews)) continue;

    const distKm = haversineKm(origin, place);
    const eta = estimateMinutes(distKm, travel);
    if (eta > maxMinutes) continue;

    let arrival = null;
    let openState = null;
    if (when.type !== 'any') {
      const depart = departureFor(place, when, now);
      arrival = new Date(depart.getTime() + eta * 60000);
      openState = isOpenThrough(place.hours, arrival, stayMin, place.utcOffsetMinutes);
      if (openState === false) continue;
      if (openState === null && !includeUnknownHours) continue;
    }

    result.push({ ...place, distKm, etaMin: Math.max(1, Math.round(eta)), arrival, openState });
  }
  return result;
}

/** 從候選中均勻隨機抽一個，盡量避開 avoidIds（全部都避開不了時就不避） */
export function pickRandom(candidates, { avoidIds = [], rand = Math.random } = {}) {
  if (!candidates.length) return null;
  const avoid = new Set(avoidIds);
  const fresh = candidates.filter((c) => !avoid.has(c.id));
  const pool = fresh.length ? fresh : candidates;
  return pool[Math.floor(rand() * pool.length)];
}

/** 把多輪搜尋結果依 id 去重合併 */
export function mergeUnique(lists) {
  const seen = new Map();
  for (const list of lists) for (const p of list) if (!seen.has(p.id)) seen.set(p.id, p);
  return [...seen.values()];
}

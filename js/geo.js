import { MAX_RADIUS_KM } from './config.js';

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** 兩點間的直線距離（公里），點的格式為 { lat, lng } */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** 實際路程（公里）→ 估計分鐘數 */
export function roadKmToMinutes(roadKm, mode) {
  const after = mode.longAfterKm ?? Infinity;
  const near = Math.min(roadKm, after);
  const far = Math.max(0, roadKm - after);
  const hours = near / mode.speedKmh + far / (mode.longSpeedKmh ?? mode.speedKmh);
  return mode.overheadMin + hours * 60;
}

/** 直線距離（公里）→ 估計分鐘數 */
export function estimateMinutes(straightKm, mode) {
  return roadKmToMinutes(straightKm * mode.detour, mode);
}

/** estimateMinutes 的反函數：給定時間上限，可以到達的直線半徑（公里），上限 50 公里 */
export function radiusKmForMinutes(minutes, mode) {
  const available = minutes - mode.overheadMin;
  if (available <= 0) return 0;
  const after = mode.longAfterKm ?? Infinity;
  const nearMinutes = (after / mode.speedKmh) * 60;
  const roadKm =
    available <= nearMinutes
      ? (available / 60) * mode.speedKmh
      : after + ((available - nearMinutes) / 60) * (mode.longSpeedKmh ?? mode.speedKmh);
  return Math.min(roadKm / mode.detour, MAX_RADIUS_KM);
}

/** 圓內均勻分布的隨機點 */
export function randomPointInCircle(center, radiusKm, rand = Math.random) {
  const r = radiusKm * Math.sqrt(rand());
  const theta = 2 * Math.PI * rand();
  return offsetKm(center, r * Math.cos(theta), r * Math.sin(theta));
}

/** 往東 eastKm、往北 northKm 位移後的座標 */
export function offsetKm(center, eastKm, northKm) {
  return {
    lat: center.lat + northKm / 110.574,
    lng: center.lng + eastKm / (111.32 * Math.cos(toRad(center.lat))),
  };
}

// 地區設定：各地區可用的交通方式（速度不同）與料理／景點類型。
// 交通時間的估算方式：直線距離 × 繞路係數 ÷ 速度 + 固定耗時（停車、等車）。
// longAfterKm 之後改用 longSpeedKmh（例如開車上快速道路、搭到電車／捷運）。

const BASE_TRAVEL = {
  walk: { icon: '🚶', speedKmh: 4.5, detour: 1.3, overheadMin: 0, gmaps: 'walking' },
  bike: { icon: '🚲', speedKmh: 13, detour: 1.3, overheadMin: 2, gmaps: 'bicycling' },
  // Google 地圖的機車導航只在部分亞洲國家提供
  scooter: {
    icon: '🛵', speedKmh: 25, longSpeedKmh: 40, longAfterKm: 8,
    detour: 1.35, overheadMin: 3, gmaps: 'two-wheeler',
  },
  car: {
    icon: '🚗', speedKmh: 22, longSpeedKmh: 55, longAfterKm: 8,
    detour: 1.4, overheadMin: 6, gmaps: 'driving',
  },
  transit: {
    icon: '🚇', speedKmh: 18, longSpeedKmh: 30, longAfterKm: 3,
    detour: 1.3, overheadMin: 10, gmaps: 'transit',
  },
};

export const TRAVEL_IDS = Object.keys(BASE_TRAVEL);

// 類型目錄：只用 Google Places API (New) Table A 裡的類型。顯示名稱在語系檔的 cat.<id>。
const FOOD_CATEGORIES = {
  chinese_tw: ['chinese_restaurant'],
  chinese: ['chinese_restaurant'],
  japanese: ['japanese_restaurant', 'ramen_restaurant', 'sushi_restaurant'],
  washoku: ['japanese_restaurant'],
  ramen: ['ramen_restaurant'],
  sushi: ['sushi_restaurant'],
  yakiniku: ['barbecue_restaurant'],
  izakaya: ['bar'],
  korean: ['korean_restaurant'],
  western: ['italian_restaurant', 'french_restaurant', 'steak_house', 'spanish_restaurant', 'mediterranean_restaurant', 'pizza_restaurant'],
  italian: ['italian_restaurant', 'pizza_restaurant'],
  american: ['american_restaurant', 'fast_food_restaurant', 'hamburger_restaurant'],
  fastfood: ['fast_food_restaurant', 'hamburger_restaurant'],
  mexican: ['mexican_restaurant'],
  asian: ['thai_restaurant', 'vietnamese_restaurant', 'indonesian_restaurant', 'indian_restaurant'],
  sea: ['thai_restaurant', 'vietnamese_restaurant', 'indonesian_restaurant'],
  indian: ['indian_restaurant'],
  mideast: ['middle_eastern_restaurant', 'mediterranean_restaurant', 'greek_restaurant', 'turkish_restaurant', 'lebanese_restaurant'],
  brunch: ['breakfast_restaurant', 'brunch_restaurant', 'sandwich_shop'],
  cafe: ['cafe', 'coffee_shop', 'bakery', 'ice_cream_shop'],
  bbq_seafood: ['barbecue_restaurant', 'seafood_restaurant'],
  seafood: ['seafood_restaurant'],
  steak: ['steak_house'],
  veg: ['vegetarian_restaurant', 'vegan_restaurant'],
};

const TRIP_CATEGORIES = {
  nature: ['park', 'national_park', 'hiking_area', 'campground'],
  sight: ['tourist_attraction', 'historical_landmark', 'cultural_center'],
  art: ['museum', 'art_gallery', 'performing_arts_theater'],
  family: ['zoo', 'aquarium', 'amusement_park'],
  indoor: ['movie_theater', 'bowling_alley', 'amusement_center'],
  shopping: ['shopping_mall'],
  onsen: ['spa'],
};

const CATALOG = { food: FOOD_CATEGORIES, trip: TRIP_CATEGORIES };

export const REGIONS = {
  TW: {
    google: 'tw',
    travel: { ...BASE_TRAVEL },
    defaults: { food: 'walk', trip: 'scooter' },
    categories: {
      food: ['chinese_tw', 'japanese', 'korean', 'western', 'american', 'asian', 'brunch', 'cafe', 'bbq_seafood', 'veg'],
      trip: ['nature', 'sight', 'art', 'family', 'indoor', 'shopping', 'onsen'],
    },
  },
  JP: {
    google: 'jp',
    travel: {
      walk: BASE_TRAVEL.walk,
      bike: BASE_TRAVEL.bike,
      // 市區開車慢、停車要找比較久
      car: { ...BASE_TRAVEL.car, speedKmh: 20, longSpeedKmh: 50, overheadMin: 8 },
      // 電車路網密、速度快
      transit: { ...BASE_TRAVEL.transit, speedKmh: 20, longSpeedKmh: 45 },
    },
    defaults: { food: 'walk', trip: 'transit' },
    categories: {
      food: ['washoku', 'ramen', 'sushi', 'yakiniku', 'izakaya', 'chinese', 'korean', 'western', 'fastfood', 'asian', 'cafe'],
      trip: ['nature', 'sight', 'art', 'family', 'indoor', 'shopping', 'onsen'],
    },
  },
  INTL: {
    google: null,
    travel: {
      walk: BASE_TRAVEL.walk,
      bike: BASE_TRAVEL.bike,
      car: { ...BASE_TRAVEL.car, speedKmh: 30, longSpeedKmh: 70, longAfterKm: 10 },
      transit: { ...BASE_TRAVEL.transit, speedKmh: 16, overheadMin: 12 },
    },
    defaults: { food: 'walk', trip: 'car' },
    categories: {
      food: ['american', 'italian', 'mexican', 'chinese', 'japanese', 'korean', 'sea', 'indian', 'mideast', 'brunch', 'cafe', 'seafood', 'steak', 'veg'],
      trip: ['nature', 'sight', 'art', 'family', 'indoor', 'shopping'],
    },
  },
};

/** 某地區某模式的類型清單（第一個固定是「都可以」） */
export function categoriesFor(regionCode, mode) {
  const catalog = CATALOG[mode];
  const list = REGIONS[regionCode].categories[mode].map((id) => ({ id, types: catalog[id] }));
  const anyTypes = mode === 'food' ? ['restaurant'] : [...new Set(list.flatMap((c) => c.types))];
  return [{ id: 'any', types: anyTypes }, ...list];
}

export function isCategoryId(mode, id) {
  return id === 'any' || id in CATALOG[mode];
}

// 用粗略的經緯度範圍判斷出發點在哪個地區，不在範圍內就是 INTL。
// [南緯界, 北緯界, 西經界, 東經界]
const BOUNDS = {
  TW: [
    [21.85, 25.35, 119.3, 122.05], // 台灣本島、澎湖、綠島、蘭嶼
    [24.35, 24.55, 118.22, 118.5], // 金門
    [25.9, 26.4, 119.85, 120.55], // 馬祖
  ],
  JP: [
    [31.0, 41.3, 129.55, 146.0], // 本州、四國、九州
    [41.3, 45.6, 139.3, 146.0], // 北海道
    [31.0, 34.0, 128.5, 129.55], // 長崎西側、五島
    [24.0, 31.0, 122.9, 131.5], // 沖繩、奄美
  ],
};

export function detectRegion({ lat, lng }) {
  for (const [code, boxes] of Object.entries(BOUNDS)) {
    if (boxes.some(([s, n, w, e]) => lat >= s && lat <= n && lng >= w && lng <= e)) return code;
  }
  return 'INTL';
}

/** 還沒有出發點時，先用裝置時區猜地區 */
export function guessRegionFromTimezone(timeZone) {
  return { 'Asia/Taipei': 'TW', 'Asia/Tokyo': 'JP' }[timeZone] ?? 'INTL';
}

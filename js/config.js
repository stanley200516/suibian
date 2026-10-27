// 與地區、語言無關的設定。交通方式與類型在 regions.js，顯示文字在 locales/。

// Google Places Nearby Search 的半徑上限是 50 公里
export const MAX_RADIUS_KM = 50;

export const APP_MODES = {
  food: {
    icon: '🍜',
    time: { min: 5, max: 60, step: 5, default: 15 },
    // 抵達後至少還要營業多久才算數
    stayMin: 30,
    includeUnknownHours: false,
    minReviews: 0,
    // 開放資料（OpenStreetMap）一次查詢的最大半徑；範圍更大時隨機取其中一塊
    openDataRadiusKm: 3,
    // 每次建立候選清單時的搜尋輪次（每輪最多 20 筆），用不同排序／子區域增加多樣性
    rounds: [
      { area: 'full', rankBy: 'popularity' },
      { area: 'full', rankBy: 'distance' },
      { area: 'sub', rankBy: 'popularity' },
    ],
  },
  trip: {
    icon: '🏞️',
    time: { min: 15, max: 180, step: 15, default: 60 },
    stayMin: 90,
    // 公園、步道常常沒有營業時間資料
    includeUnknownHours: true,
    // 過濾掉評論太少的小公園、冷門點
    minReviews: 30,
    openDataRadiusKm: 30,
    rounds: [
      { area: 'full', rankBy: 'popularity' },
      { area: 'sub', rankBy: 'popularity' },
      { area: 'sub', rankBy: 'popularity' },
    ],
  },
};

export const RATING_OPTIONS = [0, 3.5, 4, 4.5];

export const WHEN_OPTIONS = ['now', 'at', 'any'];

// FREE 的顯示文字在語系檔（price.free）
export const PRICE_LABELS = {
  INEXPENSIVE: '$',
  MODERATE: '$$',
  EXPENSIVE: '$$$',
  VERY_EXPENSIVE: '$$$$',
};

// 同一組條件的候選清單快取多久（毫秒），避免重抽時重複呼叫 API
export const POOL_TTL_MS = 10 * 60 * 1000;
// 盡量避開最近抽過的幾個
export const AVOID_RECENT = 5;

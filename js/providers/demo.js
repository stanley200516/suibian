// 示範資料：在出發點周圍產生虛構的店家與景點，讓沒有 API key 時也能完整試用。
// 店名依介面語言產生。介面與 google.js 相同。
import { haversineKm, offsetKm } from '../geo.js';

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function daily(ranges, closedDays = []) {
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
}

const HOURS = {
  allday: () => daily([[11, 0, 21, 30]]),
  lunchDinner: () => daily([[11, 0, 14, 0], [17, 0, 21, 0]], [1]),
  dinner: () => daily([[17, 0, 23, 0]], [2]),
  late: () => daily([[17, 0, 26, 0]]),
  brunch: () => daily([[8, 0, 15, 0]]),
  breakfast: () => daily([[5, 30, 12, 0]], [0]),
  cafe: () => daily([[9, 0, 18, 0]], [3]),
  '24h': () => ({ periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }] }),
  unknown: () => null,
  street: () => daily([[10, 0, 20, 0]]),
  museum: () => daily([[9, 30, 17, 0]], [1]),
  theater: () => daily([[13, 0, 22, 0]], [1]),
  zoo: () => daily([[9, 0, 17, 0]]),
  mall: () => daily([[11, 0, 22, 0]]),
  onsen: () => daily([[10, 0, 22, 0]]),
};

// 每種店：[中文, 英文, 日文] 店名後綴與類型名稱
const FOOD_KINDS = [
  { name: ['牛肉麵', 'Beef Noodles', '牛肉麺'], label: ['中式餐廳', 'Chinese restaurant', '中華料理店'], types: ['chinese_restaurant', 'restaurant'], hours: 'allday', price: 'INEXPENSIVE' },
  { name: ['滷肉飯', 'Braised Pork Rice', 'ルーロー飯'], label: ['台式餐廳', 'Taiwanese restaurant', '台湾料理店'], types: ['chinese_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'INEXPENSIVE' },
  { name: ['水餃館', 'Dumpling House', '餃子館'], label: ['中式餐廳', 'Chinese restaurant', '中華料理店'], types: ['chinese_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'INEXPENSIVE' },
  { name: ['拉麵', 'Ramen', 'ラーメン'], label: ['拉麵店', 'Ramen restaurant', 'ラーメン店'], types: ['ramen_restaurant', 'japanese_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
  { name: ['壽司', 'Sushi', '寿司'], label: ['壽司店', 'Sushi restaurant', '寿司店'], types: ['sushi_restaurant', 'japanese_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
  { name: ['定食屋', 'Teishoku', '食堂'], label: ['日式餐廳', 'Japanese restaurant', '和食店'], types: ['japanese_restaurant', 'restaurant'], hours: 'allday', price: 'INEXPENSIVE' },
  { name: ['韓式炸雞', 'Korean Fried Chicken', '韓国チキン'], label: ['韓式餐廳', 'Korean restaurant', '韓国料理店'], types: ['korean_restaurant', 'restaurant'], hours: 'late', price: 'MODERATE' },
  { name: ['豆腐鍋', 'Tofu Stew', 'スンドゥブ'], label: ['韓式餐廳', 'Korean restaurant', '韓国料理店'], types: ['korean_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
  { name: ['義大利麵', 'Pasta Bar', 'パスタ'], label: ['義式餐廳', 'Italian restaurant', 'イタリア料理店'], types: ['italian_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
  { name: ['窯烤披薩', 'Pizzeria', 'ピッツェリア'], label: ['披薩店', 'Pizza restaurant', 'ピザ店'], types: ['pizza_restaurant', 'italian_restaurant', 'restaurant'], hours: 'allday', price: 'MODERATE' },
  { name: ['牛排館', 'Steakhouse', 'ステーキハウス'], label: ['牛排館', 'Steak house', 'ステーキ店'], types: ['steak_house', 'restaurant'], hours: 'lunchDinner', price: 'EXPENSIVE' },
  { name: ['漢堡', 'Burgers', 'バーガー'], label: ['漢堡店', 'Hamburger restaurant', 'ハンバーガー店'], types: ['hamburger_restaurant', 'american_restaurant', 'restaurant'], hours: 'allday', price: 'MODERATE' },
  { name: ['炸雞速食', 'Fried Chicken', 'フライドチキン'], label: ['速食店', 'Fast food restaurant', 'ファストフード店'], types: ['fast_food_restaurant', 'restaurant'], hours: '24h', price: 'INEXPENSIVE' },
  { name: ['泰式料理', 'Thai Kitchen', 'タイ料理'], label: ['泰式餐廳', 'Thai restaurant', 'タイ料理店'], types: ['thai_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
  { name: ['越南河粉', 'Pho', 'フォー'], label: ['越南餐廳', 'Vietnamese restaurant', 'ベトナム料理店'], types: ['vietnamese_restaurant', 'restaurant'], hours: 'allday', price: 'INEXPENSIVE' },
  { name: ['印度咖哩', 'Curry House', 'インドカレー'], label: ['印度餐廳', 'Indian restaurant', 'インド料理店'], types: ['indian_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
  { name: ['墨西哥捲餅', 'Taqueria', 'タコス'], label: ['墨西哥餐廳', 'Mexican restaurant', 'メキシコ料理店'], types: ['mexican_restaurant', 'restaurant'], hours: 'allday', price: 'INEXPENSIVE' },
  { name: ['中東料理', 'Falafel', 'ファラフェル'], label: ['中東餐廳', 'Middle Eastern restaurant', '中東料理店'], types: ['middle_eastern_restaurant', 'mediterranean_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
  { name: ['早午餐', 'Brunch', 'ブランチ'], label: ['早午餐餐廳', 'Brunch restaurant', 'ブランチ'], types: ['brunch_restaurant', 'breakfast_restaurant', 'restaurant'], hours: 'brunch', price: 'MODERATE' },
  { name: ['早餐店', 'Breakfast Club', 'モーニング'], label: ['早餐店', 'Breakfast restaurant', '朝食'], types: ['breakfast_restaurant', 'restaurant'], hours: 'breakfast', price: 'INEXPENSIVE' },
  { name: ['咖啡', 'Coffee', '珈琲'], label: ['咖啡廳', 'Cafe', 'カフェ'], types: ['cafe', 'coffee_shop'], hours: 'cafe', price: 'MODERATE' },
  { name: ['甜點工作室', 'Bakery', 'ベーカリー'], label: ['烘焙坊', 'Bakery', 'パン屋'], types: ['bakery', 'cafe'], hours: 'cafe', price: 'MODERATE' },
  { name: ['燒肉', 'BBQ', '焼肉'], label: ['燒烤餐廳', 'Barbecue restaurant', '焼肉店'], types: ['barbecue_restaurant', 'restaurant'], hours: 'dinner', price: 'EXPENSIVE' },
  { name: ['海產店', 'Seafood', '海鮮'], label: ['海鮮餐廳', 'Seafood restaurant', '海鮮料理店'], types: ['seafood_restaurant', 'restaurant'], hours: 'late', price: 'MODERATE' },
  { name: ['居酒屋', 'Izakaya', '居酒屋'], label: ['居酒屋', 'Bar', '居酒屋'], types: ['bar'], hours: 'late', price: 'MODERATE' },
  { name: ['素食坊', 'Veggie Kitchen', '菜食'], label: ['素食餐廳', 'Vegetarian restaurant', 'ベジタリアン'], types: ['vegetarian_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'INEXPENSIVE' },
  { name: ['蔬食餐廳', 'Vegan Café', 'ヴィーガン'], label: ['純素餐廳', 'Vegan restaurant', 'ヴィーガン'], types: ['vegan_restaurant', 'vegetarian_restaurant', 'restaurant'], hours: 'lunchDinner', price: 'MODERATE' },
];

const TRIP_KINDS = [
  { name: ['森林公園', 'Forest Park', '森林公園'], label: ['公園', 'Park', '公園'], types: ['park'], hours: 'unknown' },
  { name: ['河濱公園', 'Riverside Park', '河川敷公園'], label: ['公園', 'Park', '公園'], types: ['park'], hours: '24h' },
  { name: ['登山步道', 'Trail', 'ハイキングコース'], label: ['健行步道', 'Hiking area', 'ハイキングコース'], types: ['hiking_area', 'park'], hours: 'unknown' },
  { name: ['露營區', 'Campground', 'キャンプ場'], label: ['露營地', 'Campground', 'キャンプ場'], types: ['campground'], hours: '24h' },
  { name: ['老街', 'Old Town', '古い町並み'], label: ['觀光景點', 'Tourist attraction', '観光名所'], types: ['tourist_attraction'], hours: 'street' },
  { name: ['觀景台', 'Lookout', '展望台'], label: ['觀光景點', 'Tourist attraction', '観光名所'], types: ['tourist_attraction'], hours: '24h' },
  { name: ['古厝', 'Heritage House', '古民家'], label: ['歷史地標', 'Historical landmark', '史跡'], types: ['historical_landmark', 'tourist_attraction'], hours: 'museum' },
  { name: ['文化園區', 'Culture Park', '文化センター'], label: ['文化中心', 'Cultural center', '文化施設'], types: ['cultural_center', 'tourist_attraction'], hours: 'museum' },
  { name: ['美術館', 'Art Museum', '美術館'], label: ['美術館', 'Art gallery', '美術館'], types: ['art_gallery', 'museum'], hours: 'museum' },
  { name: ['博物館', 'Museum', '博物館'], label: ['博物館', 'Museum', '博物館'], types: ['museum'], hours: 'museum' },
  { name: ['藝文中心', 'Arts Center', '芸術劇場'], label: ['表演場地', 'Performing arts theater', '劇場'], types: ['performing_arts_theater'], hours: 'theater' },
  { name: ['動物園', 'Zoo', '動物園'], label: ['動物園', 'Zoo', '動物園'], types: ['zoo'], hours: 'zoo' },
  { name: ['水族館', 'Aquarium', '水族館'], label: ['水族館', 'Aquarium', '水族館'], types: ['aquarium'], hours: 'zoo' },
  { name: ['遊樂園', 'Amusement Park', '遊園地'], label: ['遊樂園', 'Amusement park', '遊園地'], types: ['amusement_park'], hours: 'zoo' },
  { name: ['影城', 'Cinema', 'シネマ'], label: ['電影院', 'Movie theater', '映画館'], types: ['movie_theater'], hours: 'mall' },
  { name: ['保齡球館', 'Bowling', 'ボウル'], label: ['保齡球館', 'Bowling alley', 'ボウリング場'], types: ['bowling_alley'], hours: 'late' },
  { name: ['室內樂園', 'Fun Zone', 'アミューズメント'], label: ['遊樂中心', 'Amusement center', 'アミューズメント施設'], types: ['amusement_center'], hours: 'mall' },
  { name: ['購物中心', 'Mall', 'モール'], label: ['購物中心', 'Shopping mall', 'ショッピングモール'], types: ['shopping_mall'], hours: 'mall' },
  { name: ['溫泉', 'Hot Springs', '温泉'], label: ['溫泉', 'Spa', '温泉'], types: ['spa'], hours: 'onsen' },
];

const NAMES = {
  'zh-TW': {
    i: 0,
    food: ['阿嬤', '老王', '巷口', '福記', '小林', '永和', '一品', '好味', '金春', '光復', '阿忠', '大橋頭', '三代', '佳佳', '明月', '春水', '老張', '晴天', '小日子', '慢慢', '森林', '初心', '轉角', '日日'],
    trip: ['大安', '象山', '淡水', '北投', '陽明', '華山', '松山', '內湖', '碧潭', '貓空', '大溪', '三峽', '九份', '鶯歌', '十分', '烏來', '深坑', '關渡', '八里', '金山'],
    streets: ['中山路', '民生路', '復興路', '和平東路', '信義路', '忠孝東路', '光復南路', '永康街', '師大路', '南京東路', '民權東路', '承德路'],
    join: (a, b) => `${a}${b}`,
    address: (street, n) => `${street}${n} 號（虛構）`,
  },
  en: {
    i: 1,
    food: ["Joe's", 'Golden', 'Blue Door', 'Corner', 'Little', 'Lucky', 'Sunny', 'Maple', 'Harbor', 'Old Town', "Mama's", 'Green Leaf', 'Red Lantern', 'Main Street', 'Oak', 'Silver', 'Happy', 'Urban', 'River', 'Sunset'],
    trip: ['Riverside', 'Hillcrest', 'Lakeview', 'Pine Ridge', 'Harbor', 'Westfield', 'Cedar', 'Bayside', 'Sunrise', 'Greenway', 'Northgate', 'Willow', 'Stone Bridge', 'Eastside', 'Highland', 'Meadow', 'Grand', 'Union', 'Lighthouse', 'Maple Hill'],
    streets: ['Main St', 'Oak Ave', 'Maple St', 'Park Ave', 'Elm St', '2nd St', 'Broadway', 'Pine St', 'Cedar Rd', 'Lake Dr', 'Hill Rd', 'Market St'],
    join: (a, b) => `${a} ${b}`,
    address: (street, n) => `${n} ${street} (fictional)`,
  },
  ja: {
    i: 2,
    food: ['さくら', 'まるや', '一番', '福屋', '竹乃', '大黒', '花月', 'みどり', '山田', 'ひなた', '縁', '和楽', '金星', '駅前', '横丁', 'はなまる', 'こばやし', '小町', '月見', '風月'],
    trip: ['高尾', '鎌倉', '箱根', '日光', '上野', '浅草', '代々木', 'お台場', '多摩', '奥多摩', '秩父', '江ノ島', '井の頭', '葛西', '横浜', '川越', '吉祥寺', '品川', '池袋', '新宿'],
    streets: ['本町', '中央通り', '駅前通り', '桜町', '栄町', '緑町', '旭町', '大通り', '仲町', '新町', '若葉町', '港町'],
    join: (a, b) => `${a}${b}`,
    address: (street, n) => `${street}${n}番地（架空）`,
  },
};

/** 距離採對數分布：越靠近出發點越密集，比較像真實的市區 */
function generate(anchor, rand, names, { count, kinds, prefixes, minKm, maxKm, popular, idPrefix }) {
  const out = [];
  const logMin = Math.log(minKm);
  const logMax = Math.log(maxKm);
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const prefix = prefixes[Math.floor(rand() * prefixes.length)];
    const r = Math.exp(logMin + rand() * (logMax - logMin));
    const theta = rand() * 2 * Math.PI;
    const pos = offsetKm(anchor, r * Math.cos(theta), r * Math.sin(theta));
    // 約 8% 的地點沒有營業時間資料
    const hoursKey = rand() < 0.08 ? 'unknown' : kind.hours;
    const street = names.streets[Math.floor(rand() * names.streets.length)];
    out.push({
      id: `demo-${idPrefix}${i}`,
      name: names.join(prefix, kind.name[names.i]),
      lat: pos.lat,
      lng: pos.lng,
      address: names.address(street, 1 + Math.floor(rand() * 300)),
      rating: Math.round((3.2 + rand() * 1.7) * 10) / 10,
      ratingCount: Math.round(Math.exp(Math.log(5) + rand() * Math.log(popular))),
      priceLevel: kind.price ?? null,
      typeLabel: kind.label[names.i],
      types: kind.types,
      hours: HOURS[hoursKey](),
      // 虛構店家就在使用者附近，營業時間跟著裝置時區
      utcOffsetMinutes: null,
      businessStatus: rand() < 0.02 ? 'CLOSED_TEMPORARILY' : 'OPERATIONAL',
      mapsUrl: null,
      photo: null,
      isDemo: true,
    });
  }
  return out;
}

// 示範模式可以輸入的地點：label 依序是 [中文, 英文, 日文]，aliases 用來比對輸入
const KNOWN_PLACES = [
  { label: ['台北車站', 'Taipei Main Station', '台北駅'], aliases: ['taipeistation', 'taipeimainstation'], lat: 25.0478, lng: 121.517 },
  { label: ['台北101', 'Taipei 101', '台北101'], aliases: [], lat: 25.0339, lng: 121.5645 },
  { label: ['西門町', 'Ximending', '西門町'], aliases: [], lat: 25.0422, lng: 121.5078 },
  { label: ['台中車站', 'Taichung Station', '台中駅'], aliases: [], lat: 24.1372, lng: 120.6869 },
  { label: ['高雄車站', 'Kaohsiung Station', '高雄駅'], aliases: [], lat: 22.6394, lng: 120.3025 },
  { label: ['東京車站', 'Tokyo Station', '東京駅'], aliases: ['東京站'], lat: 35.6812, lng: 139.7671 },
  { label: ['新宿', 'Shinjuku', '新宿'], aliases: [], lat: 35.6896, lng: 139.7006 },
  { label: ['澀谷', 'Shibuya', '渋谷'], aliases: ['涉谷'], lat: 35.658, lng: 139.7016 },
  { label: ['大阪車站', 'Osaka Station', '大阪駅'], aliases: ['梅田', 'umeda'], lat: 34.7025, lng: 135.4959 },
  { label: ['京都車站', 'Kyoto Station', '京都駅'], aliases: [], lat: 34.9858, lng: 135.7588 },
  { label: ['時代廣場', 'Times Square', 'タイムズスクエア'], aliases: ['紐約', 'newyork'], lat: 40.758, lng: -73.9855 },
  { label: ['倫敦', 'London', 'ロンドン'], aliases: [], lat: 51.5074, lng: -0.1278 },
];

const normalizeText = (s) => s.toLowerCase().replace(/臺/g, '台').replace(/[\s.・]/g, '');

export function createDemoProvider({ lang = 'zh-TW' } = {}) {
  const names = NAMES[lang] ?? NAMES.en;
  let universe = null;

  function ensureUniverse(origin) {
    const key = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`;
    if (universe?.key === key) return universe.places;
    const seed = hashString(key);
    const rand = mulberry32(seed);
    const places = [
      ...generate(origin, rand, names, { count: 420, kinds: FOOD_KINDS, prefixes: names.food, minKm: 0.05, maxKm: 30, popular: 1500, idPrefix: `${seed}-f` }),
      ...generate(origin, rand, names, { count: 260, kinds: TRIP_KINDS, prefixes: names.trip, minKm: 0.3, maxKm: 50, popular: 8000, idPrefix: `${seed}-t` }),
    ];
    universe = { key, places };
    return places;
  }

  return {
    id: 'demo',
    isDemo: true,

    async searchNearby({ center, radiusM, types, rankBy, origin = center }) {
      await new Promise((r) => setTimeout(r, 250));
      const wanted = new Set(types);
      const radiusKm = radiusM / 1000;
      const matches = ensureUniverse(origin)
        .filter((p) => p.types.some((t) => wanted.has(t)))
        .map((p) => ({ p, d: haversineKm(center, p) }))
        .filter(({ d }) => d <= radiusKm);
      matches.sort(rankBy === 'distance' ? (a, b) => a.d - b.d : (a, b) => b.p.ratingCount * b.p.rating - a.p.ratingCount * a.p.rating);
      return matches.slice(0, 20).map(({ p }) => ({ ...p }));
    },

    async geocode(text) {
      const query = normalizeText(text);
      if (!query) return null;
      const hit = KNOWN_PLACES.find((p) =>
        [...p.label, ...p.aliases].map(normalizeText).some((a) => query.includes(a) || (query.length >= 2 && a.includes(query))),
      );
      return hit ? { lat: hit.lat, lng: hit.lng, label: hit.label[names.i] } : null;
    },

    knownPlaces: KNOWN_PLACES.map((p) => p.label[names.i]),

    photoUrl() {
      return null;
    },

    directionsUrl(origin, place, travelMode) {
      const params = new URLSearchParams({
        api: '1',
        origin: `${origin.lat},${origin.lng}`,
        destination: `${place.lat},${place.lng}`,
        travelmode: travelMode,
      });
      return `https://www.google.com/maps/dir/?${params}`;
    },

    mapsUrl(place) {
      return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
    },
  };
}

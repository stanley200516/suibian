// OpenStreetMap：免費、不用 key 的真實地點資料（沒有 Google API key 時的預設來源）。
// 搜尋先用 Overpass API（一次可拿到範圍內幾百個地點）；Overpass 免費伺服器常過載，
// 失敗或逾時就改用 Nominatim（一次最多 40 個，但比較穩）。地名查詢也用 Nominatim。
// 介面與 google.js 相同。跟 Google 比：沒有評分、照片；營業時間只有部分店家有。
import { haversineKm } from '../geo.js';
import { parseOpeningHours } from './osm-hours.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_TIMEOUT_MS = 12000;
const NOMINATIM_TIMEOUT_MS = 15000;
// Nominatim 使用規範：每秒最多 1 次
const NOMINATIM_INTERVAL_MS = 1100;
// 改用 Nominatim 時，每次最多查幾種類型（每種要等 1 秒多）
const MAX_FALLBACK_PHRASES = 3;
// Overpass 失敗後，這段時間內直接用 Nominatim，不用每次都等逾時
const OVERPASS_COOLDOWN_MS = 5 * 60 * 1000;

// 類型條件：每條規則是「標籤 → 條件」，全部成立才算符合。
// 字串 = 值完全相同；RegExp = 值符合；true = 有這個標籤。
// 同一份規則用來產生 Overpass 查詢，也用來篩選 Nominatim 的結果。
const EATERY = { amenity: /^(restaurant|fast_food)$/ };
const cuisine = (pattern) => ({ ...EATERY, cuisine: new RegExp(pattern, 'i') });

// Google 類型 → { phrases: Nominatim 查詢用的詞（每個詞最多回 40 筆）, rules }。
// 景點類（公園、山、古蹟）要求有 wikidata，只留下有名的地方。
const TYPE_RULES = {
  restaurant: { phrases: ['restaurant', 'fast food'], rules: [{ amenity: 'restaurant' }, { amenity: 'fast_food' }, { amenity: 'food_court' }] },
  chinese_restaurant: { phrases: ['restaurant'], rules: [cuisine('chinese|taiwanese|cantonese|sichuan|shanghai|hunan|dim_sum|dumpling|hot_pot|beef_noodle')] },
  japanese_restaurant: {
    phrases: ['restaurant'],
    rules: [cuisine('japanese|sushi|ramen|udon|soba|tempura|donburi|teishoku|yakitori|okonomiyaki|takoyaki|tonkatsu|kaiseki|gyudon|beef_bowl')],
  },
  ramen_restaurant: { phrases: ['restaurant'], rules: [cuisine('ramen')] },
  sushi_restaurant: { phrases: ['restaurant'], rules: [cuisine('sushi')] },
  korean_restaurant: { phrases: ['restaurant'], rules: [cuisine('korean')] },
  barbecue_restaurant: { phrases: ['restaurant'], rules: [cuisine('barbecue|bbq|yakiniku|grill')] },
  bar: { phrases: ['bar'], rules: [{ amenity: /^(bar|pub)$/ }, cuisine('izakaya')] },
  italian_restaurant: { phrases: ['restaurant'], rules: [cuisine('italian|pasta|pizza')] },
  pizza_restaurant: { phrases: ['restaurant'], rules: [cuisine('pizza')] },
  french_restaurant: { phrases: ['restaurant'], rules: [cuisine('french|bistro')] },
  steak_house: { phrases: ['restaurant'], rules: [cuisine('steak')] },
  spanish_restaurant: { phrases: ['restaurant'], rules: [cuisine('spanish|tapas')] },
  mediterranean_restaurant: { phrases: ['restaurant'], rules: [cuisine('mediterranean|greek')] },
  greek_restaurant: { phrases: ['restaurant'], rules: [cuisine('greek')] },
  turkish_restaurant: { phrases: ['restaurant'], rules: [cuisine('turkish|kebab')] },
  lebanese_restaurant: { phrases: ['restaurant'], rules: [cuisine('lebanese')] },
  middle_eastern_restaurant: { phrases: ['restaurant'], rules: [cuisine('middle_eastern|lebanese|turkish|kebab|falafel|arab|persian')] },
  american_restaurant: { phrases: ['restaurant'], rules: [cuisine('american|burger|diner')] },
  hamburger_restaurant: { phrases: ['fast food'], rules: [cuisine('burger')] },
  fast_food_restaurant: { phrases: ['fast food'], rules: [{ amenity: 'fast_food' }] },
  thai_restaurant: { phrases: ['restaurant'], rules: [cuisine('thai')] },
  vietnamese_restaurant: { phrases: ['restaurant'], rules: [cuisine('vietnamese|pho')] },
  indonesian_restaurant: { phrases: ['restaurant'], rules: [cuisine('indonesian|malaysian')] },
  indian_restaurant: { phrases: ['restaurant'], rules: [cuisine('indian|nepalese')] },
  mexican_restaurant: { phrases: ['restaurant'], rules: [cuisine('mexican|tacos|tex-mex|burrito')] },
  breakfast_restaurant: { phrases: ['restaurant'], rules: [cuisine('breakfast')] },
  brunch_restaurant: { phrases: ['restaurant'], rules: [cuisine('brunch|breakfast')] },
  sandwich_shop: { phrases: ['fast food'], rules: [cuisine('sandwich|bagel')] },
  cafe: { phrases: ['cafe'], rules: [{ amenity: 'cafe' }] },
  coffee_shop: { phrases: ['cafe'], rules: [{ amenity: 'cafe' }] },
  bakery: { phrases: ['bakery'], rules: [{ shop: 'bakery' }, { shop: 'pastry' }] },
  ice_cream_shop: { phrases: ['ice cream'], rules: [{ amenity: 'ice_cream' }, { shop: 'ice_cream' }] },
  seafood_restaurant: { phrases: ['restaurant'], rules: [cuisine('seafood|fish|oyster|crab')] },
  vegetarian_restaurant: { phrases: ['restaurant'], rules: [{ ...EATERY, 'diet:vegetarian': /^(yes|only)$/ }, cuisine('vegetarian|vegan')] },
  vegan_restaurant: { phrases: ['restaurant'], rules: [{ ...EATERY, 'diet:vegan': /^(yes|only)$/ }, cuisine('vegan')] },

  park: { phrases: ['park'], rules: [{ leisure: 'park', wikidata: true }, { leisure: 'garden', wikidata: true }] },
  national_park: { phrases: ['nature reserve'], rules: [{ boundary: 'national_park' }, { leisure: 'nature_reserve', wikidata: true }] },
  hiking_area: { phrases: ['viewpoint'], rules: [{ natural: 'peak', wikidata: true }, { tourism: 'viewpoint', wikidata: true }] },
  campground: { phrases: ['camp site'], rules: [{ tourism: 'camp_site' }] },
  tourist_attraction: { phrases: ['attraction'], rules: [{ tourism: 'attraction' }] },
  historical_landmark: {
    phrases: ['castle'],
    rules: [
      { historic: /^(castle|monument|ruins|archaeological_site|fort|manor|city_gate)$/, wikidata: true },
      { amenity: 'place_of_worship', religion: /^(buddhist|shinto|taoist)$/, wikidata: true },
    ],
  },
  cultural_center: { phrases: ['arts centre'], rules: [{ amenity: 'arts_centre' }] },
  museum: { phrases: ['museum'], rules: [{ tourism: 'museum' }] },
  art_gallery: { phrases: ['gallery'], rules: [{ tourism: 'gallery' }] },
  performing_arts_theater: { phrases: ['theatre'], rules: [{ amenity: 'theatre' }] },
  zoo: { phrases: ['zoo'], rules: [{ tourism: 'zoo' }] },
  aquarium: { phrases: ['aquarium'], rules: [{ tourism: 'aquarium' }] },
  amusement_park: { phrases: ['theme park'], rules: [{ tourism: 'theme_park' }] },
  movie_theater: { phrases: ['cinema'], rules: [{ amenity: 'cinema' }] },
  bowling_alley: { phrases: ['bowling alley'], rules: [{ leisure: 'bowling_alley' }] },
  amusement_center: { phrases: ['amusement arcade'], rules: [{ leisure: 'amusement_arcade' }] },
  shopping_mall: { phrases: ['mall'], rules: [{ shop: 'mall' }, { shop: 'department_store' }] },
  spa: { phrases: ['public bath'], rules: [{ amenity: 'public_bath' }, { leisure: 'spa' }] },
};

function ruleToSelector(rule) {
  return Object.entries(rule)
    .map(([key, cond]) => {
      if (cond === true) return `["${key}"]`;
      if (cond instanceof RegExp) return `["${key}"~"${cond.source}"${cond.flags.includes('i') ? ',i' : ''}]`;
      return `["${key}"="${cond}"]`;
    })
    .join('');
}

function ruleMatches(rule, tags) {
  return Object.entries(rule).every(([key, cond]) => {
    if (cond === true) return key in tags;
    if (cond instanceof RegExp) return cond.test(tags[key] ?? '');
    return tags[key] === cond;
  });
}

const rulesFor = (types) => types.flatMap((t) => TYPE_RULES[t]?.rules ?? []);

/** 一組 Google 類型對應的 Overpass 條件（去重） */
export function osmSelectorsFor(types) {
  return [...new Set(rulesFor(types).map(ruleToSelector))];
}

// 類型名稱：[中文, 英文, 日文]
const CUISINE_LABELS = {
  ramen: ['拉麵', 'Ramen', 'ラーメン'],
  sushi: ['壽司', 'Sushi', '寿司'],
  japanese: ['日本料理', 'Japanese', '和食'],
  udon: ['烏龍麵', 'Udon', 'うどん'],
  soba: ['蕎麥麵', 'Soba', 'そば'],
  noodle: ['麵店', 'Noodles', '麺類'],
  yakiniku: ['燒肉', 'Yakiniku', '焼肉'],
  yakitori: ['串燒', 'Yakitori', '焼き鳥'],
  izakaya: ['居酒屋', 'Izakaya', '居酒屋'],
  tonkatsu: ['豬排', 'Tonkatsu', 'とんかつ'],
  tempura: ['天婦羅', 'Tempura', '天ぷら'],
  donburi: ['丼飯', 'Donburi', '丼'],
  beef_bowl: ['牛丼', 'Beef bowl', '牛丼'],
  okonomiyaki: ['大阪燒', 'Okonomiyaki', 'お好み焼き'],
  curry: ['咖哩', 'Curry', 'カレー'],
  chinese: ['中式', 'Chinese', '中華'],
  taiwanese: ['台式', 'Taiwanese', '台湾料理'],
  dumpling: ['餃子', 'Dumplings', '餃子'],
  hot_pot: ['火鍋', 'Hot pot', '鍋料理'],
  korean: ['韓式', 'Korean', '韓国料理'],
  italian: ['義式', 'Italian', 'イタリアン'],
  pizza: ['披薩', 'Pizza', 'ピザ'],
  french: ['法式', 'French', 'フレンチ'],
  burger: ['漢堡', 'Burgers', 'ハンバーガー'],
  american: ['美式', 'American', 'アメリカン'],
  steak_house: ['牛排', 'Steakhouse', 'ステーキ'],
  chicken: ['炸雞', 'Chicken', 'チキン'],
  thai: ['泰式', 'Thai', 'タイ料理'],
  vietnamese: ['越南', 'Vietnamese', 'ベトナム料理'],
  indian: ['印度', 'Indian', 'インド料理'],
  mexican: ['墨西哥', 'Mexican', 'メキシコ料理'],
  seafood: ['海鮮', 'Seafood', '海鮮'],
  sandwich: ['三明治', 'Sandwiches', 'サンドイッチ'],
  coffee_shop: ['咖啡', 'Coffee', 'コーヒー'],
  cake: ['蛋糕', 'Cake', 'ケーキ'],
};

const TAG_LABELS = {
  'amenity=restaurant': ['餐廳', 'Restaurant', 'レストラン'],
  'amenity=fast_food': ['速食', 'Fast food', 'ファストフード'],
  'amenity=food_court': ['美食街', 'Food court', 'フードコート'],
  'amenity=cafe': ['咖啡廳', 'Café', 'カフェ'],
  'amenity=bar': ['酒吧', 'Bar', 'バー'],
  'amenity=pub': ['酒吧', 'Pub', 'パブ'],
  'amenity=ice_cream': ['冰淇淋', 'Ice cream', 'アイスクリーム'],
  'shop=bakery': ['麵包店', 'Bakery', 'パン屋'],
  'shop=pastry': ['甜點店', 'Pastry shop', '洋菓子店'],
  'shop=ice_cream': ['冰淇淋', 'Ice cream', 'アイスクリーム'],
  'leisure=park': ['公園', 'Park', '公園'],
  'leisure=garden': ['庭園', 'Garden', '庭園'],
  'leisure=nature_reserve': ['自然保護區', 'Nature reserve', '自然保護区'],
  'boundary=national_park': ['國家公園', 'National park', '国立公園'],
  'natural=peak': ['山', 'Mountain', '山'],
  'tourism=viewpoint': ['觀景點', 'Viewpoint', '展望スポット'],
  'tourism=camp_site': ['露營地', 'Campground', 'キャンプ場'],
  'tourism=attraction': ['景點', 'Attraction', '観光名所'],
  'tourism=museum': ['博物館', 'Museum', '博物館'],
  'tourism=gallery': ['美術館', 'Gallery', 'ギャラリー'],
  'tourism=zoo': ['動物園', 'Zoo', '動物園'],
  'tourism=aquarium': ['水族館', 'Aquarium', '水族館'],
  'tourism=theme_park': ['遊樂園', 'Theme park', 'テーマパーク'],
  'amenity=arts_centre': ['藝文中心', 'Arts centre', 'アートセンター'],
  'amenity=theatre': ['劇場', 'Theater', '劇場'],
  'amenity=cinema': ['電影院', 'Cinema', '映画館'],
  'leisure=bowling_alley': ['保齡球館', 'Bowling alley', 'ボウリング場'],
  'leisure=amusement_arcade': ['遊樂場', 'Arcade', 'ゲームセンター'],
  'shop=mall': ['購物中心', 'Shopping mall', 'ショッピングモール'],
  'shop=department_store': ['百貨公司', 'Department store', '百貨店'],
  'amenity=public_bath': ['溫泉・澡堂', 'Public bath', '温泉・銭湯'],
  'leisure=spa': ['SPA', 'Spa', 'スパ'],
  'amenity=place_of_worship': ['寺廟', 'Temple / shrine', '寺社'],
  'historic=*': ['古蹟', 'Historic site', '史跡'],
};
const LABEL_TAG_ORDER = ['amenity', 'shop', 'tourism', 'leisure', 'boundary', 'natural', 'historic'];

const LANG_INDEX = { 'zh-TW': 0, en: 1, ja: 2 };
// 優先用介面語言的名稱，沒有就用當地名稱（name:zh 常是簡體，所以不用）
const NAME_KEYS = { 'zh-TW': ['name:zh-Hant', 'name:zh-TW', 'name'], en: ['name:en', 'name'], ja: ['name:ja', 'name'] };
// 沒有該語言的名稱時，Nominatim 會用當地名稱（不混英文）
const ACCEPT_LANGUAGE = { 'zh-TW': 'zh-TW,zh-Hant,zh', en: 'en', ja: 'ja' };

function osmError(code, detail = '') {
  return Object.assign(new Error(`${code} ${detail}`.trim()), { code, detail });
}

function typeLabel(tags, i) {
  const c = tags.cuisine?.split(';')[0].trim().toLowerCase();
  if (c && CUISINE_LABELS[c]) return CUISINE_LABELS[c][i];
  for (const key of LABEL_TAG_ORDER) {
    if (!tags[key]) continue;
    const label = TAG_LABELS[`${key}=${tags[key]}`] ?? TAG_LABELS[`${key}=*`];
    if (label) return label[i];
  }
  return '';
}

function address(tags) {
  if (tags['addr:full']) return tags['addr:full'];
  const parts = [
    tags['addr:city'],
    tags['addr:suburb'] ?? tags['addr:district'],
    tags['addr:quarter'],
    tags['addr:neighbourhood'],
    tags['addr:street'] ?? tags['addr:place'],
    tags['addr:block_number'],
    tags['addr:housenumber'],
  ].filter((part, i, all) => part && part !== all[i - 1]);
  return parts.length >= 2 ? parts.join(' ') : '';
}

/** Nominatim 結果 → 跟 Overpass 一樣的元素格式，之後共用同一套轉換 */
function fromNominatim(hit) {
  const a = hit.address ?? {};
  const tags = {
    ...(hit.extratags ?? {}),
    ...(hit.namedetails ?? {}),
    [hit.category]: hit.type,
    'addr:city': a.city ?? a.town ?? a.village,
    'addr:suburb': a.suburb,
    'addr:quarter': a.quarter,
    'addr:neighbourhood': a.neighbourhood,
    'addr:street': a.road,
    'addr:housenumber': a.house_number,
  };
  if (!tags.name && hit.name) tags.name = hit.name;
  for (const key of Object.keys(tags)) if (tags[key] == null) delete tags[key];
  return { type: hit.osm_type, id: hit.osm_id, lat: Number(hit.lat), lon: Number(hit.lon), tags };
}

export function createOsmProvider({
  lang = 'en',
  fetchImpl = (...args) => globalThis.fetch(...args),
  nominatimIntervalMs = NOMINATIM_INTERVAL_MS,
} = {}) {
  const labelIndex = LANG_INDEX[lang] ?? LANG_INDEX.en;
  const nameKeys = NAME_KEYS[lang] ?? NAME_KEYS.en;
  const acceptLanguage = ACCEPT_LANGUAGE[lang] ?? 'en';
  let nominatimQueue = Promise.resolve();
  let overpassDownUntil = 0;

  async function request(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function overpass(query) {
    let res;
    try {
      res = await request(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: query }) }, OVERPASS_TIMEOUT_MS);
    } catch (err) {
      throw osmError('osm-network', err?.message ?? String(err));
    }
    if (!res.ok) throw osmError(res.status === 429 || res.status >= 500 ? 'osm-busy' : 'osm-generic', `HTTP ${res.status}`);
    let data;
    try {
      data = await res.json();
    } catch (err) {
      // 伺服器忙碌時偶爾會把回應截斷
      throw osmError('osm-busy', err?.message ?? String(err));
    }
    // 查詢逾時時 Overpass 仍回 200，但沒有結果、附上 remark
    if (!data.elements?.length && /runtime error|timed out/i.test(data.remark ?? '')) throw osmError('osm-busy', data.remark);
    return data.elements ?? [];
  }

  /** 依序呼叫 Nominatim，每次間隔 1 秒多，遵守使用規範 */
  function nominatim(params) {
    const run = nominatimQueue.then(async () => {
      let res;
      try {
        res = await request(`${NOMINATIM_URL}?${params}`, {}, NOMINATIM_TIMEOUT_MS);
      } catch (err) {
        throw osmError('osm-network', err?.message ?? String(err));
      }
      if (!res.ok) throw osmError(res.status === 429 || res.status >= 500 ? 'osm-busy' : 'osm-generic', `HTTP ${res.status}`);
      return res.json();
    });
    nominatimQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, nominatimIntervalMs)));
    return run;
  }

  async function searchOverpass(types, center, radiusM) {
    const around = `(around:${Math.round(radiusM)},${center.lat.toFixed(6)},${center.lng.toFixed(6)})`;
    // 分開限制點、區域、關聯的數量，避免大量的點把公園、商場這類區域擠掉
    const query =
      `[out:json][timeout:10];(${osmSelectorsFor(types).map((s) => `nwr${s}["name"]${around};`).join('')})->.r;` +
      'node.r;out center tags 500;way.r;out center tags 300;rel.r;out center tags 60;';
    return overpass(query);
  }

  async function searchNominatim(types, center, radiusM) {
    const phrases = [...new Set(types.flatMap((t) => TYPE_RULES[t]?.phrases ?? []))].slice(0, MAX_FALLBACK_PHRASES);
    const dLat = radiusM / 111320;
    const dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
    const viewbox = [center.lng - dLng, center.lat + dLat, center.lng + dLng, center.lat - dLat].join(',');
    const rules = rulesFor(types);
    const elements = [];
    for (const q of phrases) {
      const params = new URLSearchParams({
        format: 'jsonv2', q, viewbox, bounded: '1', limit: '40',
        extratags: '1', namedetails: '1', addressdetails: '1', 'accept-language': acceptLanguage,
      });
      for (const hit of await nominatim(params)) {
        const el = fromNominatim(hit);
        // 用同一套規則篩選（例如「拉麵」要看 cuisine 標籤）
        if (rules.some((rule) => ruleMatches(rule, el.tags))) elements.push(el);
      }
    }
    return elements;
  }

  function toPlace(el) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = nameKeys.map((k) => tags[k]).find(Boolean);
    if (!name || lat == null || lng == null) return null;
    // 員工餐廳之類不對外開放的地方
    if (/^(private|no)$/.test(tags.access ?? '')) return null;
    return {
      id: `osm-${el.type}-${el.id}`,
      name,
      lat,
      lng,
      address: address(tags),
      rating: null,
      ratingCount: null,
      priceLevel: null,
      typeLabel: typeLabel(tags, labelIndex),
      types: [],
      hours: parseOpeningHours(tags.opening_hours),
      // 附近的店跟裝置同一個時區
      utcOffsetMinutes: null,
      businessStatus: null,
      mapsUrl: null,
      photo: null,
      // 沒有評論數可用，用「有沒有維基資料、官網」粗估知名度
      notability: (tags.wikidata ? 3 : 0) + (tags.wikipedia ? 2 : 0) + (tags.website ? 1 : 0) + Object.keys(tags).length / 20,
    };
  }

  return {
    id: 'osm',
    hasRatings: false,
    // 一次查詢就能拿到範圍內的地點（Google 每次最多 20 筆）
    resultLimit: null,

    async searchNearby({ center, radiusM, types, rankBy }) {
      if (!osmSelectorsFor(types).length) return [];
      let elements;
      if (Date.now() < overpassDownUntil) {
        elements = await searchNominatim(types, center, radiusM);
      } else {
        try {
          elements = await searchOverpass(types, center, radiusM);
        } catch (err) {
          console.info('[osm] Overpass 失敗，改用 Nominatim：', err.message);
          overpassDownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
          elements = await searchNominatim(types, center, radiusM);
        }
      }

      const seen = new Set();
      const places = [];
      for (const el of elements) {
        const place = toPlace(el);
        if (!place || seen.has(place.id)) continue;
        seen.add(place.id);
        places.push(place);
      }
      if (rankBy === 'distance') places.sort((a, b) => haversineKm(center, a) - haversineKm(center, b));
      else places.sort((a, b) => b.notability - a.notability);
      return places;
    },

    /** near：目前出發點，用來優先找附近同名的地點 */
    async geocode(text, { near } = {}) {
      const params = new URLSearchParams({ format: 'jsonv2', q: text, limit: '1', 'accept-language': acceptLanguage });
      if (near) params.set('viewbox', [near.lng - 1, near.lat + 1, near.lng + 1, near.lat - 1].join(','));
      const [hit] = await nominatim(params);
      return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.name || hit.display_name.split(',')[0] } : null;
    },

    photoUrl() {
      return null;
    },

    // 用座標導航，確保導到 OSM 標記的位置
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

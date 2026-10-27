// Google Places (New)：透過 Maps JavaScript API 的 Place 類別在瀏覽器端搜尋。
// 需要在 Google Cloud 啟用「Maps JavaScript API」與「Places API (New)」。

const FIELDS = [
  'id',
  'displayName',
  'location',
  'formattedAddress',
  'rating',
  'userRatingCount',
  'priceLevel',
  'primaryTypeDisplayName',
  'types',
  'regularOpeningHours',
  'utcOffsetMinutes',
  'businessStatus',
  'googleMapsURI',
  'photos',
];

let loading = null;

function loadMapsScript(apiKey, language) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const callback = '__suibianMapsReady';
    window[callback] = () => resolve();
    // key 無效、未啟用 API 或網域不在限制清單內時，Google 會呼叫這個全域函式
    window.gm_authFailure = () => {
      window.dispatchEvent(new CustomEvent('suibian:google-auth-failure'));
    };
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      language,
      loading: 'async',
      callback,
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(googleError('load'));
    };
    document.head.append(script);
  });
  return loading;
}

const point = (p) => (p ? { day: p.day, hour: p.hour, minute: p.minute } : null);

function normalize(place) {
  const oh = place.regularOpeningHours;
  return {
    id: place.id,
    name: place.displayName,
    lat: place.location.lat(),
    lng: place.location.lng(),
    address: place.formattedAddress ?? '',
    rating: place.rating ?? null,
    ratingCount: place.userRatingCount ?? 0,
    priceLevel: place.priceLevel ?? null,
    typeLabel: place.primaryTypeDisplayName ?? '',
    types: place.types ?? [],
    hours: oh
      ? {
          periods: (oh.periods ?? []).map((p) => ({ open: point(p.open), close: point(p.close) })),
          weekdayText: oh.weekdayDescriptions ?? [],
        }
      : null,
    utcOffsetMinutes: place.utcOffsetMinutes ?? null,
    businessStatus: place.businessStatus ?? null,
    mapsUrl: place.googleMapsURI ?? null,
    photo: place.photos?.[0] ?? null,
  };
}

// 錯誤帶 code（denied / quota / load / generic），由畫面依語言顯示訊息
function googleError(code, detail = '') {
  return Object.assign(new Error(`google:${code} ${detail}`.trim()), { code, detail });
}

function classifyError(err) {
  const msg = String(err?.message ?? err);
  if (/PERMISSION_DENIED|REQUEST_DENIED|API_KEY|not authorized|ApiNotActivated/i.test(msg)) return googleError('denied', msg);
  if (/OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/i.test(msg)) return googleError('quota', msg);
  return googleError('generic', msg);
}

/** language：Google 回傳店名、類型名稱用的語言，例如 'zh-TW'、'en'、'ja' */
export function createGoogleProvider(apiKey, { language = 'en' } = {}) {
  async function places() {
    await loadMapsScript(apiKey, language);
    return google.maps.importLibrary('places');
  }

  return {
    id: 'google',
    isDemo: false,

    async searchNearby({ center, radiusM, types, rankBy, regionCode }) {
      const { Place, SearchNearbyRankPreference } = await places();
      try {
        const { places: results } = await Place.searchNearby({
          fields: FIELDS,
          locationRestriction: { center, radius: Math.min(50000, Math.max(1, Math.round(radiusM))) },
          includedTypes: types,
          maxResultCount: 20,
          rankPreference:
            rankBy === 'distance' ? SearchNearbyRankPreference.DISTANCE : SearchNearbyRankPreference.POPULARITY,
          language,
          ...(regionCode && { region: regionCode }),
        });
        return results.map(normalize);
      } catch (err) {
        throw classifyError(err);
      }
    },

    /** near：目前出發點，用來優先找附近同名的地點 */
    async geocode(text, { near, regionCode } = {}) {
      const { Place } = await places();
      try {
        const { places: results } = await Place.searchByText({
          textQuery: text,
          fields: ['displayName', 'location', 'formattedAddress'],
          maxResultCount: 1,
          language,
          ...(regionCode && { region: regionCode }),
          ...(near && { locationBias: { center: { lat: near.lat, lng: near.lng }, radius: 50000 } }),
        });
        const p = results[0];
        return p ? { lat: p.location.lat(), lng: p.location.lng(), label: p.displayName } : null;
      } catch (err) {
        throw classifyError(err);
      }
    },

    photoUrl(place) {
      return place.photo?.getURI?.({ maxWidth: 800, maxHeight: 480 }) ?? null;
    },

    directionsUrl(origin, place, travelMode) {
      const params = new URLSearchParams({
        api: '1',
        origin: `${origin.lat},${origin.lng}`,
        destination: place.name,
        destination_place_id: place.id,
        travelmode: travelMode,
      });
      return `https://www.google.com/maps/dir/?${params}`;
    },

    mapsUrl(place) {
      return (
        place.mapsUrl ??
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.id}`
      );
    },
  };
}

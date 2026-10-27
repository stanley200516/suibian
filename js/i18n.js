// 多語系：字典在 locales/，日期、時間、數字用瀏覽器內建的 Intl 依地區格式化。
import en from './locales/en.js';
import ja from './locales/ja.js';
import zhTW from './locales/zh-TW.js';

// intl：沒有更精確的裝置地區時，格式化日期時間用的預設地區
export const LANGS = {
  'zh-TW': { name: '繁體中文', html: 'zh-Hant-TW', google: 'zh-TW', intl: 'zh-TW', dict: zhTW },
  en: { name: 'English', html: 'en', google: 'en', intl: 'en-US', dict: en },
  ja: { name: '日本語', html: 'ja', google: 'ja', intl: 'ja-JP', dict: ja },
};

/** 依瀏覽器語言清單選出支援的語言，沒有符合的就用英文 */
export function detectLang(languages = []) {
  for (const l of languages) {
    const lower = String(l).toLowerCase();
    if (lower.startsWith('zh')) return 'zh-TW';
    if (lower.startsWith('ja')) return 'ja';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

const IMPERIAL_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

/** 依裝置地區決定距離單位（美國、英國等用英里） */
export function detectUnits(locale) {
  try {
    return IMPERIAL_REGIONS.has(new Intl.Locale(locale).maximize().region) ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

export function createI18n({ lang, units = 'metric', deviceLocale = '' }) {
  const info = LANGS[lang] ?? LANGS.en;
  const fallback = LANGS.en.dict;
  // 裝置語言和介面語言相同時，沿用裝置的地區格式（例如 en-GB 用 24 小時制）
  const deviceBase = deviceLocale.split('-')[0].toLowerCase();
  const intlLocale = deviceBase && info.intl.toLowerCase().startsWith(deviceBase) ? deviceLocale : info.intl;
  // 中文、日文的營業時間習慣用 24 小時制
  const clock = info.google === 'en' ? {} : { hourCycle: 'h23' };

  const timeFmt = new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', ...clock });
  const dateTimeFmt = new Intl.DateTimeFormat(intlLocale, {
    month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', ...clock,
  });
  const shortFmt = new Intl.DateTimeFormat(intlLocale, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', ...clock });
  const weekdayFmt = new Intl.DateTimeFormat(intlLocale, { weekday: 'short', timeZone: 'UTC' });
  const numberFmt = new Intl.NumberFormat(intlLocale);

  function t(key, params = {}) {
    const template = info.dict[key] ?? fallback[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  }

  return {
    lang: LANGS[lang] ? lang : 'en',
    htmlLang: info.html,
    googleLang: info.google,
    units,
    t,

    /** 店家當地的時、分（不做時區轉換） */
    formatTime: (hour, minute) => timeFmt.format(new Date(Date.UTC(2000, 0, 1, hour, minute))),
    formatDateTime: (date) => dateTimeFmt.format(date),
    formatShort: (date) => shortFmt.format(date),
    formatNumber: (n) => numberFmt.format(n),
    /** day：0 = 星期日 */
    weekday: (day) => weekdayFmt.format(new Date(Date.UTC(2023, 0, 1 + day))), // 2023-01-01 是星期日

    formatDistance(km) {
      if (units === 'imperial') {
        const miles = km / 1.609344;
        if (miles < 0.1) return t('unit.ft', { n: numberFmt.format(Math.max(50, Math.round((km * 3280.84) / 50) * 50)) });
        return t('unit.mi', { n: miles < 100 ? miles.toFixed(1) : numberFmt.format(Math.round(miles)) });
      }
      if (km < 1) return t('unit.m', { n: Math.max(10, Math.round(km * 100) * 10) });
      return t('unit.km', { n: km < 100 ? km.toFixed(1) : numberFmt.format(Math.round(km)) });
    },

    formatMinutes(min) {
      if (min < 60) return t('time.min', { m: min });
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m ? t('time.hourMin', { h, m }) : t('time.hour', { h });
    },
  };
}

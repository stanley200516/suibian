import { GOOGLE_MAPS_API_KEY } from '../app-config.js';
import {
  APP_MODES,
  AVOID_RECENT,
  MAX_RADIUS_KM,
  POOL_TTL_MS,
  PRICE_LABELS,
  RATING_OPTIONS,
  WHEN_OPTIONS,
} from './config.js';
import { radiusKmForMinutes, randomPointInCircle } from './geo.js';
import { closingTime, dayHours } from './hours.js';
import { LANGS, createI18n, detectLang, detectUnits } from './i18n.js';
import { filterCandidates, mergeUnique, pickRandom } from './picker.js';
import { createGoogleProvider } from './providers/google.js';
import { createOsmProvider } from './providers/osm.js';
import { REGIONS, TRAVEL_IDS, categoriesFor, detectRegion, guessRegionFromTimezone, isCategoryId } from './regions.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);
const els = {
  modeButtons: document.querySelectorAll('.mode-switch button'),
  dataBanner: $('dataBanner'),
  originDot: $('originDot'),
  originLabel: $('originLabel'),
  locateBtn: $('locateBtn'),
  originForm: $('originForm'),
  originInput: $('originInput'),
  travelChips: $('travelChips'),
  regionHint: $('regionHint'),
  minutesRange: $('minutesRange'),
  minutesOut: $('minutesOut'),
  radiusHint: $('radiusHint'),
  whenChips: $('whenChips'),
  whenAtRow: $('whenAtRow'),
  whenAt: $('whenAt'),
  unknownRow: $('unknownRow'),
  includeUnknown: $('includeUnknown'),
  catTitle: $('catTitle'),
  catChips: $('catChips'),
  ratingCard: $('ratingCard'),
  ratingChips: $('ratingChips'),
  historyCard: $('historyCard'),
  historyList: $('historyList'),
  clearHistoryBtn: $('clearHistoryBtn'),
  goBtn: $('goBtn'),
  resultDialog: $('resultDialog'),
  resultBody: $('resultBody'),
  settingsBtn: $('settingsBtn'),
  settingsDialog: $('settingsDialog'),
  settingsForm: $('settingsForm'),
  langSelect: $('langSelect'),
  regionSelect: $('regionSelect'),
  unitsSelect: $('unitsSelect'),
  apiKeyInput: $('apiKeyInput'),
  clearKeyBtn: $('clearKeyBtn'),
  providerStatus: $('providerStatus'),
  toast: $('toast'),
};

// ---------- 語言、單位、資料來源（變更後重新載入頁面） ----------

function loadSettings() {
  const raw = store.load('settings', {}) ?? {};
  return {
    lang: LANGS[raw.lang] ? raw.lang : 'auto',
    region: REGIONS[raw.region] ? raw.region : 'auto',
    units: ['metric', 'imperial'].includes(raw.units) ? raw.units : 'auto',
  };
}

const settings = loadSettings();
const deviceLocale = navigator.language || 'en';
const i18n = createI18n({
  lang: settings.lang !== 'auto' ? settings.lang : detectLang(navigator.languages?.length ? navigator.languages : [deviceLocale]),
  units: settings.units !== 'auto' ? settings.units : detectUnits(deviceLocale),
  deviceLocale,
});
const { t } = i18n;

const userKey = store.load('apiKey', '');
const apiKey = userKey || GOOGLE_MAPS_API_KEY;
// 有 Google key 用 Google，沒有就用免費的 OpenStreetMap
const provider = apiKey
  ? createGoogleProvider(apiKey, { language: i18n.googleLang })
  : createOsmProvider({ lang: i18n.lang });
const SOURCE_KEYS = { google: 'result.sourceGoogle', osm: 'result.sourceOsm' };

const state = {
  mode: APP_MODES[store.load('mode', 'food')] ? store.load('mode', 'food') : 'food',
  prefs: loadPrefs(),
  origin: null, // { lat, lng, label }
  excluded: new Set(), // 這次使用中按過「不要這間」的
  // 舊版示範資料的虛構地點不再顯示
  history: store.load('history', []).filter((h) => !h.demo),
  busy: false,
};
const poolCache = new Map();

// ---------- 小工具 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 指定時間的預設值：吃飯是下一個半點；出去玩是這週六早上 10 點（今天是假日就用下一個半點） */
function defaultAt(modeId) {
  const d = new Date();
  if (modeId === 'trip' && d.getDay() !== 0 && d.getDay() !== 6) {
    d.setDate(d.getDate() + (6 - d.getDay()));
    d.setHours(10, 0, 0, 0);
    return d;
  }
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

let toastTimer;
function toast(message) {
  const el = els.toast;
  el.textContent = message;
  if (el.showPopover) {
    try {
      el.hidePopover();
    } catch {}
    el.showPopover();
  } else {
    el.hidden = false;
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el.hidePopover) {
      try {
        el.hidePopover();
      } catch {}
    } else {
      el.hidden = true;
    }
  }, 2800);
}

// ---------- 地區 ----------

function regionCode() {
  if (settings.region !== 'auto') return settings.region;
  if (state.origin) return detectRegion(state.origin);
  const last = store.load('lastRegion', null);
  return REGIONS[last] ? last : guessRegionFromTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

const region = () => REGIONS[regionCode()];

// ---------- 偏好設定（每個模式各自記住） ----------

function defaultPrefs(modeId) {
  return {
    travel: null, // null = 用地區預設
    minutes: APP_MODES[modeId].time.default,
    cats: ['any'],
    minRating: 0,
    when: 'now',
    at: null,
    includeUnknown: APP_MODES[modeId].includeUnknownHours,
  };
}

function sanitizePrefs(modeId, raw) {
  const m = APP_MODES[modeId];
  const d = defaultPrefs(modeId);
  const p = { ...d, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!TRAVEL_IDS.includes(p.travel)) p.travel = null;
  p.minutes = Math.min(m.time.max, Math.max(m.time.min, Number(p.minutes) || d.minutes));
  p.cats = Array.isArray(p.cats) ? p.cats.filter((id) => isCategoryId(modeId, id)) : [];
  if (!p.cats.length) p.cats = ['any'];
  if (!RATING_OPTIONS.includes(p.minRating)) p.minRating = 0;
  if (!WHEN_OPTIONS.includes(p.when)) p.when = 'now';
  // 已經過去的指定時間就不沿用
  if (!p.at || Number.isNaN(new Date(p.at).getTime()) || new Date(p.at) < Date.now() - 3600000) p.at = null;
  p.includeUnknown = Boolean(p.includeUnknown);
  return p;
}

function loadPrefs() {
  const raw = store.load('prefs', {});
  return Object.fromEntries(Object.keys(APP_MODES).map((id) => [id, sanitizePrefs(id, raw?.[id])]));
}

const prefs = () => state.prefs[state.mode];
const savePrefs = () => store.save('prefs', state.prefs);

/** 目前地區實際使用的交通方式（記住的選擇在這個地區沒有時，用地區預設） */
function travelId() {
  const chosen = prefs().travel;
  return region().travel[chosen] ? chosen : region().defaults[state.mode];
}

const travelMode = () => region().travel[travelId()];
const categories = () => categoriesFor(regionCode(), state.mode);

/** 目前地區實際選取的類型 */
function activeCats() {
  const ids = new Set(categories().map((c) => c.id));
  const cats = prefs().cats.filter((id) => ids.has(id));
  return cats.length ? cats : ['any'];
}

function selectedTypes() {
  const cats = activeCats();
  return [...new Set(categories().filter((c) => cats.includes(c.id)).flatMap((c) => c.types))].sort();
}

// ---------- 畫面：靜態文字 ----------

function applyStaticText() {
  document.documentElement.lang = i18n.htmlLang;
  document.title = t('app.title');
  document.querySelector('meta[name="description"]').content = t('app.description');
  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = t('app.name');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));

  // 橫幅中間夾著「設定」按鈕
  const [before, after = ''] = t('banner.osm').split('{link}');
  els.dataBanner.innerHTML = `${esc(before)}<button type="button" class="link-btn" data-open-settings>${esc(t('banner.link'))}</button>${esc(after)}`;
  els.dataBanner.hidden = provider.id !== 'osm';
  // OpenStreetMap 沒有評分，評分條件用不到
  els.ratingCard.hidden = !provider.hasRatings;
}

// ---------- 畫面：條件 ----------

function chipsHtml(options, isOn, kind = 'radio') {
  return options
    .map((o) => {
      const on = Boolean(isOn(o.value));
      const aria = kind === 'radio' ? `role="radio" aria-checked="${on}"` : `aria-pressed="${on}"`;
      return `<button type="button" class="chip" data-value="${esc(o.value)}" ${aria}>${esc(o.label)}</button>`;
    })
    .join('');
}

function radiusHintText(minutes) {
  const id = travelId();
  const mode = travelMode();
  const label = t(`travel.${id}`);
  const r = radiusKmForMinutes(minutes, mode);
  if (r < 0.05) return t('radius.unreachable', { mode: label });
  let text = `${mode.icon} ${t('radius.reach', { mode: label, distance: i18n.formatDistance(r) })}`;
  if (r >= MAX_RADIUS_KM) text += t('radius.max');
  if (id === 'transit') text += t('radius.transitNote');
  return text;
}

function renderControls() {
  const mode = APP_MODES[state.mode];
  const p = prefs();
  const code = regionCode();
  const currentTravel = travelId();
  const cats = activeCats();

  document.body.dataset.mode = state.mode;
  for (const btn of els.modeButtons) btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));

  els.travelChips.innerHTML = chipsHtml(
    Object.entries(region().travel).map(([id, m]) => ({ value: id, label: `${m.icon} ${t(`travel.${id}`)}` })),
    (v) => v === currentTravel,
  );
  const autoDetected = settings.region === 'auto' && state.origin;
  els.regionHint.textContent = t(autoDetected ? 'region.hintAuto' : 'region.hint', { region: t(`region.${code}`) });

  Object.assign(els.minutesRange, { min: mode.time.min, max: mode.time.max, step: mode.time.step });
  els.minutesRange.value = p.minutes;
  renderMinutes();

  els.whenChips.innerHTML = chipsHtml(
    WHEN_OPTIONS.map((v) => ({ value: v, label: t(`when.${v}`) })),
    (v) => v === p.when,
  );
  els.whenAtRow.hidden = p.when !== 'at';
  if (p.when === 'at') {
    if (!p.at) {
      p.at = toLocalInput(defaultAt(state.mode));
      savePrefs();
    }
    els.whenAt.value = p.at;
  }
  els.unknownRow.hidden = p.when === 'any';
  els.includeUnknown.checked = p.includeUnknown;

  els.catTitle.textContent = t(state.mode === 'food' ? 'cat.titleFood' : 'cat.titleTrip');
  els.catChips.innerHTML = chipsHtml(
    categories().map((c) => ({ value: c.id, label: t(`cat.${c.id}`) })),
    (v) => cats.includes(v),
    'toggle',
  );
  els.ratingChips.innerHTML = chipsHtml(
    RATING_OPTIONS.map((v) => ({ value: v, label: v ? t('rating.min', { n: v.toFixed(1) }) : t('rating.any') })),
    (v) => v === p.minRating,
  );
  els.goBtn.textContent = t(`go.${state.mode}`);
}

function renderMinutes() {
  const p = prefs();
  els.minutesOut.textContent = i18n.formatMinutes(p.minutes);
  els.radiusHint.textContent = radiusHintText(p.minutes);
}

function renderOrigin(status) {
  const locating = status === 'locating';
  els.originDot.className = `dot${locating ? ' busy' : state.origin ? ' ok' : ''}`;
  els.originLabel.textContent = locating ? t('origin.locating') : (state.origin?.label ?? t('origin.none'));
}

function renderHistory() {
  const items = state.history.slice(0, 8);
  els.historyCard.hidden = !items.length;
  els.historyList.innerHTML = items
    .map(
      (h) => `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">
        <span>${APP_MODES[h.mode]?.icon ?? ''} ${esc(h.name)}</span>
        <small>${esc(i18n.formatShort(new Date(h.at)))}</small></a></li>`,
    )
    .join('');
}

// ---------- 出發點 ----------

function setOrigin(origin, { fromGps = false } = {}) {
  state.origin = origin;
  // 只用 GPS 位置記住「平常在哪個地區」；手動輸入的可能是在規劃別處的行程
  if (fromGps) store.save('lastRegion', detectRegion(origin));
  renderOrigin();
  // 出發點換到別的地區時，交通方式與類型也跟著換
  renderControls();
}

function locate() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      toast(t('origin.unsupported'));
      resolve(false);
      return;
    }
    renderOrigin('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: t('origin.current', { accuracy: i18n.formatDistance(pos.coords.accuracy / 1000) }),
        }, { fromGps: true });
        resolve(true);
      },
      (err) => {
        renderOrigin();
        toast(t(err.code === err.PERMISSION_DENIED ? 'origin.denied' : 'origin.failed'));
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

async function setOriginFromText(text) {
  renderOrigin('locating');
  try {
    const hit = await provider.geocode(text, { near: state.origin, regionCode: region().google });
    if (!hit) {
      renderOrigin();
      toast(t('origin.notFound'));
      return;
    }
    els.originInput.value = '';
    els.originInput.blur();
    setOrigin({ lat: hit.lat, lng: hit.lng, label: hit.label });
    toast(t('origin.changed', { label: hit.label }));
  } catch (err) {
    renderOrigin();
    toast(errorMessage(err));
  }
}

// ---------- 搜尋與抽選 ----------

/** 要搜尋哪些範圍 */
function searchPlan(origin, radiusKm) {
  const mode = APP_MODES[state.mode];
  if (!provider.resultLimit) {
    // 一次就能拿到範圍內所有地點；範圍太大時隨機取其中一塊，避免查詢太重
    const r = Math.min(radiusKm, mode.openDataRadiusKm);
    const center = radiusKm > r ? randomPointInCircle(origin, radiusKm - r) : origin;
    return [{ center, radiusKm: r, rankBy: 'popularity' }];
  }
  // 每次最多拿 20 筆：用不同排序和子區域多查幾輪
  return mode.rounds.map((round) =>
    round.area === 'sub'
      ? { center: randomPointInCircle(origin, radiusKm * 0.5), radiusKm: radiusKm * 0.5, rankBy: round.rankBy }
      : { center: origin, radiusKm, rankBy: round.rankBy },
  );
}

/** 同一組條件只搜尋一次，10 分鐘內重抽都用快取 */
async function getPool({ origin, radiusKm, types }) {
  const code = regionCode();
  const key = JSON.stringify([provider.id, state.mode, code, origin.lat.toFixed(4), origin.lng.toFixed(4), radiusKm.toFixed(2), types]);
  const hit = poolCache.get(key);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.places;

  const searches = searchPlan(origin, radiusKm).map((s) =>
    provider.searchNearby({
      center: s.center,
      radiusM: s.radiusKm * 1000,
      types,
      rankBy: s.rankBy,
      origin,
      regionCode: REGIONS[code].google,
    }),
  );
  const settled = await Promise.allSettled(searches);
  const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (!ok.length) throw settled[0].reason;
  const places = mergeUnique(ok);
  poolCache.set(key, { at: Date.now(), places });
  return places;
}

function recentIds() {
  return state.history
    .filter((h) => h.mode === state.mode)
    .slice(0, AVOID_RECENT)
    .map((h) => h.id);
}

function openSheet(dialog) {
  if (!dialog.open) dialog.showModal();
}

async function decide() {
  if (state.busy) return;
  state.busy = true;
  els.goBtn.disabled = true;
  try {
    if (!state.origin && !(await locate())) {
      els.originInput.focus();
      return;
    }
    const mode = APP_MODES[state.mode];
    const p = prefs();
    const travel = travelMode();
    const radiusKm = radiusKmForMinutes(p.minutes, travel);

    openSheet(els.resultDialog);
    if (radiusKm < 0.05) {
      renderEmpty([t('empty.tooShort'), t('empty.faster')]);
      return;
    }

    renderLoading(t('result.loading'));
    const places = await getPool({ origin: state.origin, radiusKm, types: selectedTypes() });

    const when = { type: p.when, at: p.when === 'at' && p.at ? new Date(p.at) : null };
    const candidates = filterCandidates(places, {
      origin: state.origin,
      travel,
      maxMinutes: p.minutes,
      when,
      stayMin: mode.stayMin,
      includeUnknownHours: p.includeUnknown,
      minRating: provider.hasRatings ? p.minRating : 0,
      minReviews: provider.hasRatings ? mode.minReviews : 0,
      excludeIds: state.excluded,
    });

    if (!candidates.length) {
      renderEmpty(emptyTips(p, places.length));
      return;
    }

    const pick = pickRandom(candidates, { avoidIds: recentIds() });
    await spin(candidates, pick);
    renderResult(pick, candidates.length, when);
    addHistory(pick);
    navigator.vibrate?.(20);
  } catch (err) {
    console.error(err);
    renderError(err);
  } finally {
    state.busy = false;
    els.goBtn.disabled = false;
  }
}

function emptyTips(p, foundCount) {
  const tips = [];
  const anyOnly = activeCats().includes('any');
  if (foundCount === 0) tips.push(t('empty.noneOfType'));
  else if (!anyOnly) tips.push(t('empty.anyCategory'));
  tips.push(t('empty.longer'));
  if (provider.hasRatings && p.minRating > 0) tips.push(t('empty.rating'));
  if (p.when !== 'any') {
    tips.push(t('empty.hours', { min: APP_MODES[state.mode].stayMin }));
    if (!p.includeUnknown) tips.push(t('empty.unknown'));
  }
  return tips;
}

async function spin(candidates, pick) {
  const nameEl = document.getElementById('spinName');
  const labelEl = els.resultBody.querySelector('.spin-label');
  if (labelEl) labelEl.textContent = t('result.spinning', { n: i18n.formatNumber(candidates.length) });
  if (!nameEl || candidates.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  nameEl.classList.remove('waiting');
  const names = shuffle(candidates.map((c) => c.name));
  let delay = 50;
  for (let i = 0; i < 14; i++) {
    nameEl.textContent = names[i % names.length];
    await sleep(delay);
    delay *= 1.15;
  }
  nameEl.textContent = pick.name;
  nameEl.classList.add('landed');
  await sleep(500);
}

function addHistory(pick) {
  state.history.unshift({
    id: pick.id,
    name: pick.name,
    mode: state.mode,
    at: new Date().toISOString(),
    url: provider.mapsUrl(pick),
  });
  state.history = state.history.slice(0, 30);
  store.save('history', state.history);
  renderHistory();
}

// ---------- 畫面：結果 ----------

function renderLoading(text) {
  els.resultBody.innerHTML = `
    <div class="spin">
      <p class="spin-label">${esc(text)}</p>
      <p id="spinName" class="spin-name waiting" aria-hidden="true">🎲</p>
    </div>`;
}

const formatPoint = (p) => i18n.formatTime(p.hour, p.minute);

function formatDayHours(info) {
  if (!info) return null;
  const weekday = i18n.weekday(info.day);
  if (info.allDay) return t('hours.allDay', { weekday });
  if (!info.ranges.length) return t('hours.closed', { weekday });
  const ranges = info.ranges.map((r) => `${formatPoint(r.open)}–${formatPoint(r.close)}`).join(t('hours.joiner'));
  return t('hours.day', { weekday, ranges });
}

function hoursFact(pick, when) {
  const today = formatDayHours(dayHours(pick.hours, pick.arrival ?? new Date(), pick.utcOffsetMinutes));
  if (when.type === 'any') return { main: today ?? t('result.hoursUnknown'), sub: '' };
  if (pick.openState !== true) return { main: t('result.hoursUnknownCheck'), sub: '' };
  const close = closingTime(pick.hours, pick.arrival, pick.utcOffsetMinutes);
  const until = !close ? '' : close.allDay ? t('result.allDay') : t('result.until', { time: formatPoint(close) });
  const main =
    when.type === 'now'
      ? t('result.openNow', { until })
      : t('result.openAt', { time: i18n.formatDateTime(when.at), until });
  return { main, sub: today ?? '' };
}

function renderResult(pick, total, when) {
  const mode = APP_MODES[state.mode];
  const id = travelId();
  const travel = travelMode();
  const photoUrl = provider.photoUrl(pick);
  const credit = pick.photo?.authorAttributions?.[0];
  const price = pick.priceLevel === 'FREE' ? t('price.free') : PRICE_LABELS[pick.priceLevel];
  const meta = [pick.typeLabel, price].filter(Boolean).join(' · ');
  const hours = hoursFact(pick, when);
  const eta = t('result.eta', { mode: t(`travel.${id}`), min: pick.etaMin, distance: i18n.formatDistance(pick.distKm) });
  const source = t(SOURCE_KEYS[provider.id]);

  els.resultBody.innerHTML = `
    <article class="result">
      <div class="result-photo">
        ${photoUrl ? `<img src="${esc(photoUrl)}" alt="">` : `<span aria-hidden="true">${mode.icon}</span>`}
        ${credit ? `<a class="photo-credit" href="${esc(credit.uri)}" target="_blank" rel="noopener">📷 ${esc(credit.displayName)}</a>` : ''}
      </div>
      <p class="eyebrow">${esc(t(`result.eyebrow.${state.mode}`))}</p>
      <h2 id="resultTitle" class="result-title">${esc(pick.name)}</h2>
      ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
      <ul class="facts">
        ${
          pick.rating
            ? `<li><span class="ico star" aria-hidden="true">★</span><span><b>${pick.rating.toFixed(1)}</b>${esc(t('result.reviews', { n: i18n.formatNumber(pick.ratingCount) }))}</span></li>`
            : ''
        }
        <li><span class="ico" aria-hidden="true">${travel.icon}</span><span>${esc(eta)}<small>${esc(t(id === 'transit' ? 'result.estimateTransit' : 'result.estimate'))}</small></span></li>
        <li><span class="ico" aria-hidden="true">🕒</span><span>${esc(hours.main)}${hours.sub ? `<small>${esc(hours.sub)}</small>` : ''}</span></li>
        ${pick.address ? `<li><span class="ico" aria-hidden="true">📍</span><span>${esc(pick.address)}</span></li>` : ''}
      </ul>
      <div class="actions">
        <a class="cta" href="${esc(provider.directionsUrl(state.origin, pick, travel.gmaps))}" target="_blank" rel="noopener">${esc(t('result.navigate'))}</a>
        <a class="btn-ghost" href="${esc(provider.mapsUrl(pick))}" target="_blank" rel="noopener">${esc(t('result.map'))}</a>
        <button type="button" class="btn-ghost" data-act="share">${esc(t('result.share'))}</button>
      </div>
      <div class="actions secondary">
        <button type="button" class="btn-ghost" data-act="again">${esc(t('result.again'))}</button>
        <button type="button" class="btn-ghost" data-act="veto">${esc(t('result.veto'))}</button>
      </div>
      <p class="foot">${esc(t('result.foot', { n: i18n.formatNumber(total), source }))}</p>
    </article>`;

  const on = (act, fn) => els.resultBody.querySelector(`[data-act="${act}"]`).addEventListener('click', fn);
  on('again', () => decide());
  on('veto', () => {
    state.excluded.add(pick.id);
    toast(t('result.vetoed', { name: pick.name }));
    decide();
  });
  on('share', () => share(pick));
}

function renderEmpty(tips) {
  const excluded = state.excluded.size;
  els.resultBody.innerHTML = `
    <div class="empty">
      <div class="big" aria-hidden="true">🤷</div>
      <h2 id="resultTitle">${esc(t('empty.title'))}</h2>
      <ul>${tips.map((tip) => `<li>${esc(tip)}</li>`).join('')}</ul>
      <div class="stack">
        ${excluded ? `<button type="button" class="btn-ghost" data-act="reset">${esc(t('empty.reset', { n: excluded }))}</button>` : ''}
        <button type="button" class="cta" data-act="close">${esc(t('empty.adjust'))}</button>
      </div>
    </div>`;
  els.resultBody.querySelector('[data-act="close"]').addEventListener('click', () => els.resultDialog.close());
  els.resultBody.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
    state.excluded.clear();
    decide();
  });
}

function errorMessage(err) {
  switch (err?.code) {
    case 'denied':
      return t('error.googleDenied');
    case 'quota':
      return t('error.googleQuota');
    case 'load':
      return t('error.googleLoad');
    case 'generic':
      return t('error.googleGeneric', { message: err.detail });
    case 'osm-busy':
      return t('error.osmBusy');
    case 'osm-network':
      return t('error.osmNetwork');
    case 'osm-generic':
      return t('error.osmGeneric', { message: err.detail });
    default:
      return err?.message ?? String(err);
  }
}

function renderError(err) {
  els.resultBody.innerHTML = `
    <div class="empty">
      <div class="big" aria-hidden="true">😵</div>
      <h2 id="resultTitle">${esc(t('error.title'))}</h2>
      <p class="hint">${esc(errorMessage(err))}</p>
      <div class="stack" style="margin-top:20px">
        <button type="button" class="cta" data-act="retry">${esc(t('error.retry'))}</button>
      </div>
    </div>`;
  els.resultBody.querySelector('[data-act="retry"]').addEventListener('click', () => decide());
}

async function share(pick) {
  const text = t(`share.${state.mode}`, { name: pick.name });
  const url = provider.mapsUrl(pick);
  if (navigator.share) {
    try {
      await navigator.share({ title: t('app.name'), text, url });
    } catch {
      // 使用者取消分享
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast(t('share.copied'));
  } catch {
    toast(t('share.failed'));
  }
}

// ---------- 設定 ----------

function openSettings() {
  const option = (value, label, selected) =>
    `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  els.langSelect.innerHTML =
    option('auto', t('settings.auto'), settings.lang === 'auto') +
    Object.entries(LANGS).map(([id, l]) => option(id, l.name, settings.lang === id)).join('');
  els.regionSelect.innerHTML =
    option('auto', t('settings.regionAuto'), settings.region === 'auto') +
    Object.keys(REGIONS).map((code) => option(code, t(`region.${code}`), settings.region === code)).join('');
  els.unitsSelect.innerHTML = [
    option('auto', t('settings.auto'), settings.units === 'auto'),
    option('metric', t('units.metric'), settings.units === 'metric'),
    option('imperial', t('units.imperial'), settings.units === 'imperial'),
  ].join('');

  els.apiKeyInput.value = userKey;
  els.providerStatus.textContent = t(
    provider.id === 'osm' ? 'settings.statusOsm' : userKey ? 'settings.statusGoogle' : 'settings.statusGoogleConfig',
  );
  openSheet(els.settingsDialog);
}

// ---------- 事件 ----------

function onChip(container, handler) {
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    handler(chip.dataset.value);
    savePrefs();
    renderControls();
  });
}

function bindEvents() {
  for (const btn of els.modeButtons) {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      store.save('mode', state.mode);
      renderControls();
    });
  }

  els.locateBtn.addEventListener('click', () => locate());
  els.originForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.originInput.value.trim();
    if (text) setOriginFromText(text);
  });

  onChip(els.travelChips, (value) => {
    prefs().travel = value;
  });
  onChip(els.whenChips, (value) => {
    prefs().when = value;
  });
  onChip(els.ratingChips, (value) => {
    prefs().minRating = Number(value);
  });
  onChip(els.catChips, (id) => {
    let cats = new Set(activeCats());
    if (id === 'any') {
      cats = new Set(['any']);
    } else {
      cats.delete('any');
      if (cats.has(id)) cats.delete(id);
      else cats.add(id);
      if (!cats.size) cats.add('any');
    }
    prefs().cats = [...cats];
  });

  els.minutesRange.addEventListener('input', () => {
    prefs().minutes = Number(els.minutesRange.value);
    renderMinutes();
  });
  els.minutesRange.addEventListener('change', savePrefs);

  els.whenAt.addEventListener('change', () => {
    prefs().at = els.whenAt.value || null;
    savePrefs();
    renderControls();
  });
  els.includeUnknown.addEventListener('change', () => {
    prefs().includeUnknown = els.includeUnknown.checked;
    savePrefs();
  });

  els.goBtn.addEventListener('click', () => decide());

  els.clearHistoryBtn.addEventListener('click', () => {
    state.history = [];
    store.save('history', state.history);
    renderHistory();
  });

  els.settingsBtn.addEventListener('click', openSettings);
  els.dataBanner.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-settings]')) openSettings();
  });
  els.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    store.save('settings', {
      lang: els.langSelect.value,
      region: els.regionSelect.value,
      units: els.unitsSelect.value,
    });
    const key = els.apiKeyInput.value.trim();
    if (key) store.save('apiKey', key);
    else store.remove('apiKey');
    location.reload();
  });
  els.clearKeyBtn.addEventListener('click', () => {
    store.remove('apiKey');
    location.reload();
  });

  for (const dialog of [els.resultDialog, els.settingsDialog]) {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    // 點背景關閉
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  window.addEventListener('suibian:google-auth-failure', () => {
    openSheet(els.resultDialog);
    renderError(new Error(t('error.googleAuth')));
  });
}

async function init() {
  if (!els.toast.showPopover) els.toast.hidden = true;
  applyStaticText();
  bindEvents();
  renderControls();
  renderOrigin();
  renderHistory();

  // 已經允許過定位就直接定位，不然等使用者按按鈕才跳權限詢問
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') locate();
  } catch {
    // 不支援 permissions API 的瀏覽器
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

import { createStore, newAccount, newId, DEFAULT_SETTINGS } from './store.js';
import * as S from './stats.js';
import { buildCoach, weeklyReview, guardrails, money, pct, plain, TAG_ACTIONS } from './coach.js';
import { repeatMistakes, mistakeSentence, mistakeEcho, recurringPhrases } from './patterns.js';
import { BILLING, billingStatus, needsRecheck, activateLicense, validateLicense, paymentsReady, emailCode } from './billing.js';
import { FIELDS, parseCsv, guessMapping, rowsToTrades } from './importer.js';
import { drawShareCard } from './sharecard.js';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bal = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const signed = (v) => (Math.round(v) === 0 ? '$0' : money(v));
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const rTxt = (r) => (Number.isFinite(r) ? `${r > 0 ? '+' : ''}${r.toFixed(2)}R` : '–');
const todayIso = () => S.isoDate(new Date());
const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) => new Date(iso + 'T12:00').toLocaleDateString('en-US', opts);
const nowTime = () => new Date().toTimeString().slice(0, 5);

const SESSIONS = ['London Open', 'NY AM Session', 'Macro', 'NY PM Session', 'Asia', 'Other'];
const EMOTIONS = ['Calm / Focused', 'Patient', 'FOMO / Rushed', 'Anxious', 'Overconfident', 'Bored'];
const NEWS = ['Low / None', 'Medium Impact', 'High Impact'];
const POINT_VALUE = { NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, MYM: 0.5, RTY: 50, M2K: 5, CL: 1000, MCL: 100, GC: 100, MGC: 10 };

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ================= quotes ================= */
const QUOTES = [
  'Trade the plan, not the feeling.',
];
function setQuote() {
  const d = new Date(), day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const q = QUOTES[day % QUOTES.length];
  $$('[data-quote]').forEach((el) => { el.textContent = `“${q}”`; });
}

/* ================= theme ================= */
const THEMES = [
  { id: 'dusk', name: 'Dusk', sw: ['#0f1220', '#ffad80', '#ff7fa6'] },
  { id: 'sakura', name: 'Sakura', sw: ['#161118', '#ff9cc9', '#c9a2ff'] },
  { id: 'lagoon', name: 'Lagoon', sw: ['#0a1619', '#5fd9e8', '#9be08a'] },
  { id: 'lavender', name: 'Lavender', sw: ['#121020', '#b9a6ff', '#7fd6ff'] },
  { id: 'brass', name: 'Brass', sw: ['#121419', '#d8a43a', '#d8a43a'] },
  { id: 'daylight', name: 'Daylight', sw: ['#f6f3ef', '#e0603f', '#d94f86'] },
];
const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function alpha(c, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c;
  const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function applyTheme(id) {
  const t = THEMES.some((x) => x.id === id) ? id : 'dusk';
  if (t === 'dusk') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('windage-theme', t); } catch (e) { /* private mode */ }
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = tok('--bg') || '#0f1220';
}

/* ================= state ================= */
const state = {
  user: null, accounts: [], activeAccountId: null, settings: { ...DEFAULT_SETTINGS }, profile: {},
  trades: [], prep: {}, billing: {},
  view: 'dashboard', params: {},
  cal: { y: new Date().getFullYear(), m: new Date().getMonth() },
  filters: { q: '', session: '', dir: '', result: '', grade: '', tag: '', model: '', from: '', to: '' },
  coachScope: 'account', coachDim: 'session', showAllLeaks: false,
  prepDate: todayIso(),
};
let store = null;
let installPrompt = null;
const charts = [];

const acct = () => state.accounts.find((a) => a.id === state.activeAccountId) || state.accounts[0];
const acctTrades = () => state.trades.filter((t) => t.accountId === state.activeAccountId);
const saveMeta = (patch) => store.saveMeta(patch).catch((e) => toast('Couldn’t sync: ' + e.message));

/* ================= boot & auth ================= */
const setBoot = (msg) => { $('#boot').hidden = false; $('#bootMsg').textContent = msg; };

function showAuth() {
  $('#boot').hidden = true; $('#app').hidden = true; $('#auth').hidden = false;
  setAuthMode('signin');
}

let authMode = 'signin';
function setAuthMode(mode) {
  authMode = mode;
  const title = { signin: 'Sign in', signup: 'Create your journal', reset: 'Reset your password' }[mode];
  $('#authTitle').textContent = title;
  $('#authSubmit').textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[mode];
  $('#authNameField').hidden = mode !== 'signup';
  $('#authPwField').hidden = mode === 'reset';
  $('#authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#authToSignup').hidden = mode !== 'signin';
  $('#authToReset').hidden = mode !== 'signin';
  $('#authToSignin').hidden = mode === 'signin';
  $('#authError').hidden = true; $('#authNote').hidden = true;
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'That email and password don’t match. Try again or reset your password.',
  'auth/wrong-password': 'That email and password don’t match. Try again or reset your password.',
  'auth/user-not-found': 'There’s no journal for that email yet. Create an account instead.',
  'auth/email-already-in-use': 'That email already has a journal. Sign in instead.',
  'auth/weak-password': 'Use at least 6 characters for your password.',
  'auth/invalid-email': 'That doesn’t look like a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
};

function wireAuth() {
  $$('[data-auth-mode]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.authMode)));
  $$('[data-auth-jump]').forEach((b) => b.addEventListener('click', () => {
    setAuthMode(b.dataset.authJump);
    $('#authForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => ($(b.dataset.authJump === 'signup' ? '#authName' : '#authEmail'))?.focus({ preventScroll: true }), 350);
  }));
  // Homepage pricing, from the same plan list the app uses.
  const lp = $('#lpPlans');
  if (lp) lp.innerHTML = BILLING.plans.map((p) => `<div class="plan-card ${p.id === 'twoyear' ? 'best' : ''}">
      <div class="plan-top"><h3>${esc(p.name)}</h3>${p.id === 'twoyear' ? '<span class="tag grade">Best value</span>' : ''}</div>
      <p class="plan-price"><b class="num">${esc(p.price)}</b> <span>${esc(p.per)}</span></p>
      <p class="muted" style="font-size:14px">${esc(p.note)}. Starts after your free month.</p>
      <button type="button" class="btn btn-primary btn-block" data-auth-jump-plan>Start free trial</button>
    </div>`).join('');
  $$('[data-auth-jump-plan]').forEach((b) => b.addEventListener('click', () => $('[data-auth-jump=signup]').click()));
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#authEmail').value.trim(), pw = $('#authPassword').value, name = $('#authName').value.trim();
    const err = $('#authError'), note = $('#authNote'), btn = $('#authSubmit');
    err.hidden = true; note.hidden = true;
    if (!email) { err.textContent = 'Enter your email address.'; err.hidden = false; return; }
    if (authMode !== 'reset' && pw.length < 6) { err.textContent = 'Enter your password (at least 6 characters).'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      if (authMode === 'signin') await store.signIn(email, pw);
      else if (authMode === 'signup') await store.signUp(email, pw, name);
      else { await store.resetPassword(email); note.textContent = `Reset link sent to ${email}. Check your inbox and spam folder.`; note.hidden = false; }
    } catch (ex) {
      err.textContent = AUTH_ERRORS[ex.code] || ex.message; err.hidden = false;
    } finally { btn.disabled = false; }
  });
}

async function start() {
  setQuote();
  wireAuth();
  // Install button on the sign-in screen (Android/desktop Chrome) or a hint (iPhone Safari).
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (!standalone) {
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { $('#installBox').hidden = false; $('#installHint').hidden = false; }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); installPrompt = e;
      $('#installBox').hidden = false; $('#installAuthBtn').hidden = false;
    });
    $('#installAuthBtn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#installBox').hidden = true; });
  }
  store = createStore();
  if (!store) { setBoot('Couldn’t reach the sync service. Check your internet connection, then reload the page.'); return; }
  store.onAuth(async (user) => {
    if (!user) { state.user = null; showAuth(); return; }
    state.user = user;
    try { state.emailCode = await emailCode(user.email); } catch (e) { state.emailCode = ''; }
    $('#auth').hidden = true; setBoot('Loading your journal…');
    try {
      const data = await store.load(setBoot);
      Object.assign(state, data);
      if (state.profile && !state.profile.displayName && user.name) state.profile.displayName = user.name;
    } catch (e) {
      const hint = e.code === 'permission-denied'
        ? 'Your database rules are blocking access. See the setup notes in the README (Firestore rules).'
        : e.message;
      setBoot('Couldn’t load your journal. ' + hint);
      const err = $('#bootErr'); if (err) { err.textContent = e.code ? `Code: ${e.code}` : ''; err.hidden = !e.code; }
      const act = $('#bootActions'); if (act) act.hidden = false;
      return;
    }
    applyTheme(state.settings.theme);
    if (store.kind !== 'demo') {
      recheckLicense();
    }
    $('#boot').hidden = true; $('#app').hidden = false;
    $('#demoBanner').hidden = store.kind !== 'demo';
    wireApp();
    route();
    if (needsOnboarding()) setTimeout(openOnboarding, 300);
  });
}

/* ================= shell ================= */
let wired = false;
function wireApp() {
  renderAccountSelect();
  if (wired) return; wired = true;
  window.addEventListener('hashchange', route);
  $('#accountSelect').addEventListener('change', (e) => {
    state.activeAccountId = e.target.value; saveMeta({ activeAccountId: state.activeAccountId }); render();
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]'); if (!a) return;
    const act = a.dataset.action;
    if (act === 'log') { if (locked()) openPlans(); else openEditor(); }
    else if (act === 'plans') openPlans();
    else if (act === 'trade') openDetail(a.dataset.id);
  });
  $('#copyLastBtn').addEventListener('click', () => {
    const t = S.sortTrades(acctTrades()).pop();
    if (!t) { toast('No trades logged yet'); return; }
    copyRecap(t);
  });
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (state.view === 'settings') render(); });
}

function renderAccountSelect() {
  $('#accountSelect').innerHTML = state.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === state.activeAccountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

const VIEWS = { dashboard: 'Dashboard', trades: 'Trades', coach: 'Coach', playbook: 'Playbook', prep: 'Daily journal', accounts: 'Accounts', settings: 'Settings' };

function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  state.view = VIEWS[path] ? path : 'dashboard';
  state.params = Object.fromEntries(new URLSearchParams(query || ''));
  if (state.view === 'trades' && state.params.date) {
    state.filters = { ...state.filters, from: state.params.date, to: state.params.date };
  }
  if (state.view === 'trades' && state.params.model !== undefined) state.filters = { ...state.filters, model: state.params.model };
  $$('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === state.view || (state.view === 'playbook' && a.dataset.nav === 'coach' && a.closest('.bottom-nav'));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#pageTitle').textContent = VIEWS[state.view];
  document.title = `${VIEWS[state.view]} · Windage`;
  render();
  window.scrollTo(0, 0);
  if (state.params.log) { history.replaceState(null, '', `#/${state.view}`); openEditor(); }
}

function render() {
  charts.splice(0).forEach((c) => c.destroy());
  renderAccountSelect();
  const v = $('#view');
  paintPlanChip();
  if (locked() && state.view !== 'settings') { renderPaywall(v); return; }
  ({ dashboard: renderDashboard, trades: renderTrades, coach: renderCoach, playbook: renderPlaybook, prep: renderPrep, accounts: renderAccounts, settings: renderSettings })[state.view](v);
  if (state.view === 'coach' || state.view === 'playbook') {
    v.insertAdjacentHTML('afterbegin', `<nav class="subtabs mobile-only" aria-label="Coach sections"><a href="#/coach" ${state.view === 'coach' ? 'aria-current="page"' : ''}>Insights</a><a href="#/playbook" ${state.view === 'playbook' ? 'aria-current="page"' : ''}>Playbook</a></nav>`);
  }
}

/* ================= charts ================= */
function chart(canvas, config) {
  if (!window.Chart || !canvas) { if (canvas) canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Charts are unavailable offline.' })); return; }
  Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  Chart.defaults.color = tok('--mute');
  const c = new Chart(canvas, config); charts.push(c); return c;
}
const gridColor = () => alpha(tok('--line'), 0.8);
const moneyTick = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `$${v}`);

/* ================= dashboard ================= */
function ladderHtml(a, st, per) {
  const lo0 = Math.min(st.threshold, st.balance, st.start), hi0 = Math.max(st.target, st.balance, st.start);
  const pad = (hi0 - lo0) * 0.04 || 100;
  const lo = lo0 - pad, hi = hi0 + pad;
  const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const ticks = [
    { k: 'liq', v: st.threshold, label: 'Liquidation' },
    { k: 'start', v: st.start, label: 'Start' },
    { k: 'tgt', v: st.target, label: a.type === 'Funded' ? 'Payout goal' : 'Target' },
  ].filter((t) => t.k !== 'tgt' || st.target > st.start);
  const tickHtml = ticks.map((t) => {
    const p = pos(t.v);
    const crowded = t.k === 'start' && ticks.some((o) => o.k !== 'start' && Math.abs(pos(o.v) - p) < 16);
    const edge = p < 9 ? 'edge-l' : p > 91 ? 'edge-r' : '';
    return `<div class="ladder-tick ${t.k} ${edge}" style="left:${p}%">${crowded ? '' : `<span>${t.label}</span><b>${bal(t.v)}</b>`}</div>`;
  }).join('');
  const fillFrom = Math.min(pos(st.start), pos(st.balance)), fillTo = Math.max(pos(st.start), pos(st.balance));
  const delta = st.balance - st.start;
  const status = st.blown ? '<span class="ladder-status blown">Drawdown limit hit</span>' : st.passed ? `<span class="ladder-status passed">${a.type === 'Funded' ? 'Payout goal reached' : 'Target reached'}</span>` : '';
  const ddLabel = { trailing: 'trailing', eod: 'end-of-day trailing', static: 'static' }[a.ddType || 'trailing'];
  return `
  <section class="panel ladder" aria-label="Account health">
    ${status}
    <div class="ladder-top">
      <div>
        <p class="ladder-name"><strong>${esc(a.name)}</strong> ${esc(a.firm || '')} ${esc(a.type || '')}</p>
        <p class="ladder-balance num">${bal(st.balance)}<span class="ladder-delta ${cls(delta)}">${signed(delta)}</span></p>
      </div>
      <div class="ladder-facts">
        <div><span>Room before liquidation</span><strong class="num ${st.bufferPct < 0.3 ? 'neg' : ''}">${bal(st.buffer)}</strong></div>
        ${st.target > st.start ? `<div><span>Left to ${a.type === 'Funded' ? 'payout goal' : 'target'}</span><strong class="num">${st.passed ? 'Done' : bal(st.toTarget)}</strong></div>` : ''}
        <div><span>Today</span><strong class="num ${cls(per.today)}">${signed(per.today)}</strong></div>
        <div><span>This week</span><strong class="num ${cls(per.week)}">${signed(per.week)}</strong></div>
      </div>
    </div>
    <div class="ladder-track" style="--danger:${pos(st.threshold)}%" role="img" aria-label="Balance ${bal(st.balance)}, liquidation at ${bal(st.threshold)} (${ddLabel} drawdown), target ${bal(st.target)}">
      <div class="ladder-rail"></div>
      <div class="ladder-fill ${delta < 0 ? 'neg' : ''}" style="left:${fillFrom}%;width:${fillTo - fillFrom}%"></div>
      ${tickHtml}
      <div class="ladder-now" style="left:${pos(st.balance)}%" title="Current balance"></div>
    </div>
  </section>`;
}

function kpisHtml(c, disc) {
  const pf = c.profitFactor === Infinity ? '∞' : c.profitFactor.toFixed(2);
  return `<section class="kpis" aria-label="Key numbers">
    <div class="kpi"><span>Net P&amp;L</span><strong class="${cls(c.net)}">${signed(c.net)}</strong><small>${c.n} trades</small></div>
    <div class="kpi"><span>Win rate</span><strong>${pct(c.winRate)}</strong><small>${c.wins} won, ${c.losses} lost</small></div>
    <div class="kpi"><span>Profit factor</span><strong class="${c.profitFactor >= 1.5 ? 'pos' : c.profitFactor < 1 && c.n ? 'neg' : ''}">${c.n ? pf : '–'}</strong><small>Won per $1 lost</small></div>
    <div class="kpi"><span>Per trade</span><strong class="${cls(c.expectancy)}">${c.n ? signed(c.expectancy) : '–'}</strong><small>Expectancy</small></div>
    <div class="kpi"><span>Average R</span><strong class="${cls(c.avgR)}">${rTxt(c.avgR)}</strong><small>Max drawdown ${bal(c.maxDrawdown)}</small></div>
    <div class="kpi"><span>Discipline</span><strong>${disc ? disc.score : '–'}</strong><small><a href="#/coach">What this means</a></small></div>
  </section>`;
}

function tradeRow(t) {
  const p = S.pnlOf(t), r = S.rOf(t);
  const dir = t.Direction ? `<span class="tag ${t.Direction === 'Long' ? 'long' : 'short'}">${esc(t.Direction)}</span>` : '';
  const grade = t.Grade && t.Grade !== 'N/A' ? `<span class="tag grade">${esc(t.Grade)}</span>` : '';
  const noted = new Set(S.noteMistakes(t).map((x) => x.tag));
  const mist = S.mistakesOf(t).slice(0, 2).map((m) => `<span class="tag mistake${noted.has(m) ? ' noted' : ''}" ${noted.has(m) ? 'title="Found in your reflection"' : ''}>${esc(m)}</span>`).join('');
  const img = t.hasImage || t.ChartImage ? '<span class="tag img" title="Has chart screenshot"><svg><use href="#i-image"/></svg></span>' : '';
  return `<button class="trade-row" data-action="trade" data-id="${esc(t.id)}">
    <span class="when"><b>${esc(fmtDate(t.Date))}</b>${esc(t.Time && t.Time !== '--:--' ? t.Time : '')}</span>
    <span class="what"><span class="sess">${esc(t.Killzone || 'Trade')}</span>${t.Instrument ? `<span class="muted">${esc(t.Instrument)}</span>` : ''}${dir}${t.Model ? `<span class="tag model">${esc(t.Model)}</span>` : ''}${grade}${mist}${t.imported && !t.reviewed ? '<span class="tag img" title="Imported. Open it to add your notes.">New</span>' : ''}${img}</span>
    <span class="r">${rTxt(r)}</span>
    <span class="pnl ${cls(p)}">${signed(p)}</span>
  </button>`;
}

function calendarHtml(trades) {
  const { y, m } = state.cal;
  const daily = S.dailyPnl(trades);
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const cur = S.weekStart(first);
  const monthName = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Week'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  let monthNet = 0, monthDays = 0;
  while (cur <= last) {
    let weekPnl = 0, weekN = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(cur); d.setDate(cur.getDate() + i);
      const iso = S.isoDate(d), x = daily[iso], inMonth = d.getMonth() === m;
      if (x) { weekPnl += x.pnl; weekN += x.n; if (inMonth) { monthNet += x.pnl; monthDays++; } }
      if (i >= 5) continue;
      const k = !inMonth ? 'out' : x ? `has ${x.pnl > 0 ? 'win' : x.pnl < 0 ? 'loss' : ''}` : '';
      cells += x && inMonth
        ? `<a class="cal-cell ${k} ${iso === todayIso() ? 'today' : ''}" href="#/trades?date=${iso}" title="${x.n} trade${x.n > 1 ? 's' : ''}"><span class="d">${d.getDate()}</span><span class="v">${signed(x.pnl)}</span><span class="c">${x.n} trade${x.n > 1 ? 's' : ''}</span></a>`
        : `<div class="cal-cell ${k} ${iso === todayIso() && inMonth ? 'today' : ''}"><span class="d">${inMonth ? d.getDate() : ''}</span></div>`;
    }
    cells += `<div class="cal-cell cal-week"><span class="d">${weekN ? `${weekN} trades` : ''}</span><span class="v ${cls(weekPnl)}">${weekN ? signed(weekPnl) : ''}</span></div>`;
    cur.setDate(cur.getDate() + 7);
  }
  return `<div class="cal-head"><h2>${monthName}</h2><div class="cal-nav">
      <span class="muted num" style="align-self:center;margin-right:8px">${monthDays ? signed(monthNet) : ''}</span>
      <button class="icon-btn" data-cal="-1" aria-label="Previous month"><svg><use href="#i-chev-l"/></svg></button>
      <button class="icon-btn" data-cal="1" aria-label="Next month"><svg><use href="#i-chev-r"/></svg></button></div></div>
    <div class="cal">${cells}</div>`;
}

function wireCalendar(root, rerender) {
  $$('[data-cal]', root).forEach((b) => b.addEventListener('click', () => {
    let { y, m } = state.cal; m += +b.dataset.cal;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    state.cal = { y, m }; rerender();
  }));
}

function renderDashboard(v) {
  const a = acct(), tr = acctTrades();
  const st = S.accountState(a, tr), core = S.coreStats(tr), per = S.periodPnl(tr);
  const g = guardrails(tr, state.settings);
  const coach = tr.length ? buildCoach(tr, { prep: state.prep, settings: state.settings, accountState: st }) : null;
  const name = state.profile?.displayName ? esc(state.profile.displayName.split(' ')[0]) : '';
  const recent = S.sortTrades(tr).reverse().slice(0, 6);
  const watch = tr.length ? repeatMistakes(tr).find((m) => m.last30 >= 2) : null;

  v.innerHTML = `
    ${g.alerts.map((x) => `<div class="alert ${/Take 30/.test(x) ? 'calm' : ''}">${esc(x)}</div>`).join('')}
    ${ladderHtml(a, st, per)}
    ${tr.length ? `
    ${kpisHtml(core, coach?.discipline)}
    <div class="row-2">
      <section class="panel"><div class="panel-head"><h2>Balance and liquidation line</h2><span class="sub">${core.n} trades</span></div><div class="chart-box"><canvas id="eqChart"></canvas></div></section>
      <section class="panel" id="calPanel">${calendarHtml(tr)}</section>
    </div>
    <div class="row-2">
      <section class="panel">
        <div class="panel-head"><h2>Coach</h2><a href="#/coach">See full breakdown</a></div>
        <p style="font-size:16px;line-height:1.5">${esc(coach.headline)}</p>
        ${watch ? `<p class="watch" style="margin-top:12px"><b>Watch for today:</b> ${esc(mistakeSentence(watch))}.</p>` : ''}
        <div class="insights" style="margin-top:16px">${coach.leaks.slice(0, 3).map((l) => insightHtml(l, true)).join('') || '<p class="muted">No leaks found yet.</p>'}</div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Recent trades</h2><a href="#/trades">All trades</a></div>
        <div class="trade-list compact">${recent.map(tradeRow).join('')}</div></section>
    </div>` : `
    <section class="panel empty">
      <h3>${name ? `Welcome, ${name}. ` : ''}Log your first trade</h3>
      <p>Your balance, drawdown and coaching fill in as you log. Write your plan for the day first if you have a bias.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button class="btn btn-primary" data-action="log">Log trade</button><a class="btn btn-ghost" href="#/prep">Plan today</a></div>
    </section>`}`;

  if (!tr.length) return;
  const repaintCal = () => { $('#calPanel').innerHTML = calendarHtml(tr); wireCalendar($('#calPanel'), repaintCal); };
  wireCalendar(v, repaintCal);
  const series = st.series;
  chart($('#eqChart'), {
    type: 'line',
    data: {
      labels: series.map((p) => p.label),
      datasets: [
        { label: 'Balance', data: series.map((p) => p.balance), borderColor: tok('--profit'), backgroundColor: alpha(tok('--profit'), 0.1), fill: 'origin', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15 },
        { label: 'Liquidation line', data: series.map((p) => p.threshold), borderColor: tok('--loss'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, stepped: true },
        ...(st.target > st.start ? [{ label: 'Target', data: series.map(() => st.target), borderColor: alpha(tok('--accent'), 0.8), borderDash: [2, 4], borderWidth: 1.5, pointRadius: 0, fill: false }] : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 2, padding: 16 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${bal(c.parsed.y)}` } } },
      scales: { x: { display: false }, y: { grid: { color: gridColor() }, ticks: { callback: moneyTick } } },
    },
  });
}

/* ================= trades ================= */
function filteredTrades() {
  const f = state.filters, q = f.q.trim().toLowerCase();
  return S.sortTrades(acctTrades()).reverse().filter((t) => {
    const p = S.pnlOf(t);
    if (f.session && t.Killzone !== f.session) return false;
    if (f.dir && t.Direction !== f.dir) return false;
    if (f.result === 'win' && !(p > 0)) return false;
    if (f.result === 'loss' && !(p < 0)) return false;
    if (f.grade && !(t.Grade || '').startsWith(f.grade)) return false;
    if (f.tag && !S.mistakesOf(t).includes(f.tag)) return false;
    if (f.model && (f.model === '(none)' ? t.Model : t.Model !== f.model)) return false;
    if (f.from && t.Date < f.from) return false;
    if (f.to && t.Date > f.to) return false;
    if (q && !`${t.Improvement || ''} ${t.Model || ''} ${t.Killzone || ''} ${t.Instrument || ''} ${S.mistakesOf(t).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderTrades(v) {
  const f = state.filters;
  const opts = (list, cur, all) => `<option value="">${all}</option>` + list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const tags = [...new Set(acctTrades().flatMap(S.mistakesOf))].sort();
  const models = [...new Set([...(state.settings.models || []), ...acctTrades().map((t) => t.Model).filter(Boolean)])];
  v.innerHTML = `
    <section class="panel">
      <form class="filters" id="filters" onsubmit="return false">
        <label class="field grow"><span>Search notes</span><input name="q" value="${esc(f.q)}" placeholder="e.g. displacement, revenge"></label>
        <label class="field"><span>Session</span><select name="session">${opts(SESSIONS, f.session, 'All sessions')}</select></label>
        <label class="field"><span>Direction</span><select name="dir">${opts(['Long', 'Short'], f.dir, 'Both')}</select></label>
        <label class="field"><span>Result</span><select name="result"><option value="">All</option><option value="win" ${f.result === 'win' ? 'selected' : ''}>Winners</option><option value="loss" ${f.result === 'loss' ? 'selected' : ''}>Losers</option></select></label>
        <label class="field"><span>Grade</span><select name="grade">${opts(['A', 'B', 'C'], f.grade, 'Any grade')}</select></label>
        <label class="field"><span>Model</span><select name="model">${opts(models, f.model, 'Any model')}<option value="(none)" ${f.model === '(none)' ? 'selected' : ''}>No model</option></select></label>
        <label class="field"><span>Mistake</span><select name="tag">${opts(tags, f.tag, 'Any')}</select></label>
        <label class="field"><span>From</span><input type="date" name="from" value="${esc(f.from)}"></label>
        <label class="field"><span>To</span><input type="date" name="to" value="${esc(f.to)}"></label>
      </form>
    </section>
    <section class="panel" id="tradeResults"></section>`;
  const paint = () => {
    const list = filteredTrades(), b = S.bucketStats(list);
    const active = Object.values(state.filters).some(Boolean);
    $('#tradeResults').innerHTML = list.length ? `
      <div class="filter-summary" style="margin-bottom:12px">
        <span><strong>${list.length}</strong> trades <strong class="${cls(b.net)}" style="margin-left:12px">${signed(b.net)}</strong> <span style="margin-left:12px">${pct(b.winRate)} win rate</span> <span style="margin-left:12px">${rTxt(b.avgR)} avg</span></span>
        ${active ? '<button class="link" id="clearFilters">Clear filters</button>' : ''}
      </div>
      <div class="trade-list">${list.map(tradeRow).join('')}</div>`
      : `<div class="empty"><h3>${acctTrades().length ? 'No trades match these filters' : 'No trades in this account yet'}</h3>${active ? '<button class="btn btn-ghost" id="clearFilters">Clear filters</button>' : '<button class="btn btn-primary" data-action="log">Log trade</button>'}</div>`;
    $('#clearFilters')?.addEventListener('click', () => { state.filters = { q: '', session: '', dir: '', result: '', grade: '', tag: '', model: '', from: '', to: '' }; if (location.hash.includes('?')) location.hash = '#/trades'; else render(); });
  };
  $('#filters').addEventListener('input', (e) => { state.filters[e.target.name] = e.target.value; paint(); });
  paint();
}

/* ================= sheet (shared) ================= */
let sheetCleanup = null;
function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = html; sh.hidden = false; $('#sheetBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  $('[data-close]', sh)?.addEventListener('click', closeSheet);
  setTimeout(() => ($('[autofocus]', sh) || $('.sheet-head button', sh))?.focus(), 30);
  return sh;
}
function closeSheet() {
  $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true; $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
}
const sheetHead = (title) => `<div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="icon-btn" data-close aria-label="Close"><svg><use href="#i-x"/></svg></button></div>`;

/* ================= trade detail ================= */
async function openDetail(id) {
  const t = state.trades.find((x) => String(x.id) === String(id)); if (!t) return;
  const p = S.pnlOf(t), r = S.rOf(t);
  const prep = state.prep[t.Date];
  const bias = S.biasRelation(t, state.prep);
  const rulesAll = t.RulesAll || [], rulesChecked = t.RulesChecked || [];
  const tagged = Array.isArray(t.Mistakes) ? t.Mistakes : [], noted = S.noteMistakes(t);
  const sh = openSheet(`${sheetHead(`${esc(fmtDate(t.Date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}${t.Time && t.Time !== '--:--' ? ' at ' + esc(t.Time) : ''}`)}
    <div class="sheet-body">
      <div class="detail-hero"><div><p class="muted">${t.Model ? `<span class="tag model">${esc(t.Model)}</span> ` : ''}${esc(t.Killzone || '')} ${esc(t.Instrument || '')}</p><p class="big ${cls(p)}">${signed(p)}</p></div>
        <div style="text-align:right"><p class="num" style="font-size:22px;font-weight:600">${rTxt(r)}</p><p class="muted">${t.Grade && t.Grade !== 'N/A' ? `Grade ${esc(t.Grade)}` : ''}</p></div></div>
      <div class="detail-grid">
        <div>Direction<b>${esc(t.Direction || '–')}</b></div><div>Size<b>${esc(t.Contracts || '–')}</b></div><div>Time in trade<b>${t.Duration ? esc(t.Duration) + ' min' : '–'}</b></div>
        <div>Entry<b>${esc(t.Entry || '–')}</b></div><div>Stop<b>${esc(t.StopLoss || '–')}</b></div><div>Exit<b>${esc(t.Exit || '–')}</b></div>
        <div>Partials<b>${esc(t.Partials || 'None')}</b></div><div>Emotion<b>${esc(t.EmotionBefore || '–')}</b></div><div>News<b>${esc(t.NewsImpact || '–')}</b></div>
      </div>
      ${hasPlan(prep) ? `<div><p class="fs-title">Pre-market plan that day</p><div class="note-box">${esc(prep.bias)} bias${prep.dol ? `, targeting ${esc(prep.dol)}` : ''}${prep.htfArray ? `\nHTF: ${esc(prep.htfArray)}` : ''}\n<span class="${bias === 'Against daily bias' ? 'neg' : bias === 'With daily bias' ? 'pos' : 'muted'}">${esc(bias)}</span></div></div>` : ''}
      ${rulesAll.length ? `<div><p class="fs-title">Checklist <span class="muted" style="font-weight:400">${rulesChecked.length} of ${rulesAll.length}</span></p><div class="checks">${rulesAll.map((x) => `<div class="check" style="cursor:default"><span class="${rulesChecked.includes(x) ? 'pos' : 'neg'}" style="width:18px">${rulesChecked.includes(x) ? '✓' : '✗'}</span><span>${esc(x)}</span></div>`).join('')}</div></div>` : t.Setups ? `<p class="muted">Checklist: ${esc(t.Setups)}</p>` : ''}
      ${tagged.length || noted.length ? `<div><p class="fs-title">Mistakes</p>${tagged.length ? `<div class="chips">${tagged.map((m) => `<span class="tag mistake">${esc(m)}</span>`).join('')}</div>` : ''}${noted.length ? `<div class="noted">${noted.map((x) => `<div class="noted-row"><div><span class="tag mistake noted">${esc(x.tag)}</span><p>Found in your reflection: <q>${esc(x.quote)}</q></p></div><div class="noted-act"><button class="btn btn-ghost btn-sm" data-confirm="${esc(x.tag)}">Tag it</button><button class="btn btn-ghost btn-sm" data-dismiss="${esc(x.tag)}">Not a mistake</button></div></div>`).join('')}</div>` : ''}</div>` : ''}
      ${t.Improvement ? `<div><p class="fs-title">Reflection</p><div class="note-box">${esc(t.Improvement)}</div></div>` : ''}
      <div id="detailImg"></div>
    </div>
    <div class="sheet-foot">
      <button class="btn btn-danger" id="dDelete">Delete</button>
      <button class="btn btn-ghost" id="dShare">Share card</button>
      <button class="btn btn-ghost desktop-only" id="dCopy">Copy recap</button>
      <button class="btn btn-primary" id="dEdit">Edit</button>
    </div>`);
  $('#dEdit', sh).addEventListener('click', () => openEditor(t));
  $('#dCopy', sh).addEventListener('click', () => copyRecap(t));
  $('#dShare', sh).addEventListener('click', () => openShareCard(t));
  const resolveNote = async (tag, confirm) => {
    const { ChartImage, ...rest } = t;
    const upd = { ...rest, id: String(t.id), updatedAt: Date.now() };
    if (confirm) upd.Mistakes = [...new Set([...(Array.isArray(t.Mistakes) ? t.Mistakes : []), tag])];
    else upd.DismissedNotes = [...new Set([...(t.DismissedNotes || []), tag])];
    if (ChartImage) upd.hasImage = true;
    try { await Promise.race([store.saveTrade(upd, ChartImage), new Promise((res) => setTimeout(res, 2500))]); } catch (e) { toast('Couldn’t save: ' + e.message); return; }
    state.trades = state.trades.map((x) => (x === t ? upd : x));
    toast(confirm ? `Tagged “${tag}”` : 'Got it. The coach will ignore that one.');
    render(); openDetail(upd.id);
  };
  $$('[data-confirm]', sh).forEach((b) => b.addEventListener('click', () => resolveNote(b.dataset.confirm, true)));
  $$('[data-dismiss]', sh).forEach((b) => b.addEventListener('click', () => resolveNote(b.dataset.dismiss, false)));
  $('#dDelete', sh).addEventListener('click', async () => {
    if (!confirm('Delete this trade? This can’t be undone.')) return;
    await store.deleteTrades([String(t.id)]);
    state.trades = state.trades.filter((x) => x !== t);
    closeSheet(); render(); toast('Trade deleted');
  });
  if (t.hasImage || t.ChartImage) {
    const box = $('#detailImg', sh);
    box.innerHTML = '<p class="muted">Loading chart…</p>';
    const src = t.ChartImage || (await store.getImage(String(t.id)).catch(() => null));
    if (!box.isConnected) return;
    box.innerHTML = src ? `<p class="fs-title">Chart</p><img class="detail-img" src="${esc(src)}" alt="Chart screenshot for this trade">` : '';
    $('.detail-img', box)?.addEventListener('click', () => window.open().document.write(`<img src="${src}" style="max-width:100%">`));
  }
}

function copyRecap(t) {
  const a = state.accounts.find((x) => x.id === t.accountId);
  const lines = [
    '🎯 Snipe executed',
    `Account: ${a?.name || ''}`,
    `${t.Killzone || ''}${t.Instrument ? ' ' + t.Instrument : ''} ${t.Direction || ''}`.trim(),
    t.Model ? `Model: ${t.Model}` : '',
    t.Grade && t.Grade !== 'N/A' ? `Setup grade: ${t.Grade}` : '',
    Number.isFinite(S.rOf(t)) ? `Realized: ${rTxt(S.rOf(t))}` : '',
    `P&L: ${signed(S.pnlOf(t))}`,
  ].filter(Boolean);
  navigator.clipboard?.writeText(lines.join('\n')).then(() => toast('Recap copied'), () => toast('Couldn’t copy. Your browser blocked clipboard access.'));
}

/* ================= trade editor ================= */
function sessionFor(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number), x = h * 60 + m;
  if (x >= 120 && x < 300) return 'London Open';
  if (x >= 570 && x < 660) return 'NY AM Session';
  if (x >= 660 && x < 720) return 'Macro';
  if (x >= 810 && x < 960) return 'NY PM Session';
  if (x >= 1200 || x < 60) return 'Asia';
  return null;
}

function gradeFor(checked, total) {
  if (!total) return 'N/A';
  const p = checked / total;
  return p === 1 ? 'A+' : p >= 0.85 ? 'A' : p >= 0.7 ? 'B+' : p >= 0.55 ? 'B' : p >= 0.4 ? 'C+' : 'C';
}

function estimatePnl(d) {
  const pv = POINT_VALUE[(d.Instrument || '').toUpperCase()];
  const ent = S.num(d.Entry), ext = S.num(d.Exit), size = S.num(d.Contracts) > 0 ? S.num(d.Contracts) : 1;
  if (!pv || !Number.isFinite(ent)) return NaN;
  const long = d.Direction !== 'Short';
  const mv = (p) => (long ? p - ent : ent - p);
  let pts = 0, closed = 0;
  for (const p of S.parsePartials(d.Partials)) { pts += mv(p.price) * p.qty; closed += p.qty; }
  if (Number.isFinite(ext) && size - closed > 0) { pts += mv(ext) * (size - closed); closed = size; }
  return closed ? Math.round(pts * pv * 100) / 100 : NaN;
}

async function compressImage(file) {
  const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  for (const [w, q] of [[1400, 0.75], [1100, 0.65], [900, 0.55], [700, 0.5]]) {
    const scale = Math.min(1, w / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', q);
    if (out.length < 700_000) return out;
  }
  throw new Error('That image is too large. Try a smaller screenshot.');
}

function openEditor(existing = null) {
  const checklist = state.settings.checklist || [];
  const last = S.sortTrades(acctTrades()).pop();
  const d = existing ? { ...existing } : {
    Date: todayIso(), Time: nowTime(), Killzone: sessionFor(nowTime()) || last?.Killzone || 'NY AM Session',
    Instrument: last?.Instrument || state.settings.instruments?.[0] || '', Direction: 'Long', Contracts: last?.Contracts || '',
    NewsImpact: 'Low / None', EmotionBefore: 'Calm / Focused', Mistakes: [], RulesChecked: [],
  };
  if (existing && !Array.isArray(existing.Mistakes)) d.Mistakes = S.mistakesOf(existing);
  let image; // undefined = unchanged, string = new, null = removed
  let sessionTouched = !!existing;
  const rulesShown = existing?.RulesAll?.length ? [...new Set([...existing.RulesAll, ...checklist])] : checklist;
  const instruments = [...new Set([...(state.settings.instruments || []), d.Instrument].filter(Boolean))];
  const opt = (list, cur) => list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const models = [...new Set([...(state.settings.models || []), d.Model].filter(Boolean))];

  const watch = existing ? null : repeatMistakes(acctTrades()).find((m) => m.last30 >= 2);
  let dismissed = [...(existing?.DismissedNotes || [])];
  const sh = openSheet(`${sheetHead(existing ? 'Edit trade' : `Log trade in ${esc(acct().name)}`)}
    <form class="sheet-body" id="tradeForm" novalidate>
      ${watch ? `<p class="watch"><b>Watch for:</b> ${esc(mistakeSentence(watch))}.</p>` : ''}
      <fieldset class="fs"><legend>When</legend>
        <div class="grid-3">
          <label class="field"><span>Date</span><input type="date" name="Date" value="${esc(d.Date)}" required></label>
          <label class="field"><span>Entry time</span><input type="time" name="Time" value="${esc(d.Time && d.Time !== '--:--' ? d.Time : '')}"></label>
          <label class="field"><span>Session</span><select name="Killzone">${opt([...new Set([...SESSIONS, d.Killzone].filter(Boolean))], d.Killzone)}</select></label>
        </div>
      </fieldset>

      <fieldset class="fs"><legend>Execution</legend>
        <div class="grid-3">
          <label class="field"><span>Instrument</span><select name="Instrument"><option value="">–</option>${opt(instruments, d.Instrument)}</select></label>
          <div class="field"><span>Direction</span><div class="seg" id="dirSeg">${['Long', 'Short'].map((x) => `<button type="button" data-v="${x}" aria-pressed="${d.Direction === x}">${x}</button>`).join('')}</div></div>
          <label class="field"><span>Contracts</span><input type="number" inputmode="decimal" name="Contracts" min="0" step="any" value="${esc(d.Contracts)}"></label>
        </div>
        <div class="grid-3">
          <label class="field"><span>Entry</span><input type="number" inputmode="decimal" step="any" name="Entry" value="${esc(d.Entry)}"></label>
          <label class="field"><span>Stop loss</span><input type="number" inputmode="decimal" step="any" name="StopLoss" value="${esc(d.StopLoss)}"></label>
          <label class="field"><span>Final exit</span><input type="number" inputmode="decimal" step="any" name="Exit" value="${esc(d.Exit)}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Partials</span><input name="Partials" value="${esc(d.Partials)}" placeholder="19850 x 2, 19865 x 1"><small>Price and contracts closed at each partial.</small></label>
          <label class="field"><span>Minutes in trade</span><input type="number" inputmode="numeric" min="0" name="Duration" value="${esc(d.Duration)}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Net P&amp;L ($)</span><input type="number" inputmode="decimal" step="any" name="PNL" value="${esc(d.PNL ?? '')}" placeholder="e.g. 450 or -200"></label>
          <label class="field"><span>Realized R</span><input name="RRView" readonly tabindex="-1" placeholder="Fills from prices"></label>
        </div>
        <p class="calc-line" id="calcLine"></p>
      </fieldset>

      <fieldset class="fs"><legend>Context</legend>
        <label class="field"><span>News</span><select name="NewsImpact">${opt(NEWS, d.NewsImpact)}</select></label>
        <div class="field"><span>How you felt before entering</span><div class="chips" id="emoChips">${EMOTIONS.map((x) => `<button type="button" class="chip ${/FOMO|Anxious|Overconfident|Bored/.test(x) ? 'warn' : ''}" data-v="${esc(x)}" aria-pressed="${d.EmotionBefore === x}">${esc(x)}</button>`).join('')}</div></div>
      </fieldset>

      <fieldset class="fs"><legend>Setup model</legend>
        <div class="chips" id="modelChips">${models.map((x) => `<button type="button" class="chip" data-v="${esc(x)}" aria-pressed="${d.Model === x}">${esc(x)}</button>`).join('') || '<p class="muted">Add your setup models in Settings.</p>'}</div>
      </fieldset>

      <fieldset class="fs"><div class="fs-title">Checklist <span class="grade-pill" id="gradePill"></span></div>
        <div class="checks">${rulesShown.map((x, i) => `<label class="check"><input type="checkbox" name="rule" value="${esc(x)}" ${(d.RulesChecked || []).includes(x) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('') || '<p class="muted">No checklist rules yet. Add yours in Settings.</p>'}</div>
      </fieldset>

      <fieldset class="fs"><legend>Mistakes, if any</legend>
        <div class="chips" id="mistakeChips">${S.MISTAKE_TAGS.map((x) => `<button type="button" class="chip warn" data-v="${esc(x)}" aria-pressed="${(d.Mistakes || []).includes(x)}">${esc(x)}</button>`).join('')}</div>
      </fieldset>

      <fieldset class="fs"><legend>Reflection</legend>
        <textarea name="Improvement" placeholder="What did you see? What would you do differently? Write it honestly, the coach reads it.">${esc(d.Improvement)}</textarea>
        <div class="note-hints" id="noteHints" aria-live="polite"></div>
      </fieldset>

      <fieldset class="fs"><legend>Chart screenshot</legend>
        <div class="drop" id="drop" tabindex="0" role="button" aria-label="Add chart screenshot">
          <svg><use href="#i-image"/></svg>
          <span id="dropText">Paste a screenshot (Ctrl/Cmd+V), drop one here, or tap to choose</span>
          <img id="dropImg" alt="" hidden>
        </div>
        <input type="file" id="fileIn" accept="image/*" hidden>
        <button type="button" class="link" id="rmImg" hidden>Remove screenshot</button>
      </fieldset>
      <p class="form-error" id="tradeErr" role="alert" hidden></p>
    </form>
    <div class="sheet-foot">
      ${existing ? '' : '<button class="btn btn-ghost" id="saveAnother">Save and log another</button>'}
      <button class="btn btn-primary" id="saveTrade">${existing ? 'Save changes' : 'Save trade'}</button>
    </div>`);

  const form = $('#tradeForm', sh);
  const val = (n) => form.elements[n]?.value ?? '';
  const draft = () => ({
    Date: val('Date'), Time: val('Time'), Killzone: val('Killzone'), Instrument: val('Instrument'),
    Direction: $('#dirSeg [aria-pressed=true]', sh)?.dataset.v || 'Long',
    Contracts: val('Contracts'), Entry: val('Entry'), StopLoss: val('StopLoss'), Exit: val('Exit'), Partials: val('Partials'), Duration: val('Duration'),
    PNL: val('PNL'), NewsImpact: val('NewsImpact'),
    EmotionBefore: $('#emoChips [aria-pressed=true]', sh)?.dataset.v || '',
    RulesChecked: $$('input[name=rule]:checked', sh).map((x) => x.value),
    Mistakes: $$('#mistakeChips [aria-pressed=true]', sh).map((x) => x.dataset.v),
    Model: $('#modelChips [aria-pressed=true]', sh)?.dataset.v || '',
    DismissedNotes: dismissed,
    Improvement: val('Improvement'),
  });

  const recalc = () => {
    const x = draft();
    const r = S.realizedR({ entry: x.Entry, stop: x.StopLoss, exit: x.Exit, contracts: x.Contracts, direction: x.Direction, partials: x.Partials });
    form.elements.RRView.value = Number.isFinite(r) ? rTxt(r) : '';
    const est = estimatePnl(x);
    const risk = S.num(x.Entry) && S.num(x.StopLoss) && POINT_VALUE[x.Instrument] ? Math.abs(S.num(x.Entry) - S.num(x.StopLoss)) * POINT_VALUE[x.Instrument] * (S.num(x.Contracts) || 1) : NaN;
    $('#calcLine', sh).innerHTML = [
      Number.isFinite(risk) ? `<span>Risk <b>${bal(risk)}</b></span>` : '',
      Number.isFinite(est) ? `<span>From prices <b class="${cls(est)}">${signed(est)}</b> before fees ${x.PNL === '' ? '<button type="button" class="link" id="useEst">Use this</button>' : ''}</span>` : '',
    ].join('');
    $('#useEst', sh)?.addEventListener('click', () => { form.elements.PNL.value = est; recalc(); });
    const total = $$('input[name=rule]', sh).length;
    const g = gradeFor(x.RulesChecked.length, total);
    $('#gradePill', sh).textContent = total ? `${x.RulesChecked.length}/${total}  ${g}` : '';
  };

  const hints = () => {
    const on = $$('#mistakeChips [aria-pressed=true]', sh).map((x) => x.dataset.v);
    const found = S.readReflection(form.elements.Improvement.value).filter((x) => !on.includes(x.tag) && !dismissed.includes(x.tag));
    $('#noteHints', sh).innerHTML = found.length ? `<p>Your reflection sounds like a mistake. It counts unless you say otherwise:</p>${found.map((x) => `<div class="hint-row"><span class="tag mistake noted">${esc(x.tag)}</span><button type="button" class="link" data-tag-hint="${esc(x.tag)}">Tag it</button><button type="button" class="link muted" data-skip-hint="${esc(x.tag)}">Not a mistake</button></div>`).join('')}` : '';
  };
  $('#noteHints', sh).addEventListener('click', (e) => {
    const a = e.target.closest('[data-tag-hint]'), b = e.target.closest('[data-skip-hint]');
    if (a) $(`#mistakeChips [data-v="${CSS.escape(a.dataset.tagHint)}"]`, sh)?.setAttribute('aria-pressed', 'true');
    if (b) dismissed.push(b.dataset.skipHint);
    hints();
  });
  form.elements.Improvement.addEventListener('input', hints);
  hints();
  form.addEventListener('input', (e) => {
    if (e.target.name === 'Killzone') sessionTouched = true;
    if (e.target.name === 'Time' && !sessionTouched) { const s = sessionFor(e.target.value); if (s) form.elements.Killzone.value = s; }
    recalc();
  });
  $('#dirSeg', sh).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#dirSeg button', sh).forEach((x) => x.setAttribute('aria-pressed', x === b)); recalc(); });
  $('#emoChips', sh).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#emoChips button', sh).forEach((x) => x.setAttribute('aria-pressed', x === b)); });
  $('#mistakeChips', sh).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); hints(); });
  $('#modelChips', sh).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const on = b.getAttribute('aria-pressed') !== 'true'; $$('#modelChips button', sh).forEach((x) => x.setAttribute('aria-pressed', x === b && on)); });

  // Screenshot
  const drop = $('#drop', sh), dropImg = $('#dropImg', sh), dropText = $('#dropText', sh), rm = $('#rmImg', sh);
  const showImg = (src) => { dropImg.src = src || ''; dropImg.hidden = !src; dropText.textContent = src ? 'Paste or drop to replace' : 'Paste a screenshot (Ctrl/Cmd+V), drop one here, or tap to choose'; rm.hidden = !src; };
  const takeFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    try { image = await compressImage(file); showImg(image); } catch (e) { toast(e.message); }
  };
  if (existing && (existing.hasImage || existing.ChartImage)) {
    (existing.ChartImage ? Promise.resolve(existing.ChartImage) : store.getImage(String(existing.id))).then((src) => { if (src && image === undefined) showImg(src); }).catch(() => {});
  }
  drop.addEventListener('click', () => $('#fileIn', sh).click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileIn', sh).click(); } });
  $('#fileIn', sh).addEventListener('change', (e) => takeFile(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
  rm.addEventListener('click', () => { image = null; showImg(''); });
  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); takeFile(item.getAsFile()); }
  };
  document.addEventListener('paste', onPaste);
  sheetCleanup = () => document.removeEventListener('paste', onPaste);

  const save = async (another) => {
    const x = draft(), err = $('#tradeErr', sh);
    err.hidden = true;
    if (!x.Date) { err.textContent = 'Pick the date of the trade.'; err.hidden = false; return; }
    let pnl = S.num(x.PNL);
    if (!Number.isFinite(pnl)) {
      const est = estimatePnl(x);
      if (Number.isFinite(est)) pnl = est;
      else { err.textContent = 'Enter the net P&L in dollars (use a minus sign for a loss).'; err.hidden = false; form.elements.PNL.focus(); return; }
    }
    const r = S.realizedR({ entry: x.Entry, stop: x.StopLoss, exit: x.Exit, contracts: x.Contracts, direction: x.Direction, partials: x.Partials });
    const rulesAll = $$('input[name=rule]', sh).map((i) => i.value);
    const grade = gradeFor(x.RulesChecked.length, rulesAll.length);
    const { ChartImage, ...base } = existing || {};
    const trade = {
      ...base, ...x,
      id: existing ? String(existing.id) : newId(),
      accountId: existing?.accountId || state.activeAccountId,
      Time: x.Time || '--:--',
      PNL: pnl, RR: Number.isFinite(r) ? Math.round(r * 100) / 100 : null,
      RulesAll: rulesAll, Grade: grade,
      ChecklistScore: `${x.RulesChecked.length}/${rulesAll.length}`, Setups: `${x.RulesChecked.length}/${rulesAll.length} rules met`,
      hasImage: image === undefined ? !!(existing?.hasImage || ChartImage) : !!image,
      ...(existing?.imported ? { reviewed: true } : {}),
      updatedAt: Date.now(), ...(existing ? {} : { createdAt: Date.now() }),
    };
    const btns = $$('.sheet-foot .btn', sh); btns.forEach((b) => { b.disabled = true; });
    try {
      const img = image === undefined && ChartImage ? ChartImage : image; // carry a legacy inline image into its own document
      await Promise.race([store.saveTrade(trade, img), new Promise((res) => setTimeout(res, 2500))]); // offline: Firestore queues the write
      const i = state.trades.findIndex((t) => String(t.id) === trade.id);
      if (i >= 0) state.trades[i] = trade; else state.trades.push(trade);
      const [yy, mm] = trade.Date.split('-').map(Number); state.cal = { y: yy, m: mm - 1 };
      const echo = mistakeEcho(trade, acctTrades());
      if (echo && echo.n >= 2) toast(echo.text, 6500); else toast(existing ? 'Changes saved' : 'Trade saved');
      if (another) { closeSheet(); render(); openEditor(); const f = $('#tradeForm'); f.elements.Date.value = trade.Date; f.elements.Killzone.value = trade.Killzone; f.elements.Instrument.value = trade.Instrument; }
      else { closeSheet(); render(); }
    } catch (e) {
      err.textContent = 'Couldn’t save: ' + e.message; err.hidden = false; btns.forEach((b) => { b.disabled = false; });
    }
  };
  $('#saveTrade', sh).addEventListener('click', () => save(false));
  $('#saveAnother', sh)?.addEventListener('click', () => save(true));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  recalc();
}

/* ================= coach ================= */
function insightHtml(l, compact = false) {
  const impact = l.impact > 0 && Number.isFinite(l.impact) ? `<span class="impact ${l.kind === 'edge' ? 'pos' : 'neg'}">${l.kind === 'edge' ? '+' : '−'}${plain(l.impact)}</span>` : '';
  return `<article class="insight ${l.kind}">
    <div><h3>${esc(l.title)}</h3>${compact ? '' : `<p>${esc(l.body)}</p>`}<p class="do"><b>Do this:</b> ${esc(l.action)}</p></div>
    <div class="meta">${compact ? '' : impact}<span class="badge ${l.confidence}">${l.confidence === 'solid' ? `${l.n} trades` : `Early signal, ${l.n} trades`}</span></div>
  </article>`;
}

function repeatHtml(tr) {
  const repeats = repeatMistakes(tr).slice(0, 4);
  const phrases = recurringPhrases(tr, state.prep, 4);
  const caught = tr.filter((t) => S.noteMistakes(t).length).length;
  const trend = { worse: '<span class="trend worse">▲ More often lately</span>', better: '<span class="trend better">▼ Fading</span>', same: '<span class="trend">Steady</span>' };
  return `<section class="panel">
    <div class="panel-head"><h2>Same mistakes, again</h2><span class="sub">${caught ? `${caught} trade${caught === 1 ? '' : 's'} caught from your reflections` : 'From your tags and your reflections'}</span></div>
    ${repeats.length ? `<div class="repeat-grid">${repeats.map((m) => `<div class="repeat">
      <div class="repeat-top"><h3>${esc(m.tag)}</h3>${trend[m.trend]}</div>
      <div><p class="repeat-cost num ${cls(m.cost)}">${signed(m.cost)}</p><small class="muted">${m.n} trades in total, ${m.last30} in the last 30 days</small></div>
      ${m.trigger ? `<p>Usually happens <b>${esc(m.trigger.phrase)}</b> (${m.trigger.hits} of ${m.trigger.of} times).</p>` : ''}
      ${m.chain ? `<p>Your next trade often brings <b>${esc(m.chain.tag)}</b> (${m.chain.n}×).</p>` : ''}
      <p class="muted">${m.cleanTrades ? `${m.cleanTrades} clean trade${m.cleanTrades === 1 ? '' : 's'} since the last one.` : 'It happened on your latest trade.'}</p>
      <p class="do"><b>Do this:</b> ${esc(TAG_ACTIONS[m.tag] || `Put “${m.tag}” at the top of your checklist as a warning.`)}</p>
    </div>`).join('')}</div>` : '<p class="muted">No mistake has come back twice yet. Tag mistakes when you log, or just describe them in your reflection, and the coach will track them.</p>'}
    ${phrases.length ? `<div class="echo"><p class="fs-title">What you keep writing to yourself</p>${phrases.map((p) => `<div class="echo-row"><q>${esc(p.phrase)}</q><span class="muted">${p.n} notes</span>${p.net != null ? `<b class="num ${cls(p.net)}">${signed(p.net)}</b>` : '<b></b>'}</div>`).join('')}<p class="help" style="margin-top:8px">A lesson you keep writing hasn’t stuck yet. Turn it into a checklist rule in Settings.</p></div>` : ''}
  </section>`;
}

function renderCoach(v) {
  const scopeAll = state.coachScope === 'all';
  const tr = scopeAll ? state.trades : acctTrades();
  if (!tr.length) {
    v.innerHTML = `<section class="panel empty"><h3>The coach needs trades to work with</h3><p>Log at least 5 trades and it will start pointing out which sessions, setups and habits make or lose you money. After about 20 the patterns get reliable.</p><button class="btn btn-primary" data-action="log">Log trade</button></section>`;
    return;
  }
  const st = scopeAll ? null : S.accountState(acct(), tr);
  const c = buildCoach(tr, { prep: state.prep, settings: state.settings, accountState: st });
  const w = weeklyReview(tr, state.prep, state.settings);
  const leaks = state.showAllLeaks ? c.leaks : c.leaks.slice(0, 5);
  const maxDelta = Math.max(1, ...c.scenarios.map((s) => Math.abs(s.delta)));
  const dim = c.dims.find((d) => d.id === state.coachDim) || c.dims[0];
  const rules = S.ruleImpact(tr).filter((r) => r.followed.n + r.skipped.n >= 3);
  const ring = c.discipline ? (c.discipline.score >= 80 ? 'var(--profit)' : c.discipline.score >= 60 ? 'var(--accent)' : 'var(--loss)') : 'var(--accent)';
  const change = (a, b, money_ = true) => (Number.isFinite(b) && w.previous.n ? `<small class="${cls(a - b)}">${a - b >= 0 ? '▲' : '▼'} ${money_ ? plain(a - b) : Math.abs(Math.round(a - b))} vs last week</small>` : '<small>No trades last week</small>');

  v.innerHTML = `
    <div class="seg" style="max-width:360px" id="scopeSeg">
      <button data-v="account" aria-pressed="${!scopeAll}">${esc(acct().name)}</button>
      <button data-v="all" aria-pressed="${scopeAll}">All accounts</button>
    </div>

    <section class="panel coach-hero">
      <div>
        <h2>${esc(c.headline)}</h2>
        <p>Based on ${c.stats.n} trades. Findings marked “early signal” need more trades before you treat them as fact.</p>
      </div>
      ${c.discipline ? `<div class="score"><div class="score-ring" style="--v:${c.discipline.score};--ring:${ring}"><b>${c.discipline.score}</b></div><span>Discipline score</span></div>` : ''}
    </section>

    ${repeatHtml(tr)}

    <section class="panel">
      <div class="panel-head"><h2>Fix these first</h2><span class="sub">Ranked by money lost</span></div>
      <div class="insights">${leaks.map((l) => insightHtml(l)).join('') || '<p class="muted">No money leaks found. Keep logging honestly, including mistakes, so the coach can spot patterns.</p>'}</div>
      ${c.leaks.length > 5 ? `<button class="link" id="moreLeaks" style="margin-top:14px">${state.showAllLeaks ? 'Show fewer' : `Show all ${c.leaks.length} findings`}</button>` : ''}
    </section>

    <div class="row-even">
      <section class="panel">
        <div class="panel-head"><h2>What if you had…</h2><span class="sub">Same trades, one rule applied</span></div>
        ${c.scenarios.length ? `<table class="whatif"><thead><tr><th>Rule</th><th class="n">Trades</th><th class="n">Result</th><th class="bar-cell"></th></tr></thead><tbody>
          ${c.scenarios.map((s) => `<tr><td>${esc(s.title)}</td><td class="n">${s.kept}<span class="muted"> of ${s.kept + s.removed}</span></td><td class="n ${cls(s.delta)}">${signed(s.delta)}</td>
            <td class="bar-cell"><div class="mini-bar ${s.delta < 0 ? 'neg' : ''}" style="width:${(Math.abs(s.delta) / maxDelta) * 100}%"></div></td></tr>`).join('')}
        </tbody></table><p class="help" style="margin-top:12px">“Result” is how much more (or less) you'd have made than your actual ${signed(c.stats.net)}.</p>` : '<p class="muted">Log a few more trades to compare scenarios.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Discipline breakdown</h2></div>
        ${c.discipline ? `<div class="score-parts">${c.discipline.parts.map((p) => `<div class="score-part"><span>${esc(p.label)}</span><b>${Math.round(p.value * 100)}%</b><div class="bar"><i style="width:${p.value * 100}%"></i></div></div>`).join('')}</div>` : ''}
        ${c.edges.length ? `<div class="panel-head" style="margin:24px 0 12px"><h2>Where your edge is</h2></div><div class="insights">${c.edges.map((l) => insightHtml(l)).join('')}</div>` : ''}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>This week vs last week</h2><span class="sub">${esc(fmtDate(w.range[0]))} to ${esc(fmtDate(w.range[1]))}</span></div>
      ${w.current.n ? `<div class="week-compare">
        <div><span>Net P&amp;L</span><strong class="${cls(w.current.net)}">${signed(w.current.net)}</strong>${change(w.current.net, w.previous.net)}</div>
        <div><span>Trades</span><strong>${w.current.n}</strong>${change(w.current.n, w.previous.n, false)}</div>
        <div><span>Win rate</span><strong>${pct(w.current.winRate)}</strong><small>${w.previous.n ? `${pct(w.previous.winRate)} last week` : ''}</small></div>
        <div><span>Discipline</span><strong>${w.discipline ?? '–'}</strong><small>${w.prevDiscipline != null ? `${w.prevDiscipline} last week` : ''}</small></div>
      </div>
      <div class="week-notes">
        <p>You did pre-market prep on ${w.prepDays} of ${w.tradeDays} trading day${w.tradeDays === 1 ? '' : 's'}.</p>
        ${w.topMistake ? `<p>Most repeated mistake: <b>${esc(w.topMistake.tag)}</b> (${w.topMistake.count}×).</p>` : '<p>No mistakes tagged this week.</p>'}
        ${w.best ? `<p>Best trade: ${esc(fmtDate(w.best.Date))}, ${esc(w.best.Killzone)}, <span class="pos">${signed(S.pnlOf(w.best))}</span>. <button class="link" data-action="trade" data-id="${esc(w.best.id)}">Review it</button></p>` : ''}
      </div>` : '<p class="muted">No trades yet this week.</p>'}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Break it down</h2><span class="sub">Per-trade result for each group</span></div>
      <div class="chips dim-picker" id="dimChips">${c.dims.map((d) => `<button class="chip" data-v="${d.id}" aria-pressed="${d.id === dim.id}">${esc(d.label)}</button>`).join('')}</div>
      <div class="row-even">
        <div class="chart-box sm"><canvas id="dimChart"></canvas></div>
        <div style="overflow-x:auto"><table class="bucket-table"><thead><tr><th>${esc(dim.label)}</th><th>Trades</th><th>Win rate</th><th>Avg R</th><th>Per trade</th><th>Net</th></tr></thead><tbody>
          ${dim.groups.map((g) => `<tr class="${g.n < 5 ? 'low' : ''}"><td>${esc(g.key)}</td><td>${g.n}</td><td>${pct(g.winRate)}</td><td>${rTxt(g.avgR)}</td><td class="${cls(g.expectancy)}">${signed(g.expectancy)}</td><td class="${cls(g.net)}">${signed(g.net)}</td></tr>`).join('')}
        </tbody></table><p class="help" style="margin-top:10px">Greyed rows have fewer than 5 trades.</p></div>
      </div>
    </section>

    <div class="row-even">
      <section class="panel"><div class="panel-head"><h2>How your trades end</h2><span class="sub">Count of trades by R result</span></div><div class="chart-box sm"><canvas id="rChart"></canvas></div></section>
      <section class="panel"><div class="panel-head"><h2>Checklist rules</h2><span class="sub">Per trade when followed vs skipped</span></div>
        ${rules.length ? `<div style="overflow-x:auto"><table class="bucket-table"><thead><tr><th>Rule</th><th>Followed</th><th>When followed</th><th>When skipped</th></tr></thead><tbody>
          ${rules.map((r) => `<tr><td>${esc(r.rule)}</td><td>${pct(r.adherence)}</td><td class="${cls(r.followed.expectancy)}">${r.followed.n ? signed(r.followed.expectancy) : '–'}</td><td class="${cls(r.skipped.expectancy)}">${r.skipped.n ? signed(r.skipped.expectancy) : '–'}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Rule-by-rule results appear once you log trades with the new checklist. Older trades only stored a score, not which rules you ticked.</p>'}
      </section>
    </div>`;

  $('#scopeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.coachScope = b.dataset.v; render(); } });
  $('#moreLeaks')?.addEventListener('click', () => { state.showAllLeaks = !state.showAllLeaks; render(); });
  $('#dimChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.coachDim = b.dataset.v; const y = window.scrollY; render(); window.scrollTo(0, y); } });

  chart($('#dimChart'), {
    type: 'bar',
    data: { labels: dim.groups.map((g) => g.key), datasets: [{ data: dim.groups.map((g) => Math.round(g.expectancy)), backgroundColor: dim.groups.map((g) => (g.expectancy >= 0 ? alpha(tok('--profit'), 0.8) : alpha(tok('--loss'), 0.8))), borderRadius: 4, maxBarThickness: 28 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => ` ${signed(x.parsed.x)} per trade` } } }, scales: { x: { grid: { color: gridColor() }, ticks: { callback: moneyTick } }, y: { grid: { display: false }, ticks: { autoSkip: false } } } },
  });
  const rd = S.rDistribution(tr);
  chart($('#rChart'), {
    type: 'bar',
    data: { labels: rd.labels, datasets: [{ data: rd.counts, backgroundColor: rd.labels.map((_, i) => (i < 4 ? alpha(tok('--loss'), 0.8) : alpha(tok('--profit'), 0.8))), borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } }, y: { grid: { color: gridColor() }, ticks: { precision: 0 } } } },
  });
}

/* ================= prop-firm presets ================= */
// Rules as of November 2026. Firms change these often, so every field stays editable.
const FIRM_PRESETS = [
  { id: 'apex50', label: 'Apex 50K', firm: 'Apex', type: 'Evaluation', startBal: 50000, targetBal: 53000, trailingLimit: 2000, ddType: 'trailing', trailLockAt: null },
  { id: 'apex100', label: 'Apex 100K', firm: 'Apex', type: 'Evaluation', startBal: 100000, targetBal: 106000, trailingLimit: 3000, ddType: 'trailing', trailLockAt: null },
  { id: 'apex150', label: 'Apex 150K', firm: 'Apex', type: 'Evaluation', startBal: 150000, targetBal: 159000, trailingLimit: 4000, ddType: 'trailing', trailLockAt: null },
  { id: 'apex50eod', label: 'Apex 50K end-of-day', firm: 'Apex', type: 'Evaluation', startBal: 50000, targetBal: 53000, trailingLimit: 2000, ddType: 'eod', trailLockAt: null },
  { id: 'top50', label: 'Topstep 50K Combine', firm: 'Topstep', type: 'Evaluation', startBal: 50000, targetBal: 53000, trailingLimit: 2000, ddType: 'eod', trailLockAt: 50000 },
  { id: 'top100', label: 'Topstep 100K Combine', firm: 'Topstep', type: 'Evaluation', startBal: 100000, targetBal: 106000, trailingLimit: 3000, ddType: 'eod', trailLockAt: 100000 },
  { id: 'top150', label: 'Topstep 150K Combine', firm: 'Topstep', type: 'Evaluation', startBal: 150000, targetBal: 159000, trailingLimit: 4500, ddType: 'eod', trailLockAt: 150000 },
];
const presetOptions = (sel = '') => `<option value="">Pick a firm and size…</option>${FIRM_PRESETS.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}<option value="custom" ${sel === 'custom' ? 'selected' : ''}>Something else (I'll type it in)</option>`;
function fillAccountForm(f, preset) {
  if (!preset) return;
  const set = (k, v) => { if (f.elements[k]) f.elements[k].value = v ?? ''; };
  set('firm', preset.firm); set('type', preset.type); set('startBal', preset.startBal); set('targetBal', preset.targetBal);
  set('trailingLimit', preset.trailingLimit); set('ddType', preset.ddType); set('trailLockAt', preset.trailLockAt);
  if (f.elements.name && (!f.elements.name.value || f.elements.name.dataset.auto === '1')) { f.elements.name.value = `${preset.label}${preset.type === 'Evaluation' ? ' Eval' : ''}`; f.elements.name.dataset.auto = '1'; }
}

/* ================= first visit ================= */
function needsOnboarding() {
  return store.kind !== 'demo' && !state.profile?.onboarded && !state.trades.length && state.accounts.length === 1;
}
function openOnboarding() {
  const a = state.accounts[0];
  const sh = openSheet(`${sheetHead('Welcome to Windage')}
    <form class="sheet-body" id="onbForm">
      <p class="help">Set up the account you're trading. Your balance, liquidation line and target are worked out from this. You can change everything later in Accounts.</p>
      <label class="field"><span>Your name</span><input name="displayName" value="${esc(state.profile?.displayName || '')}" placeholder="How the journal greets you"></label>
      <label class="field"><span>What are you trading?</span><select name="preset">${presetOptions('apex50')}</select></label>
      <label class="field"><span>Account name</span><input name="name" value="" data-auto="1"></label>
      <div class="grid-2">
        <label class="field"><span>Firm</span><input name="firm"></label>
        <label class="field"><span>Type</span><select name="type">${['Evaluation', 'Funded', 'Personal'].map((t) => `<option>${t}</option>`).join('')}</select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Starting balance ($)</span><input type="number" inputmode="decimal" name="startBal"></label>
        <label class="field"><span>Profit target ($ balance)</span><input type="number" inputmode="decimal" name="targetBal"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Max drawdown ($)</span><input type="number" inputmode="decimal" name="trailingLimit"></label>
        <label class="field"><span>Drawdown type</span><select name="ddType"><option value="trailing">Trailing (follows your high)</option><option value="eod">End-of-day trailing</option><option value="static">Static (never moves)</option></select></label>
      </div>
      <label class="field"><span>Liquidation line stops trailing at ($, optional)</span><input type="number" inputmode="decimal" name="trailLockAt" placeholder="Leave empty if it keeps trailing"></label>
      <p class="help">Preset rules are from November 2026. Firms change them often, so check your firm's dashboard and adjust anything that's different.</p>
    </form>
    <div class="sheet-foot"><button class="btn btn-ghost" id="onbSkip">Skip for now</button><button class="btn btn-primary" id="onbSave">Start journaling</button></div>`);
  const f = $('#onbForm', sh);
  fillAccountForm(f, FIRM_PRESETS[0]);
  f.elements.name.addEventListener('input', () => { f.elements.name.dataset.auto = '0'; });
  f.elements.preset.addEventListener('change', () => fillAccountForm(f, FIRM_PRESETS.find((p) => p.id === f.elements.preset.value)));
  const done = (patch) => {
    state.profile = { ...state.profile, onboarded: true, ...(patch?.profile || {}) };
    if (patch?.account) state.accounts = [{ ...a, ...patch.account }];
    saveMeta({ profile: state.profile, ...(patch?.account ? { accounts: state.accounts } : {}) });
    closeSheet(); render();
  };
  $('#onbSkip', sh).addEventListener('click', () => done());
  $('#onbSave', sh).addEventListener('click', () => {
    const n = (k) => (f.elements[k].value === '' ? null : Number(f.elements[k].value));
    done({
      profile: { displayName: f.elements.displayName.value.trim() || state.profile?.displayName || '' },
      account: { name: f.elements.name.value.trim() || a.name, firm: f.elements.firm.value.trim(), type: f.elements.type.value,
        startBal: n('startBal') ?? a.startBal, targetBal: n('targetBal') ?? a.targetBal, trailingLimit: n('trailingLimit') ?? a.trailingLimit,
        ddType: f.elements.ddType.value, trailLockAt: n('trailLockAt') },
    });
    toast('You’re all set. Log your first trade when you’re ready.');
  });
}

/* ================= delete account ================= */
function openDeleteAccount() {
  const sh = openSheet(`${sheetHead('Delete my account')}
    <form class="sheet-body" id="delForm">
      <p class="help">This permanently deletes every account, trade, screenshot, plan and review in your journal, and your login. It can't be undone.</p>
      ${state.billing?.licenseKey ? '<div class="alert">Deleting doesn’t cancel a monthly plan. Cancel it first from your Gumroad library (gumroad.com/library).</div>' : ''}
      <p class="help">Want a copy first? Close this and use “Download a full backup”.</p>
      <label class="field"><span>Your password</span><input type="password" name="pw" autocomplete="current-password"></label>
      <label class="field"><span>Type DELETE to confirm</span><input name="confirm" autocomplete="off" autocapitalize="characters"></label>
      <p class="form-error" id="delErr" role="alert" hidden></p>
    </form>
    <div class="sheet-foot"><button class="btn btn-ghost" data-close>Keep my account</button><button class="btn btn-danger" id="delGo" disabled>Delete everything</button></div>`);
  $$('[data-close]', sh).forEach((b) => b.addEventListener('click', closeSheet));
  const f = $('#delForm', sh), go = $('#delGo', sh), err = $('#delErr', sh);
  f.addEventListener('input', () => { go.disabled = !(f.elements.confirm.value.trim().toUpperCase() === 'DELETE' && f.elements.pw.value); });
  go.addEventListener('click', async () => {
    err.hidden = true; go.disabled = true; go.textContent = 'Deleting…';
    try {
      await store.deleteAccount(f.elements.pw.value);
      try { localStorage.removeItem('windage-theme'); } catch (e) { /* ignore */ }
      closeSheet(); toast('Your account has been deleted.', 4000);
      setTimeout(() => location.replace(location.pathname), 1200);
    } catch (e) {
      err.textContent = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential' || e.code === 'auth/invalid-login-credentials' ? 'That password isn’t right.' : e.message;
      err.hidden = false; go.disabled = false; go.textContent = 'Delete everything';
    }
  });
}

/* ================= plans ================= */
const planStatus = () => (store?.kind === 'demo' ? billingStatus(state.billing, '') : billingStatus(state.billing, state.emailCode, Date.now(), state.user?.createdAt));
// Only lock once payments are set up, so nobody is ever stuck with no way to pay.
const locked = () => store?.kind !== 'demo' && paymentsReady() && planStatus().state === 'expired';

function paintPlanChip() {
  const chip = $('#planChip'); if (!chip) return;
  const p = planStatus();
  chip.hidden = !(p.state === 'expired' && paymentsReady()) || store?.kind === 'demo';
  chip.classList.toggle('ended', p.state === 'expired');
  const narrow = window.matchMedia('(max-width: 560px)').matches;
  chip.textContent = narrow ? 'Ended' : 'Trial ended';
}

async function recheckLicense() {
  const b = state.billing;
  if (!needsRecheck(b)) return;
  const ok = await validateLicense(b.licenseKey, b.productId);
  if (ok === null) return; // offline or service down: keep access during the grace period
  state.billing = ok ? { ...b, lastValidAt: Date.now(), revoked: false } : { ...b, revoked: true };
  saveMeta({ billing: state.billing });
  if (!ok) toast('Your Windage plan is no longer active.', 5000);
  render();
}

const PRO_FEATURES = ['Unlimited trades and accounts', 'Coach that reads your reflections', 'Playbook, daily journal and share cards', 'Broker CSV import and Excel export', 'Every colour theme, on all your devices'];

function plansHtml() {
  const ready = paymentsReady();
  return `<div class="plan-cards">${BILLING.plans.map((p) => `
    <div class="plan-card ${p.id === 'twoyear' ? 'best' : ''}">
      <div class="plan-top"><h3>${esc(p.name)}</h3>${p.id === 'twoyear' ? '<span class="tag grade">Best value</span>' : ''}</div>
      <p class="plan-price"><b class="num">${esc(p.price)}</b> <span>${esc(p.per)}</span></p>
      <p class="muted" style="font-size:14px">${esc(p.note)}</p>
      ${p.checkout ? `<a class="btn btn-primary btn-block" href="${esc(p.checkout)}" target="_blank" rel="noopener">Get ${esc(p.name.toLowerCase())}</a>` : `<button class="btn btn-ghost btn-block" disabled>${ready ? 'Not available' : 'Payments open soon'}</button>`}
    </div>`).join('')}</div>
    <ul class="plan-feats">${PRO_FEATURES.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <p class="help plan-legal">Payments are handled by Gumroad, our Merchant of Record. Plans aren't refundable and the monthly plan can be cancelled any time. By buying you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a> and <a href="refunds.html" target="_blank" rel="noopener">Refund and Cancellation Policy</a>.</p>
    <form class="activate" id="activateForm">
      <label class="field"><span>Already paid? Paste the license key from your Gumroad receipt</span>
        <div class="activate-row"><input name="key" placeholder="e.g. 3F2A-…" autocomplete="off" spellcheck="false"><button class="btn btn-primary" type="submit">Activate</button></div></label>
      <p class="form-error" id="activateErr" role="alert" hidden></p>
    </form>`;
}

function wireActivate(root, onDone) {
  const f = $('#activateForm', root); if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#activateErr', root), btn = $('button[type=submit]', f), key = f.elements.key.value.trim();
    err.hidden = true;
    if (store.kind === 'demo') { err.textContent = 'Create your own journal first, then activate your key there.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const { productId, planId } = await activateLicense(key);
      state.billing = { ...state.billing, licenseKey: key, productId, planId, lastValidAt: Date.now(), revoked: false };
      await saveMeta({ billing: state.billing });
      toast('Windage Pro is active. Thank you!', 4000);
      onDone();
    } catch (er) {
      err.textContent = er.message; err.hidden = false;
      btn.disabled = false; btn.textContent = 'Activate';
    }
  });
}

function openPlans() {
  const p = planStatus();
  const sh = openSheet(`${sheetHead(p.state === 'expired' ? 'Keep using Windage' : 'Windage plans')}
    <div class="sheet-body">
      <p class="help">${p.state === 'trial' ? 'You’re on the free trial, with everything included.' : p.state === 'expired' ? 'Your free month is over. Pick a plan to keep logging. Your trades are safe either way.' : 'You already have full access.'}</p>
      ${plansHtml()}
    </div>`);
  wireActivate(sh, () => { closeSheet(); render(); });
}

function renderPaywall(v) {
  const n = acctTrades().length;
  v.innerHTML = `
    <section class="panel paywall">
      <div class="paywall-head">
        <span class="brand-mark"><svg class="mark" aria-hidden="true"><use href="#i-mark"/></svg></span>
        <h2>Your free month is over</h2>
        <p>${n ? `You logged ${n} trade${n === 1 ? '' : 's'} in this account. They’re all saved. ` : ''}Pick a plan to keep using Windage.</p>
      </div>
      ${plansHtml()}
      <p class="help" style="text-align:center">Want your data instead? <a href="#/settings">Export or back it up in Settings</a>.</p>
    </section>`;
  wireActivate(v, () => render());
}

/* ================= playbook ================= */
function renderPlaybook(v) {
  const tr = acctTrades();
  const models = state.settings.models || [];
  const groups = models.map((m) => ({ key: m, trades: tr.filter((t) => t.Model === m) }));
  tr.forEach((t) => { if (t.Model && !models.includes(t.Model) && !groups.some((g) => g.key === t.Model)) groups.push({ key: t.Model, trades: tr.filter((x) => x.Model === t.Model) }); });
  const untagged = tr.filter((t) => !t.Model);
  const traded = groups.filter((g) => g.trades.length).map((g) => ({ ...g, c: S.coreStats(g.trades) })).sort((a, b) => b.c.net - a.c.net);
  const idle = groups.filter((g) => !g.trades.length);
  const best = traded.find((g) => g.c.n >= 5 && g.c.net > 0);
  const worst = [...traded].reverse().find((g) => g.c.n >= 5 && g.c.net < 0);
  const pfTxt = (pf) => (pf === Infinity ? '∞' : pf.toFixed(2));
  const top = (list, fn) => { const m = S.groupBy(list, fn).filter((x) => x.n >= 2).sort((a, b) => b.net - a.net); return m[0]; };
  const mostMistake = (list) => { const c = {}; list.flatMap(S.mistakesOf).forEach((m) => { c[m] = (c[m] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; };

  const card = (g) => {
    const c = g.c, last = S.sortTrades(g.trades).slice(-16);
    const sess = top(g.trades, (t) => t.Killzone), mis = mostMistake(g.trades);
    const flag = g === best ? '<span class="tag long">Your best edge</span>' : g === worst ? '<span class="tag short">Costing you</span>' : c.n < 5 ? '<span class="badge">Small sample</span>' : '';
    return `<section class="panel play-card">
      <header><h3>${esc(g.key)}</h3>${flag}</header>
      <div><p class="play-net num ${cls(c.net)}">${signed(c.net)}</p><small class="muted">${c.n} trade${c.n === 1 ? '' : 's'}</small></div>
      <div class="play-figs">
        <div>Win rate<b>${pct(c.winRate)}</b></div>
        <div>Avg R<b class="${cls(c.avgR)}">${rTxt(c.avgR)}</b></div>
        <div>Per trade<b class="${cls(c.expectancy)}">${signed(c.expectancy)}</b></div>
        <div>Profit factor<b>${pfTxt(c.profitFactor)}</b></div>
      </div>
      <div class="play-strip" aria-label="Last ${last.length} results, oldest first">${last.map((t) => `<i class="${S.pnlOf(t) > 0 ? 'w' : S.pnlOf(t) < 0 ? 'l' : 'b'}" title="${esc(fmtDate(t.Date))}: ${esc(signed(S.pnlOf(t)))}"></i>`).join('')}</div>
      <p class="play-note">${sess ? `Best session: <b>${esc(sess.key)}</b>` : 'Not enough trades per session yet'}${mis ? `<br>Most common mistake: <b>${esc(mis[0])}</b> (${mis[1]}×)` : '<br>No mistakes tagged'}</p>
      <a class="play-link" href="#/trades?model=${encodeURIComponent(g.key)}">See these trades</a>
    </section>`;
  };

  v.innerHTML = `
    <section class="panel play-hero">
      <div>
        <h2>${best ? `${esc(best.key)} has made you the most: ${signed(best.c.net)} over ${best.c.n} trades.` : traded.length ? 'Tag a few more trades to see which setup pays.' : 'Tag each trade with the setup you took.'}</h2>
        <p>${worst ? `${esc(worst.key)} has lost you ${bal(Math.abs(worst.c.net))} over ${worst.c.n} trades. Stop taking it until you've studied what's going wrong.` : 'Each card shows what one setup has actually made you, so you can trade more of what works.'}</p>
      </div>
      <a class="btn btn-ghost" href="#/settings">Edit models</a>
    </section>
    ${traded.length ? `<div class="play-grid">${traded.map(card).join('')}</div>` : ''}
    ${untagged.length ? `<section class="panel play-untagged"><div><h3>${untagged.length} trade${untagged.length === 1 ? '' : 's'} without a model</h3><p class="muted">Open a trade, tap Edit, and pick its setup model so it counts here.</p></div><a class="btn btn-ghost" href="#/trades?model=(none)">Tag them</a></section>` : ''}
    ${idle.length ? `<p class="muted" style="font-size:14px">Not traded yet: ${idle.map((g) => esc(g.key)).join(', ')}</p>` : ''}`;
}

/* ================= daily journal (plan + review) ================= */
const hasPlan = (p) => !!(p && (p.htfArray || p.dol || p.notes || p.news || (p.bias && p.planSaved !== false)));
function renderPrep(v) {
  const date = state.prepDate, p = state.prep[date] || {};
  const days = Object.keys(state.prep).sort().reverse().slice(0, 20);
  const daily = S.dailyPnl(acctTrades());
  const withPrep = Object.entries(daily).filter(([d]) => hasPlan(state.prep[d])), without = Object.entries(daily).filter(([d]) => !hasPlan(state.prep[d]));
  const avg = (l) => (l.length ? l.reduce((s, [, x]) => s + x.pnl, 0) / l.length : NaN);
  const today = acctTrades().filter((t) => t.Date === date), todayNet = today.reduce((s, t) => s + S.pnlOf(t), 0);
  const rated = Object.entries(daily).filter(([d]) => state.prep[d]?.rating);
  const byRating = [1, 2, 3, 4, 5].map((r) => { const l = rated.filter(([d]) => state.prep[d].rating === r); return { r, n: l.length, avg: avg(l) }; }).filter((x) => x.n);
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
  v.innerHTML = `
    <div class="prep-grid">
      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <section class="panel">
          <div class="panel-head"><h2>Plan for ${esc(fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' }))}</h2><span class="sub">Before the open</span></div>
          <form class="prep-form" id="prepForm">
            <label class="field"><span>Date</span><input type="date" name="date" value="${esc(date)}"></label>
            <div class="field"><span>Daily bias</span><div class="seg bias-seg" id="biasSeg">${['Bullish', 'Bearish', 'Consolidation / Neutral'].map((x) => `<button type="button" data-v="${x}" aria-pressed="${(p.bias || 'Bullish') === x}">${x === 'Consolidation / Neutral' ? 'Neutral' : x}</button>`).join('')}</div></div>
            <label class="field"><span>Higher-timeframe PD array</span><input name="htfArray" value="${esc(p.htfArray)}" placeholder="e.g. 4H bullish FVG tapped, daily order block"></label>
            <label class="field"><span>Draw on liquidity / targets</span><input name="dol" value="${esc(p.dol)}" placeholder="e.g. buy-side at 19950, previous day high"></label>
            <label class="field"><span>High-impact news</span><input name="news" value="${esc(p.news)}" placeholder="e.g. 8:30 CPI, flat 8:25 to 8:35"></label>
            <label class="field"><span>Game plan</span><textarea name="notes" rows="4" placeholder="e.g. Wait for displacement after 9:45. One contract if it's choppy.">${esc(p.notes)}</textarea></label>
            <button class="btn btn-primary" type="submit" style="align-self:flex-start">Save plan</button>
          </form>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>End-of-day review</h2><span class="sub">${today.length ? `${today.length} trade${today.length === 1 ? '' : 's'}, <span class="num ${cls(todayNet)}">${signed(todayNet)}</span>` : 'No trades this day'}</span></div>
          <form class="prep-form" id="reviewForm">
            <div class="field"><span>How well did you follow your plan?</span>
              <div class="rating" id="rating" role="radiogroup" aria-label="Rating out of 5">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-v="${n}" aria-checked="${p.rating === n}" aria-label="${n} out of 5" class="${(p.rating || 0) >= n ? 'on' : ''}">★</button>`).join('')}<span class="rating-word" id="ratingWord">${['Tap to rate', 'Off plan', 'Shaky', 'Okay', 'Good', 'Followed it exactly'][p.rating || 0]}</span></div></div>
            <label class="field"><span>What went well</span><textarea name="wentWell" rows="2" placeholder="e.g. Waited for the 9:50 displacement and held to target.">${esc(p.wentWell)}</textarea></label>
            <label class="field"><span>Fix tomorrow</span><textarea name="lesson" rows="2" placeholder="e.g. No second trade after a win.">${esc(p.lesson)}</textarea></label>
            <button class="btn btn-primary" type="submit" style="align-self:flex-start">Save review</button>
          </form>
        </section>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        ${withPrep.length && without.length ? `<section class="panel"><div class="panel-head"><h2>Does prep pay?</h2></div>
          <div class="grid-2"><div><span class="muted" style="font-size:13px">Days with a plan</span><p class="num ${cls(avg(withPrep))}" style="font-size:24px;font-weight:600">${signed(avg(withPrep))}</p><small class="muted">${withPrep.length} days, average</small></div>
          <div><span class="muted" style="font-size:13px">Days without</span><p class="num ${cls(avg(without))}" style="font-size:24px;font-weight:600">${signed(avg(without))}</p><small class="muted">${without.length} days, average</small></div></div></section>` : ''}
        ${byRating.length >= 2 ? `<section class="panel"><div class="panel-head"><h2>Discipline vs P&amp;L</h2><span class="sub">Average day by your rating</span></div>
          <div class="rate-rows">${byRating.map((x) => `<div><span class="stars">${stars(x.r)}</span><span class="muted">${x.n} day${x.n === 1 ? '' : 's'}</span><b class="num ${cls(x.avg)}">${signed(x.avg)}</b></div>`).join('')}</div></section>` : ''}
        <section class="panel"><div class="panel-head"><h2>Recent days</h2></div>
          ${days.length ? days.map((d) => { const x = state.prep[d], r = daily[d]; return `<div class="prep-day" data-date="${d}"><span class="dt">${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))} ${hasPlan(x) ? `<span class="${x.bias === 'Bullish' ? 'pos' : x.bias === 'Bearish' ? 'neg' : 'muted'}">${esc(x.bias === 'Consolidation / Neutral' ? 'Neutral' : x.bias)}</span>` : ''} ${x.rating ? `<span class="stars sm">${stars(x.rating)}</span>` : ''}</span><span class="num ${r ? cls(r.pnl) : 'muted'}">${r ? signed(r.pnl) : 'No trades'}</span><span class="sm">${esc(x.lesson ? 'Fix: ' + x.lesson : [x.dol, x.htfArray].filter(Boolean).join(', ') || x.notes || '')}</span></div>`; }).join('') : '<p class="muted">Your plans and reviews show up here with how each day went.</p>'}
        </section>
      </div>
    </div>`;
  const form = $('#prepForm');
  form.elements.date.addEventListener('change', (e) => { state.prepDate = e.target.value || todayIso(); render(); });
  $('#biasSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) $$('#biasSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); });
  $$('.prep-day').forEach((el) => el.addEventListener('click', () => { state.prepDate = el.dataset.date; render(); }));
  const persist = (patch, msg) => {
    const data = { ...(state.prep[date] || {}), ...patch, updatedAt: Date.now() };
    state.prep[date] = data;
    store.savePrep(date, data).catch((er) => toast('Couldn’t sync: ' + er.message));
    toast(msg); render();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    persist({ bias: $('#biasSeg [aria-pressed=true]').dataset.v, htfArray: form.elements.htfArray.value, dol: form.elements.dol.value, news: form.elements.news.value, notes: form.elements.notes.value, planSaved: true }, 'Plan saved');
  });
  let rating = p.rating || 0;
  const words = ['Tap to rate', 'Off plan', 'Shaky', 'Okay', 'Good', 'Followed it exactly'];
  $('#rating').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    rating = Number(b.dataset.v);
    $$('#rating button').forEach((x) => { x.classList.toggle('on', Number(x.dataset.v) <= rating); x.setAttribute('aria-checked', Number(x.dataset.v) === rating); });
    $('#ratingWord').textContent = words[rating];
  });
  const rf = $('#reviewForm');
  rf.addEventListener('submit', (e) => {
    e.preventDefault();
    const patch = { rating: rating || null, wentWell: rf.elements.wentWell.value, lesson: rf.elements.lesson.value };
    if (!state.prep[date]?.bias) patch.planSaved = false;
    persist(patch, 'Review saved');
  });
}

/* ================= share card ================= */
function themeColours() {
  const c = (n) => tok(n);
  return {
    bg: c('--bg'), surface: c('--surface'), ink: c('--ink'), ink2: c('--ink-2'), mute: c('--mute'), line: alpha(c('--line'), 1),
    accent: c('--accent'), accent2: c('--accent-2'), accentInk: c('--accent-ink'), profit: c('--profit'), loss: c('--loss'),
    surfaceA: alpha(c('--surface-2'), 0.85),
    accentGlow: alpha(c('--accent'), 0.22), accent2Glow: alpha(c('--accent-2'), 0.16),
    profitGlow: alpha(c('--profit'), 0.14), lossGlow: alpha(c('--loss'), 0.14),
  };
}
function openShareCard(t) {
  let showMoney = true;
  const sh = openSheet(`${sheetHead('Share card')}
    <div class="sheet-body">
      <canvas class="share-canvas" id="shareCanvas" aria-label="Trade card preview"></canvas>
      <label class="check" style="padding:0"><input type="checkbox" id="shareMoney" checked><span>Show dollar amounts</span></label>
      <p class="help">The card uses your current colour theme. Change it in Settings.</p>
    </div>
    <div class="sheet-foot">
      <button class="btn btn-ghost" id="shareSave">Save image</button>
      <button class="btn btn-primary" id="shareSend">Share</button>
    </div>`);
  const canvas = $('#shareCanvas', sh);
  const draw = () => {
    const p = S.pnlOf(t), r = S.rOf(t), a = state.accounts.find((x) => x.id === t.accountId);
    const hasR = Number.isFinite(r);
    const big = showMoney ? signed(p) : hasR ? rTxt(r) : (p > 0 ? 'Win' : p < 0 ? 'Loss' : 'Breakeven');
    const rows = [
      hasR && showMoney ? ['Realized', rTxt(r), r > 0 ? 'pos' : r < 0 ? 'neg' : ''] : ['Session', t.Killzone || '–'],
      ['Grade', t.Grade && t.Grade !== 'N/A' ? t.Grade : '–'],
      ['Checklist', t.ChecklistScore || '–'],
      ['Entry', t.Entry || '–'], ['Exit', t.Exit || '–'], ['Time in trade', t.Duration ? `${t.Duration} min` : '–'],
    ];
    drawShareCard(canvas, {
      date: fmtDate(t.Date, { month: 'short', day: 'numeric', year: 'numeric' }),
      headline: [t.Instrument, t.Direction, t.Model].filter(Boolean).join(' · ') || 'Trade',
      sub: [t.Killzone, t.Time && t.Time !== '--:--' ? t.Time : '', a?.firm && a.firm !== 'Personal' ? a.firm : ''].filter(Boolean).join(' · '),
      big, bigLabel: showMoney ? 'Net P&L' : hasR ? 'Realized R' : 'Result',
      tone: p > 0 ? 'pos' : p < 0 ? 'neg' : '', rows,
      footer: state.profile?.handle ? `@${state.profile.handle.replace(/^@/, '')}` : (state.profile?.displayName || 'windage journal'),
    }, themeColours(), { num: "'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif" });
  };
  const blob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
  const name = `windage-${t.Date}-${(t.Instrument || 'trade').toLowerCase()}.png`;
  $('#shareMoney', sh).addEventListener('change', (e) => { showMoney = e.target.checked; draw(); });
  $('#shareSave', sh).addEventListener('click', async () => download(await blob(), name));
  $('#shareSend', sh).addEventListener('click', async () => {
    const file = new File([await blob()], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (e) { /* cancelled */ } }
    else { download(file, name); toast('Saved. Your browser can’t share images directly.'); }
  });
  (document.fonts?.ready || Promise.resolve()).then(draw);
  draw();
}

/* ================= broker import ================= */
function openImport() {
  let parsed = null, map = {};
  const sh = openSheet(`${sheetHead('Import trades from your broker')}
    <div class="sheet-body" id="impBody">
      <p class="help">Export your trade history as a CSV, one row per trade. Works with Tradovate (Performance report), NinjaTrader (Trades tab), TopstepX, Rithmic and most other platforms.</p>
      <label class="drop" style="cursor:pointer"><svg><use href="#i-list"/></svg><span>Choose a CSV file</span><input type="file" id="impFile" accept=".csv,text/csv,.txt" hidden></label>
      <div id="impStep"></div>
    </div>
    <div class="sheet-foot"><button class="btn btn-primary" id="impGo" disabled>Import</button></div>`);
  const step = $('#impStep', sh), go = $('#impGo', sh);
  const fieldSelect = (f) => `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span><select data-field="${f.id}"><option value="">Not in file</option>${parsed.headers.map((h) => `<option ${map[f.id] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`;
  const preview = () => {
    const known = [...new Set([...(state.settings.instruments || []), ...Object.keys(POINT_VALUE)])];
    const res = rowsToTrades(parsed.rows, { map, known, subtractFees: $('#impFees', sh)?.checked ?? true, sessionFor });
    const existing = new Set(state.trades.map((t) => String(t.id)));
    const fresh = res.trades.filter((t) => !existing.has(t.id));
    const missing = FIELDS.filter((f) => f.required && !map[f.id] && !(f.id === 'entryTime' && (map.buyTime || map.sellTime)));
    $('#impPreview', sh).innerHTML = missing.length
      ? `<p class="form-error">Pick the column for ${missing.map((f) => f.label).join(', ')}.</p>`
      : `<p class="help"><b>${fresh.length}</b> new trade${fresh.length === 1 ? '' : 's'} ready${res.trades.length - fresh.length ? `, ${res.trades.length - fresh.length} already in your journal (skipped)` : ''}${res.skipped.length ? `, ${res.skipped.length} row${res.skipped.length === 1 ? '' : 's'} couldn’t be read (line ${res.skipped.slice(0, 3).map((x) => x.line).join(', ')}${res.skipped.length > 3 ? '…' : ''})` : ''}.</p>
        <div class="table-scroll"><table class="bucket-table imp-table"><thead><tr><th>Date</th><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&amp;L</th></tr></thead><tbody>
        ${res.trades.slice(0, 6).map((t) => `<tr><td>${esc(t.Date)}</td><td>${esc(t.Time)}</td><td>${esc(t.Instrument)}</td><td>${esc(t.Direction)}</td><td>${esc(t.Contracts)}</td><td>${esc(t.Entry)}</td><td>${esc(t.Exit)}</td><td class="${cls(t.PNL)}">${signed(t.PNL)}</td></tr>`).join('')}</tbody></table></div>`;
    go.disabled = !!missing.length || !fresh.length;
    go.textContent = fresh.length ? `Import ${fresh.length} trade${fresh.length === 1 ? '' : 's'} into ${acct().name}` : 'Import';
    return fresh;
  };
  $('#impFile', sh).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    parsed = parseCsv(await file.text());
    if (!parsed.rows.length) { step.innerHTML = '<p class="form-error">That file has no rows. Check you exported trades, not an empty report.</p>'; return; }
    map = guessMapping(parsed.headers);
    step.innerHTML = `<p class="fs-title">${esc(file.name)} <span class="muted" style="font-weight:400">${parsed.rows.length} rows</span></p>
      <details class="imp-map" ${FIELDS.some((f) => f.required && !map[f.id] && !(f.id === 'entryTime' && map.buyTime)) ? 'open' : ''}><summary>Columns we matched (check or change)</summary>
        <div class="grid-3" style="margin-top:12px">${FIELDS.map(fieldSelect).join('')}</div></details>
      <label class="check" style="padding:0"><input type="checkbox" id="impFees" checked><span>Subtract fees and commission from P&amp;L</span></label>
      <div id="impPreview"></div>
      <p class="help">Imported trades get the session from their entry time. Open each one later to add your model, checklist and notes.</p>`;
    step.addEventListener('change', (ev) => { const sel = ev.target.closest('[data-field]'); if (sel) map[sel.dataset.field] = sel.value; preview(); });
    preview();
  });
  go.addEventListener('click', async () => {
    const fresh = preview(); if (!fresh.length) return;
    go.disabled = true; go.textContent = 'Importing…';
    try {
      for (let i = 0; i < fresh.length; i += 10) {
        const chunk = fresh.slice(i, i + 10).map((t) => ({ ...t, accountId: state.activeAccountId, createdAt: Date.now(), updatedAt: Date.now() }));
        await Promise.all(chunk.map((t) => store.saveTrade(t)));
        state.trades.push(...chunk);
        go.textContent = `Importing… ${Math.min(i + 10, fresh.length)} of ${fresh.length}`;
      }
      closeSheet(); toast(`Imported ${fresh.length} trades`); location.hash = '#/trades';
    } catch (er) { go.disabled = false; go.textContent = 'Try again'; toast('Import stopped: ' + er.message); }
  });
}

/* ================= accounts ================= */
function renderAccounts(v) {
  v.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <p class="help">Each account tracks its own balance, drawdown and trades. Pick the one you're trading from the menu at the top.</p>
      <button class="btn btn-primary" id="addAcct">Add account</button>
    </div>
    <div class="acct-cards">${state.accounts.map((a) => {
      const tr = state.trades.filter((t) => t.accountId === a.id), st = S.accountState(a, tr);
      return `<section class="panel acct-card ${a.id === state.activeAccountId ? 'active' : ''}">
        <header><div><h3>${esc(a.name)}</h3><p>${esc([a.firm, a.type].filter(Boolean).join(', '))}, ${tr.length} trades</p></div>${st.blown ? '<span class="tag short">Limit hit</span>' : st.passed ? '<span class="tag grade">Target hit</span>' : ''}</header>
        <div class="acct-figs"><div>Balance<b class="${cls(st.balance - st.start)}">${bal(st.balance)}</b></div><div>Room left<b>${bal(st.buffer)}</b></div><div>To target<b>${st.target > st.start ? bal(st.toTarget) : '–'}</b></div></div>
        <div><small class="muted">Progress to target</small><div class="acct-meter"><i style="width:${st.targetProgress * 100}%"></i></div></div>
        <div><small class="muted">Drawdown room left</small><div class="acct-meter buf"><i style="width:${st.bufferPct * 100}%"></i></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${a.id !== state.activeAccountId ? `<button class="btn btn-ghost btn-sm" data-use="${esc(a.id)}">Switch to this account</button>` : '<span class="muted" style="font-size:13px;align-self:center">Active account</span>'}
          <button class="btn btn-ghost btn-sm" data-edit="${esc(a.id)}">Edit</button>
        </div>
      </section>`;
    }).join('')}</div>`;
  $('#addAcct').addEventListener('click', () => openAccountEditor());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openAccountEditor(state.accounts.find((a) => a.id === b.dataset.edit))));
  $$('[data-use]').forEach((b) => b.addEventListener('click', () => { state.activeAccountId = b.dataset.use; saveMeta({ activeAccountId: state.activeAccountId }); toast('Switched account'); render(); }));
}

function openAccountEditor(a = null) {
  const x = a || newAccount({ name: '' });
  const sh = openSheet(`${sheetHead(a ? 'Edit account' : 'Add account')}
    <form class="sheet-body" id="acctForm">
      <label class="field"><span>Fill from a preset</span><select name="preset">${presetOptions()}</select><small>Fills in the firm's rules (as of November 2026). Check them against your firm's dashboard.</small></label>
      <label class="field"><span>Name</span><input name="name" value="${esc(x.name)}" placeholder="e.g. Apex 50K #2" required autofocus></label>
      <div class="grid-2">
        <label class="field"><span>Firm</span><input name="firm" value="${esc(x.firm)}" list="firms" placeholder="Apex, Topstep, Lucid…"><datalist id="firms">${['Apex', 'Topstep', 'Lucid', 'Alpha Futures', 'Take Profit Trader', 'MyFundedFutures', 'Tradeify', 'Personal'].map((f) => `<option value="${f}">`).join('')}</datalist></label>
        <label class="field"><span>Type</span><select name="type">${['Evaluation', 'Funded', 'Personal'].map((t) => `<option ${t === x.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Starting balance ($)</span><input type="number" inputmode="decimal" name="startBal" value="${esc(x.startBal)}"></label>
        <label class="field"><span>Target balance ($)</span><input type="number" inputmode="decimal" name="targetBal" value="${esc(x.targetBal)}"><small>For funded accounts, use your payout goal.</small></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Max drawdown ($)</span><input type="number" inputmode="decimal" name="trailingLimit" value="${esc(x.trailingLimit)}"></label>
        <label class="field"><span>Drawdown type</span><select name="ddType">
          <option value="trailing" ${x.ddType === 'trailing' ? 'selected' : ''}>Trailing (follows your high)</option>
          <option value="eod" ${x.ddType === 'eod' ? 'selected' : ''}>End-of-day trailing</option>
          <option value="static" ${x.ddType === 'static' ? 'selected' : ''}>Static (never moves)</option></select></label>
      </div>
      <label class="field"><span>Liquidation line stops trailing at ($, optional)</span><input type="number" inputmode="decimal" name="trailLockAt" value="${esc(x.trailLockAt ?? '')}" placeholder="e.g. 50100 for Apex 50K"><small>Many firms stop trailing once the line reaches your starting balance (Apex: start + $100). Leave empty if yours keeps trailing.</small></label>
      <p class="help">Balances are calculated from closed trades, so an intraday trailing drawdown may sit slightly higher on your firm's dashboard.</p>
    </form>
    <div class="sheet-foot">${a && state.accounts.length > 1 ? '<button class="btn btn-danger" id="delAcct">Delete</button>' : ''}<button class="btn btn-primary" id="saveAcct">${a ? 'Save changes' : 'Add account'}</button></div>`);
  const f = $('#acctForm', sh);
  f.elements.preset.addEventListener('change', () => fillAccountForm(f, FIRM_PRESETS.find((p) => p.id === f.elements.preset.value)));
  const save = () => {
    const n = (k) => (f.elements[k].value === '' ? null : Number(f.elements[k].value));
    const upd = { ...x, name: f.elements.name.value.trim() || 'My account', firm: f.elements.firm.value.trim(), type: f.elements.type.value,
      startBal: n('startBal') ?? 0, targetBal: n('targetBal') ?? 0, trailingLimit: n('trailingLimit') ?? 0, ddType: f.elements.ddType.value, trailLockAt: n('trailLockAt') };
    if (a) state.accounts = state.accounts.map((y) => (y.id === a.id ? upd : y));
    else { state.accounts.push(upd); state.activeAccountId = upd.id; }
    saveMeta({ accounts: state.accounts, activeAccountId: state.activeAccountId });
    closeSheet(); toast(a ? 'Account saved' : 'Account added'); render();
  };
  $('#saveAcct', sh).addEventListener('click', save);
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('#delAcct', sh)?.addEventListener('click', async () => {
    const ids = state.trades.filter((t) => t.accountId === a.id).map((t) => String(t.id));
    if (!confirm(`Delete “${a.name}” and its ${ids.length} trades? This can’t be undone.`)) return;
    await store.deleteTrades(ids);
    state.trades = state.trades.filter((t) => t.accountId !== a.id);
    state.accounts = state.accounts.filter((y) => y.id !== a.id);
    if (state.activeAccountId === a.id) state.activeAccountId = state.accounts[0].id;
    saveMeta({ accounts: state.accounts, activeAccountId: state.activeAccountId });
    closeSheet(); toast('Account deleted'); render();
  });
}

/* ================= settings ================= */
function renderSettings(v) {
  const s = state.settings;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
  const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const cur = THEMES.some((x) => x.id === s.theme) ? s.theme : 'dusk';
  const plan = planStatus();
  v.innerHTML = `
    <section class="panel plan-panel">
      <div class="panel-head"><h2>Your plan</h2></div>
      <div class="plan-now">
        <div>
          <p class="plan-state">${plan.state === 'owner' ? 'Free forever' : plan.state === 'paid' ? 'Windage Pro, active' : plan.state === 'trial' ? 'Free trial' : 'Your free trial has ended'}</p>
          <p class="help">${plan.state === 'paid' ? 'Thanks for supporting Windage. To cancel or change your card, open your Gumroad library (gumroad.com/library) → Manage membership.' : plan.state === 'owner' ? 'This account never sees the paywall.' : 'Everything in Windage is included in the trial. After it ends, pick monthly or 2 years to keep logging.'}</p>
        </div>
        ${plan.state === 'trial' || plan.state === 'expired' ? '<button class="btn btn-primary" data-action="plans">See plans</button>' : ''}
      </div>
    </section>
    ${locked() ? '<div class="alert">Your trial has ended. You can still export or back up your journal below.</div>' : ''}
    <section class="panel">
      <div class="panel-head"><h2>Colours</h2><span class="sub">Saved to your account, so every device matches</span></div>
      <div class="themes" role="radiogroup" aria-label="Colour theme">${THEMES.map((t) => `<button class="theme-opt" role="radio" aria-checked="${t.id === cur}" data-theme-id="${t.id}"><span class="theme-sw" style="background:${t.sw[0]}"><i style="background:${t.sw[1]}"></i><i style="background:${t.sw[2]}"></i></span>${t.name}</button>`).join('')}</div>
    </section>
    <div class="row-even">
      <section class="panel">
        <div class="panel-head"><h2>Checklist rules</h2></div>
        <p class="help" style="margin-bottom:14px">These are the boxes you tick when logging a trade. The share you tick sets the setup grade. Changing them doesn't change trades you've already logged.</p>
        <div class="form-stack" id="rules">${(s.checklist || []).map((r) => `<div class="rule-row"><input value="${esc(r)}" aria-label="Rule"><button class="icon-btn" data-rm aria-label="Remove rule"><svg><use href="#i-x"/></svg></button></div>`).join('')}</div>
        <div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-ghost" id="addRule">Add rule</button><button class="btn btn-primary" id="saveRules">Save rules</button></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Setup models</h2></div>
        <p class="help" style="margin-bottom:14px">The setups you trade. You tag each trade with one, and the Playbook shows what each model actually pays.</p>
        <div class="form-stack" id="models">${(s.models || []).map((r) => `<div class="rule-row"><input value="${esc(r)}" aria-label="Model"><button class="icon-btn" data-rm aria-label="Remove model"><svg><use href="#i-x"/></svg></button></div>`).join('')}</div>
        <div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-ghost" id="addModel">Add model</button><button class="btn btn-primary" id="saveModels">Save models</button></div>
      </section>
    </div>
    <div class="row-even">
      <section class="panel">
        <div class="panel-head"><h2>Guardrails</h2></div>
        <p class="help" style="margin-bottom:14px">The dashboard warns you when you hit these, and the coach scores you against them.</p>
        <form class="form-stack" id="guardForm">
          <div class="grid-2">
            <label class="field"><span>Max trades per day</span><input type="number" min="0" name="maxTradesPerDay" value="${esc(s.maxTradesPerDay ?? '')}"></label>
            <label class="field"><span>Daily loss limit ($)</span><input type="number" min="0" name="dailyLossLimit" value="${esc(s.dailyLossLimit ?? '')}"></label>
          </div>
          <label class="field"><span>Instruments you trade</span><input name="instruments" value="${esc((s.instruments || []).join(', '))}"><small>Comma separated. NQ, MNQ, ES, MES, YM, RTY, CL and GC also estimate P&amp;L from your prices.</small></label>
          <div class="grid-2">
            <label class="field"><span>Your name</span><input name="displayName" value="${esc(state.profile?.displayName || '')}"></label>
            <label class="field"><span>Instagram handle</span><input name="handle" value="${esc(state.profile?.handle || '')}" placeholder="yourname"><small>Shown on share cards.</small></label>
          </div>
          <button class="btn btn-primary" type="submit" style="align-self:flex-start">Save</button>
        </form>
      </section>
    <div class="row-even">
      <section class="panel">
        <div class="panel-head"><h2>Your data</h2></div>
        <div class="form-stack">
          <button class="btn btn-primary" id="csvBtn">Import trades from your broker (CSV)</button>
          <button class="btn btn-ghost" id="xlsxBtn">Export this account to Excel</button>
          <button class="btn btn-ghost" id="jsonBtn">Download a full backup</button>
          <label class="btn btn-ghost" style="cursor:pointer">Restore from a backup file<input type="file" id="importIn" accept="application/json,.json" hidden></label>
          <p class="help">Backups include every account, trade and plan, but not chart screenshots.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>App</h2></div>
        <div class="form-stack">
          ${installed ? '<p class="help">Installed. You can open Windage from your home screen or dock.</p>'
            : installPrompt ? '<button class="btn btn-primary" id="installBtn">Install on this device</button>'
            : ios ? '<p class="help">To install on iPhone or iPad, open this page in Safari, tap the Share button, then “Add to Home Screen”.</p>'
            : '<p class="help">To install, open the browser menu and choose “Install app” or “Add to Home Screen”.</p>'}
          <p class="help">Signed in as ${esc(state.user?.email)}</p>
          <p class="help"><a href="terms.html" target="_blank" rel="noopener">Terms</a> · <a href="privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="refunds.html" target="_blank" rel="noopener">Refunds and cancellation</a> · Support: <a href="mailto:support@windagejournal.com">support@windagejournal.com</a></p>
          <button class="link" id="delAcctBtn" style="align-self:flex-start;color:var(--loss)">Delete my account</button>
          <button class="btn btn-danger" id="signOut" style="align-self:flex-start">Sign out</button>
        </div>
      </section>
    </div>`;

  const rules = $('#rules');
  rules.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.rule-row').remove(); });
  $('#addRule').addEventListener('click', () => { rules.insertAdjacentHTML('beforeend', '<div class="rule-row"><input placeholder="New rule" aria-label="Rule"><button class="icon-btn" data-rm aria-label="Remove rule"><svg><use href="#i-x"/></svg></button></div>'); $('.rule-row:last-child input', rules).focus(); });
  $('#saveRules').addEventListener('click', () => {
    state.settings.checklist = $$('input', rules).map((i) => i.value.trim()).filter(Boolean);
    saveMeta({ settings: state.settings }); toast('Rules saved'); render();
  });
  $('#guardForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    const n = (k) => (f.elements[k].value === '' ? null : Number(f.elements[k].value));
    state.settings.maxTradesPerDay = n('maxTradesPerDay'); state.settings.dailyLossLimit = n('dailyLossLimit');
    state.settings.instruments = f.elements.instruments.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    state.profile = { ...state.profile, displayName: f.elements.displayName.value.trim(), handle: f.elements.handle.value.trim().replace(/^@/, '') };
    saveMeta({ settings: state.settings, profile: state.profile }); toast('Settings saved');
  });
  $('#xlsxBtn').addEventListener('click', exportExcel);
  $('#csvBtn').addEventListener('click', openImport);
  $('#delAcctBtn').addEventListener('click', openDeleteAccount);
  $$('.theme-opt').forEach((b) => b.addEventListener('click', () => {
    state.settings.theme = b.dataset.themeId; applyTheme(state.settings.theme);
    saveMeta({ settings: state.settings }); render();
  }));
  const models = $('#models');
  models.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.rule-row').remove(); });
  $('#addModel').addEventListener('click', () => { models.insertAdjacentHTML('beforeend', '<div class="rule-row"><input placeholder="e.g. London Raid" aria-label="Model"><button class="icon-btn" data-rm aria-label="Remove model"><svg><use href="#i-x"/></svg></button></div>'); $('.rule-row:last-child input', models).focus(); });
  $('#saveModels').addEventListener('click', () => {
    state.settings.models = [...new Set($$('input', models).map((i) => i.value.trim()).filter(Boolean))];
    saveMeta({ settings: state.settings }); toast('Models saved'); render();
  });
  $('#jsonBtn').addEventListener('click', () => {
    const data = { app: 'windage', version: 2, exportedAt: new Date().toISOString(), accounts: state.accounts, settings: state.settings, prep: state.prep, trades: state.trades.map(({ ChartImage, ...t }) => t) };
    download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `windage-backup-${todayIso()}.json`);
  });
  $('#importIn').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.trades) || !Array.isArray(data.accounts)) throw new Error('That file isn’t a Windage backup.');
      if (!confirm(`Restore ${data.trades.length} trades and ${data.accounts.length} accounts? Matching trades are overwritten; nothing is deleted.`)) return;
      const ids = new Set(state.accounts.map((a) => a.id));
      data.accounts.forEach((a) => { if (!ids.has(a.id)) state.accounts.push(a); });
      for (const t of data.trades) {
        const trade = { ...t, id: String(t.id) };
        await store.saveTrade(trade);
        const i = state.trades.findIndex((x) => String(x.id) === trade.id);
        if (i >= 0) state.trades[i] = trade; else state.trades.push(trade);
      }
      for (const [d, p] of Object.entries(data.prep || {})) { state.prep[d] = p; await store.savePrep(d, p); }
      await saveMeta({ accounts: state.accounts });
      toast(`Restored ${data.trades.length} trades`); render();
    } catch (er) { toast(er.message); }
  });
  $('#installBtn')?.addEventListener('click', async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); });
  $('#signOut').addEventListener('click', () => store.signOut());
}

function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportExcel() {
  if (!window.XLSX) { toast('Excel export needs an internet connection.'); return; }
  const tr = S.sortTrades(acctTrades());
  const wb = XLSX.utils.book_new();
  const rows = tr.map((t) => ({
    Date: t.Date, Time: t.Time, Session: t.Killzone, Instrument: t.Instrument || '', Direction: t.Direction, Contracts: S.num(t.Contracts) || '',
    Entry: S.num(t.Entry) || '', Stop: S.num(t.StopLoss) || '', Exit: S.num(t.Exit) || '', Partials: t.Partials || '', 'Minutes in trade': S.num(t.Duration) || '',
    'P&L': S.pnlOf(t), R: Number.isFinite(S.rOf(t)) ? S.rOf(t) : '', Model: t.Model || '', Grade: t.Grade, Checklist: t.ChecklistScore || '', 'Rules ticked': (t.RulesChecked || []).join('; '),
    Emotion: t.EmotionBefore || '', News: t.NewsImpact || '', Mistakes: S.mistakesOf(t).join('; '), Reflection: t.Improvement || '', 'Daily bias': S.biasRelation(t, state.prep),
  }));
  if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Trades');
  const prep = Object.entries(state.prep).sort().map(([d, p]) => ({ Date: d, Bias: p.bias || '', 'HTF PD array': p.htfArray || '', 'Draw on liquidity': p.dol || '', News: p.news || '', Plan: p.notes || '', Rating: p.rating || '', 'Went well': p.wentWell || '', 'Fix tomorrow': p.lesson || '' }));
  if (prep.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prep), 'Daily journal');
  if (!wb.SheetNames.length) { toast('Nothing to export yet'); return; }
  XLSX.writeFile(wb, `${acct().name.replace(/[^\w-]+/g, '_')}_${todayIso()}.xlsx`);
}

start();

// Pure analytics: no DOM, no Firebase. Everything here can be unit-tested in Node.

export const MISTAKE_TAGS = [
  'FOMO entry',
  'No valid setup',
  'Against daily bias',
  'Entered too early',
  'Moved / widened stop',
  'Cut winner early',
  'Held loser too long',
  'Oversized',
  'Revenge trade',
  'Traded through news',
  'Broke max trades rule',
];

// Old journals only have free-text reflections. Map them to tags so history still counts.
const LEGACY_KEYWORDS = {
  'FOMO entry': ['chase', 'chased', 'fomo', 'rush', 'rushed', 'impatient', 'patience'],
  'Cut winner early': ['cut', 'early exit', 'scared', 'panicked', 'closed early', 'left money'],
  'Moved / widened stop': ['moved stop', 'moved my stop', 'widened', 'move sl', 'moved sl'],
  'Against daily bias': ['htf', 'pd array', 'against bias', 'no bias', 'context', 'higher timeframe'],
  'Oversized': ['oversize', 'over size', 'too big', 'too many contracts', 'heavy'],
  'Revenge trade': ['revenge', 'tilt', 'win it back', 'make it back'],
};

export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

export const pnlOf = (t) => num(t.PNL) || 0;
export const rOf = (t) => num(t.RR);

export function tradeTime(t) {
  const time = t.Time && /^\d{1,2}:\d{2}/.test(t.Time) ? t.Time : '12:00';
  return new Date(`${t.Date}T${time.length === 4 ? '0' + time : time}`);
}

export function sortTrades(trades) {
  return [...trades].sort((a, b) => tradeTime(a) - tradeTime(b) || (a.id > b.id ? 1 : -1));
}

export function mistakesOf(t) {
  if (Array.isArray(t.Mistakes) && t.Mistakes.length) return t.Mistakes;
  if (Array.isArray(t.Mistakes)) return []; // explicitly logged as clean
  const text = (t.Improvement || '').toLowerCase();
  if (!text) return [];
  const found = [];
  for (const [tag, words] of Object.entries(LEGACY_KEYWORDS)) {
    if (words.some((w) => text.includes(w))) found.push(tag);
  }
  return found;
}

/* ---------- Partials / R engine ---------- */

// Accepts "19850 (2), 19865 (3)", "19850 x 2", "19850*2", "19850@2", "2 @ 19850" is NOT supported (ambiguous).
export function parsePartials(str) {
  if (!str) return [];
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\)|[x×*@]\s*(\d+(?:\.\d+)?))/gi;
  let m;
  while ((m = re.exec(str)) !== null) {
    const price = parseFloat(m[1]);
    const qty = parseFloat(m[2] ?? m[3]);
    if (Number.isFinite(price) && Number.isFinite(qty) && qty > 0) out.push({ price, qty });
  }
  return out;
}

export function realizedR({ entry, stop, exit, contracts, direction, partials }) {
  const ent = num(entry), stp = num(stop), ext = num(exit);
  const size = num(contracts) > 0 ? num(contracts) : 1;
  if (!Number.isFinite(ent) || !Number.isFinite(stp)) return NaN;
  const risk = Math.abs(ent - stp);
  if (risk === 0) return NaN;
  const long = direction !== 'Short';
  const move = (p) => (long ? p - ent : ent - p);
  let reward = 0, closed = 0;
  for (const p of parsePartials(partials)) { reward += move(p.price) * p.qty; closed += p.qty; }
  if (Number.isFinite(ext)) {
    const remaining = Math.max(size - closed, 0);
    if (remaining > 0) { reward += move(ext) * remaining; closed += remaining; }
  }
  if (closed === 0) return NaN;
  return reward / (risk * Math.max(size, closed));
}

/* ---------- Core stats ---------- */

export function coreStats(trades) {
  const t = sortTrades(trades);
  const n = t.length;
  let net = 0, grossWin = 0, grossLoss = 0, wins = 0, losses = 0;
  let peak = 0, maxDD = 0, run = 0;
  let curType = null, curCount = 0, maxWinStreak = 0, maxLossStreak = 0;
  let rSum = 0, rCount = 0, winRSum = 0, winRCount = 0;
  const days = {};
  for (const tr of t) {
    const p = pnlOf(tr);
    net += p;
    if (p > 0) { wins++; grossWin += p; } else if (p < 0) { losses++; grossLoss += -p; }
    run += p; peak = Math.max(peak, run); maxDD = Math.max(maxDD, peak - run);
    const type = p > 0 ? 'W' : p < 0 ? 'L' : null;
    if (type) {
      if (type === curType) curCount++; else { curType = type; curCount = 1; }
      if (type === 'W') maxWinStreak = Math.max(maxWinStreak, curCount);
      else maxLossStreak = Math.max(maxLossStreak, curCount);
    }
    const r = rOf(tr);
    if (Number.isFinite(r)) { rSum += r; rCount++; if (p > 0) { winRSum += r; winRCount++; } }
    days[tr.Date] = (days[tr.Date] || 0) + p;
  }
  const dayVals = Object.entries(days);
  const avgWin = wins ? grossWin / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;
  const best = dayVals.reduce((a, b) => (!a || b[1] > a[1] ? b : a), null);
  const worst = dayVals.reduce((a, b) => (!a || b[1] < a[1] ? b : a), null);
  return {
    n, wins, losses, breakeven: n - wins - losses, net, grossWin, grossLoss,
    winRate: n ? wins / n : 0,
    avgWin, avgLoss,
    payoff: avgLoss ? avgWin / avgLoss : (avgWin ? Infinity : 0),
    profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
    expectancy: n ? net / n : 0,
    avgR: rCount ? rSum / rCount : NaN,
    avgWinR: winRCount ? winRSum / winRCount : NaN,
    maxDrawdown: maxDD,
    maxWinStreak, maxLossStreak,
    currentStreak: curType ? { type: curType, count: curCount } : null,
    tradingDays: dayVals.length,
    greenDays: dayVals.filter(([, v]) => v > 0).length,
    bestDay: best ? { date: best[0], pnl: best[1] } : null,
    worstDay: worst ? { date: worst[0], pnl: worst[1] } : null,
    tradesPerDay: dayVals.length ? n / dayVals.length : 0,
  };
}

export function dailyPnl(trades) {
  const map = {};
  for (const t of trades) {
    const d = (map[t.Date] ||= { pnl: 0, n: 0 });
    d.pnl += pnlOf(t); d.n++;
  }
  return map;
}

/* ---------- Account / prop firm rules ---------- */

export function accountState(acc, trades) {
  const start = num(acc.startBal) || 0;
  const target = num(acc.targetBal) || 0;
  const limit = num(acc.trailingLimit) || 0;
  const type = acc.ddType || 'trailing';
  const lockAt = Number.isFinite(num(acc.trailLockAt)) ? num(acc.trailLockAt) : null;

  const sorted = sortTrades(trades);
  let bal = start, peak = start, eodPeak = start;
  const series = [{ label: 'Start', balance: start, threshold: start - limit }];
  const thresholdFor = (pk) => {
    if (type === 'static') return start - limit;
    let th = pk - limit;
    if (lockAt != null) th = Math.min(th, lockAt);
    return th;
  };
  sorted.forEach((t, i) => {
    bal += pnlOf(t);
    peak = Math.max(peak, bal);
    const lastOfDay = !sorted[i + 1] || sorted[i + 1].Date !== t.Date;
    if (lastOfDay) eodPeak = Math.max(eodPeak, bal);
    const th = thresholdFor(type === 'eod' ? eodPeak : peak);
    series.push({ label: `${t.Date} ${t.Time || ''}`.trim(), balance: bal, threshold: th, id: t.id });
  });
  const threshold = series[series.length - 1].threshold;
  const buffer = bal - threshold;
  const needed = target - start;
  return {
    start, target, limit, balance: bal, threshold, buffer: Math.max(buffer, 0),
    bufferPct: limit ? Math.max(0, Math.min(1, buffer / limit)) : 1,
    blown: limit > 0 && buffer <= 0,
    passed: needed > 0 && bal >= target,
    targetProgress: needed > 0 ? Math.max(0, Math.min(1, (bal - start) / needed)) : 0,
    toTarget: Math.max(target - bal, 0),
    series,
  };
}

/* ---------- Grouping ---------- */

export function bucketStats(trades) {
  const n = trades.length;
  let net = 0, wins = 0, rSum = 0, rN = 0;
  for (const t of trades) {
    const p = pnlOf(t); net += p; if (p > 0) wins++;
    const r = rOf(t); if (Number.isFinite(r)) { rSum += r; rN++; }
  }
  return { n, net, winRate: n ? wins / n : 0, expectancy: n ? net / n : 0, avgR: rN ? rSum / rN : NaN };
}

export function groupBy(trades, keyFn) {
  const groups = new Map();
  for (const t of trades) {
    const keys = [].concat(keyFn(t)).filter((k) => k != null && k !== '');
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, trades: list, ...bucketStats(list) }))
    .sort((a, b) => b.expectancy - a.expectancy);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function biasRelation(t, prep) {
  const p = prep?.[t.Date];
  if (!p || !p.bias) return 'No prep logged';
  if (p.bias.startsWith('Consolidation')) return 'Neutral day';
  const aligned = (p.bias === 'Bullish' && t.Direction === 'Long') || (p.bias === 'Bearish' && t.Direction === 'Short');
  return aligned ? 'With daily bias' : 'Against daily bias';
}

// Annotates each trade with context that depends on neighbouring trades.
export function withContext(trades) {
  const sorted = sortTrades(trades);
  const sizes = sorted.map((t) => num(t.Contracts)).filter((n) => n > 0).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : NaN;
  let idxInDay = 0;
  return sorted.map((t, i) => {
    const prev = sorted[i - 1];
    const sameDay = prev && prev.Date === t.Date;
    idxInDay = sameDay ? idxInDay + 1 : 0;
    const prevP = sameDay ? pnlOf(prev) : null;
    const gapMin = sameDay ? (tradeTime(t) - tradeTime(prev)) / 60000 : null;
    const c = num(t.Contracts);
    return {
      ...t,
      _ordinal: idxInDay,
      _after: !sameDay ? 'First trade of the day' : prevP < 0 ? 'Right after a loss' : prevP > 0 ? 'Right after a win' : 'After a breakeven',
      _quickReentry: sameDay && prevP < 0 && gapMin != null && gapMin >= 0 && gapMin <= 15,
      _oversized: Number.isFinite(c) && Number.isFinite(median) && c > median * 1.25,
      _size: c,
    };
  });
}

function hourBucket(t) {
  if (!t.Time || !/^\d{1,2}:\d{2}/.test(t.Time)) return null;
  const [h, m] = t.Time.split(':').map(Number);
  const half = m < 30 ? '00' : '30';
  const end = m < 30 ? `${h}:30` : `${h + 1}:00`;
  return `${h}:${half}–${end}`;
}

function durationBucket(t) {
  const d = num(t.Duration);
  if (!Number.isFinite(d)) return null;
  if (d < 5) return 'Under 5 min';
  if (d < 15) return '5–15 min';
  if (d < 60) return '15–60 min';
  return 'Over an hour';
}

export const DIMENSIONS = [
  { id: 'session', label: 'Session', key: (t) => t.Killzone },
  { id: 'grade', label: 'Setup grade', key: (t) => t.Grade && t.Grade !== 'N/A' ? t.Grade : null },
  { id: 'emotion', label: 'Emotion before entry', key: (t) => t.EmotionBefore },
  { id: 'direction', label: 'Direction', key: (t) => t.Direction },
  { id: 'bias', label: 'Daily bias', key: (t, ctx) => biasRelation(t, ctx.prep) },
  { id: 'weekday', label: 'Day of week', key: (t) => WEEKDAYS[new Date(t.Date + 'T12:00').getDay()] },
  { id: 'hour', label: 'Time of day', key: hourBucket },
  { id: 'news', label: 'News', key: (t) => t.NewsImpact },
  { id: 'instrument', label: 'Instrument', key: (t) => t.Instrument },
  { id: 'ordinal', label: 'Trade number of the day', key: (t) => ['1st trade', '2nd trade', '3rd trade or later'][Math.min(t._ordinal, 2)] },
  { id: 'after', label: 'What came before', key: (t) => t._after },
  { id: 'duration', label: 'Time in trade', key: durationBucket },
  { id: 'mistakes', label: 'Mistakes', key: (t) => { const m = mistakesOf(t); return m.length ? m : ['Clean execution']; } },
];

export function breakdowns(trades, prep) {
  const ctxTrades = withContext(trades);
  const ctx = { prep };
  return DIMENSIONS.map((d) => ({
    ...d,
    groups: groupBy(ctxTrades, (t) => d.key(t, ctx)),
  })).filter((d) => d.groups.length > 0);
}

/* ---------- Rule-by-rule analysis ---------- */

export function ruleImpact(trades) {
  const tracked = trades.filter((t) => Array.isArray(t.RulesChecked) && Array.isArray(t.RulesAll));
  const rules = new Set();
  tracked.forEach((t) => t.RulesAll.forEach((r) => rules.add(r)));
  return [...rules].map((rule) => {
    const relevant = tracked.filter((t) => t.RulesAll.includes(rule));
    const followed = relevant.filter((t) => t.RulesChecked.includes(rule));
    const skipped = relevant.filter((t) => !t.RulesChecked.includes(rule));
    const f = bucketStats(followed), s = bucketStats(skipped);
    return { rule, followed: f, skipped: s, adherence: relevant.length ? followed.length / relevant.length : 0, gap: f.expectancy - s.expectancy };
  }).sort((a, b) => b.gap - a.gap);
}

/* ---------- Discipline ---------- */

export function disciplineScore(trades, prep, settings = {}) {
  if (!trades.length) return null;
  const parts = [];
  const tracked = trades.filter((t) => Array.isArray(t.RulesChecked) && Array.isArray(t.RulesAll) && t.RulesAll.length);
  if (tracked.length) {
    const avg = tracked.reduce((s, t) => s + t.RulesChecked.length / t.RulesAll.length, 0) / tracked.length;
    parts.push({ label: 'Checklist followed', value: avg });
  } else {
    const scored = trades.map((t) => (t.ChecklistScore || '').split('/').map(Number)).filter(([a, b]) => b > 0);
    if (scored.length) parts.push({ label: 'Checklist followed', value: scored.reduce((s, [a, b]) => s + a / b, 0) / scored.length });
  }
  const biasKnown = trades.map((t) => biasRelation(t, prep)).filter((r) => r === 'With daily bias' || r === 'Against daily bias');
  if (biasKnown.length) parts.push({ label: 'Traded with your bias', value: biasKnown.filter((r) => r === 'With daily bias').length / biasKnown.length });
  parts.push({ label: 'Trades with no mistakes', value: trades.filter((t) => mistakesOf(t).length === 0).length / trades.length });
  const calm = trades.filter((t) => t.EmotionBefore);
  if (calm.length) parts.push({ label: 'Calm or patient entries', value: calm.filter((t) => /calm|patient/i.test(t.EmotionBefore)).length / calm.length });
  const maxT = num(settings.maxTradesPerDay);
  if (maxT > 0) {
    const d = Object.values(dailyPnl(trades));
    parts.push({ label: `Days within ${maxT} trade${maxT > 1 ? 's' : ''}`, value: d.filter((x) => x.n <= maxT).length / d.length });
  }
  const score = Math.round((parts.reduce((s, p) => s + p.value, 0) / parts.length) * 100);
  return { score, parts };
}

/* ---------- Periods ---------- */

export function weekStart(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function tradesInRange(trades, from, to) {
  const a = isoDate(from), b = isoDate(to);
  return trades.filter((t) => t.Date >= a && t.Date <= b);
}

export function periodPnl(trades, now = new Date()) {
  const ws = weekStart(now);
  const we = new Date(ws); we.setDate(ws.getDate() + 6);
  const ms = new Date(now.getFullYear(), now.getMonth(), 1);
  const me = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const sum = (l) => l.reduce((s, t) => s + pnlOf(t), 0);
  const today = trades.filter((t) => t.Date === isoDate(now));
  return {
    today: sum(today), todayCount: today.length,
    week: sum(tradesInRange(trades, ws, we)),
    month: sum(tradesInRange(trades, ms, me)),
  };
}

export function rDistribution(trades) {
  const edges = [-Infinity, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, Infinity];
  const labels = ['< -1.5R', '-1.5 to -1R', '-1 to -0.5R', '-0.5 to 0R', '0 to 0.5R', '0.5 to 1R', '1 to 1.5R', '1.5 to 2R', '2 to 3R', '3R +'];
  const counts = labels.map(() => 0);
  for (const t of trades) {
    const r = rOf(t); if (!Number.isFinite(r)) continue;
    for (let i = 0; i < labels.length; i++) if (r >= edges[i] && r < edges[i + 1]) { counts[i]++; break; }
  }
  return { labels, counts };
}

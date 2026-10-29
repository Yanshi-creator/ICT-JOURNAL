// Turns the numbers from stats.js into plain-language coaching, ranked by how much money is at stake.
import {
  coreStats, bucketStats, breakdowns, ruleImpact, withContext, biasRelation, mistakesOf,
  pnlOf, dailyPnl, disciplineScore, weekStart, tradesInRange, isoDate, num,
} from './stats.js';

const money = (v) => `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const plain = (v) => `$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const per = (v) => `${money(v)} per trade`;

const MIN_BUCKET = 3;

// How a bucket reads in a sentence, by dimension.
const NAME = {
  session: (k) => k,
  grade: (k) => `${k} setups`,
  emotion: (k) => `Entering while ${k.toLowerCase()}`,
  direction: (k) => `${k} trades`,
  bias: (k) => k === 'No prep logged' ? 'Trading without pre-market prep' : k === 'Neutral day' ? 'Trading on neutral-bias days' : `Trading ${k.toLowerCase()}`,
  weekday: (k) => `${k}s`,
  hour: (k) => `Entries between ${k}`,
  news: (k) => /low|none/i.test(k) ? 'No-news days' : `${k.replace(' Impact', '-impact')} news days`,
  instrument: (k) => `${k} trades`,
  ordinal: (k) => `Your ${k}`,
  after: (k) => k === 'First trade of the day' ? 'Your first trade of the day' : `Trading ${k.toLowerCase()}`,
  duration: (k) => `Trades lasting ${k.toLowerCase()}`,
};
const nameOf = (dim, k) => (NAME[dim] ? NAME[dim](k) : k);

const TAG_ACTIONS = {
  'FOMO entry': 'If price already left without you, it is gone. Wait for the next setup or the next day.',
  'No valid setup': 'Write your model in one sentence and pin it above your screen. No match, no trade.',
  'Against daily bias': 'Only take trades in the direction of your pre-market bias.',
  'Entered too early': 'Wait for the candle to close and confirm the displacement before entering.',
  'Moved / widened stop': 'Your stop is placed before entry and only ever moves toward profit.',
  'Cut winner early': 'Leave one contract running to the draw on liquidity you marked in prep.',
  'Held loser too long': 'When price closes through your invalidation, you are out. No hoping.',
  'Oversized': 'Pick one size per account and stick to it for 20 trades.',
  'Revenge trade': 'After any loss, start a 30-minute timer before you can look at the chart again.',
  'Traded through news': 'Be flat 5 minutes before and after red-folder news.',
  'Broke max trades rule': 'When you hit your trade limit, close the platform.',
};
const SOLID = 10;
const confidence = (n) => (n >= SOLID ? 'solid' : 'early');

// What to actually do about a weak bucket, by dimension.
const ACTIONS = {
  session: (k) => `Sit out ${k} for the next two weeks, or drop to minimum size there until it turns positive.`,
  grade: (k) => `Make ${k} setups a no-trade. If it isn't an A, it's a pass.`,
  emotion: (k) => `When you notice “${k}”, take your hands off the mouse for 5 minutes and re-check the checklist before entering.`,
  direction: (k) => `Your ${k.toLowerCase()}s need a higher bar. Require full HTF alignment before taking one.`,
  bias: (k) => k === 'Against daily bias' ? 'Only take trades in the direction of your pre-market bias. Write the bias down before the open, every day.' : k === 'No prep logged' ? 'Do your pre-market prep before every session. Unprepared days are your weakest.' : 'On neutral days, cut size in half or skip the session.',
  weekday: (k) => `Treat ${k} as a half-size day, or review what's different about it.`,
  hour: (k) => `Avoid entries between ${k}. Set a phone alarm as a reminder.`,
  news: (k) => `Stay flat around ${k.toLowerCase()} releases. Mark them in your pre-market prep.`,
  instrument: (k) => `Pause ${k} and focus on the market where your edge is proven.`,
  ordinal: (k) => k === '1st trade' ? 'Your first entry is the problem. Wait for one more confirmation before the first trade.' : `Stop after your ${k === '2nd trade' ? 'first' : 'second'} trade. Set a hard daily trade limit in settings.`,
  after: (k) => k === 'Right after a loss' ? 'After a loss, walk away for 30 minutes minimum before another entry.' : k === 'Right after a win' ? 'After a win, you get careless. Consider ending the day on a green trade.' : 'Review these trades as a group.',
  duration: (k) => `Trades lasting ${k.toLowerCase()} are losing. Review whether you're exiting too fast or holding hope.`,
  mistakes: (k) => TAG_ACTIONS[k] || 'Review these trades as a group.',
};

function bucketLeaks(dims, overall) {
  const out = [];
  for (const d of dims) {
    if (d.id === 'mistakes') continue; // handled separately
    if (d.groups.length < 2) continue;
    for (const g of d.groups) {
      if (g.n < MIN_BUCKET || g.net >= 0) continue;
      const ids = new Set(g.trades.map((t) => String(t.id)));
      const rest = bucketStats(overall.filter((t) => !ids.has(String(t.id))));
      if (rest.n && g.expectancy >= rest.expectancy) continue;
      out.push({
        kind: 'leak', dimension: d.label, impact: -g.net, n: g.n, confidence: confidence(g.n),
        title: `${nameOf(d.id, g.key)} cost you ${plain(g.net)}`, ids: g.trades.map((t) => String(t.id)),
        body: `${g.n} trades, ${pct(g.winRate)} win rate, ${per(g.expectancy)}. Everything else averages ${per(rest.expectancy)}.`,
        action: ACTIONS[d.id]?.(g.key) || 'Review these trades together and look for what they share.',
      });
    }
  }
  return out;
}

function edges(dims) {
  const out = [];
  for (const d of dims) {
    if (['mistakes', 'after', 'ordinal', 'news'].includes(d.id) || d.groups.length < 2) continue;
    const best = d.groups[0];
    if (best.n < 4 || best.expectancy <= 0) continue;
    const second = d.groups[1];
    if (second && best.expectancy < second.expectancy * 1.3 && second.expectancy > 0) continue;
    out.push({
      kind: 'edge', dimension: d.label, impact: best.net, n: best.n, confidence: confidence(best.n),
      title: `Your edge: ${nameOf(d.id, best.key).replace(/^Your /, '')}`,
      body: `${best.n} trades, ${pct(best.winRate)} win rate, ${per(best.expectancy)}${Number.isFinite(best.avgR) ? `, averaging ${best.avgR.toFixed(2)}R` : ''}.`,
      action: 'Size up here first when you scale. Protect this.',
    });
  }
  return out.sort((a, b) => b.impact - a.impact).slice(0, 3);
}

function whatIfs(trades, prep) {
  const actual = trades.reduce((s, t) => s + pnlOf(t), 0);
  const ctx = withContext(trades);
  const scenarios = [
    { id: 'aOnly', title: 'Only A and A+ setups', keep: (t) => /^A/.test(t.Grade || '') },
    { id: 'withBias', title: 'Skip trades against your daily bias', keep: (t) => biasRelation(t, prep) !== 'Against daily bias' },
    { id: 'calm', title: 'Skip FOMO and anxious entries', keep: (t) => !/fomo|anxious|rushed/i.test(t.EmotionBefore || '') },
    { id: 'first', title: 'Stop after one trade a day', keep: (t) => t._ordinal === 0 },
    { id: 'twoMax', title: 'Stop after two trades a day', keep: (t) => t._ordinal <= 1 },
    { id: 'noLossFollow', title: 'Never trade right after a loss', keep: (t) => t._after !== 'Right after a loss' },
    { id: 'clean', title: 'Skip every trade with a mistake tag', keep: (t) => mistakesOf(t).length === 0 },
  ];
  return scenarios.map((s) => {
    const kept = ctx.filter(s.keep);
    const removed = ctx.length - kept.length;
    const net = kept.reduce((a, t) => a + pnlOf(t), 0);
    return { ...s, net, delta: net - actual, removed, kept: kept.length, stats: bucketStats(kept) };
  }).filter((s) => s.removed > 0 && s.kept > 0).sort((a, b) => b.delta - a.delta);
}

function ruleLeaks(trades) {
  return ruleImpact(trades)
    .filter((r) => r.skipped.n >= MIN_BUCKET && r.followed.n >= MIN_BUCKET && r.gap > 0 && r.skipped.net < 0)
    .map((r) => ({
      kind: 'leak', dimension: 'Checklist', impact: -r.skipped.net, n: r.skipped.n, confidence: confidence(r.skipped.n),
      title: `Skipping “${r.rule}” costs you ${plain(r.skipped.net)}`,
      body: `When you follow it: ${per(r.followed.expectancy)} (${r.followed.n} trades). When you skip it: ${per(r.skipped.expectancy)} (${r.skipped.n} trades). You follow it ${pct(r.adherence)} of the time.`,
      action: 'Make this rule non-negotiable. No tick, no trade.',
    }));
}

function mistakeLeaks(trades) {
  const totals = {};
  for (const t of trades) for (const m of mistakesOf(t)) {
    const x = (totals[m] ||= { n: 0, net: 0, lost: 0 });
    x.n++; x.net += pnlOf(t); if (pnlOf(t) < 0) x.lost += -pnlOf(t);
  }
  return Object.entries(totals)
    .filter(([, x]) => x.n >= 2 && x.net < 0)
    .map(([tag, x]) => ({
      kind: 'leak', dimension: 'Mistakes', impact: -x.net, n: x.n, confidence: confidence(x.n),
      title: `“${tag}” has cost you ${plain(x.net)}`, ids: trades.filter((t) => mistakesOf(t).includes(tag)).map((t) => String(t.id)),
      body: `Tagged on ${x.n} trades, netting ${per(x.net / x.n)}.`,
      action: TAG_ACTIONS[tag] || `Add “${tag}” to the top of your checklist as a warning.`,
    }));
}

function behaviourFlags(trades, settings) {
  const out = [];
  const ctx = withContext(trades);
  const s = coreStats(trades);

  // Revenge / quick re-entry
  const quick = ctx.filter((t) => t._quickReentry);
  if (quick.length >= 2) {
    const b = bucketStats(quick);
    if (b.net < 0) out.push({
      kind: 'leak', dimension: 'Tilt', impact: -b.net, n: b.n, confidence: confidence(b.n),
      title: `Re-entering within 15 minutes of a loss: ${money(b.net)}`,
      body: `${b.n} quick re-entries, ${pct(b.winRate)} win rate. That's the revenge pattern.`,
      action: 'After any loss, start a 30-minute timer before you can look at the chart again.',
    });
  }

  // Sizing up after losses
  const afterLoss = ctx.filter((t) => t._after === 'Right after a loss' && t._size > 0);
  const others = ctx.filter((t) => t._after !== 'Right after a loss' && t._size > 0);
  if (afterLoss.length >= 3 && others.length >= 3) {
    const a = afterLoss.reduce((x, t) => x + t._size, 0) / afterLoss.length;
    const o = others.reduce((x, t) => x + t._size, 0) / others.length;
    if (a > o * 1.2) out.push({
      kind: 'warn', dimension: 'Sizing', impact: Math.max(0, -bucketStats(afterLoss).net), n: afterLoss.length, confidence: confidence(afterLoss.length),
      title: 'You size up after losing',
      body: `Average ${a.toFixed(1)} contracts right after a loss vs ${o.toFixed(1)} otherwise.`,
      action: 'Lock your size before the session. After a loss, size can only go down.',
    });
  }

  // Oversized trades
  const big = ctx.filter((t) => t._oversized);
  if (big.length >= 3) {
    const b = bucketStats(big);
    if (b.net < 0) out.push({
      kind: 'leak', dimension: 'Sizing', impact: -b.net, n: b.n, confidence: confidence(b.n),
      title: `Your bigger-than-usual trades lost ${plain(b.net)}`,
      body: `${b.n} trades above your normal size, ${pct(b.winRate)} win rate.`,
      action: 'Pick one size per account and stick to it for 20 trades.',
    });
  }

  // Overtrading days
  const days = dailyPnl(trades);
  const busy = Object.values(days).filter((d) => d.n >= 3);
  const quiet = Object.values(days).filter((d) => d.n <= 2);
  if (busy.length >= 2 && quiet.length >= 2) {
    const busyAvg = busy.reduce((x, d) => x + d.pnl, 0) / busy.length;
    const quietAvg = quiet.reduce((x, d) => x + d.pnl, 0) / quiet.length;
    if (busyAvg < quietAvg && busyAvg < 0) out.push({
      kind: 'leak', dimension: 'Overtrading', impact: -busyAvg * busy.length, n: busy.length, confidence: confidence(busy.length * 2),
      title: 'Days with 3+ trades are red days',
      body: `${busy.length} days with 3 or more trades average ${money(busyAvg)}. Days with 1–2 trades average ${money(quietAvg)}.`,
      action: `Set a max of ${num(settings?.maxTradesPerDay) > 0 ? settings.maxTradesPerDay : 2} trades a day in settings and stop when you hit it.`,
    });
  }

  // Payoff math
  if (s.wins >= 3 && s.losses >= 3 && s.payoff < 1) {
    const need = 1 / (1 + s.payoff);
    out.push({
      kind: s.winRate >= need ? 'info' : 'leak', dimension: 'Risk/reward', impact: s.winRate >= need ? 0 : Math.abs(s.net), n: s.n, confidence: confidence(s.n),
      title: 'Your losses are bigger than your wins',
      body: `Average win ${plain(s.avgWin)} vs average loss ${plain(s.avgLoss)}. At this ratio you need a ${pct(need)} win rate to break even; you're at ${pct(s.winRate)}.`,
      action: 'Either hold winners to your full target or cut losers faster. Check your “Cut winner early” and “Held loser too long” tags.',
    });
  }
  if (Number.isFinite(s.avgWinR) && s.wins >= 3 && s.avgWinR < 1) out.push({
    kind: 'warn', dimension: 'Exits', impact: 0, n: s.wins, confidence: confidence(s.wins),
    title: `Your winners only average ${s.avgWinR.toFixed(2)}R`,
    body: 'You are taking profit before the trade pays for its risk.',
    action: 'Leave at least one contract running to the draw on liquidity you marked in prep.',
  });

  // Live state
  if (s.currentStreak?.type === 'L' && s.currentStreak.count >= 3) out.push({
    kind: 'warn', dimension: 'Right now', impact: Infinity, n: s.currentStreak.count, confidence: 'solid',
    title: `${s.currentStreak.count} losses in a row`,
    body: 'Streaks like this are when accounts get blown.',
    action: 'Take tomorrow off or trade sim only. Come back with your checklist fresh.',
  });
  return out;
}

export function buildCoach(trades, { prep = {}, settings = {}, account = null, accountState = null } = {}) {
  if (!trades.length) return { empty: true };
  const dims = breakdowns(trades, prep);
  const ctxTrades = dims.length ? withContext(trades) : trades;
  const leaks = [
    ...bucketLeaks(dims, ctxTrades),
    ...ruleLeaks(trades),
    ...mistakeLeaks(trades),
    ...behaviourFlags(trades, settings),
  ];
  // De-duplicate leaks that describe the same trades (e.g. "Against daily bias" from bias + mistake tag)
  const seen = new Set();
  const ranked = leaks
    .sort((a, b) => b.impact - a.impact)
    .filter((l) => { const k = l.ids ? [...l.ids].sort().join(',') : l.title; if (seen.has(k)) return false; seen.add(k); return true; });

  const scenarios = whatIfs(trades, prep);
  const stats = coreStats(trades);
  const discipline = disciplineScore(trades, prep, settings);

  let headline;
  if (accountState?.blown) headline = 'This account has hit its drawdown limit. Review before trading it again.';
  else if (stats.n < 5) headline = `Only ${stats.n} trade${stats.n === 1 ? '' : 's'} logged. Patterns get reliable after about 20, so keep logging.`;
  else if (ranked[0] && ranked[0].impact !== Infinity && scenarios[0]?.delta > 0) headline = `Biggest leak: ${ranked[0].title.charAt(0).toLowerCase() + ranked[0].title.slice(1)}. ${scenarios[0].title} would have changed your result by ${money(scenarios[0].delta)}.`;
  else if (ranked[0]) headline = ranked[0].title + '.';
  else headline = `${stats.n} trades, ${money(stats.net)} net. No major leaks found. Keep doing what you're doing.`;

  return { empty: false, headline, leaks: ranked, edges: edges(dims), scenarios, stats, discipline, dims };
}

export function weeklyReview(trades, prep, settings, now = new Date()) {
  const ws = weekStart(now);
  const we = new Date(ws); we.setDate(ws.getDate() + 6);
  const pws = new Date(ws); pws.setDate(ws.getDate() - 7);
  const pwe = new Date(ws); pwe.setDate(ws.getDate() - 1);
  const cur = tradesInRange(trades, ws, we);
  const prev = tradesInRange(trades, pws, pwe);
  const c = coreStats(cur), p = coreStats(prev);
  const dc = disciplineScore(cur, prep, settings), dp = disciplineScore(prev, prep, settings);
  const tags = {};
  cur.forEach((t) => mistakesOf(t).forEach((m) => { tags[m] = (tags[m] || 0) + 1; }));
  const topMistake = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
  const best = [...cur].sort((a, b) => pnlOf(b) - pnlOf(a))[0];
  const prepDays = Object.keys(prep || {}).filter((d) => d >= isoDate(ws) && d <= isoDate(we)).length;
  const tradeDays = new Set(cur.map((t) => t.Date)).size;
  return {
    range: [isoDate(ws), isoDate(we)],
    current: c, previous: p,
    discipline: dc?.score ?? null, prevDiscipline: dp?.score ?? null,
    topMistake: topMistake ? { tag: topMistake[0], count: topMistake[1] } : null,
    best: best && pnlOf(best) > 0 ? best : null,
    prepDays, tradeDays,
  };
}

export function guardrails(trades, settings = {}, today = isoDate(new Date())) {
  const t = trades.filter((x) => x.Date === today);
  const pnl = t.reduce((s, x) => s + pnlOf(x), 0);
  const maxT = num(settings.maxTradesPerDay);
  const maxL = num(settings.dailyLossLimit);
  const alerts = [];
  if (maxL > 0 && pnl <= -maxL) alerts.push(`You've hit your ${plain(maxL)} daily loss limit. Done for today.`);
  else if (maxL > 0 && pnl <= -maxL * 0.7) alerts.push(`You're ${plain(maxL + pnl)} from your daily loss limit.`);
  if (maxT > 0 && t.length >= maxT) alerts.push(`That's ${t.length} of ${maxT} trades today. You're done.`);
  const last = [...t].sort((a, b) => (a.Time || '').localeCompare(b.Time || '')).pop();
  if (last && pnlOf(last) < 0 && !alerts.length) alerts.push('Last trade was a loss. Take 30 minutes before the next one.');
  return { count: t.length, pnl, alerts };
}

export { money, pct, plain };

// Repeat-mistake detection. Pure functions: no DOM, no Firebase.
// Finds the mistakes you keep making, when they tend to happen, what they cost,
// whether they're getting better or worse, and what you keep writing to yourself.

import { mistakesOf, pnlOf, withContext, sortTrades, isoDate } from './stats.js';

const DAY = 86400000;
const dayOf = (iso) => new Date(iso + 'T12:00');
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

// Contexts a mistake can cluster in, phrased for a sentence: "usually happens <phrase>".
const CONTEXTS = [
  { id: 'after', key: (t) => t._after, phrase: (k) => ({ 'Right after a loss': 'right after a loss', 'Right after a win': 'right after a win', 'First trade of the day': 'on your first trade of the day', 'After a breakeven': 'after a breakeven trade' }[k] || null) },
  { id: 'ordinal', key: (t) => (t._ordinal >= 1 ? 'later' : null), phrase: () => 'on your second trade of the day or later' },
  { id: 'session', key: (t) => t.Killzone, phrase: (k) => (k && k !== 'Other' ? `in the ${k}` : null) },
  { id: 'emotion', key: (t) => t.EmotionBefore, phrase: (k) => (k ? `when you feel ${k.split(' / ')[0].toLowerCase()} before entering` : null) },
  { id: 'weekday', key: (t) => WEEKDAYS[dayOf(t.Date).getDay()], phrase: (k) => `on ${k}` },
  { id: 'model', key: (t) => t.Model, phrase: (k) => (k ? `on ${k} setups` : null) },
  { id: 'size', key: (t) => (t._oversized ? 'big' : null), phrase: () => 'when you size up' },
  { id: 'news', key: (t) => (t.NewsImpact === 'High Impact' ? 'news' : null), phrase: () => 'on high-impact news days' },
];

/** The context a mistake over-indexes on. Needs ≥2 hits, ≥50% of its trades, and 1.3× the normal rate. */
function triggerFor(tag, mistakeTrades, all) {
  let best = null;
  const own = tag.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  for (const c of CONTEXTS) {
    const counts = {};
    mistakeTrades.forEach((t) => { const k = c.key(t); if (k) counts[k] = (counts[k] || 0) + 1; });
    for (const [k, hits] of Object.entries(counts)) {
      const share = hits / mistakeTrades.length;
      const base = all.filter((t) => c.key(t) === k).length / all.length;
      const lift = base ? share / base : 0;
      const phrase = c.phrase(k);
      if (!phrase || hits < 2 || share < 0.5 || lift < 1.3) continue;
      if (own.some((w) => phrase.includes(w))) continue; // "FOMO entry" isn't explained by feeling FOMO
      const score = share * Math.min(lift, 4);
      if (!best || score > best.score) best = { phrase, hits, of: mistakeTrades.length, score };
    }
  }
  return best;
}

/** Which mistake most often shows up on your next trade the same day. */
function followedBy(tag, ctx) {
  const next = {};
  let base = 0;
  ctx.forEach((t, i) => {
    const n = ctx[i + 1];
    if (!n || n.Date !== t.Date || !mistakesOf(t).includes(tag)) return;
    base++;
    mistakesOf(n).forEach((m) => { next[m] = (next[m] || 0) + 1; });
  });
  const top = Object.entries(next).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? { tag: top[0], n: top[1], of: base } : null;
}

/**
 * One entry per mistake you've made at least twice, most expensive first.
 * { tag, n, cost (net P&L of those trades), last30, prev30, trend, lastDate, cleanTrades, trigger, chain }
 */
export function repeatMistakes(trades, now = new Date()) {
  const reviewed = trades.filter((t) => !(t.imported && !t.reviewed));
  if (!reviewed.length) return [];
  const ctx = withContext(reviewed);
  const sorted = sortTrades(ctx);
  const cut30 = isoDate(new Date(+now - 30 * DAY)), cut60 = isoDate(new Date(+now - 60 * DAY));
  const tags = {};
  sorted.forEach((t) => mistakesOf(t).forEach((m) => { (tags[m] ||= []).push(t); }));
  return Object.entries(tags)
    .filter(([, list]) => list.length >= 2)
    .map(([tag, list]) => {
      const last30 = list.filter((t) => t.Date >= cut30).length;
      const prev30 = list.filter((t) => t.Date >= cut60 && t.Date < cut30).length;
      const last = list[list.length - 1];
      const lastIdx = sorted.indexOf(last);
      return {
        tag, n: list.length,
        cost: list.reduce((s, t) => s + pnlOf(t), 0),
        losses: list.filter((t) => pnlOf(t) < 0).length,
        last30, prev30,
        trend: last30 > prev30 ? 'worse' : last30 < prev30 ? 'better' : 'same',
        lastDate: last.Date,
        cleanTrades: sorted.length - 1 - lastIdx,
        trigger: triggerFor(tag, list, ctx),
        chain: followedBy(tag, sorted),
        ids: list.map((t) => String(t.id)),
      };
    })
    .sort((a, b) => a.cost - b.cost || b.n - a.n);
}

/** Short, specific sentence for a repeat mistake, e.g. for the dashboard or the trade form. */
export function mistakeSentence(m) {
  const parts = [`“${m.tag}” ${m.last30 ? `${m.last30} time${m.last30 === 1 ? '' : 's'} in the last 30 days` : `${m.n} times`}`];
  if (m.trigger) parts.push(`usually ${m.trigger.phrase} (${m.trigger.hits} of ${m.trigger.of})`);
  return parts.join(', ');
}

/** What a just-saved trade's mistakes mean, given the history before it. */
export function mistakeEcho(trade, trades, now = new Date()) {
  const tags = mistakesOf(trade);
  if (!tags.length) return null;
  const cut30 = isoDate(new Date(+now - 30 * DAY));
  const others = trades.filter((t) => String(t.id) !== String(trade.id));
  const lines = tags.map((tag) => {
    const prior = others.filter((t) => mistakesOf(t).includes(tag));
    const recent = prior.filter((t) => t.Date >= cut30).length + 1;
    const cost = prior.reduce((s, t) => s + pnlOf(t), 0) + pnlOf(trade);
    if (!prior.length) return { tag, n: 1, text: `First time you've tagged “${tag}”. Note what led to it.` };
    const ord = recent === 2 ? '2nd' : recent === 3 ? '3rd' : `${recent}th`;
    return { tag, n: recent, text: `That's your ${ord} “${tag}” in 30 days. All of them together: ${cost < 0 ? '−' : '+'}$${Math.abs(Math.round(cost)).toLocaleString('en-US')}.` };
  });
  return lines.sort((a, b) => b.n - a.n)[0];
}

const STOP = new Set('a an the and or but if then so to of in on at for with from by as is was were be been am are it its this that these those i im i\'m me my we you your he she they them our not no too very just only also more less than up down out into over again once there here when what which who how all any each few some such can could would should will shall do did does done have has had having get got go went going trade trades trading take took taking day today tomorrow time next same one two'.split(' '));

/**
 * Phrases you keep writing in reflections and reviews (2–5 words, in 3+ separate notes).
 * Returns [{ phrase, n, net }] — net is the P&L of the trades whose notes contain it (null for review-only notes).
 */
export function recurringPhrases(trades, prep = {}, limit = 4) {
  const notes = [
    ...trades.filter((t) => (t.Improvement || '').trim()).map((t) => ({ text: t.Improvement, pnl: pnlOf(t) })),
    ...Object.values(prep).flatMap((p) => [p.lesson, p.wentWell].filter(Boolean).map((text) => ({ text, pnl: null }))),
  ];
  const seen = {};
  notes.forEach((note, idx) => {
    const words = note.text.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+(?:[:.][0-9]+)?/g) || [];
    const grams = new Set();
    for (let size = 5; size >= 2; size--) {
      for (let i = 0; i + size <= words.length; i++) {
        const g = words.slice(i, i + size);
        if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue;
        if (g.filter((w) => !STOP.has(w)).length < 2 && size === 2) continue;
        grams.add(g.join(' '));
      }
    }
    grams.forEach((g) => { (seen[g] ||= { notes: new Set(), net: 0, priced: 0 }); if (!seen[g].notes.has(idx)) { seen[g].notes.add(idx); if (note.pnl != null) { seen[g].net += note.pnl; seen[g].priced++; } } });
  });
  const found = Object.entries(seen)
    .filter(([, x]) => x.notes.size >= 3)
    .map(([phrase, x]) => ({ phrase, n: x.notes.size, net: x.priced ? x.net : null }))
    .sort((a, b) => b.n - a.n || b.phrase.length - a.phrase.length);
  // Drop phrases contained in a longer phrase that appears just as often.
  // Fragments of one repeated sentence share the same notes: keep only the longest of them.
  const out = [], sigs = new Set();
  found.sort((a, b) => b.n - a.n || b.phrase.length - a.phrase.length);
  for (const f of found) {
    const sig = [...seen[f.phrase].notes].join(',');
    if (sigs.has(sig) || out.some((o) => o.phrase.includes(f.phrase))) continue;
    sigs.add(sig); out.push(f);
  }
  return out.slice(0, limit);
}

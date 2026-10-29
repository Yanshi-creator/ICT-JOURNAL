// Realistic sample journal for demo mode (?demo). Seeded so it looks the same every load.
import { isoDate } from './stats.js';

export const DEFAULT_CHECKLIST = [
  'Wait 15 min after market open',
  'One trade per day limit respected',
  'HTF PD array alignment confirmed',
  'iFVG on execution timeframe',
  'Clear draw on liquidity',
  'Stop beyond swing high/low',
  'Minimum 1:1.3 RR available',
];

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

export function demoData(now = new Date()) {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const accounts = [
    { id: 'demo_eval', name: 'Apex 50K Eval', firm: 'Apex', type: 'Evaluation', startBal: 50000, targetBal: 53000, trailingLimit: 2500, ddType: 'trailing', trailLockAt: 50100 },
    { id: 'demo_pa', name: 'Topstep XFA', firm: 'Topstep', type: 'Funded', startBal: 50000, targetBal: 52000, trailingLimit: 2000, ddType: 'eod' },
  ];
  const trades = [], prep = {};
  const start = new Date(now); start.setDate(start.getDate() - 62);
  let id = 1;
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    if (r() < 0.18) continue;
    const date = isoDate(d);
    const bias = pick(['Bullish', 'Bullish', 'Bearish', 'Bearish', 'Consolidation / Neutral']);
    if (r() < 0.8) prep[date] = {
      bias, htfArray: pick(['4H bullish FVG tapped', 'Daily OB respected', '1H iFVG inversion', 'Weekly gap fill']),
      dol: pick(['PDH buy-side', 'Asia low sell-side', 'London high', 'Relative equal lows']),
      news: pick(['', '8:30 CPI', '10:00 ISM', '']), notes: 'Wait for displacement after 9:45.',
    };
    const nTrades = r() < 0.6 ? 1 : r() < 0.7 ? 2 : 3;
    let lastLoss = false;
    for (let k = 0; k < nTrades; k++) {
      const session = k === 0 ? pick(['NY AM Session', 'NY AM Session', 'London Open', 'Macro', 'NY PM Session']) : pick(['NY AM Session', 'NY PM Session', 'NY PM Session']);
      const hour = { 'London Open': 3, 'NY AM Session': 9, 'Macro': 10, 'NY PM Session': 13 }[session];
      const minute = session === 'NY AM Session' ? 35 + Math.floor(r() * 50) : Math.floor(r() * 59);
      const h = hour + Math.floor(minute / 60) + k, m = minute % 60;
      const direction = prep[date] && r() < 0.75 ? (bias === 'Bearish' ? 'Short' : 'Long') : pick(['Long', 'Short']);
      const against = prep[date] && bias !== 'Consolidation / Neutral' && ((bias === 'Bullish') !== (direction === 'Long'));
      const emotion = lastLoss ? pick(['FOMO / Rushed', 'Anxious', 'Calm / Focused']) : pick(['Calm / Focused', 'Calm / Focused', 'Patient', 'FOMO / Rushed']);
      const rulesChecked = DEFAULT_CHECKLIST.filter(() => r() < (lastLoss ? 0.55 : 0.82));
      const ratio = rulesChecked.length / DEFAULT_CHECKLIST.length;
      const grade = ratio === 1 ? 'A+' : ratio >= 0.85 ? 'A' : ratio >= 0.7 ? 'B+' : ratio >= 0.55 ? 'B' : ratio >= 0.4 ? 'C+' : 'C';
      let edge = 0.52 + (ratio - 0.7) * 0.6 - (against ? 0.22 : 0) - (session === 'NY PM Session' ? 0.2 : 0) - (lastLoss ? 0.15 : 0) + (session === 'NY AM Session' ? 0.08 : 0);
      const win = r() < edge;
      const contracts = lastLoss && r() < 0.5 ? 4 : pick([2, 2, 3]);
      const entry = 19800 + Math.round(r() * 600) + 0.25 * Math.floor(r() * 4);
      const riskPts = pick([10, 12, 15, 20]);
      const stop = direction === 'Long' ? entry - riskPts : entry + riskPts;
      const rMult = win ? +(1 + r() * 2.2).toFixed(2) : -(0.6 + r() * 0.45).toFixed(2);
      const exitMove = rMult * riskPts;
      const exit = direction === 'Long' ? entry + exitMove : entry - exitMove;
      const pnl = Math.round(rMult * riskPts * 20 * contracts * 0.25); // MNQ-ish scale
      const mistakes = [];
      if (!win && emotion.startsWith('FOMO')) mistakes.push('FOMO entry');
      if (against) mistakes.push('Against daily bias');
      if (lastLoss && r() < 0.6) mistakes.push('Revenge trade');
      if (!win && r() < 0.15) mistakes.push('Moved / widened stop');
      if (win && rMult < 1.3 && r() < 0.6) mistakes.push('Cut winner early');
      trades.push({
        id: String(id++), accountId: r() < 0.8 ? 'demo_eval' : 'demo_pa', Date: date,
        Time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        Killzone: session, Direction: direction, Contracts: String(contracts), Instrument: pick(['NQ', 'NQ', 'MNQ', 'ES']),
        NewsImpact: prep[date]?.news ? 'High Impact' : 'Low / None', EmotionBefore: emotion,
        Duration: String(Math.round(3 + r() * 40)),
        RulesAll: [...DEFAULT_CHECKLIST], RulesChecked: rulesChecked,
        Setups: `${rulesChecked.length}/${DEFAULT_CHECKLIST.length} rules met`, ChecklistScore: `${rulesChecked.length}/${DEFAULT_CHECKLIST.length}`,
        Grade: grade, Entry: String(entry), StopLoss: String(stop), Exit: String(exit), Partials: '', RR: rMult, PNL: pnl,
        Mistakes: mistakes,
        Improvement: win ? pick(['Followed the plan.', 'Could have held to DOL.', '']) : pick(['Entered before displacement confirmed.', 'Should have waited for the iFVG.', 'Took it out of boredom.', '']),
      });
      lastLoss = pnl < 0;
      if (k === 0 && win && r() < 0.5) break;
    }
  }
  return {
    accounts, activeAccountId: 'demo_eval', trades, prep,
    settings: { checklist: [...DEFAULT_CHECKLIST], maxTradesPerDay: 2, dailyLossLimit: 600, instruments: ['NQ', 'MNQ', 'ES', 'MES'] },
    profile: { displayName: 'Demo trader' },
  };
}

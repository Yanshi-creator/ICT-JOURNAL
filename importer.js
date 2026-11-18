// Broker CSV import. Pure functions: parse a CSV, guess which column is which,
// and turn each row into a Windage trade. Works with one-row-per-trade exports
// (Tradovate Performance, NinjaTrader Trades, TopstepX, Rithmic/R|Trader, most others).

export const FIELDS = [
  { id: 'entryTime', label: 'Entry time', required: true, names: ['entrytime', 'enteredat', 'opentime', 'opened', 'entrydate', 'entrydatetime', 'opendate', 'timeentered', 'starttime', 'datetime', 'tradedate', 'date', 'time'] },
  { id: 'exitTime', label: 'Exit time', names: ['exittime', 'exitedat', 'closetime', 'closed', 'exitdate', 'exitdatetime', 'closedate', 'timeexited', 'endtime'] },
  { id: 'buyTime', label: 'Buy time', names: ['boughttimestamp', 'buytime', 'buytimestamp', 'buydate'] },
  { id: 'sellTime', label: 'Sell time', names: ['soldtimestamp', 'selltime', 'selltimestamp', 'selldate'] },
  { id: 'symbol', label: 'Symbol', required: true, names: ['symbol', 'instrument', 'contractname', 'contract', 'ticker', 'market', 'product', 'contractid'] },
  { id: 'side', label: 'Long / short', names: ['side', 'direction', 'marketpos', 'marketposition', 'position', 'longshort', 'buysell', 'type', 'tradetype'] },
  { id: 'qty', label: 'Contracts', names: ['qty', 'quantity', 'size', 'contracts', 'filledqty', 'lots', 'volume'] },
  { id: 'entryPrice', label: 'Entry price', names: ['entryprice', 'avgentryprice', 'openprice', 'avgopenprice', 'entry', 'priceopen'] },
  { id: 'exitPrice', label: 'Exit price', names: ['exitprice', 'avgexitprice', 'closeprice', 'avgcloseprice', 'exit', 'priceclose'] },
  { id: 'buyPrice', label: 'Buy price', names: ['buyprice', 'avgbuyprice', 'boughtprice'] },
  { id: 'sellPrice', label: 'Sell price', names: ['sellprice', 'avgsellprice', 'soldprice'] },
  { id: 'pnl', label: 'P&L', required: true, names: ['pnl', 'netpnl', 'realizedpnl', 'netprofit', 'profit', 'profitloss', 'pl', 'grosspnl', 'grossprofit', 'netpl', 'realizedpl', 'pnlusd'] },
  { id: 'fees', label: 'Fees / commission', names: ['fees', 'commission', 'commissions', 'fee', 'totalfees', 'comm'] },
];

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** RFC 4180-ish CSV parser: quotes, escaped quotes, commas/semicolons/tabs, CRLF, BOM. */
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

/** Best guess of which header holds each field. Exact names first, then "contains". */
export function guessMapping(headers) {
  const map = {}, used = new Set();
  const n = headers.map(norm);
  for (const pass of ['exact', 'contains']) {
    for (const f of FIELDS) {
      if (map[f.id]) continue;
      for (const name of f.names) {
        const i = n.findIndex((h, k) => !used.has(k) && !String(headers[k]).startsWith('_') && (pass === 'exact' ? h === name : name.length > 4 && h.includes(name)));
        if (i >= 0) { map[f.id] = headers[i]; used.add(i); break; }
      }
    }
  }
  // Tradovate-style files have buy/sell columns instead of entry/exit; don't let a plain "date" steal entry time.
  if (map.buyTime && map.sellTime && map.entryTime && /^(date|time|tradedate)$/.test(norm(map.entryTime))) delete map.entryTime;
  return map;
}

export function parseMoney(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s.replace(/[$€£\s]/g, '')) || /^-/.test(s.replace(/[$€£\s]/g, '')) || /\(.*\)/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (/,\d{1,2}$/.test(s) && !/\./.test(s)) s = s.replace(',', '.'); // 12,50 → 12.50
  s = s.replace(/,/g, '');
  const x = parseFloat(s);
  return Number.isFinite(x) ? (neg ? -Math.abs(x) : x) : NaN;
}

/** Parses the date formats brokers use. Returns a Date in the viewer's local time, or null. */
export function parseWhen(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  // MM/DD/YYYY HH:MM[:SS][.fff] [AM|PM]  (also M/D/YY)
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?)?/.exec(s);
  if (m) {
    let [, mo, d, y, h = '0', mi = '0', se = '0', ap] = m;
    y = +y < 100 ? 2000 + +y : +y; h = +h;
    if (ap) { const pm = /p/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return new Date(y, +mo - 1, +d, h, +mi, +se);
  }
  // DD.MM.YYYY HH:MM (European)
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  // ISO 8601: with a zone it's converted to local time; without one it's taken as local.
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    if (m[7]) { const d = new Date(s.replace(' ', 'T')); return Number.isNaN(+d) ? null : d; }
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
}

/** "MNQZ5", "NQ 12-25", "CON.F.US.MNQ.Z25" → "MNQ" / "NQ". Prefers roots the trader already uses. */
export function rootSymbol(sym, known = []) {
  const s = String(sym || '').toUpperCase();
  const keys = [...new Set(known.map((k) => k.toUpperCase()))].sort((a, b) => b.length - a.length);
  const tokens = s.split(/[^A-Z0-9]+/).filter(Boolean);
  for (const t of tokens) for (const k of keys) if (t === k || (t.startsWith(k) && /^[FGHJKMNQUVXZ]\d{1,4}$/.test(t.slice(k.length)))) return k;
  const t = tokens.find((x) => /[A-Z]/.test(x)) || s;
  const mm = /^([A-Z0-9]{1,5}?)[FGHJKMNQUVXZ]\d{1,4}$/.exec(t);
  return mm ? mm[1] : t;
}

function sideOf(v) {
  const s = String(v || '').trim().toLowerCase();
  if (/^(long|buy|b|bot|bought|1)$/.test(s) || /long|buy/.test(s)) return 'Long';
  if (/^(short|sell|s|sld|sold|-1)$/.test(s) || /short|sell/.test(s)) return 'Short';
  return '';
}

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * Turns parsed rows into trades. Returns { trades, skipped: [{ line, reason }] }.
 * opts: { map, known (instrument roots), subtractFees, sessionFor(time) }
 */
export function rowsToTrades(rows, { map, known = [], subtractFees = true, sessionFor = () => null } = {}) {
  const trades = [], skipped = [];
  const get = (r, f) => (map[f] ? r[map[f]] : '');
  rows.forEach((r, i) => {
    const line = i + 2;
    const buyT = parseWhen(get(r, 'buyTime')), sellT = parseWhen(get(r, 'sellTime'));
    let dir = sideOf(get(r, 'side'));
    if (!dir && buyT && sellT) dir = buyT <= sellT ? 'Long' : 'Short';
    let entryT = parseWhen(get(r, 'entryTime')), exitT = parseWhen(get(r, 'exitTime'));
    if (!entryT && buyT && sellT) { entryT = dir === 'Short' ? sellT : buyT; exitT = exitT || (dir === 'Short' ? buyT : sellT); }
    if (!entryT) entryT = buyT || sellT;
    if (!entryT) { skipped.push({ line, reason: 'no readable entry time' }); return; }

    let pnl = parseMoney(get(r, 'pnl'));
    if (!Number.isFinite(pnl)) { skipped.push({ line, reason: 'no P&L' }); return; }
    const fees = parseMoney(get(r, 'fees'));
    if (subtractFees && Number.isFinite(fees)) pnl -= Math.abs(fees);
    pnl = Math.round(pnl * 100) / 100;

    const rawSym = get(r, 'symbol');
    const sym = rootSymbol(rawSym, known);
    const qty = Math.abs(parseMoney(get(r, 'qty')));
    let entry = parseMoney(get(r, 'entryPrice')), exit = parseMoney(get(r, 'exitPrice'));
    const bp = parseMoney(get(r, 'buyPrice')), sp = parseMoney(get(r, 'sellPrice'));
    if (!Number.isFinite(entry) && Number.isFinite(bp) && Number.isFinite(sp)) { entry = dir === 'Short' ? sp : bp; exit = dir === 'Short' ? bp : sp; }
    if (!dir && Number.isFinite(entry) && Number.isFinite(exit) && entry !== exit) dir = (exit > entry) === (pnl > 0) ? 'Long' : 'Short';

    const time = hhmm(entryT);
    const minutes = exitT ? Math.max(0, Math.round((exitT - entryT) / 60000)) : null;
    const key = [rawSym, +entryT, exitT ? +exitT : '', qty, pnl, entry].join('|');
    trades.push({
      id: 'imp_' + hash(key),
      Date: isoDay(entryT), Time: time, Killzone: sessionFor(time) || 'Other',
      Instrument: sym, Direction: dir || 'Long',
      Contracts: Number.isFinite(qty) && qty ? String(qty) : '',
      Entry: Number.isFinite(entry) ? String(entry) : '', Exit: Number.isFinite(exit) ? String(exit) : '',
      StopLoss: '', Partials: '', Duration: minutes == null ? '' : String(minutes),
      PNL: pnl, RR: null,
      RulesAll: [], RulesChecked: [], Grade: 'N/A', ChecklistScore: '', Setups: '',
      Mistakes: [], EmotionBefore: '', NewsImpact: '', Improvement: '', Model: '',
      imported: true, hasImage: false,
    });
  });
  return { trades, skipped };
}

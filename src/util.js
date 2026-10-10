import { RULES, PERIODS, CLOSED_RANGES, SHORT_DAYS, TIMEZONE, ADMINS } from './config.js';

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new HttpError(status, code, message); };

const enc = new TextEncoder();
export const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const b64urlToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
export const bytesToB64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- זמן בשעון ישראל ---------- */
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function israelNow(at = Date.now()) {
  const p = {}; for (const x of fmt.formatToParts(new Date(at))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
export const validDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const dayNum = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export const dowOf = (s) => new Date(dayNum(s) * 86400000).getUTCDay();
export const addDays = (s, n) => new Date((dayNum(s) + n) * 86400000).toISOString().slice(0, 10);
/* דקות "קיר" בשעון ישראל: מאפשר להשוות תאריך+שעה לרגע הנוכחי בלי להתעסק באזורי זמן */
export const absMin = (date, hour) => dayNum(date) * 1440 + hour * 60;
export const nowAbs = () => { const n = israelNow(); return absMin(n.date, n.hour) + n.minute; };
/* מילישניות אמיתיות של תאריך+שעה בישראל */
export const epochOf = (date, hour) => Date.now() + (absMin(date, hour) - nowAbs()) * 60000;

/* ---------- כללי לוח השנה (אותם כללים כמו בדפדפן) ---------- */
const CLOSED = {};
for (const [a, b, why] of CLOSED_RANGES) for (let d = a; d <= b; d = addDays(d, 1)) CLOSED[d] = why;
const MAXD = PERIODS[PERIODS.length - 1][1];
export const closeOf = (d) => SHORT_DAYS[d] || RULES.CLOSE;
export function blockedReason(d) {
  const today = israelNow().date;
  if (d < today) return 'עבר';
  if (d > MAXD) return 'אחרי סיום שנת הלימודים';
  if (dowOf(d) >= 5) return 'סוף שבוע';
  if (CLOSED[d]) return CLOSED[d];
  for (const [a, b] of PERIODS) if (d >= a && d <= b) return '';
  if (d < PERIODS[0][0]) return 'לפני פתיחת שנת הלימודים';
  return 'חופשת סמסטר';
}
export const isAdminEmail = (em) => ADMINS.some((a) => a.email === String(em || '').toLowerCase());

/* ---------- הגבלת קצב ---------- */
export async function rateLimit(env, key, limit, windowSec) {
  const w = Math.floor(Date.now() / 1000 / windowSec);
  const r = await env.DB.prepare(
    'INSERT INTO rl (k,w,n) VALUES (?,?,1) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN w = excluded.w THEN n + 1 ELSE 1 END, w = excluded.w RETURNING n'
  ).bind(key, w).first();
  if (r && r.n > limit) fail(429, 'rate_limited', 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.');
}

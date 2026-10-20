import { STUDIOS, RULES, ADMINS, PERIODS, CLOSED_RANGES, SHORT_DAYS, YEARS, STUDY_YEARS, PURPOSES, BLACK_IDS, ZONES, CLOSE_PURPOSE, EMAIL_DOMAIN, EMAIL_RE, SAFETY } from './config.js';
import { json, HttpError, fail, randomHex, israelNow, validDate, addDays, absMin, nowAbs, epochOf, blockedReason, closeOf, isAdminEmail, rateLimit, sha256Hex } from './util.js';
import { verifyGoogleToken, newSessionToken, hashToken, cookieHeader, readCookie, SESSION_MS } from './auth.js';

/* ---------- כותרות אבטחה לכל תגובה ---------- */
const CSP = [
  "default-src 'none'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src https://fonts.gstatic.com",
  "manifest-src 'self'", "worker-src 'self'",
  "img-src 'self' data: https://*.googleusercontent.com",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

function secure(res, api) {
  const r = new Response(res.body, res);
  r.headers.set('Content-Security-Policy', CSP);
  r.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('X-Frame-Options', 'DENY');
  r.headers.set('Referrer-Policy', 'no-referrer');
  r.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  r.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  r.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (api) r.headers.set('Cache-Control', 'no-store');
  return r;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return secure(await handleApi(request, env, url, ctx), true); }
      catch (e) {
        if (e instanceof HttpError) return secure(json({ error: e.code, message: e.message }, e.status), true);
        console.error('api error', e && e.stack || e);
        return secure(json({ error: 'server', message: 'אירעה תקלה בשרת. נסו שוב בעוד רגע.' }, 500), true);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return secure(new Response('Method Not Allowed', { status: 405 }), false);
    if (url.pathname.startsWith('/_g/')) return secure(new Response('Not Found', { status: 404 }), false);
    return secure(await env.ASSETS.fetch(request), false);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(housekeeping(env)); },
};

/* ניקוי יומי: התחברויות שפגו, מונה קצב, חשבונות שלא השלימו הרשמה, יומן ישן */
// טבלת המשתתפים בהזמנה נוצרת בעת הצורך (פעם אחת לכל מופע של השרת)
// עמודת שנת הלימוד בהזמנות נוספת בעת הצורך (פעם אחת לכל מופע של השרת)
let YEAR_READY = false;
async function ensureYear(env) {
  if (YEAR_READY) return;
  try { await env.DB.prepare("ALTER TABLE bookings ADD COLUMN study_year TEXT NOT NULL DEFAULT ''").run(); } catch (e) { /* העמודה כבר קיימת */ }
  YEAR_READY = true;
}
// טבלת הצהרות על חתימה על טופס הבטיחות נוצרת בעת הצורך (פעם אחת לכל מופע של השרת)
let SAFETY_READY = false;
async function ensureSafety(env) {
  if (SAFETY_READY) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS safety (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT \'\', checked_at INTEGER, checked_by TEXT)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS safety_versions (version TEXT PRIMARY KEY, title TEXT NOT NULL, rules TEXT NOT NULL, checks TEXT NOT NULL, published_at INTEGER NOT NULL, published_by TEXT NOT NULL DEFAULT \'\', current INTEGER NOT NULL DEFAULT 0)').run();
  await env.DB.prepare('INSERT INTO safety_versions (version,title,rules,checks,published_at,published_by,current) SELECT ?,?,?,?,?,?,1 WHERE NOT EXISTS (SELECT 1 FROM safety_versions)')
    .bind(SAFETY.version, SAFETY.title, JSON.stringify(SAFETY.rules), JSON.stringify(SAFETY.checks), Date.now(), 'ברירת מחדל').run();
  for (const col of ['version', 'signed_name']) {
    try { await env.DB.prepare(`ALTER TABLE safety ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`).run(); } catch (e) { /* העמודה כבר קיימת */ }
  }
  SAFETY_READY = true;
}
// הנוסח הנוכחי של כללי ההתנהגות (נערך על ידי המנהלים). בהתחלה נטען מ-config.js
async function currentSafety(env) {
  await ensureSafety(env);
  const r = await env.DB.prepare('SELECT * FROM safety_versions WHERE current = 1').first();
  if (!r) return { version: SAFETY.version, title: SAFETY.title, rules: SAFETY.rules, checks: SAFETY.checks, minWords: SAFETY.minWords };
  return { version: r.version, title: r.title, rules: parseJson(r.rules), checks: parseJson(r.checks), minWords: SAFETY.minWords, publishedAt: r.published_at };
}
let PEOPLE_READY = false;
async function ensurePeople(env) {
  if (PEOPLE_READY) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS booking_people (gid TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (gid, uid))').run();
  PEOPLE_READY = true;
}
async function housekeeping(env) {
  const now = Date.now();
  await ensurePeople(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM booking_people WHERE gid NOT IN (SELECT gid FROM bookings)'),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM rl'),
    env.DB.prepare('DELETE FROM users WHERE profile_done = 0 AND created_at < ? AND id NOT IN (SELECT user_id FROM sessions)').bind(now - 30 * 86400e3),
    env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(now - 400 * 86400e3),
  ]);
}

/* ---------- עזרים ---------- */
const bump = (env) => env.DB.prepare("UPDATE meta SET v = v + 1 WHERE k = 'ver'");
const audit = (env, u, action, target, detail) =>
  env.DB.prepare('INSERT INTO audit_log (at,actor_id,actor_email,action,target,detail) VALUES (?,?,?,?,?,?)')
    .bind(Date.now(), u ? u.id : null, u ? u.email : null, action, target || null, detail ? String(detail).slice(0, 300) : null);
const isAdmin = (u) => isAdminEmail(u.email);
const canBook = (u) => !!u.profile_done && (isAdmin(u) || u.status === 'approved');

async function readBody(request) {
  const text = await request.text();
  if (text.length > 100000) fail(413, 'too_big', 'הבקשה גדולה מדי.');
  if (!text) return {};
  try { const b = JSON.parse(text); return b && typeof b === 'object' ? b : {}; } catch { fail(400, 'bad_json', 'בקשה לא תקינה.'); }
}

async function getUser(c) {
  const token = readCookie(c.request);
  if (!token || token.length > 100) return null;
  const hash = await hashToken(token);
  const row = await c.env.DB.prepare(
    'SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires_at > ?'
  ).bind(hash, Date.now()).first();
  if (!row) return null;
  if (row.s_exp - Date.now() < SESSION_MS / 2) { // חידוש חכם: מאריך רק כשנשאר פחות ממחצית התוקף
    await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE hash = ?').bind(Date.now() + SESSION_MS, hash).run();
    c.refreshCookie = token;
  }
  c.hash = hash;
  return row;
}
const needUser = async (c) => { const u = await getUser(c); if (!u) fail(401, 'auth', 'יש להתחבר מחדש.'); return u; };
const needAdmin = async (c) => { const u = await needUser(c); if (!isAdmin(u)) fail(403, 'forbidden', 'הפעולה זמינה למנהלי המערכת בלבד.'); return u; };

async function strikesOf(env, uid) {
  const r = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM noshows WHERE user_id = ? AND end_at > COALESCE((SELECT at FROM releases WHERE user_id = ?), 0)'
  ).bind(uid, uid).first();
  return r ? r.n : 0;
}
const groupOf = (rows) => {
  const g = { gid: rows[0].gid, user_id: rows[0].user_id, date: rows[0].date, lo: 99, hi: -1, studios: [] };
  for (const r of rows) { g.lo = Math.min(g.lo, r.hour); g.hi = Math.max(g.hi, r.hour); if (!g.studios.includes(r.studio)) g.studios.push(r.studio); }
  return g;
};
const keyOf = (r) => `${r.studio}_${r.date}_${String(r.hour).padStart(2, '0')}`;
const distinctHours = (rows) => new Set(rows.map((r) => r.hour)).size;

/* ---------- התראות למנהלת (אופציונלי) ----------
   אם הוגדרו NOTIFY_URL ו-NOTIFY_SECRET, נשלחת הודעה לסקריפט Google שמעביר אותה במייל.
   השליחה ברקע ואינה מעכבת או מפילה את הפעולה. בלי ההגדרות לא קורה כלום. */
const oneLine = (t) => String(t == null ? '' : t).replace(/[\r\n]+/g, ' ').slice(0, 120);
function notify(c, subject, text) {
  const { env, ctx } = c;
  if (!env.NOTIFY_URL || !env.NOTIFY_SECRET || !ctx) return;
  const p = fetch(env.NOTIFY_URL, {
    method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: env.NOTIFY_SECRET, subject: oneLine(subject), text: String(text).slice(0, 1500) }),
    redirect: 'follow',
  }).catch((e) => console.error('notify failed', e && e.message));
  ctx.waitUntil(p);
}

/* ---------- ניתוב ---------- */
async function handleApi(request, env, url, ctx) {
  const method = request.method, path = url.pathname;
  const c = { request, env, url, ctx };
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) fail(403, 'origin', 'בקשה לא מורשית.');
    if (request.headers.get('x-requested-with') !== 'yb') fail(403, 'csrf', 'בקשה לא מורשית.');
  }
  let res, m;
  if (method === 'GET' && path === '/api/config') res = getConfig(env);
  else if (method === 'POST' && path === '/api/auth/google') res = await loginGoogle(c);
  else if (method === 'POST' && path === '/api/auth/logout') res = await logout(c);
  else if (method === 'GET' && path === '/api/state') res = await getState(c);
  else if (method === 'POST' && path === '/api/bookings') res = await createBooking(c);
  else if ((m = path.match(/^\/api\/bookings\/([a-f0-9]{8,32})$/)) && method === 'PUT') res = await editBooking(c, m[1]);
  else if ((m = path.match(/^\/api\/bookings\/([a-f0-9]{8,32})$/)) && method === 'DELETE') res = await cancelBooking(c, m[1]);
  else if (method === 'POST' && path === '/api/transfers') res = await sendTransfer(c);
  else if ((m = path.match(/^\/api\/transfers\/([a-f0-9]{8,32})\/(accept|decline)$/)) && method === 'POST') res = await answerTransfer(c, m[1], m[2]);
  else if ((m = path.match(/^\/api\/transfers\/([a-f0-9]{8,32})$/)) && method === 'DELETE') res = await dropTransfer(c, m[1]);
  else if (method === 'PUT' && path === '/api/profile') res = await saveProfile(c);
  else if (method === 'GET' && path === '/api/safety/text') res = await safetyText(c);
  else if (method === 'POST' && path === '/api/safety/sign') res = await safetySign(c);
  else if (method === 'POST' && path === '/api/privacy/ack') res = await privacyAck(c);
  else if (method === 'GET' && path === '/api/admin/safety/text') res = await safetyAdminText(c);
  else if (method === 'POST' && path === '/api/admin/safety/publish') res = await safetyPublish(c);
  else if (method === 'POST' && path === '/api/admin/safety') res = await safetyAdmin(c);
  else if (method === 'GET' && path === '/api/people') res = await peopleDir(c);
  else if (method === 'GET' && path === '/api/guide') res = await guideFile(c);
  else if (method === 'DELETE' && path === '/api/profile') res = await deleteProfile(c);
  else if ((m = path.match(/^\/api\/admin\/members\/([a-f0-9]{8,32})\/(status|remove)$/)) && method === 'POST') res = await memberAction(c, m[1], m[2]);
  else if ((m = path.match(/^\/api\/admin\/members\/([a-f0-9]{8,32})$/)) && method === 'DELETE') res = await purgeMember(c, m[1]);
  else if (method === 'POST' && path === '/api/admin/noshow') res = await markNoShow(c);
  else if (method === 'POST' && path === '/api/admin/release') res = await releaseUser(c);
  else if (method === 'GET' && path === '/api/admin/export') res = await exportData(c);
  else if (method === 'POST' && path === '/api/admin/cleanup') res = await cleanupYear(c);
  else if (method === 'POST' && path === '/api/admin/coord') res = await coordBlocks(c);
  else if (method === 'GET' && path === '/api/admin/audit') res = await auditList(c);
  else if (method === 'GET' && path === '/api/admin/infra') res = await infraInfo(c);
  else if (method === 'GET' && path === '/api/admin/stats') res = await statsData(c);
  else if (method === 'GET' && path === '/api/admin/allowlist') res = await allowCount(c);
  else if (method === 'POST' && path === '/api/admin/allowlist') res = await allowAdd(c);
  else if (method === 'POST' && path === '/api/admin/allowlist/clear') res = await allowClear(c);
  else if (method === 'GET' && path === '/api/admin/allowlist/list') res = await allowList(c);
  else if (method === 'POST' && path === '/api/admin/allowlist/role') res = await allowSetRole(c);
  else if (method === 'POST' && path === '/api/admin/allowlist/remove') res = await allowRemove(c);
  else if (method === 'POST' && path === '/api/admin/allowlist/name') res = await allowSetName(c);
  else fail(404, 'not_found', 'לא נמצא.');
  if (c.refreshCookie) res.headers.append('Set-Cookie', cookieHeader(c.refreshCookie, SESSION_MS / 1000));
  return res;
}

function getConfig(env) {
  return json({
    clientId: env.GOOGLE_CLIENT_ID, domain: EMAIL_DOMAIN, studios: STUDIOS, rules: RULES, admins: ADMINS,
    periods: PERIODS, closed: CLOSED_RANGES, shortDays: SHORT_DAYS, years: YEARS, studyYears: STUDY_YEARS, purposes: PURPOSES, zones: ZONES, closePurpose: CLOSE_PURPOSE,
  });
}

/* ---------- התחברות ---------- */
async function loginGoogle(c) {
  const { env, request } = c;
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  await rateLimit(env, 'login:' + (await sha256Hex('ip:' + ip)).slice(0, 24), 20, 600);
  const body = await readBody(request);
  const g = await verifyGoogleToken(body.credential, env);
  const now = Date.now();
  let u = await env.DB.prepare('SELECT * FROM users WHERE sub = ? OR email = ?').bind(g.sub, g.email).first();
  if (!u) {
    const id = randomHex(16);
    await env.DB.prepare('INSERT INTO users (id,sub,email,name,status,created_at,updated_at,last_login) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, g.sub, g.email, g.gname, (isAdminEmail(g.email) || await allowRole(env, g.email)) ? 'approved' : 'pending', now, now, now).run();
    u = { id, email: g.email };
  } else {
    await env.DB.prepare('UPDATE users SET sub = ?, email = ?, last_login = ? WHERE id = ?').bind(g.sub, g.email, now, u.id).run();
  }
  const token = newSessionToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(await hashToken(token), u.id, now, now + SESSION_MS),
    audit(env, u, 'login', u.email),
  ]);
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', cookieHeader(token, SESSION_MS / 1000));
  return res;
}
async function logout(c) {
  const token = readCookie(c.request);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await hashToken(token)).run();
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', cookieHeader('', 0));
  return res;
}

/* ---------- מצב כולל (מה שהדפדפן מציג) ---------- */
const parseJson = (s) => { try { return JSON.parse(s); } catch { return []; } };
async function getState(c) {
  const { env, url } = c;
  const u = await needUser(c);
  const admin = isAdmin(u);
  const listed = admin ? null : await allowEntry(env, u.email);
  await ensurePeople(env);
  const privOk = await privacyOk(env, u.id);
  const ver = (await env.DB.prepare("SELECT v FROM meta WHERE k = 'ver'").first()).v;
  const since = url.searchParams.get('v');
  if (since !== null && Number(since) === ver) return json({ unchanged: true, v: ver });
  const today = israelNow().date;
  const from = admin ? addDays(today, -RULES.REVIEW_DAYS) : today;
  const curSafety = await currentSafety(env);
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  const out = await env.DB.batch([
    q('SELECT * FROM bookings WHERE date >= ?', from),
    q('SELECT * FROM bookings WHERE user_id = ?', u.id),
    admin ? q('SELECT * FROM noshows') : q('SELECT * FROM noshows WHERE user_id = ?', u.id),
    admin ? q('SELECT * FROM releases') : q('SELECT * FROM releases WHERE user_id = ?', u.id),
    q('SELECT * FROM transfers WHERE from_uid = ? OR to_email = ?', u.id, u.email),
    admin ? q('SELECT id,name,email,role,status,created_at FROM users WHERE profile_done = 1') : q('SELECT 1 WHERE 0'),
    admin ? q('SELECT bp.gid AS gid, u.name AS name FROM booking_people bp JOIN users u ON u.id = bp.uid WHERE bp.gid IN (SELECT gid FROM bookings WHERE date >= ?) ORDER BY u.name', from)
          : q('SELECT bp.gid AS gid, u.name AS name FROM booking_people bp JOIN users u ON u.id = bp.uid WHERE bp.gid IN (SELECT gid FROM bookings WHERE user_id = ?) ORDER BY u.name', u.id),
    admin ? q('SELECT * FROM safety') : q('SELECT * FROM safety WHERE user_id = ?', u.id),
  ]);
  const people = {}; for (const r of out[6].results) (people[r.gid] = people[r.gid] || []).push(r.name);
  const bk = (r) => {
    const o = { studio: r.studio, date: r.date, hour: r.hour, gid: r.gid, uid: r.user_id, name: r.name, year: r.role, purpose: r.purpose, people: r.people, createdAt: r.created_at };
    if (r.transferred_from) o.transferredFrom = r.transferred_from;
    if (admin || r.user_id === u.id) { o.email = r.email; o.notes = r.notes; o.studyYear = r.study_year || ''; } // מייל והערות רק למזמין ולמנהלים
    return o;
  };
  const bookings = {}; for (const r of out[0].results) bookings[keyOf(r)] = bk(r);
  const mine = {}; for (const r of out[1].results) mine[keyOf(r)] = bk(r);
  const noshows = {}; for (const r of out[2].results) noshows[r.gid] = { gid: r.gid, uid: r.user_id, name: r.name, email: r.email, date: r.date, studios: parseJson(r.studios), from: r.from_hour, to: r.to_hour, endAt: r.end_at, markedBy: r.marked_by, at: r.at };
  const releases = {}; for (const r of out[3].results) releases[r.user_id] = { uid: r.user_id, at: r.at, by: r.by_name };
  const transfers = {}; for (const r of out[4].results) transfers[r.gid] = { gid: r.gid, fromUid: r.from_uid, fromName: r.from_name, toEmail: r.to_email, status: r.status, date: r.date, from: r.from_hour, to: r.to_hour, studios: parseJson(r.studios), createdAt: r.created_at };
  const members = {}; for (const r of out[5].results) members[r.id] = { uid: r.id, name: r.name, email: r.email, role: r.role, status: r.status, createdAt: r.created_at };
  const safetyMap = {}; for (const r of out[7].results) safetyMap[r.user_id] = { uid: r.user_id, at: r.at, kind: r.kind, by: r.by_name, name: r.signed_name || '', version: r.version, valid: r.version === curSafety.version };
  const profile = u.profile_done ? { name: u.name, year: u.role, email: u.email, photo: u.photo, createdAt: u.created_at, updatedAt: u.updated_at } : null;
  const member = u.profile_done ? { uid: u.id, name: u.name, email: u.email, role: u.role, status: isAdmin(u) ? 'approved' : u.status, createdAt: u.created_at } : null;
  return json({ v: ver, me: { uid: u.id, email: u.email, isAdmin: admin, privacy: privOk, suggest: u.profile_done ? '' : (listed && listed.name) || u.name, listRole: (listed && listed.role) || '', safety: safetyMap[u.id] && safetyMap[u.id].valid ? safetyMap[u.id] : null }, safety: admin ? safetyMap : {}, profile, member, bookings, mine, noshows, releases, transfers, members, people });
}

/* ---------- הזמנות ---------- */
// רשימת שמות להוספה כמשתתפים בהזמנה: רק שם ותפקיד, בלי מיילים
/* מדריך השימוש (PDF): זמין רק למי שנכנס למערכת */
async function guideFile(c) {
  const { env, url } = c;
  await needUser(c);
  const r = await env.ASSETS.fetch(new Request(new URL('/_g/guide.pdf', url.origin)));
  if (!r.ok) fail(404, 'not_found', 'המדריך לא נמצא.');
  const dl = url.searchParams.get('dl') === '1';
  return new Response(r.body, { status: 200, headers: {
    'content-type': 'application/pdf',
    'content-disposition': (dl ? 'attachment' : 'inline') + "; filename=\"studio-guide.pdf\"; filename*=UTF-8''" + encodeURIComponent('מדריך-הזמנת-אולפנים.pdf'),
  } });
}
async function peopleDir(c) {
  const { env } = c;
  const u = await needUser(c);
  if (!canBook(u)) fail(403, 'not_approved', 'ההרשמה שלך עדיין לא אושרה.');
  await rateLimit(env, 'dir:' + u.id, 30, 60);
  const r = await env.DB.prepare("SELECT id, name, role FROM users WHERE profile_done = 1 AND status = 'approved' AND id <> ? AND id NOT LIKE 'sys-%' ORDER BY name LIMIT 2000").bind(u.id).all();
  return json({ items: r.results.map((x) => ({ uid: x.id, name: x.name, role: x.role })) });
}
async function createBooking(c) {
  const { env, request } = c;
  const u = await needUser(c);
  await rateLimit(env, 'w:' + u.id, 40, 60);
  const b = await readBody(request);
  if (!u.profile_done) fail(403, 'no_profile', 'כדי להזמין צריך להשלים הרשמה.');
  if (!canBook(u)) fail(403, 'not_approved', 'ההרשמה שלך עדיין לא אושרה על ידי מנהל.');
  await needSafety(env, u);
  if ((await strikesOf(env, u.id)) >= RULES.MAX_STRIKES) fail(403, 'blocked', 'ההזמנה חסומה עבורך עקב אי-הגעות. לשחרור פנו למנהלי המערכת.');
  const zone = typeof b.closeZone === 'string' ? ZONES[b.closeZone] : null;
  if (b.closeZone !== undefined && !zone) fail(400, 'zone', 'האולפן שנבחר לסגירה לא תקין.');
  const closeAll = !!zone;
  if (closeAll && !isAdmin(u)) fail(403, 'forbidden', 'סגירת אולפן אפשרית למנהלים בלבד.');
  const ids = closeAll ? zone.ids.slice() : Array.isArray(b.studios) ? [...new Set(b.studios.map(String))] : [];
  if (!closeAll && !isAdmin(u) && Object.values(ZONES).some((z) => z.ids.every((i) => ids.includes(i)))) fail(403, 'whole_studio', 'סגירת אולפן שחור במלואו (הקדמי, האחורי או שניהם) אפשרית למנהלים בלבד. אפשר לבחור חלק מהעמדות.');
  if (!ids.length || ids.length > RULES.MAX_STATIONS || ids.some((i) => !STUDIOS.some((s) => s.id === i))) fail(400, 'studios', 'בחירת העמדות לא תקינה.');
  if (!validDate(b.date)) fail(400, 'date', 'תאריך לא תקין.');
  const why = blockedReason(b.date);
  if (why) fail(400, 'date_blocked', `אי אפשר להזמין בתאריך הזה (${why}).`);
  const start = b.start, dur = b.dur;
  if (!Number.isInteger(start) || !Number.isInteger(dur) || dur < 1 || dur > (closeAll ? 24 : RULES.MAX_DAY) || start < RULES.OPEN || start + dur > closeOf(b.date)) fail(400, 'hours', 'השעות שנבחרו אינן תקינות.');
  if (absMin(b.date, start) <= nowAbs()) fail(400, 'past', 'אי אפשר להזמין שעה שכבר התחילה.');
  if (closeAll) return closeStudio(c, u, b, ids, start, dur);
  if (!PURPOSES.includes(b.purpose)) fail(400, 'purpose', 'נא לבחור מטרת שימוש.');
  const cap = ids.reduce((a, i) => a + STUDIOS.find((s) => s.id === i).cap, 0);
  const people = b.people;
  if (!Number.isInteger(people) || people < 1 || people > cap) fail(400, 'people', `מספר המשתתפים בהזמנה הזאת הוא בין 1 ל-${cap}.`);
  const notes = typeof b.notes === 'string' ? b.notes.slice(0, 300) : '';
  // סטודנטים חייבים לציין שנת לימוד; מתרגלים, מדריכים ומרצים לא
  let studyYear = '';
  if (u.role === 'סטודנט') {
    if (!STUDY_YEARS.includes(b.studyYear)) fail(400, 'study_year', 'סטודנטים צריכים לציין שנת לימוד.');
    studyYear = b.studyYear;
  }
  await ensureYear(env);
  // חובה לציין אם עובדים לבד או עם אחרים, והמספר חייב להתאים לשמות שנבחרו
  const mode = b.mode;
  if (mode !== 'solo' && mode !== 'group') fail(400, 'mode', 'יש לציין אם אתם עובדים לבד או עם אנשים נוספים. אם הדף פתוח כבר זמן רב, רעננו אותו.');
  const rawPart = b.participants === undefined || b.participants === null ? [] : b.participants;
  if (!Array.isArray(rawPart) || rawPart.length > 20) fail(400, 'participants', 'רשימת המשתתפים לא תקינה.');
  const part = [...new Set(rawPart.map(String))].filter((x) => x !== u.id);
  if (mode === 'solo' && (part.length || people !== 1)) fail(400, 'people', 'בחרתם לעבוד לבד, ולכן מספר המשתתפים חייב להיות 1 וללא שמות נוספים.');
  if (mode === 'group') {
    if (!part.length) fail(400, 'people', 'בחרתם לעבוד עם אחרים: יש להוסיף לפחות שם משתתף אחד.');
    if (people !== part.length + 1) fail(400, 'people', `מספר המשתתפים (${people}) חייב להתאים לשמות שנבחרו (${part.length} נוספים ואתם, ${part.length + 1} בסך הכול).`);
    const ph = part.map(() => '?').join(',');
    const ok = (await env.DB.prepare(`SELECT id FROM users WHERE id IN (${ph}) AND profile_done = 1 AND status = 'approved'`).bind(...part).all()).results;
    if (ok.length !== part.length) fail(400, 'participants', 'אחד מהמשתתפים שנבחרו לא נמצא. רעננו את הדף ובחרו שוב.');
  }
  if (part.length) await ensurePeople(env);
  const own = (await env.DB.prepare('SELECT hour FROM bookings WHERE user_id = ? AND date = ?').bind(u.id, b.date).all()).results;
  const hrs = new Set(own.map((r) => r.hour)); for (let i = 0; i < dur; i++) hrs.add(start + i);
  if (hrs.size > RULES.MAX_DAY) fail(400, 'quota', `ההזמנה חורגת ממכסה של ${RULES.MAX_DAY} שעות ליום.`);
  const gid = randomHex(8), now = Date.now(), stmts = [];
  for (let i = 0; i < dur; i++) for (const s of ids)
    stmts.push(env.DB.prepare('INSERT INTO bookings (studio,date,hour,gid,user_id,name,email,role,purpose,people,notes,created_at,study_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(s, b.date, start + i, gid, u.id, u.name, u.email, u.role, b.purpose, people, notes, now, studyYear));
  for (const pu of part) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO booking_people (gid, uid) VALUES (?,?)').bind(gid, pu));
  stmts.push(bump(env));
  try { await env.DB.batch(stmts); } // כל ההזמנה נשמרת יחד או לא נשמרת בכלל
  catch (e) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) fail(409, 'taken', 'אחת העמדות או השעות שבחרתם הוזמנה לפני רגע. ההזמנה לא נשמרה. בחרו שעה או עמדה אחרת.');
    throw e;
  }
  const after = await env.DB.prepare('SELECT COUNT(DISTINCT hour) AS n FROM bookings WHERE user_id = ? AND date = ?').bind(u.id, b.date).first();
  if (after.n > RULES.MAX_DAY) { // הגנה מפני שתי בקשות במקביל של אותו משתמש
    await env.DB.batch([env.DB.prepare('DELETE FROM bookings WHERE gid = ?').bind(gid), ...(part.length ? [env.DB.prepare('DELETE FROM booking_people WHERE gid = ?').bind(gid)] : []), bump(env)]);
    fail(409, 'quota', `ההזמנה חורגת ממכסה של ${RULES.MAX_DAY} שעות ליום.`);
  }
  if (!isAdmin(u)) {
    const names = ids.map((i) => STUDIOS.find((s) => s.id === i).name).join(', ');
    const [yy, mm, dd] = b.date.split('-');
    notify(c, `הזמנת אולפן חדשה: ${oneLine(u.name)}`,
      `${oneLine(u.name)} (${oneLine(u.role)}) הזמין/ה אולפן\n${names}\nתאריך: ${dd}/${mm}/${yy}\nשעות: ${String(start).padStart(2, '0')}:00–${String(start + dur).padStart(2, '0')}:00\nמטרה: ${oneLine(b.purpose)}, ${people} משתתפים\n\nhttps://studio-booking.photography-e89.workers.dev`);
  }
  return json({ ok: true, gid });
}

/* סגירת האולפן השחור במלואו (מנהל בלבד): חוסמת את כל העמדות בטווח השעות, בלי מכסה ובלי פרטי משתתפים */
async function closeStudio(c, u, b, ids, start, dur) {
  const zname = ZONES[b.closeZone].name;
  const { env } = c;
  const label = cleanLabel(b.label, 'סגור');
  const notes = label;
  const ph = ids.map(() => '?').join(',');
  const rowsIn = (await env.DB.prepare(`SELECT gid, user_id FROM bookings WHERE date = ? AND hour >= ? AND hour < ? AND studio IN (${ph})`).bind(b.date, start, start + dur, ...ids).all()).results;
  const clash = new Set(rowsIn.map((r) => r.gid)).size;
  const pre = [];
  let cancelledN = 0;
  if (clash && b.override === true) {
    await ensurePeople(env);
    const g = new Set(rowsIn.filter((r) => r.user_id !== 'sys-classes').map((r) => r.gid));
    cancelledN = g.size;
    pre.push(env.DB.prepare(`DELETE FROM bookings WHERE user_id = 'sys-classes' AND date = ? AND hour >= ? AND hour < ? AND studio IN (${ph})`).bind(b.date, start, start + dur, ...ids), ...cancelGids(env, g));
  } else if (clash) fail(409, 'taken', `בטווח הזה כבר יש הזמנות או שיעורים באולפן שנבחר. סמנו "החלפת שעות תפוסות" כדי להחליף אותם, או בחרו שעות אחרות.`);
  const gid = randomHex(8), now = Date.now(), stmts = [];
  for (let i = 0; i < dur; i++) for (const s of ids)
    stmts.push(env.DB.prepare('INSERT INTO bookings (studio,date,hour,gid,user_id,name,email,role,purpose,people,notes,created_at,study_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(s, b.date, start + i, gid, u.id, label, u.email, u.role, CLOSE_PURPOSE, 1, notes, now, ''));
  stmts.push(audit(env, u, 'close_studio', u.email, `${zname} ${b.date} ${start}-${start + dur}${pre.length ? `, בוטלו ${cancelledN} הזמנות והוחלפו חסימות קיימות` : ''}`), bump(env));
  try { await env.DB.batch([...pre, ...stmts]); }
  catch (e) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) fail(409, 'taken', 'אחת העמדות הוזמנה לפני רגע. נסו שוב.');
    throw e;
  }
  return json({ ok: true, gid, cancelled: cancelledN });
}

async function editBooking(c, gid) {
  const { env, request } = c;
  const u = await needUser(c);
  await rateLimit(env, 'w:' + u.id, 40, 60);
  const b = await readBody(request);
  const rows = (await env.DB.prepare('SELECT * FROM bookings WHERE gid = ?').bind(gid).all()).results;
  if (!rows.length) fail(404, 'gone', 'ההזמנה כבר לא קיימת.');
  const g = groupOf(rows), admin = isAdmin(u);
  if (g.user_id !== u.id && !admin) fail(403, 'forbidden', 'אפשר לערוך רק הזמנה שלך.');
  if (absMin(g.date, g.hi + 1) <= nowAbs()) fail(400, 'over', 'ההזמנה כבר הסתיימה.');
  if (rows[0].purpose === CLOSE_PURPOSE) fail(400, 'closure', 'סגירת אולפן אי אפשר לערוך. בטלו אותה וצרו סגירה חדשה.');
  if (!PURPOSES.includes(b.purpose)) fail(400, 'purpose', 'נא לבחור מטרת שימוש.');
  const cap = g.studios.reduce((a, i) => a + ((STUDIOS.find((s) => s.id === i) || { cap: 1 }).cap), 0);
  const people = b.people;
  if (!Number.isInteger(people) || people < 1 || people > cap) fail(400, 'people', `מספר המשתתפים בהזמנה הזאת הוא בין 1 ל-${cap}.`);
  await ensurePeople(env);
  const np = (await env.DB.prepare('SELECT COUNT(*) AS n FROM booking_people WHERE gid = ?').bind(gid).first()).n;
  if (np ? people !== np + 1 : false) fail(400, 'people', 'בהזמנה יש משתתפים עם שמות, ולכן מספר המשתתפים נקבע לפיהם. כדי לשנות אותם בטלו והזמינו מחדש.');
  if (!np && people !== 1 && b.solo === true) fail(400, 'people', 'בחרתם לעבוד לבד: מספר המשתתפים הוא 1.');
  const notes = typeof b.notes === 'string' ? b.notes.slice(0, 300) : '';
  await ensureYear(env);
  let studyYear = rows[0].study_year || '';
  if (rows[0].role === 'סטודנט') {
    if (!STUDY_YEARS.includes(b.studyYear)) fail(400, 'study_year', 'סטודנטים צריכים לציין שנת לימוד.');
    studyYear = b.studyYear;
  }
  const st = [env.DB.prepare('UPDATE bookings SET purpose = ?, people = ?, notes = ?, study_year = ? WHERE gid = ?').bind(b.purpose, people, notes, studyYear, gid), bump(env)];
  if (g.user_id !== u.id) st.push(audit(env, u, 'edit_booking', rows[0].email, `${g.date} ${g.lo}-${g.hi + 1}`));
  await env.DB.batch(st);
  return json({ ok: true });
}

async function cancelBooking(c, gid) {
  const { env } = c;
  const u = await needUser(c);
  await rateLimit(env, 'w:' + u.id, 40, 60);
  const rows = (await env.DB.prepare('SELECT * FROM bookings WHERE gid = ?').bind(gid).all()).results;
  if (!rows.length) fail(404, 'gone', 'ההזמנה כבר לא קיימת.');
  const g = groupOf(rows), admin = isAdmin(u);
  if (g.user_id !== u.id && !admin) fail(403, 'forbidden', 'אפשר לבטל רק הזמנה שלך.');
  if (absMin(g.date, g.hi + 1) <= nowAbs()) fail(400, 'over', 'ההזמנה כבר הסתיימה.');
  if (!admin && absMin(g.date, g.lo) - nowAbs() < RULES.CANCEL_LEAD_H * 60) fail(400, 'too_late', 'אי אפשר לבטל פחות משעתיים לפני תחילת ההזמנה.');
  await ensurePeople(env);
  const st = [env.DB.prepare('DELETE FROM bookings WHERE gid = ?').bind(gid), env.DB.prepare('DELETE FROM transfers WHERE gid = ?').bind(gid), env.DB.prepare('DELETE FROM booking_people WHERE gid = ?').bind(gid), bump(env)];
  if (g.user_id !== u.id) st.push(audit(env, u, 'cancel_booking', rows[0].email, `${g.date} ${g.lo}-${g.hi + 1}`));
  await env.DB.batch(st);
  return json({ ok: true });
}

/* ---------- העברת מקום ---------- */
async function sendTransfer(c) {
  const { env, request } = c;
  const u = await needUser(c);
  await rateLimit(env, 'w:' + u.id, 40, 60);
  const b = await readBody(request);
  const to = String(b.toEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) fail(400, 'email', 'נא להזין מייל ארגוני בסיומת \u2066@' + EMAIL_DOMAIN + '.\u2069');
  if (to === u.email) fail(400, 'self', 'אי אפשר להעביר את המקום לעצמך.');
  if (!u.profile_done) fail(403, 'no_profile', 'יש להשלים הרשמה.');
  const rows = (await env.DB.prepare('SELECT * FROM bookings WHERE gid = ?').bind(String(b.gid || '')).all()).results;
  if (!rows.length || rows[0].user_id !== u.id) fail(404, 'gone', 'ההזמנה לא נמצאה.');
  const g = groupOf(rows);
  if (absMin(g.date, g.lo) - nowAbs() < RULES.CANCEL_LEAD_H * 60) fail(400, 'too_late', 'אי אפשר להעביר פחות משעתיים לפני תחילת ההזמנה.');
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO transfers (gid,from_uid,from_name,to_email,status,date,from_hour,to_hour,studios,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(g.gid, u.id, u.name, to, 'pending', g.date, g.lo, g.hi + 1, JSON.stringify(g.studios), Date.now()),
    bump(env),
  ]);
  return json({ ok: true });
}
async function dropTransfer(c, gid) { // השולח מבטל בקשה
  const u = await needUser(c);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM transfers WHERE gid = ? AND from_uid = ?').bind(gid, u.id), bump(c.env)]);
  return json({ ok: true });
}
async function answerTransfer(c, gid, action) {
  const { env } = c;
  const u = await needUser(c);
  await rateLimit(env, 'w:' + u.id, 40, 60);
  const t = await env.DB.prepare('SELECT * FROM transfers WHERE gid = ?').bind(gid).first();
  if (!t || t.status !== 'pending' || t.to_email !== u.email) fail(404, 'gone', 'הבקשה כבר לא קיימת.');
  if (action === 'decline') {
    await env.DB.batch([env.DB.prepare("UPDATE transfers SET status = 'declined', answered_at = ? WHERE gid = ?").bind(Date.now(), gid), bump(env)]);
    return json({ ok: true });
  }
  if (!canBook(u)) fail(403, 'not_approved', 'כדי לקבל מקום צריך שמנהל יאשר את ההרשמה שלך.');
  await needSafety(env, u);
  if ((await strikesOf(env, u.id)) >= RULES.MAX_STRIKES) fail(403, 'blocked', 'החשבון שלך חסום מהזמנת אולפנים ולכן אי אפשר לקבל מקום.');
  const rows = (await env.DB.prepare('SELECT * FROM bookings WHERE gid = ?').bind(gid).all()).results;
  if (!rows.length || rows.some((r) => r.user_id !== t.from_uid)) {
    await env.DB.batch([env.DB.prepare("UPDATE transfers SET status = 'void', answered_at = ? WHERE gid = ?").bind(Date.now(), gid), bump(env)]);
    fail(409, 'void', 'ההזמנה כבר לא זמינה להעברה (בוטלה או שונתה).');
  }
  const g = groupOf(rows);
  if (absMin(g.date, g.lo) <= nowAbs()) fail(400, 'started', 'ההזמנה כבר התחילה, אי אפשר לקבל אותה.');
  const own = (await env.DB.prepare('SELECT hour FROM bookings WHERE user_id = ? AND date = ?').bind(u.id, g.date).all()).results;
  const hrs = new Set(own.map((r) => r.hour)); rows.forEach((r) => hrs.add(r.hour));
  if (hrs.size > RULES.MAX_DAY) fail(400, 'quota', `קבלת המקום תחרוג ממכסה של ${RULES.MAX_DAY} שעות ליום בתאריך הזה.`);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE bookings SET user_id = ?, name = ?, email = ?, role = ?, transferred_from = ?, transferred_at = ? WHERE gid = ? AND user_id = ?')
      .bind(u.id, u.name, u.email, u.role, t.from_name, now, gid, t.from_uid),
    env.DB.prepare("UPDATE transfers SET status = 'accepted', answered_at = ? WHERE gid = ?").bind(now, gid),
    audit(env, u, 'transfer_accept', gid, `from ${t.from_name}`),
    bump(env),
  ]);
  return json({ ok: true });
}

/* ---------- רשימת אישור אוטומטי ----------
   מי שהמייל שלו ברשימה מאושר מיד בהרשמה. מי שלא ברשימה ממתין לאישור ידני. הטבלה נוצרת בעת הצורך. */
const ALLOW_DDL = "CREATE TABLE IF NOT EXISTS allowlist (email TEXT PRIMARY KEY, added_at INTEGER NOT NULL, added_by TEXT, role TEXT NOT NULL DEFAULT 'סטודנט', name TEXT NOT NULL DEFAULT '')";
async function ensureAllow(env) {
  await env.DB.prepare(ALLOW_DDL).run();
  try { await env.DB.prepare("ALTER TABLE allowlist ADD COLUMN role TEXT NOT NULL DEFAULT 'סטודנט'").run(); } catch (e) { /* העמודה כבר קיימת */ }
  try { await env.DB.prepare("ALTER TABLE allowlist ADD COLUMN name TEXT NOT NULL DEFAULT ''").run(); } catch (e) { /* העמודה כבר קיימת */ }
}
// מחזיר {role, name} לפי הרשימה, או null אם המייל לא ברשימה
async function allowEntry(env, email) {
  const em = String(email).toLowerCase();
  const fix = (r) => ({ role: YEARS.includes(r.role) ? r.role : 'סטודנט', name: r.name || '' });
  try { const r = await env.DB.prepare('SELECT role, name FROM allowlist WHERE email = ?').bind(em).first(); return r ? fix(r) : null; }
  catch (e) {
    try { const r = await env.DB.prepare('SELECT role FROM allowlist WHERE email = ?').bind(em).first(); return r ? fix(r) : null; }
    catch (e2) {
      try { return (await env.DB.prepare('SELECT 1 AS x FROM allowlist WHERE email = ?').bind(em).first()) ? fix({}) : null; } catch (e3) { return null; }
    }
  }
}
const allowRole = async (env, email) => { const r = await allowEntry(env, email); return r ? r.role : null; };
async function allowCount(c) {
  await needAdmin(c);
  try {
    const r = await c.env.DB.prepare('SELECT role, COUNT(*) AS n FROM allowlist GROUP BY role').all();
    const byRole = {}; let count = 0;
    for (const x of r.results) { byRole[x.role] = x.n; count += x.n; }
    return json({ count, byRole });
  } catch (e) {
    try { return json({ count: (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM allowlist').first()).n, byRole: {} }); } catch (e2) { return json({ count: 0, byRole: {} }); }
  }
}
async function allowAdd(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const body = await readBody(request);
  const text = String(body.text || '');
  const role = YEARS.includes(body.role) ? body.role : 'סטודנט';
  if (text.length > 200000) fail(400, 'big', 'הרשימה ארוכה מדי.');
  const seen = new Set(), bad = [], names = new Map();
  const note = (x) => { if (bad.length < 5) bad.push(String(x).slice(0, 60)); };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const toks = line.match(/[^\s,;<>"'|]+@[^\s,;<>"'|]+/g) || [];
    if (!toks.length) { note(line.trim()); continue; }
    const ems = toks.map((x) => x.trim().toLowerCase().replace(/\.+$/, ''));
    for (const e of ems) { if (EMAIL_RE.test(e)) seen.add(e); else note(e); }
    if (toks.length === 1 && EMAIL_RE.test(ems[0])) { // שורה עם מייל אחד: שאר השורה הוא השם המלא
      const nm = line.replace(toks[0], ' ').replace(/[\t,;<>"'|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (nm) names.set(ems[0], nm);
    }
  }
  const emails = [...seen];
  if (!emails.length) fail(400, 'empty', 'לא נמצאו כתובות מייל תקינות בסיומת \u2066@' + EMAIL_DOMAIN + '.\u2069');
  if (emails.length > 1500) fail(400, 'big', 'אפשר להוסיף עד 1500 כתובות בכל פעם.');
  await ensureAllow(env);
  const now = Date.now(), by = a.name || a.email;
  for (let i = 0; i < emails.length; i += 100) {
    await env.DB.batch(emails.slice(i, i + 100).map((e) => env.DB.prepare("INSERT INTO allowlist (email,added_at,added_by,role,name) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE allowlist.name END").bind(e, now, by, role, names.get(e) || '')));
  }
  // מי שכבר רשום: התפקיד מתעדכן לפי הרשימה (מנהלי מערכת לא משתנים)
  const today = israelNow().date;
  const targets = emails.filter((e) => !isAdminEmail(e));
  for (let i = 0; i < targets.length; i += 50) {
    await env.DB.batch(targets.slice(i, i + 50).flatMap((e) => [
      env.DB.prepare('UPDATE users SET role = ? WHERE email = ? AND profile_done = 1').bind(role, e),
      env.DB.prepare('UPDATE bookings SET role = ? WHERE email = ? AND date >= ?').bind(role, e, today),
    ]));
  }
  // מי שכבר נרשם וממתין והמייל שלו ברשימה מאושר עכשיו (לא נוגעים ב"נדחה" או "הוסר")
  const ap = await env.DB.prepare("UPDATE users SET status = 'approved', decided_by = ?, decided_at = ? WHERE status = 'pending' AND email IN (SELECT email FROM allowlist)").bind('רשימה אוטומטית', now).run();
  await env.DB.batch([audit(env, a, 'allowlist_add', String(emails.length)), bump(env)]);
  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM allowlist').first()).n;
  return json({ ok: true, added: emails.length, invalid: bad, count, approvedNow: (ap.meta && ap.meta.changes) || 0 });
}
async function allowList(c) {
  await needAdmin(c);
  try {
    await ensureAllow(c.env);
    const r = await c.env.DB.prepare('SELECT a.email AS email, a.role AS role, a.name AS lname, u.name AS name, u.status AS status, u.profile_done AS done FROM allowlist a LEFT JOIN users u ON u.email = a.email ORDER BY a.email LIMIT 3000').all();
    return json({ items: r.results.map((x) => ({ email: x.email, role: x.role, name: (x.done && x.name) || x.lname || '', status: x.done ? x.status : '' })) });
  } catch (e) { return json({ items: [] }); }
}
async function allowSetRole(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const b = await readBody(request);
  const email = String(b.email || '').toLowerCase();
  if (!EMAIL_RE.test(email) || !YEARS.includes(b.role)) fail(400, 'bad', 'נתונים לא תקינים.');
  const r = await env.DB.prepare('UPDATE allowlist SET role = ? WHERE email = ?').bind(b.role, email).run();
  if (!((r.meta && r.meta.changes) || 0)) fail(404, 'gone', 'הכתובת לא נמצאת ברשימה.');
  const st = [audit(env, a, 'allowlist_role', email, b.role), bump(env)];
  if (!isAdminEmail(email)) st.unshift(
    env.DB.prepare('UPDATE users SET role = ? WHERE email = ? AND profile_done = 1').bind(b.role, email),
    env.DB.prepare('UPDATE bookings SET role = ? WHERE email = ? AND date >= ?').bind(b.role, email, israelNow().date));
  await env.DB.batch(st);
  return json({ ok: true });
}
async function allowSetName(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const b = await readBody(request);
  const email = String(b.email || '').toLowerCase();
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  if (!EMAIL_RE.test(email) || name.length > 60) fail(400, 'bad', 'נתונים לא תקינים.');
  await ensureAllow(env);
  const r = await env.DB.prepare('UPDATE allowlist SET name = ? WHERE email = ?').bind(name, email).run();
  if (!((r.meta && r.meta.changes) || 0)) fail(404, 'gone', 'הכתובת לא נמצאת ברשימה.');
  const st = [audit(env, a, 'allowlist_name', email, name), bump(env)];
  if (name && !isAdminEmail(email)) st.unshift( // מי שכבר רשום: גם השם שלו והזמנותיו העתידיות מתעדכנים
    env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE email = ? AND profile_done = 1').bind(name, Date.now(), email),
    env.DB.prepare('UPDATE bookings SET name = ? WHERE email = ? AND date >= ?').bind(name, email, israelNow().date));
  await env.DB.batch(st);
  return json({ ok: true });
}
async function allowRemove(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const email = String((await readBody(request)).email || '').toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'bad', 'נתונים לא תקינים.');
  await env.DB.batch([env.DB.prepare('DELETE FROM allowlist WHERE email = ?').bind(email), audit(env, a, 'allowlist_remove', email), bump(env)]);
  return json({ ok: true });
}
async function allowClear(c) {
  const { env } = c;
  const a = await needAdmin(c);
  try { await env.DB.prepare('DELETE FROM allowlist').run(); } catch (e) { /* אין טבלה */ }
  await env.DB.batch([audit(env, a, 'allowlist_clear', ''), bump(env)]);
  return json({ ok: true, count: 0 });
}

/* ---------- פרופיל ---------- */
async function saveProfile(c) {
  const { env, request } = c;
  const u = await needUser(c);
  await rateLimit(env, 'w:' + u.id, 40, 60);
  const b = await readBody(request);
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60) fail(400, 'name', 'נא למלא שם מלא.');
  if (!YEARS.includes(b.year)) fail(400, 'role', 'נא לבחור תפקיד.');
  const photo = typeof b.photo === 'string' ? b.photo : '';
  if (photo && (photo.length > 80000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo))) fail(400, 'photo', 'התמונה לא תקינה.');
  const first = !u.profile_done;
  if (first && b.agree !== true) fail(400, 'agree', 'כדי להירשם צריך לאשר את ההתחייבות.');
  if (first && b.privacy !== true) fail(400, 'privacy', 'כדי להירשם צריך לאשר שקראתם את הודעת הפרטיות. אם הדף פתוח זמן רב, רעננו אותו.');
  const now = Date.now();
  let status = isAdmin(u) ? 'approved' : u.status;
  const listed = isAdmin(u) ? null : await allowRole(env, u.email); // התפקיד נקבע לפי רשימת האישור האוטומטי
  if (status === 'pending' && listed) status = 'approved';
  const role = listed || b.year;
  const st = [
    env.DB.prepare('UPDATE users SET name = ?, role = ?, photo = ?, profile_done = 1, status = ?, updated_at = ? WHERE id = ?').bind(name, role, photo, status, now, u.id),
    env.DB.prepare('UPDATE bookings SET name = ?, role = ? WHERE user_id = ? AND date >= ?').bind(name, role, u.id, israelNow().date),
    bump(env),
  ];
  if (first) st.push(audit(env, u, 'register', u.email));
  if (first) { await ensurePrivacy(env); st.push(ackStmt(env, u.id)); }
  await env.DB.batch(st);
  if (first && !isAdmin(u) && status === 'pending') notify(c, `נרשם/ה חדש/ה ממתין/ה לאישור: ${oneLine(name)}`,
    `${oneLine(name)} (${oneLine(role)}) נרשם/ה למערכת הזמנת האולפנים וממתין/ה לאישור.\n\nלאישור: לשונית "ניהול" באתר\nhttps://studio-booking.photography-e89.workers.dev`);
  return json({ ok: true });
}
async function deleteProfile(c) {
  const u = await needUser(c);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET name = '', role = '', photo = '', profile_done = 0, updated_at = ? WHERE id = ?").bind(Date.now(), u.id),
    audit(c.env, u, 'profile_delete', u.email), bump(c.env),
  ]);
  return json({ ok: true });
}

/* ---------- ניהול ---------- */
async function memberAction(c, id, action) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const t = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND profile_done = 1').bind(id).first();
  if (!t) fail(404, 'gone', 'המשתמש לא נמצא.');
  if (isAdmin(t)) fail(400, 'admin', 'אי אפשר לשנות מנהל מערכת.');
  const now = Date.now();
  if (action === 'status') {
    const s = (await readBody(request)).status;
    if (s !== 'approved' && s !== 'rejected') fail(400, 'status', 'סטטוס לא תקין.');
    await env.DB.batch([env.DB.prepare('UPDATE users SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?').bind(s, a.name || a.email, now, id), audit(env, a, 'member_' + s, t.email), bump(env)]);
  } else { // הסרה: חוסמת ומבטלת הזמנות עתידיות
    const n = israelNow();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM bookings WHERE user_id = ? AND (date > ? OR (date = ? AND hour >= ?))').bind(id, n.date, n.date, n.hour),
      env.DB.prepare('DELETE FROM transfers WHERE from_uid = ?').bind(id),
      env.DB.prepare("UPDATE users SET status = 'removed', decided_by = ?, decided_at = ? WHERE id = ?").bind(a.name || a.email, now, id),
      audit(env, a, 'member_remove', t.email), bump(env),
    ]);
  }
  return json({ ok: true });
}
async function purgeMember(c, id) {
  const { env } = c;
  const a = await needAdmin(c);
  const t = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!t) fail(404, 'gone', 'המשתמש לא נמצא.');
  if (isAdmin(t)) fail(400, 'admin', 'אי אפשר למחוק מנהל מערכת.');
  await ensurePrivacy(env);
  if (t.status !== 'removed' && t.status !== 'rejected') fail(400, 'status', 'אפשר למחוק לגמרי רק משתמש שהוסר או שלא אושר.');
  const today = israelNow().date;
  await ensureSafety(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM safety WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM privacy_ack WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM bookings WHERE user_id = ? AND date >= ?').bind(id, today),
    env.DB.prepare('DELETE FROM transfers WHERE from_uid = ?').bind(id),
    env.DB.prepare('DELETE FROM noshows WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM releases WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
    audit(env, a, 'member_purge', t.email), bump(env),
  ]);
  return json({ ok: true });
}
async function markNoShow(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const b = await readBody(request);
  const gid = String(b.gid || '');
  if (!/^[a-f0-9]{8,32}$/.test(gid)) fail(400, 'gid', 'בקשה לא תקינה.');
  if (b.on === false) {
    await env.DB.batch([env.DB.prepare('DELETE FROM noshows WHERE gid = ?').bind(gid), audit(env, a, 'noshow_undo', gid), bump(env)]);
    return json({ ok: true });
  }
  const rows = (await env.DB.prepare('SELECT * FROM bookings WHERE gid = ?').bind(gid).all()).results;
  if (!rows.length) fail(404, 'gone', 'ההזמנה לא נמצאה.');
  const g = groupOf(rows);
  if (absMin(g.date, g.hi + 1) > nowAbs()) fail(400, 'not_over', 'אפשר לסמן אי-הגעה רק אחרי שההזמנה הסתיימה.');
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO noshows (gid,user_id,name,email,date,studios,from_hour,to_hour,end_at,marked_by,at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(gid, g.user_id, rows[0].name, rows[0].email, g.date, JSON.stringify(g.studios), g.lo, g.hi + 1, epochOf(g.date, g.hi + 1), a.name || a.email, Date.now()),
    audit(env, a, 'noshow_mark', rows[0].email, `${g.date} ${g.lo}-${g.hi + 1}`), bump(env),
  ]);
  return json({ ok: true });
}
/* ---------- אישור קריאת הודעת הפרטיות ---------- */
const PRIVACY_VERSION = '2'; // מעלים כשנוסח ההודעה משתנה, וכולם מאשרים מחדש
let PRIVACY_READY = false;
async function ensurePrivacy(env) {
  if (PRIVACY_READY) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS privacy_ack (user_id TEXT PRIMARY KEY, version TEXT NOT NULL, at INTEGER NOT NULL)').run();
  PRIVACY_READY = true;
}
const ackStmt = (env, uid) => env.DB.prepare('INSERT OR REPLACE INTO privacy_ack (user_id, version, at) VALUES (?,?,?)').bind(uid, PRIVACY_VERSION, Date.now());
async function privacyOk(env, uid) {
  await ensurePrivacy(env);
  const r = await env.DB.prepare('SELECT version FROM privacy_ack WHERE user_id = ?').bind(uid).first();
  return !!(r && r.version === PRIVACY_VERSION);
}
async function privacyAck(c) {
  const u = await needUser(c);
  await ensurePrivacy(c.env);
  await c.env.DB.batch([ackStmt(c.env, u.id), bump(c.env)]);
  return json({ ok: true });
}
/* ---------- טופס כללי בטיחות: הצהרה של המשתמש, ואישור או ביטול על ידי מנהל ---------- */
async function needSafety(env, u) {
  if (!(await privacyOk(env, u.id))) fail(403, 'privacy', 'כדי להזמין צריך לקרוא את הודעת הפרטיות וללחוץ "הבנתי".');
  // החתימה נדרשת מכולם: מנהלים, מרצים, מתרגלים וסטודנטים
  const cur = await currentSafety(env);
  const r = await env.DB.prepare('SELECT version FROM safety WHERE user_id = ?').bind(u.id).first();
  if (!r || r.version !== cur.version) fail(403, 'safety', 'כדי להזמין אולפן צריך לקרוא את כללי ההתנהגות בחללים המעשיים ובאולפנים ולחתום עליהם במערכת.');
}
async function safetyText(c) {
  await needUser(c);
  return json(await currentSafety(c.env));
}
async function safetyAdminText(c) {
  const { env } = c;
  await needAdmin(c);
  const cur = await currentSafety(env);
  const rows = await env.DB.batch([
    env.DB.prepare('SELECT version,title,rules,checks,published_at,published_by,current FROM safety_versions ORDER BY published_at DESC'),
    env.DB.prepare('SELECT version, COUNT(*) AS n FROM safety GROUP BY version'),
  ]);
  const counts = new Map(rows[1].results.map((r) => [r.version, r.n]));
  const history = rows[0].results.map((r) => ({ version: r.version, title: r.title, rules: parseJson(r.rules), checks: parseJson(r.checks), at: r.published_at, by: r.published_by, current: !!r.current, signed: counts.get(r.version) || 0 }));
  return json({ current: cur, history });
}
async function safetyPublish(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const b = await readBody(request);
  const clean = (x, max) => String(x == null ? '' : x).replace(/\r/g, '').trim().slice(0, max);
  const title = clean(b.title, 200);
  const rules = Array.isArray(b.rules) ? b.rules.map((x) => clean(x, 3000)).filter(Boolean) : [];
  const checks = Array.isArray(b.checks) ? b.checks.map((x) => clean(x, 500)).filter(Boolean) : [];
  if (!title) fail(400, 'title', 'נא למלא כותרת.');
  if (!rules.length || rules.length > 60) fail(400, 'rules', 'נא להזין בין כלל אחד ל-60 כללים.');
  if (!checks.length || checks.length > 5) fail(400, 'checks', 'נא להזין בין אישור אחד לחמישה אישורים.');
  const cur = await currentSafety(env);
  if (title === cur.title && JSON.stringify(rules) === JSON.stringify(cur.rules) && JSON.stringify(checks) === JSON.stringify(cur.checks)) fail(400, 'same', 'לא בוצע שינוי בנוסח, ולכן לא נוצרה גרסה חדשה.');
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM safety_versions').first()).n;
  const version = `${SAFETY.version}-${n + 1}`;
  await env.DB.batch([
    env.DB.prepare('UPDATE safety_versions SET current = 0'),
    env.DB.prepare('INSERT INTO safety_versions (version,title,rules,checks,published_at,published_by,current) VALUES (?,?,?,?,?,?,1)').bind(version, title, JSON.stringify(rules), JSON.stringify(checks), Date.now(), a.name || a.email),
    audit(env, a, 'safety_publish', version, `${rules.length} כללים`), bump(env),
  ]);
  return json({ ok: true, version });
}
async function safetySign(c) {
  const { env, request } = c;
  const u = await needUser(c);
  await rateLimit(env, 'safe:' + u.id, 10, 600);
  if (!u.profile_done) fail(403, 'no_profile', 'יש להשלים הרשמה לפני כן.');
  const b = await readBody(request);
  const cur = await currentSafety(env);
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.split(' ').filter((w) => w.length >= 2).length < cur.minWords) fail(400, 'name', 'נא להקליד שם מלא (שם פרטי ושם משפחה) כחתימה.');
  if (b.read !== true || b.agree !== true) fail(400, 'confirm', 'צריך לקרוא את כל הכללים עד הסוף ולסמן את שני האישורים.');
  if (typeof b.version === 'string' && b.version !== cur.version) fail(409, 'stale', 'נוסח הכללים עודכן. סגרו את החלון ופתחו אותו מחדש.');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO safety (user_id,at,kind,by_name,checked_at,checked_by,version,signed_name) VALUES (?,?, 'sign', ?, ?, ?, ?, ?)").bind(u.id, now, u.name || u.email, now, 'חתימה במערכת', cur.version, name),
    audit(env, u, 'safety_sign', u.email, cur.version), bump(env),
  ]);
  return json({ ok: true });
}
async function safetyAdmin(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const b = await readBody(request);
  const uid = String(b.uid || ''), act = String(b.action || '');
  if (!['set', 'revoke'].includes(act)) fail(400, 'action', 'פעולה לא תקינה.');
  const t = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(uid).first();
  if (!t) fail(404, 'gone', 'המשתמש לא נמצא.');
  const cur = await currentSafety(env);
  const now = Date.now(), by = a.name || a.email;
  const st = [];
  if (act === 'revoke') st.push(env.DB.prepare('DELETE FROM safety WHERE user_id = ?').bind(uid));
  else st.push(env.DB.prepare("INSERT OR REPLACE INTO safety (user_id,at,kind,by_name,checked_at,checked_by,version,signed_name) VALUES (?,?, 'admin', ?, ?, ?, ?, '')").bind(uid, now, by, now, by, cur.version));
  st.push(audit(env, a, 'safety_' + act, t.email), bump(env));
  await env.DB.batch(st);
  return json({ ok: true });
}
async function releaseUser(c) {
  const { env, request } = c;
  const a = await needAdmin(c);
  const uid = String((await readBody(request)).uid || '');
  const t = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(uid).first();
  const ns = t ? null : await env.DB.prepare('SELECT email FROM noshows WHERE user_id = ? LIMIT 1').bind(uid).first();
  if (!t && !ns) fail(404, 'gone', 'המשתמש לא נמצא.');
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO releases (user_id,at,by_name) VALUES (?,?,?)').bind(uid, Date.now(), a.name || a.email),
    audit(env, a, 'release', (t || ns).email), bump(env),
  ]);
  return json({ ok: true });
}
async function exportData(c) {
  const { env } = c;
  const a = await needAdmin(c);
  await ensurePeople(env);
  await ensureYear(env);
  const out = await env.DB.batch([
    env.DB.prepare('SELECT name,email,role,status,created_at FROM users WHERE profile_done = 1 ORDER BY name'),
    env.DB.prepare("SELECT b.gid AS gid,b.date AS date,MIN(b.hour) AS lo,MAX(b.hour) AS hi,group_concat(DISTINCT b.studio) AS st,b.name AS name,b.email AS email,b.role AS role,b.purpose AS purpose,b.people AS people,b.notes AS notes,b.study_year AS sy,(SELECT group_concat(u.name, ', ') FROM booking_people bp JOIN users u ON u.id = bp.uid WHERE bp.gid = b.gid) AS withp FROM bookings b GROUP BY b.gid ORDER BY b.date, lo"),
    env.DB.prepare('SELECT name,email,end_at FROM noshows ORDER BY end_at'),
    audit(env, a, 'export', ''),
  ]);
  return json({ users: out[0].results, bookings: out[1].results, noshows: out[2].results });
}
/* ---------- סטטיסטיקה: כמה כל אדם היה פעיל באולפנים, ובאיזה סוג פעילות ---------- */
async function statsData(c) {
  const { env, url } = c;
  await needAdmin(c);
  await ensurePeople(env);
  await ensureYear(env);
  const sp = url.searchParams, today = israelNow().date;
  const q = String(sp.get('q') || '').trim().toLowerCase().slice(0, 60);
  const purpose = PURPOSES.includes(sp.get('purpose')) ? sp.get('purpose') : '';
  const role = YEARS.includes(sp.get('role')) ? sp.get('role') : '';
  const year = STUDY_YEARS.includes(sp.get('year')) ? sp.get('year') : '';
  const from = validDate(sp.get('from') || '') ? sp.get('from') : '0000-00-00';
  const to = validDate(sp.get('to') || '') ? sp.get('to') : today; // ברירת מחדל: עד היום, בלי הזמנות עתידיות
  const detail = sp.get('detail') === '1';
  const out = await env.DB.batch([
    env.DB.prepare(`SELECT b.gid AS gid, b.date AS date, b.user_id AS uid, b.purpose AS purpose, b.people AS people, b.notes AS notes, b.study_year AS sy,
        MIN(b.hour) AS lo, MAX(b.hour) + 1 AS hi, group_concat(DISTINCT b.studio) AS st,
        COALESCE(NULLIF(u.name, ''), b.name) AS name, COALESCE(u.email, b.email) AS email, COALESCE(NULLIF(u.role, ''), b.role) AS role
      FROM bookings b LEFT JOIN users u ON u.id = b.user_id
      WHERE b.user_id <> 'sys-classes' AND b.date >= ? AND b.date <= ? GROUP BY b.gid`).bind(from, to),
    env.DB.prepare(`SELECT bp.gid AS gid, bp.uid AS uid, u.name AS name, u.email AS email, u.role AS role
      FROM booking_people bp JOIN users u ON u.id = bp.uid
      WHERE bp.gid IN (SELECT gid FROM bookings WHERE date >= ? AND date <= ?)`).bind(from, to),
    env.DB.prepare('SELECT gid, user_id FROM noshows WHERE date >= ? AND date <= ?').bind(from, to),
    env.DB.prepare("SELECT user_id, study_year, MAX(date) FROM bookings WHERE study_year <> '' GROUP BY user_id"), // שנת הלימוד האחרונה של כל אדם
  ]);
  const ymap = new Map(out[3].results.map((r) => [r.user_id, r.study_year]));
  const parts = {};
  for (const r of out[1].results) (parts[r.gid] = parts[r.gid] || []).push(r);
  const noshow = new Set(out[2].results.map((r) => r.gid));
  const match = (p) => (!role || p.role === role) && (!year || p.year === year) && (!q || String(p.name || '').toLowerCase().includes(q) || String(p.email || '').toLowerCase().includes(q));
  const people = new Map(), purposes = new Map(), detailRows = [];
  const person = (uid, name, email, rl) => {
    if (!people.has(uid)) people.set(uid, { uid, name: name || '', email: email || '', role: rl || '', year: ymap.get(uid) || '', bookings: 0, hours: 0, pBookings: 0, pHours: 0, noshows: 0, by: new Map() });
    return people.get(uid);
  };
  const totals = { bookings: 0, hours: 0, people: new Set() };
  const yrs = new Map(); // לפי שנת לימוד: הזמנות לפי השנה שצוינה בהזמנה, השתתפות לפי השנה האחרונה של המשתתף
  const yAgg = (y) => { if (!yrs.has(y)) yrs.set(y, { year: y, who: new Set(), bookings: 0, hours: 0, pBookings: 0, pHours: 0, noshows: 0 }); return yrs.get(y); };
  for (const g of out[0].results) {
    if (g.purpose === CLOSE_PURPOSE) continue; // סגירת אולפן אינה פעילות שימוש
    if (purpose && g.purpose !== purpose) continue;
    const hours = Math.max(1, g.hi - g.lo), ps = (parts[g.gid] || []).slice().sort((x, y) => String(x.name).localeCompare(String(y.name), 'he'));
    const involved = [{ uid: g.uid, name: g.name, email: g.email, role: g.role, year: ymap.get(g.uid) || '', owner: true }, ...ps.map((x) => ({ uid: x.uid, name: x.name, email: x.email, role: x.role, year: ymap.get(x.uid) || '' }))];
    if (!involved.some(match)) continue; // בלי סינון: כולם. עם סינון: הזמנות שמעורב בהן מישהו שמתאים
    totals.bookings++; totals.hours += hours;
    const pu = purposes.get(g.purpose) || { purpose: g.purpose, bookings: 0, hours: 0, personHours: 0, who: new Set() };
    pu.bookings++; pu.hours += hours; pu.personHours += hours * Math.max(1, g.people || 1);
    purposes.set(g.purpose, pu);
    for (const x of involved) {
      pu.who.add(x.uid); totals.people.add(x.uid);
      if (!match(x)) continue;
      const pr = person(x.uid, x.name, x.email, x.role);
      if (x.owner) { pr.bookings++; pr.hours += hours; if (noshow.has(g.gid)) pr.noshows++; } else { pr.pBookings++; pr.pHours += hours; }
      const ya = yAgg(x.owner ? (g.sy || x.year || '') : (x.year || '')); ya.who.add(x.uid);
      if (x.owner) { ya.bookings++; ya.hours += hours; if (noshow.has(g.gid)) ya.noshows++; } else { ya.pBookings++; ya.pHours += hours; }
      pr.by.set(g.purpose, (pr.by.get(g.purpose) || 0) + 1);
    }
    if (detail && detailRows.length < 20000) detailRows.push({
      date: g.date, lo: g.lo, hi: g.hi, st: g.st, name: g.name, email: g.email, role: g.role, purpose: g.purpose, people: g.people,
      sy: g.sy || '', with: ps.map((x) => x.name).join(', '), noshow: noshow.has(g.gid), notes: g.notes,
    });
  }
  const peopleOut = [...people.values()].map((p) => ({
    uid: p.uid, name: p.name, email: p.email, role: p.role, year: p.year, bookings: p.bookings, hours: p.hours, pBookings: p.pBookings, pHours: p.pHours,
    total: p.hours + p.pHours, noshows: p.noshows, by: [...p.by.entries()].sort((a, b) => b[1] - a[1]),
  })).sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name), 'he'));
  const purposesOut = [...purposes.values()].map((x) => ({ purpose: x.purpose, bookings: x.bookings, hours: x.hours, personHours: x.personHours, people: x.who.size })).sort((a, b) => b.hours - a.hours);
  const order = [...STUDY_YEARS, ''];
  const yearsOut = [...yrs.values()].map((y) => ({ year: y.year, ord: order.indexOf(y.year) < 0 ? 99 : order.indexOf(y.year), people: y.who.size, bookings: y.bookings, hours: y.hours, pBookings: y.pBookings, pHours: y.pHours, total: y.hours + y.pHours, noshows: y.noshows })).sort((a, b) => a.ord - b.ord);
  const res = { people: peopleOut, purposes: purposesOut, years: yearsOut, totals: { bookings: totals.bookings, hours: totals.hours, people: totals.people.size }, from: from === '0000-00-00' ? '' : from, to };
  if (detail) res.detail = detailRows.sort((a, b) => (a.date + a.lo).localeCompare(b.date + b.lo));
  return json(res);
}
/* מבטל במלואן הזמנות של משתמשים (לפי gid), כולל משתתפים והעברות */
function cancelGids(env, gids) {
  const st = [], list = [...gids];
  for (let i = 0; i < list.length; i += 80) {
    const part = list.slice(i, i + 80), ph = part.map(() => '?').join(',');
    st.push(env.DB.prepare(`DELETE FROM bookings WHERE gid IN (${ph})`).bind(...part), env.DB.prepare(`DELETE FROM transfers WHERE gid IN (${ph})`).bind(...part), env.DB.prepare(`DELETE FROM booking_people WHERE gid IN (${ph})`).bind(...part));
  }
  return st;
}

/* ---------- חסימות "תיאום עם ירדן גבאי": מנהל מוסיף או מסיר לפי ימים, תאריכים, שעות ואולפנים ---------- */
const COORD_NAME = 'תיאום עם ירדן גבאי';
const cleanLabel = (v, dflt) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) || dflt;
async function coordBlocks(c) {
  const { env, request } = c;
  const u = await needAdmin(c);
  await rateLimit(env, 'w:' + u.id, 20, 60);
  const b = await readBody(request);
  const mode = b.mode === 'remove' ? 'remove' : 'add';
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 4);
  if (!days.length) fail(400, 'days', 'בחרו לפחות יום אחד בשבוע.');
  if (!validDate(b.from) || !validDate(b.to) || b.to < b.from) fail(400, 'date', 'טווח התאריכים לא תקין.');
  const today = israelNow().date;
  const from = b.from < today ? today : b.from;
  if (b.to < from) fail(400, 'date', 'כל הטווח כבר עבר.');
  if (b.to > addDays(from, 400)) fail(400, 'date', 'אפשר לעדכן עד 400 יום בכל פעם.');
  const hf = b.hFrom, ht = b.hTo;
  if (!Number.isInteger(hf) || !Number.isInteger(ht) || hf < RULES.OPEN || ht > RULES.CLOSE || ht <= hf) fail(400, 'hours', 'טווח השעות לא תקין.');
  const ids = [...new Set((Array.isArray(b.studios) ? b.studios : []).map(String))];
  if (!ids.length || ids.some((i) => !STUDIOS.some((s) => s.id === i))) fail(400, 'studios', 'נא לבחור אולפנים.');
  const ph = ids.map(() => '?').join(',');
  const dows = days.map(String);
  if (mode === 'remove') {
    const where = `user_id = 'sys-classes' AND name NOT LIKE ? AND date >= ? AND date <= ? AND hour >= ? AND hour < ? AND studio IN (${ph}) AND strftime('%w', date) IN (${dows.map(() => '?').join(',')})`;
    const args = ['שיעור:%', from, b.to, hf, ht, ...ids, ...dows];
    const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE ${where}`).bind(...args).first()).n;
    await env.DB.batch([env.DB.prepare(`DELETE FROM bookings WHERE ${where}`).bind(...args), audit(env, u, 'coord_remove', `${from}..${b.to}`, `ימים ${days.join('')} שעות ${hf}-${ht} אולפנים ${ids.join(',')}: ${n} שעות-עמדה`), bump(env)]);
    return json({ ok: true, removed: n });
  }
  const override = b.override === true;
  const label = cleanLabel(b.label, COORD_NAME);
  await ensurePeople(env);
  const taken = new Map((await env.DB.prepare(`SELECT studio, date, hour, gid, user_id FROM bookings WHERE date >= ? AND date <= ? AND studio IN (${ph})`).bind(from, b.to, ...ids).all()).results.map((r) => [`${r.studio}|${r.date}|${r.hour}`, r]));
  const cancelled = new Set();
  let replaced = 0;
  const now = Date.now(), stmts = [];
  let added = 0, skipped = 0;
  for (let d = from; d <= b.to; d = addDays(d, 1)) {
    if (!days.includes(new Date(d + 'T12:00:00Z').getUTCDay()) || blockedReason(d)) continue;
    const gid = randomHex(8);
    for (let h = hf; h < Math.min(ht, closeOf(d)); h++) for (const s of ids) {
      const ex = taken.get(`${s}|${d}|${h}`);
      if (ex) {
        if (!override) { skipped++; continue; }
        if (ex.user_id === 'sys-classes') replaced++; else cancelled.add(ex.gid);
      }
      added++;
      stmts.push(env.DB.prepare('INSERT INTO bookings (studio,date,hour,gid,user_id,name,email,role,purpose,people,notes,created_at,study_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(s, d, h, gid, 'sys-classes', label, 'classes@system.local', 'מערכת', 'אחר', 1, label === COORD_NAME ? 'בתיאום מראש עם ירדן גבאי' : label, now, ''));
    }
  }
  if (added > 3000) fail(400, 'big', 'הטווח גדול מדי. צמצמו את התאריכים או האולפנים.');
  if (override && (replaced || cancelled.size)) {
    const delSys = env.DB.prepare(`DELETE FROM bookings WHERE user_id = 'sys-classes' AND date >= ? AND date <= ? AND hour >= ? AND hour < ? AND studio IN (${ph}) AND strftime('%w', date) IN (${dows.map(() => '?').join(',')})`).bind(from, b.to, hf, ht, ...ids, ...dows);
    await env.DB.batch([delSys, ...cancelGids(env, cancelled)]);
  }
  for (let i = 0; i < stmts.length; i += 100) {
    try { await env.DB.batch(stmts.slice(i, i + 100)); }
    catch (e) { if (/UNIQUE|constraint/i.test(String(e && e.message))) fail(409, 'taken', 'חלק מהשעות הוזמנו בזמן העדכון. נסו שוב.'); throw e; }
  }
  await env.DB.batch([audit(env, u, 'coord_add', `${from}..${b.to}`, `${label}: ימים ${days.join('')} שעות ${hf}-${ht} אולפנים ${ids.join(',')}: ${added} שעות-עמדה${override ? `, הוחלפו ${replaced} חסימות/שיעורים ובוטלו ${cancelled.size} הזמנות` : ''}`), bump(env)]);
  return json({ ok: true, added, skipped, replaced, cancelled: cancelled.size });
}

async function cleanupYear(c) {
  const { env } = c;
  const a = await needAdmin(c);
  const today = israelNow().date;
  const out = await env.DB.batch([
    env.DB.prepare('DELETE FROM bookings WHERE date < ?').bind(today),
    env.DB.prepare('DELETE FROM noshows'), env.DB.prepare('DELETE FROM releases'), env.DB.prepare('DELETE FROM transfers'),
    audit(env, a, 'cleanup_year', ''), bump(env),
  ]);
  const n = out.slice(0, 4).reduce((s, r) => s + ((r.meta && r.meta.changes) || 0), 0);
  return json({ ok: true, deleted: n });
}
/* אבחון מיקום: באיזה אזור מסד הנתונים עונה, ומאיזה מרכז נתונים של Cloudflare הבקשה הוגשה (למנהלים בלבד) */
async function infraInfo(c) {
  await needAdmin(c);
  const r = await c.env.DB.prepare('SELECT 1 AS x').run();
  const m = (r && r.meta) || {};
  const cf = c.request.cf || {};
  return json({
    d1: { region: m.served_by_region || null, primary: m.served_by_primary === undefined ? null : m.served_by_primary, ms: m.duration },
    request: { colo: cf.colo || null, country: cf.country || null, city: cf.city || null, region: cf.region || null },
    note: 'region מציין את אזור מסד הנתונים שענה לשאילתה. אם primary=true זהו אזור המסד הראשי.',
  });
}
async function auditList(c) {
  await needAdmin(c);
  const r = await c.env.DB.prepare('SELECT at,actor_email,action,target,detail FROM audit_log ORDER BY id DESC LIMIT 100').all();
  return json({ items: r.results });
}

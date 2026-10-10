import { STUDIOS, RULES, ADMINS, PERIODS, CLOSED_RANGES, SHORT_DAYS, YEARS, PURPOSES, EMAIL_DOMAIN, EMAIL_RE } from './config.js';
import { json, HttpError, fail, randomHex, israelNow, validDate, addDays, absMin, nowAbs, epochOf, blockedReason, closeOf, isAdminEmail, rateLimit, sha256Hex } from './util.js';
import { verifyGoogleToken, newSessionToken, hashToken, cookieHeader, readCookie, SESSION_MS } from './auth.js';

/* ---------- כותרות אבטחה לכל תגובה ---------- */
const CSP = [
  "default-src 'none'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://*.googleusercontent.com",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

function secure(res, api) {
  const r = new Response(res.body, res);
  r.headers.set('Content-Security-Policy', CSP);
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return secure(await handleApi(request, env, url), true); }
      catch (e) {
        if (e instanceof HttpError) return secure(json({ error: e.code, message: e.message }, e.status), true);
        console.error('api error', e && e.stack || e);
        return secure(json({ error: 'server', message: 'אירעה תקלה בשרת. נסו שוב בעוד רגע.' }, 500), true);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return secure(new Response('Method Not Allowed', { status: 405 }), false);
    return secure(await env.ASSETS.fetch(request), false);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(housekeeping(env)); },
};

/* ניקוי יומי: התחברויות שפגו, מונה קצב, חשבונות שלא השלימו הרשמה, יומן ישן */
async function housekeeping(env) {
  const now = Date.now();
  await env.DB.batch([
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

/* ---------- ניתוב ---------- */
async function handleApi(request, env, url) {
  const method = request.method, path = url.pathname;
  const c = { request, env, url };
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
  else if ((m = path.match(/^\/api\/bookings\/([a-f0-9]{8,32})$/)) && method === 'DELETE') res = await cancelBooking(c, m[1]);
  else if (method === 'POST' && path === '/api/transfers') res = await sendTransfer(c);
  else if ((m = path.match(/^\/api\/transfers\/([a-f0-9]{8,32})\/(accept|decline)$/)) && method === 'POST') res = await answerTransfer(c, m[1], m[2]);
  else if ((m = path.match(/^\/api\/transfers\/([a-f0-9]{8,32})$/)) && method === 'DELETE') res = await dropTransfer(c, m[1]);
  else if (method === 'PUT' && path === '/api/profile') res = await saveProfile(c);
  else if (method === 'DELETE' && path === '/api/profile') res = await deleteProfile(c);
  else if ((m = path.match(/^\/api\/admin\/members\/([a-f0-9]{8,32})\/(status|remove)$/)) && method === 'POST') res = await memberAction(c, m[1], m[2]);
  else if ((m = path.match(/^\/api\/admin\/members\/([a-f0-9]{8,32})$/)) && method === 'DELETE') res = await purgeMember(c, m[1]);
  else if (method === 'POST' && path === '/api/admin/noshow') res = await markNoShow(c);
  else if (method === 'POST' && path === '/api/admin/release') res = await releaseUser(c);
  else if (method === 'GET' && path === '/api/admin/export') res = await exportData(c);
  else if (method === 'POST' && path === '/api/admin/cleanup') res = await cleanupYear(c);
  else if (method === 'GET' && path === '/api/admin/audit') res = await auditList(c);
  else fail(404, 'not_found', 'לא נמצא.');
  if (c.refreshCookie) res.headers.append('Set-Cookie', cookieHeader(c.refreshCookie, SESSION_MS / 1000));
  return res;
}

function getConfig(env) {
  return json({
    clientId: env.GOOGLE_CLIENT_ID, domain: EMAIL_DOMAIN, studios: STUDIOS, rules: RULES, admins: ADMINS,
    periods: PERIODS, closed: CLOSED_RANGES, shortDays: SHORT_DAYS, years: YEARS, purposes: PURPOSES,
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
      .bind(id, g.sub, g.email, g.gname, isAdminEmail(g.email) ? 'approved' : 'pending', now, now, now).run();
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
  const ver = (await env.DB.prepare("SELECT v FROM meta WHERE k = 'ver'").first()).v;
  const since = url.searchParams.get('v');
  if (since !== null && Number(since) === ver) return json({ unchanged: true, v: ver });
  const today = israelNow().date;
  const from = admin ? addDays(today, -RULES.REVIEW_DAYS) : today;
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  const out = await env.DB.batch([
    q('SELECT * FROM bookings WHERE date >= ?', from),
    q('SELECT * FROM bookings WHERE user_id = ?', u.id),
    admin ? q('SELECT * FROM noshows') : q('SELECT * FROM noshows WHERE user_id = ?', u.id),
    admin ? q('SELECT * FROM releases') : q('SELECT * FROM releases WHERE user_id = ?', u.id),
    q('SELECT * FROM transfers WHERE from_uid = ? OR to_email = ?', u.id, u.email),
    admin ? q('SELECT id,name,email,role,status,created_at FROM users WHERE profile_done = 1') : q('SELECT 1 WHERE 0'),
  ]);
  const bk = (r) => {
    const o = { studio: r.studio, date: r.date, hour: r.hour, gid: r.gid, uid: r.user_id, name: r.name, year: r.role, purpose: r.purpose, people: r.people, createdAt: r.created_at };
    if (r.transferred_from) o.transferredFrom = r.transferred_from;
    if (admin || r.user_id === u.id) { o.email = r.email; o.notes = r.notes; } // מייל והערות רק למזמין ולמנהלים
    return o;
  };
  const bookings = {}; for (const r of out[0].results) bookings[keyOf(r)] = bk(r);
  const mine = {}; for (const r of out[1].results) mine[keyOf(r)] = bk(r);
  const noshows = {}; for (const r of out[2].results) noshows[r.gid] = { gid: r.gid, uid: r.user_id, name: r.name, email: r.email, date: r.date, studios: parseJson(r.studios), from: r.from_hour, to: r.to_hour, endAt: r.end_at, markedBy: r.marked_by, at: r.at };
  const releases = {}; for (const r of out[3].results) releases[r.user_id] = { uid: r.user_id, at: r.at, by: r.by_name };
  const transfers = {}; for (const r of out[4].results) transfers[r.gid] = { gid: r.gid, fromUid: r.from_uid, fromName: r.from_name, toEmail: r.to_email, status: r.status, date: r.date, from: r.from_hour, to: r.to_hour, studios: parseJson(r.studios), createdAt: r.created_at };
  const members = {}; for (const r of out[5].results) members[r.id] = { uid: r.id, name: r.name, email: r.email, role: r.role, status: r.status, createdAt: r.created_at };
  const profile = u.profile_done ? { name: u.name, year: u.role, email: u.email, photo: u.photo, createdAt: u.created_at, updatedAt: u.updated_at } : null;
  const member = u.profile_done ? { uid: u.id, name: u.name, email: u.email, role: u.role, status: isAdmin(u) ? 'approved' : u.status, createdAt: u.created_at } : null;
  return json({ v: ver, me: { uid: u.id, email: u.email, isAdmin: admin, suggest: u.profile_done ? '' : u.name }, profile, member, bookings, mine, noshows, releases, transfers, members });
}

/* ---------- הזמנות ---------- */
async function createBooking(c) {
  const { env, request } = c;
  const u = await needUser(c);
  await rateLimit(env, 'w:' + u.id, 40, 60);
  const b = await readBody(request);
  if (!u.profile_done) fail(403, 'no_profile', 'כדי להזמין צריך להשלים הרשמה.');
  if (!canBook(u)) fail(403, 'not_approved', 'ההרשמה שלך עדיין לא אושרה על ידי מנהל.');
  if ((await strikesOf(env, u.id)) >= RULES.MAX_STRIKES) fail(403, 'blocked', 'ההזמנה חסומה עבורך עקב אי-הגעות. לשחרור פנו למנהלי המערכת.');
  const ids = Array.isArray(b.studios) ? [...new Set(b.studios.map(String))] : [];
  if (!ids.length || ids.length > RULES.MAX_STATIONS || ids.some((i) => !STUDIOS.some((s) => s.id === i))) fail(400, 'studios', 'בחירת העמדות לא תקינה.');
  if (!validDate(b.date)) fail(400, 'date', 'תאריך לא תקין.');
  const why = blockedReason(b.date);
  if (why) fail(400, 'date_blocked', `אי אפשר להזמין בתאריך הזה (${why}).`);
  const start = b.start, dur = b.dur;
  if (!Number.isInteger(start) || !Number.isInteger(dur) || dur < 1 || dur > RULES.MAX_DAY || start < RULES.OPEN || start + dur > closeOf(b.date)) fail(400, 'hours', 'השעות שנבחרו אינן תקינות.');
  if (absMin(b.date, start) <= nowAbs()) fail(400, 'past', 'אי אפשר להזמין שעה שכבר התחילה.');
  if (!PURPOSES.includes(b.purpose)) fail(400, 'purpose', 'נא לבחור מטרת שימוש.');
  const cap = ids.reduce((a, i) => a + STUDIOS.find((s) => s.id === i).cap, 0);
  const people = b.people;
  if (!Number.isInteger(people) || people < 1 || people > cap) fail(400, 'people', `מספר המשתתפים בהזמנה הזאת הוא בין 1 ל-${cap}.`);
  const notes = typeof b.notes === 'string' ? b.notes.slice(0, 300) : '';
  const own = (await env.DB.prepare('SELECT hour FROM bookings WHERE user_id = ? AND date = ?').bind(u.id, b.date).all()).results;
  const hrs = new Set(own.map((r) => r.hour)); for (let i = 0; i < dur; i++) hrs.add(start + i);
  if (hrs.size > RULES.MAX_DAY) fail(400, 'quota', `ההזמנה חורגת ממכסה של ${RULES.MAX_DAY} שעות ליום.`);
  const gid = randomHex(8), now = Date.now(), stmts = [];
  for (let i = 0; i < dur; i++) for (const s of ids)
    stmts.push(env.DB.prepare('INSERT INTO bookings (studio,date,hour,gid,user_id,name,email,role,purpose,people,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(s, b.date, start + i, gid, u.id, u.name, u.email, u.role, b.purpose, people, notes, now));
  stmts.push(bump(env));
  try { await env.DB.batch(stmts); } // כל ההזמנה נשמרת יחד או לא נשמרת בכלל
  catch (e) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) fail(409, 'taken', 'אחת העמדות או השעות שבחרתם הוזמנה לפני רגע. ההזמנה לא נשמרה. בחרו שעה או עמדה אחרת.');
    throw e;
  }
  const after = await env.DB.prepare('SELECT COUNT(DISTINCT hour) AS n FROM bookings WHERE user_id = ? AND date = ?').bind(u.id, b.date).first();
  if (after.n > RULES.MAX_DAY) { // הגנה מפני שתי בקשות במקביל של אותו משתמש
    await env.DB.batch([env.DB.prepare('DELETE FROM bookings WHERE gid = ?').bind(gid), bump(env)]);
    fail(409, 'quota', `ההזמנה חורגת ממכסה של ${RULES.MAX_DAY} שעות ליום.`);
  }
  return json({ ok: true, gid });
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
  const st = [env.DB.prepare('DELETE FROM bookings WHERE gid = ?').bind(gid), env.DB.prepare('DELETE FROM transfers WHERE gid = ?').bind(gid), bump(env)];
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
  if (!EMAIL_RE.test(to)) fail(400, 'email', 'נא להזין מייל ארגוני בסיומת @' + EMAIL_DOMAIN + '.');
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
  const now = Date.now(), status = isAdmin(u) ? 'approved' : u.status;
  const st = [
    env.DB.prepare('UPDATE users SET name = ?, role = ?, photo = ?, profile_done = 1, status = ?, updated_at = ? WHERE id = ?').bind(name, b.year, photo, status, now, u.id),
    env.DB.prepare('UPDATE bookings SET name = ?, role = ? WHERE user_id = ? AND date >= ?').bind(name, b.year, u.id, israelNow().date),
    bump(env),
  ];
  if (first) st.push(audit(env, u, 'register', u.email));
  await env.DB.batch(st);
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
  if (t.status !== 'removed' && t.status !== 'rejected') fail(400, 'status', 'אפשר למחוק לגמרי רק משתמש שהוסר או שלא אושר.');
  const today = israelNow().date;
  await env.DB.batch([
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
  const out = await env.DB.batch([
    env.DB.prepare('SELECT name,email,role,status,created_at FROM users WHERE profile_done = 1 ORDER BY name'),
    env.DB.prepare('SELECT gid,date,MIN(hour) AS lo,MAX(hour) AS hi,group_concat(DISTINCT studio) AS st,name,email,role,purpose,people,notes FROM bookings GROUP BY gid ORDER BY date, lo'),
    env.DB.prepare('SELECT name,email,end_at FROM noshows ORDER BY end_at'),
    audit(env, a, 'export', ''),
  ]);
  return json({ users: out[0].results, bookings: out[1].results, noshows: out[2].results });
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
async function auditList(c) {
  await needAdmin(c);
  const r = await c.env.DB.prepare('SELECT at,actor_email,action,target,detail FROM audit_log ORDER BY id DESC LIMIT 100').all();
  return json({ items: r.results });
}

import { EMAIL_DOMAIN, EMAIL_RE } from './config.js';
import { b64urlToBytes, fail, randomHex, bytesToB64url, sha256Hex } from './util.js';

const dec = new TextDecoder();
let jwksCache = { url: '', at: 0, keys: null };

async function getJwks(env, force) {
  const url = env.GOOGLE_JWKS_URL;
  if (!force && jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const r = await fetch(url);
  if (!r.ok) fail(502, 'jwks', 'לא הצלחנו לאמת מול Google. נסו שוב.');
  const j = await r.json();
  jwksCache = { url, at: Date.now(), keys: j.keys || [] };
  return jwksCache.keys;
}

/* מאמת אסימון זהות של Google: חתימה, מנפיק, קהל יעד, תוקף, דומיין המכללה */
export async function verifyGoogleToken(idToken, env) {
  const bad = () => fail(401, 'bad_token', 'הכניסה נכשלה. נסו שוב.');
  if (typeof idToken !== 'string' || idToken.length > 4096) bad();
  const parts = idToken.split('.'); if (parts.length !== 3) bad();
  let header, payload;
  try { header = JSON.parse(dec.decode(b64urlToBytes(parts[0]))); payload = JSON.parse(dec.decode(b64urlToBytes(parts[1]))); } catch { bad(); }
  if (header.alg !== 'RS256' || !header.kid) bad();
  let keys = await getJwks(env, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await getJwks(env, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) bad();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const okSig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!okSig) bad();
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== env.GOOGLE_CLIENT_ID) bad();
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') bad();
  if (!(payload.exp > now - 30) || (payload.iat && payload.iat > now + 300)) bad();
  if (payload.email_verified !== true && payload.email_verified !== 'true') bad();
  const email = String(payload.email || '').toLowerCase();
  if (!EMAIL_RE.test(email) || payload.hd !== EMAIL_DOMAIN) fail(403, 'domain', 'הכניסה אפשרית רק עם חשבון Google של המכללה, בסיומת @' + EMAIL_DOMAIN);
  if (!payload.sub) bad();
  return { sub: String(payload.sub), email, gname: String(payload.name || '').slice(0, 80) };
}

export const COOKIE = '__Host-yb';
export const SESSION_MS = 7 * 86400e3;
export function newSessionToken() { return bytesToB64url(crypto.getRandomValues(new Uint8Array(32))); }
export const hashToken = (t) => sha256Hex('yb-session:' + t);
export function cookieHeader(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}
export function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  for (const p of raw.split(';')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === COOKIE) return p.slice(i + 1).trim(); }
  return '';
}
export { randomHex };

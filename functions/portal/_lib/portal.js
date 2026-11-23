// 통합 포털(doctorville.github.io/portal) 공통 — 계정·서비스 권한 확인
// 계정 기준 (모두 같은 Nhost DB):
//   업무 포털      portal.accounts (email, role admin|member, active)  ← 포털 계정 관리 화면에서 관리
//   운영 대시보드  public.profiles (email, active=true)
//   주간 업무 보고 teamwork.members (id = auth.users.id)
//   업무·위험 모니터 dvops.members (email, active=true)
//   세미나 관리자  별도 Supabase: profiles(login_id=메일, role=admin, status=active) 또는 admin_invites
//                  (Nhost 환경변수 SEMINAR_SUPABASE_SERVICE_ROLE 이 있어야 확인 가능)
// 로그인 허용: 포털 계정(사용 중) 또는 서비스 계정 중 하나라도 있으면 허용.
//             단, 포털 계정이 '사용 중지'면 서비스 계정이 있어도 포털 로그인 차단.
// 제안서 생성기: 포털 로그인 허용자 전원
import { runSqlClient } from '../../teamwork/_lib/db.js';
import { bearer } from '../../teamwork/_lib/http.js';
import { verifyRequestToken } from '../../teamwork/_lib/auth.js';

export const normEmail = (e) => String(e ?? '').trim().toLowerCase().slice(0, 200);
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const sql = (text, values = []) => runSqlClient(null).query(text, values);
async function one(text, values) {
  try { const { rows } = await sql(text, values); return rows[0] || null; }
  catch (e) { console.error('[portal] sql', e.message); return null; }
}

/** auth.users 조회 */
export async function authUser(email) {
  return one("select id::text as id, disabled from auth.users where lower(email::text) = $1 limit 1", [email]);
}

/** 포털 계정 한 건 (테이블이 아직 없으면 null) */
export async function portalAccount(email) {
  return one('select email, name, org, role, active from portal.accounts where email = $1', [email]);
}

// ── 세미나 관리자 (별도 Supabase, 서비스 롤 키로 서버에서만 조회) ──
const SEMINAR_URL = () => (process.env.SEMINAR_SUPABASE_URL || 'https://lzwbqgexdgtsoihsifke.supabase.co').replace(/\/+$/, '');
const seminarKey = () => (process.env.SEMINAR_SUPABASE_SERVICE_ROLE || '').trim();
export const seminarConfigured = () => !!seminarKey();
async function seminarFetch(path, init = {}) {
  const k = seminarKey();
  return fetch(SEMINAR_URL() + path, { ...init, headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}
async function seminarRows(path) {
  const r = await seminarFetch(path);
  if (!r.ok) throw new Error('seminar ' + r.status);
  return r.json();
}
/** 세미나 관리자(메일 로그인) 여부 */
export async function seminarAdmin(email) {
  if (!seminarConfigured()) return false;
  try {
    const e = encodeURIComponent(email);
    const [p, inv] = await Promise.all([
      seminarRows('/rest/v1/profiles?select=id&role=eq.admin&status=eq.active&login_id=eq.' + e + '&limit=1'),
      seminarRows('/rest/v1/admin_invites?select=email&email=eq.' + e + '&limit=1'),
    ]);
    return p.length > 0 || inv.length > 0;
  } catch (err) { console.error('[portal] seminar check', err.message); return false; }
}
/** 세미나 관리자 전체 (계정 관리 목록용): [{email, name}] */
export async function seminarAdmins() {
  if (!seminarConfigured()) return [];
  try {
    const [p, inv] = await Promise.all([
      seminarRows('/rest/v1/profiles?select=login_id,name&role=eq.admin&status=eq.active&login_id=like.*%40*'),
      seminarRows('/rest/v1/admin_invites?select=email,name'),
    ]);
    return p.map((x) => ({ email: normEmail(x.login_id), name: x.name || '' })).concat(inv.map((x) => ({ email: normEmail(x.email), name: x.name || '' })));
  } catch (err) { console.error('[portal] seminar list', err.message); return []; }
}
/** 세미나 관리자 화면 1회용 로그인 토큰 (메일 발송 없음) */
export async function seminarLoginHash(email) {
  const r = await seminarFetch('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email, data: { admin_otp: true } }) });
  const j = await r.json().catch(() => ({}));
  const h = j.hashed_token || j.properties?.hashed_token;
  if (!r.ok || !h) throw new Error('seminar generate_link ' + r.status + ' ' + (j.msg || j.error_description || ''));
  return h;
}

/** 서비스별 회원 여부 (한 곳이 실패해도 나머지는 판단) */
export async function membership(email) {
  const [acct, dash, monthly, ops, seminar] = await Promise.all([
    portalAccount(email),
    one("select 1 as ok from public.profiles where lower(email) = $1 and active limit 1", [email]),
    one("select 1 as ok from teamwork.members m join auth.users u on u.id = m.id where lower(u.email::text) = $1 limit 1", [email]),
    one("select 1 as ok from dvops.members where lower(email) = $1 and active limit 1", [email]),
    seminarAdmin(email),
  ]);
  const blocked = !!acct && !acct.active;
  const allowed = !blocked && (!!acct || !!dash || !!monthly || !!ops || seminar);
  return {
    allowed, blocked,
    role: acct && acct.active ? acct.role : null,
    account: acct ? { name: acct.name, org: acct.org } : null,
    services: { proposal: allowed, dash: allowed && !!dash, monthly: allowed && !!monthly, ops: allowed && !!ops, seminar: allowed && seminar },
  };
}

/** 포털 로그인용 Nhost 계정 보장 (대시보드·주간보고 권한은 생기지 않음) */
export async function ensureAuthUser(email) {
  const { rows } = await sql('select id::text as id from teamwork.ensure_auth_user($1,$2)', [email, email.split('@')[0]]);
  return rows[0]?.id || null;
}

export function authBase(env = process.env) {
  if (env.NHOST_AUTH_URL) return env.NHOST_AUTH_URL.replace(/\/+$/, '');
  return 'https://' + env.NHOST_SUBDOMAIN + '.auth.' + env.NHOST_REGION + '.nhost.run/v1';
}

/** 요청한 사람의 이메일 (Nhost 토큰 검증) */
export async function callerEmail(req) {
  const u = await verifyRequestToken(bearer(req));
  let email = normEmail(u.email);
  if (!email) {
    const { rows } = await sql('select email::text as email from auth.users where id = $1::uuid and not disabled', [u.id]);
    email = normEmail(rows[0]?.email);
  }
  if (!email) throw Object.assign(Error('로그인이 필요합니다.'), { status: 401 });
  return email;
}

/** (이전 버전 호환) */
export const anyService = (m) => !!(m && (m.allowed || m.dash || m.monthly || m.ops));

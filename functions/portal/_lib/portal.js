// 통합 포털(doctorville.github.io/portal) 공통 — 계정·서비스 권한 확인
// 계정 기준 (모두 같은 Nhost DB):
//   업무 포털      portal.accounts (email, role admin|member, active)  ← 포털 계정 관리 화면에서 관리
//   운영 대시보드  public.profiles (email, active=true)
//   주간 업무 보고 teamwork.members (id = auth.users.id)
//   업무·위험 모니터 dvops.members (email, active=true)
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

/** 서비스별 회원 여부 (한 곳이 실패해도 나머지는 판단) */
export async function membership(email) {
  const [acct, dash, monthly, ops] = await Promise.all([
    portalAccount(email),
    one("select 1 as ok from public.profiles where lower(email) = $1 and active limit 1", [email]),
    one("select 1 as ok from teamwork.members m join auth.users u on u.id = m.id where lower(u.email::text) = $1 limit 1", [email]),
    one("select 1 as ok from dvops.members where lower(email) = $1 and active limit 1", [email]),
  ]);
  const blocked = !!acct && !acct.active;
  const allowed = !blocked && (!!acct || !!dash || !!monthly || !!ops);
  return {
    allowed, blocked,
    role: acct && acct.active ? acct.role : null,
    account: acct ? { name: acct.name, org: acct.org } : null,
    services: { proposal: allowed, dash: allowed && !!dash, monthly: allowed && !!monthly, ops: allowed && !!ops },
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

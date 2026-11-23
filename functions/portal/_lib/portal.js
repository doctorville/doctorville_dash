// 통합 포털(doctorville.github.io/portal) 공통 — 서비스별 계정 확인
// 계정 기준 (모두 같은 Nhost DB):
//   운영 대시보드  public.profiles (email, active=true)
//   주간 업무 보고 teamwork.members (id = auth.users.id)
//   업무·위험 모니터 dvops.members (email, active=true)
//   제안서 생성기  포털 로그인 회원 전원
import { runSqlClient } from '../../teamwork/_lib/db.js';

export const normEmail = (e) => String(e ?? '').trim().toLowerCase().slice(0, 200);
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const admin = () => runSqlClient(null);
async function one(sql, values) {
  try { const { rows } = await admin().query(sql, values); return rows[0] || null; }
  catch (e) { console.error('[portal] sql', e.message); return null; }
}

/** auth.users 조회 */
export async function authUser(email) {
  return one("select id::text as id, disabled from auth.users where lower(email::text) = $1 limit 1", [email]);
}

/** 서비스별 회원 여부 (한 곳이 실패해도 나머지는 판단) */
export async function membership(email) {
  const [dash, monthly, ops] = await Promise.all([
    one("select 1 as ok from public.profiles where lower(email) = $1 and active limit 1", [email]),
    one("select 1 as ok from teamwork.members m join auth.users u on u.id = m.id where lower(u.email::text) = $1 limit 1", [email]),
    one("select 1 as ok from dvops.members where lower(email) = $1 and active limit 1", [email]),
  ]);
  return { proposal: true, dash: !!dash, monthly: !!monthly, ops: !!ops };
}
export const anyService = (s) => s.dash || s.monthly || s.ops;

/** 모니터에만 등록된 사람: 포털 로그인용 Nhost 계정만 생성 (대시보드·주간보고 권한은 생기지 않음) */
export async function ensureAuthUser(email) {
  const { rows } = await admin().query('select id::text as id from teamwork.ensure_auth_user($1,$2)', [email, email.split('@')[0]]);
  return rows[0]?.id || null;
}

export function authBase(env = process.env) {
  if (env.NHOST_AUTH_URL) return env.NHOST_AUTH_URL.replace(/\/+$/, '');
  return 'https://' + env.NHOST_SUBDOMAIN + '.auth.' + env.NHOST_REGION + '.nhost.run/v1';
}

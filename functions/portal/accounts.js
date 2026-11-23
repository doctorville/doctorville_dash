// 통합 포털 — 계정 관리 (포털 관리자 전용) · Nhost Functions
// POST https://<subdomain>.functions.<region>.nhost.run/v1/portal/accounts   (Authorization: Bearer <포털 토큰>)
//   { action: 'list' }
//   { action: 'save', email, name, org, role: 'admin'|'member', active: true|false, note }
//   { action: 'delete', email }
// 포털 계정만 바꿉니다. 대시보드·주간보고·모니터의 계정·권한은 각 서비스 관리 화면에서 관리합니다.
import { applyCors, readBody } from '../teamwork/_lib/http.js';
import { callerEmail, portalAccount, normEmail, isEmail, sql, ensureAuthUser, seminarAdmins } from './_lib/portal.js';

const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const ROLES = ['admin', 'member'];

const LIST_SQL = `
with p as (select lower(email) as e, name, org from public.profiles where active),
     t as (select lower(u.email::text) as e, m.name from teamwork.members m join auth.users u on u.id = m.id),
     o as (select lower(email) as e, name from dvops.members where active),
     ids as (select email as e from portal.accounts union select e from p union select e from t union select e from o)
select ids.e as email,
       coalesce(nullif(a.name, ''), (select name from p where p.e = ids.e limit 1), (select name from t where t.e = ids.e limit 1), (select name from o where o.e = ids.e limit 1), '') as name,
       coalesce(nullif(a.org, ''), (select org from p where p.e = ids.e limit 1), '') as org,
       a.role, a.active, coalesce(a.note, '') as note, to_char(a.updated_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as updated_at, a.updated_by,
       (a.email is not null) as has_portal,
       exists(select 1 from p where p.e = ids.e) as dash,
       exists(select 1 from t where t.e = ids.e) as monthly,
       exists(select 1 from o where o.e = ids.e) as ops
from ids left join portal.accounts a on a.email = ids.e
order by (a.role = 'admin' and a.active) desc nulls last, (a.email is null), ids.e`;

async function activeAdminsExcept(email) {
  const { rows } = await sql("select count(*)::int as n from portal.accounts where role = 'admin' and active and email <> $1", [email]);
  return Number(rows[0]?.n || 0);
}

export default async (req, res) => {
  if (applyCors(req, res)) return;
  const out = (body, status = 200) => res.status(status).json(body);
  try {
    const me = await callerEmail(req);
    const acct = await portalAccount(me);
    if (!acct || !acct.active || acct.role !== 'admin') return out({ ok: false, message: '포털 관리자만 계정을 관리할 수 있습니다.' }, 403);

    const b = await readBody(req);
    const action = s(b.action, 20);

    if (action === 'list') {
      const [{ rows }, sem] = await Promise.all([sql(LIST_SQL), seminarAdmins()]);
      // 세미나 관리자(별도 Supabase)를 목록에 합침
      const byEmail = new Map(rows.map((r) => [r.email, r]));
      for (const a of sem) {
        const r = byEmail.get(a.email);
        if (r) { r.seminar = true; if (!r.name) r.name = a.name; }
        else { const n = { email: a.email, name: a.name, org: '', role: null, active: null, note: '', updated_at: null, updated_by: null, has_portal: false, dash: false, monthly: false, ops: false, seminar: true }; rows.push(n); byEmail.set(a.email, n); }
      }
      return out({ ok: true, me, accounts: rows });
    }

    const email = normEmail(b.email);
    if (!isEmail(email)) return out({ ok: false, message: '이메일 형식을 확인해 주세요.' }, 400);

    if (action === 'save') {
      const role = s(b.role, 10) || 'member';
      const active = b.active !== false;
      if (!ROLES.includes(role)) return out({ ok: false, message: '권한을 선택해 주세요.' }, 400);
      if (!(role === 'admin' && active) && (await activeAdminsExcept(email)) === 0) {
        return out({ ok: false, message: '사용 중인 관리자가 최소 1명은 있어야 합니다.' }, 400);
      }
      await sql(`insert into portal.accounts (email, name, org, role, active, note, updated_by)
                 values ($1, $2, $3, $4, $5, $6, $7)
                 on conflict (email) do update set name = excluded.name, org = excluded.org, role = excluded.role,
                   active = excluded.active, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`,
        [email, s(b.name, 60), s(b.org, 60), role, active, s(b.note, 300), me]);
      if (active) await ensureAuthUser(email).catch((e) => console.error('[portal] ensure user', e.message));
      return out({ ok: true });
    }

    if (action === 'delete') {
      const target = await portalAccount(email);
      if (!target) return out({ ok: false, message: '포털 계정이 없습니다.' }, 404);
      if (target.role === 'admin' && target.active && (await activeAdminsExcept(email)) === 0) {
        return out({ ok: false, message: '마지막 관리자는 삭제할 수 없습니다.' }, 400);
      }
      await sql('delete from portal.accounts where email = $1', [email]);
      return out({ ok: true });
    }

    return out({ ok: false, message: '알 수 없는 요청입니다.' }, 400);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[portal] accounts', e);
    return out({ ok: false, message: status === 401 ? '로그인이 필요합니다.' : '서버 오류가 발생했습니다.' }, status);
  }
};

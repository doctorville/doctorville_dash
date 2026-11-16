// 닥터빌 · 팜빌 운영 대시보드 — 계정 관리 함수 (admin-users) · Nhost Functions
// 최고 관리자(profiles.role = 'super')만 호출 가능. 계정 등록·수정·삭제.
// 로그인은 이메일 인증 코드(OTP) — 계정 등록 시 비밀번호를 받지 않음.
// 배포: GitHub 저장소(functions/ 폴더)를 Nhost에 연결하면 push 때 자동 배포
import { cors, adminGql, adminDb, whoami, readBody } from './_lib/common.js';

const ROLES = ['super', 'admin', 'dv', 'partner'];
const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);

export default async (req, res) => {
  if (cors(req, res)) return;
  const out = (body, status = 200) => res.status(status).json(body);
  try {
    const me = await whoami(req);
    if (!me) return out({ ok: false, error: '로그인이 필요합니다.' }, 401);
    if (!me.active || me.role !== 'super') return out({ ok: false, error: '최고 관리자만 계정을 관리할 수 있습니다.' }, 403);
    const admin = adminDb();
    const b = await readBody(req);
    const action = s(b.action, 20);
    const superCount = async () => (await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'super').eq('active', true)).count || 0;

    if (action === 'create') {
      const email = s(b.email, 200).toLowerCase(), role = s(b.role, 10);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return out({ ok: false, error: '아이디는 이메일 형식으로 입력해 주세요.' }, 400);
      if (!ROLES.includes(role)) return out({ ok: false, error: '권한을 선택해 주세요.' }, 400);
      if (!s(b.name)) return out({ ok: false, error: '이름을 입력해 주세요.' }, 400);
      // Nhost 계정 (비밀번호 없음 → 이메일 인증 코드로만 로그인)
      let uid;
      try {
        const d = await adminGql('mutation($u:users_insert_input!){u:insertUser(object:$u){id}}', {
          u: { email, emailVerified: true, displayName: s(b.name, 60), locale: 'en', defaultRole: 'user', roles: { data: [{ role: 'user' }, { role: 'me' }] } },
        });
        uid = d.u.id;
      } catch (e) {
        const m = String(e.message || e);
        return out({ ok: false, error: /unique|duplicate|already|exists/i.test(m) ? '이미 등록된 아이디입니다.' : '계정을 만들지 못했습니다: ' + m }, 400);
      }
      const { error: pe } = await admin.from('profiles').insert({ id: uid, email, name: s(b.name, 60), org: s(b.org, 100), role, created_by: me.id, updated_by: me.id });
      if (pe) {
        await adminGql('mutation($id:uuid!){deleteUser(id:$id){id}}', { id: uid }).catch(() => {});
        return out({ ok: false, error: '프로필 저장 실패: ' + pe.message }, 500);
      }
      return out({ ok: true, id: uid });
    }

    const id = s(b.id, 60);
    if (!id) return out({ ok: false, error: '대상 계정이 없습니다.' }, 400);
    const { data: target } = await admin.from('profiles').select('id, role').eq('id', id).maybeSingle();
    if (!target) return out({ ok: false, error: '계정을 찾지 못했습니다.' }, 404);

    if (action === 'update') {
      const role = s(b.role, 10);
      if (!ROLES.includes(role)) return out({ ok: false, error: '권한을 선택해 주세요.' }, 400);
      if (!s(b.name)) return out({ ok: false, error: '이름을 입력해 주세요.' }, 400);
      if (target.role === 'super' && role !== 'super' && (await superCount()) <= 1) return out({ ok: false, error: '최고 관리자는 최소 1명이 있어야 합니다.' }, 400);
      const { error } = await admin.from('profiles').update({ name: s(b.name, 60), org: s(b.org, 100), role, updated_by: me.id }).eq('id', id);
      if (error) return out({ ok: false, error: error.message }, 500);
      return out({ ok: true });
    }
    if (action === 'delete') {
      if (id === me.id) return out({ ok: false, error: '내 계정은 삭제할 수 없습니다.' }, 400);
      if (target.role === 'super' && (await superCount()) <= 1) return out({ ok: false, error: '최고 관리자는 최소 1명이 있어야 합니다.' }, 400);
      try { await adminGql('mutation($id:uuid!){deleteUser(id:$id){id}}', { id }); }   // profiles 는 on delete cascade 로 함께 삭제
      catch (e) { return out({ ok: false, error: String(e.message || e) }, 500); }
      return out({ ok: true });
    }
    return out({ ok: false, error: '알 수 없는 요청입니다.' }, 400);
  } catch (e) {
    return out({ ok: false, error: String(e?.message || e) }, 500);
  }
};

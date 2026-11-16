// 닥터빌 운영 대시보드 — 회원 활동 주간 업무 함수 (weekly-activity) · Nhost Functions
// 열람: 최고 관리자(super) + 최고 관리자가 [계정 관리]에서 지정한 사람(public.view_grants, view = 'wact')
// 데이터: 주간 업무 보고 DB(별도 Supabase 프로젝트)의 제출 완료(status = 'submitted') 보고 중 서비스 닥터빌·공통 항목
//   → 대시보드 DB(datasets)에는 저장하지 않음 (지정된 사람만 보도록)
// 환경 변수(필수, Nhost 대시보드 → Settings → Secrets 에 값, Environment Variables 에서 연결): 코드·저장소에는 절대 넣지 않음
//   WEEKLY_SB_URL = 주간 업무 보고 프로젝트 URL (https://<ref>.supabase.co)
//   WEEKLY_SB_KEY = 주간 업무 보고 프로젝트의 service_role(secret) 키 — 서버에서 읽기 전용으로만 사용
import { cors, adminDb, whoami } from './_lib/common.js';

const SERVICES = ['닥터빌', '공통'];
const WEEKS = 12;            // 최근 몇 주까지
const MAX_RESULT = 1500;     // 결과(실적) 최대 글자 수
const ymd = (d) => d.toISOString().slice(0, 10);

async function rest(base, key, path) {
  const r = await fetch(base.replace(/\/+$/, '') + '/rest/v1/' + path, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.error)) || 'HTTP ' + r.status);
  return j || [];
}

export default async (req, res) => {
  if (cors(req, res)) return;
  const out = (body, status = 200) => res.status(status).json(body);
  try {
    // 1) 호출한 사람 확인 (대시보드 DB)
    const me = await whoami(req);
    if (!me) return out({ ok: false, error: '로그인이 필요합니다.' }, 401);
    if (!me.active || !me.role) return out({ ok: false, error: '사용할 수 없는 계정입니다.' }, 403);
    if (me.role === 'partner') return out({ ok: false, error: '내부 담당자만 볼 수 있습니다.' }, 403);
    if (me.role !== 'super') {
      const { data: g } = await adminDb().from('view_grants').select('view').eq('user_id', me.id).eq('view', 'wact').maybeSingle();
      if (!g) return out({ ok: false, error: '회원 활동 주간 업무는 최고 관리자가 지정한 사람만 볼 수 있습니다.' }, 403);
    }
    // 2) 주간 업무 보고 프로젝트 읽기
    const wUrl = process.env.WEEKLY_SB_URL, wKey = process.env.WEEKLY_SB_KEY;
    if (!wUrl || !wKey) return out({ ok: false, error: '주간 업무 보고 DB 연결 정보가 없습니다. Nhost 환경 변수에 WEEKLY_SB_URL · WEEKLY_SB_KEY를 추가해 주세요.' }, 500);
    const since = ymd(new Date(Date.now() - (WEEKS * 7 + 7) * 86400000));
    const [rep, mem] = await Promise.all([
      rest(wUrl, wKey, 'reports?select=user_id,week_start,items&status=eq.submitted&week_start=gte.' + since + '&order=week_start.desc&limit=500').catch((e) => { throw new Error('reports: ' + e.message); }),
      rest(wUrl, wKey, 'members?select=id,name').catch((e) => { throw new Error('members: ' + e.message); }),
    ]);
    const names = new Map(mem.map((m) => [m.id, m.name]));
    const items = [];
    for (const r of rep) {
      for (const it of (Array.isArray(r.items) ? r.items : [])) {
        if (!it || !SERVICES.includes(String(it.service || '').trim())) continue;
        const title = String(it.title || '').trim(); if (!title) continue;
        items.push({
          week: r.week_start, owner: names.get(r.user_id) || '', service: it.service, project: it.project || '',
          title, state: it.state || '', progress: Math.max(0, Math.min(100, Number(it.progress) || 0)),
          result: String(it.result || '').trim().slice(0, MAX_RESULT), target: it.target_date || '',
        });
      }
    }
    const weeks = Array.from(new Set(items.map((x) => x.week))).sort().reverse().slice(0, WEEKS);
    return out({ ok: true, fetchedAt: new Date().toISOString(), weeks, items: items.filter((x) => weeks.includes(x.week)) });
  } catch (e) {
    return out({ ok: false, error: '주간 업무 보고를 불러오지 못했습니다: ' + (e?.message || e) }, 500);
  }
};

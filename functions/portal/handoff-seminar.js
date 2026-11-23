// 통합 포털 — 세미나 관리자 화면 자동 로그인 · Nhost Functions
// POST https://<subdomain>.functions.<region>.nhost.run/v1/portal/handoff-seminar   (Authorization: Bearer <포털 토큰>)
// 세미나 관리자(별도 Supabase)에게 1회용 로그인 토큰을 만들어, 관리자 화면 주소(#portal_th=…)로 돌려줍니다.
// 토큰은 주소의 # 뒤에만 실려 서버 로그에 남지 않고, 관리자 화면이 읽자마자 지웁니다.
import { applyCors } from '../teamwork/_lib/http.js';
import { callerEmail, membership, seminarConfigured, seminarLoginHash } from './_lib/portal.js';

const ADMIN_URL = process.env.SEMINAR_ADMIN_URL || 'https://doctorville.github.io/doctorville-seminar/admin/';

export default async (req, res) => {
  if (applyCors(req, res)) return;
  const out = (body, status = 200) => res.status(status).json(body);
  try {
    if (!seminarConfigured()) return out({ ok: false, message: '세미나 연결 설정(SEMINAR_SUPABASE_SERVICE_ROLE)이 아직 없습니다.' }, 503);
    const email = await callerEmail(req);
    const m = await membership(email);
    if (!m.services.seminar) return out({ ok: false, message: '세미나 관리자 계정이 없습니다.' }, 403);
    const hash = await seminarLoginHash(email);
    return out({ ok: true, url: ADMIN_URL + '#portal_th=' + encodeURIComponent(hash) });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[portal] handoff-seminar', e);
    return out({ ok: false, message: status === 401 ? '로그인이 필요합니다.' : '세미나 자동 로그인 링크를 만들지 못했습니다.' }, status);
  }
};

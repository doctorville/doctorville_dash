// 통합 포털 — 로그인 사용자의 권한·서비스 목록 · Nhost Functions
// POST https://<subdomain>.functions.<region>.nhost.run/v1/portal/me   (Authorization: Bearer <포털 토큰>)
// 제안서 생성기 서버(Cloudflare Worker)도 이 함수로 포털 로그인 여부를 확인합니다.
import { applyCors } from '../teamwork/_lib/http.js';
import { callerEmail, membership } from './_lib/portal.js';

export default async (req, res) => {
  if (applyCors(req, res)) return;
  try {
    const email = await callerEmail(req);
    const m = await membership(email);
    if (!m.allowed) return res.status(403).json({ error: m.blocked ? 'blocked' : 'not_member' });
    return res.status(200).json({ email, role: m.role, account: m.account, services: m.services });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[portal] me', e);
    return res.status(status).json({ error: status === 401 ? 'unauthorized' : 'server' });
  }
};

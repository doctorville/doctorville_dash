// 통합 포털 — 로그인 사용자가 쓸 수 있는 서비스 목록 · Nhost Functions
// POST https://<subdomain>.functions.<region>.nhost.run/v1/portal/me   (Authorization: Bearer <포털 토큰>)
import { applyCors, bearer } from '../teamwork/_lib/http.js';
import { verifyRequestToken } from '../teamwork/_lib/auth.js';
import { normEmail, membership } from './_lib/portal.js';
import { runSqlClient } from '../teamwork/_lib/db.js';

export default async (req, res) => {
  if (applyCors(req, res)) return;
  try {
    const u = await verifyRequestToken(bearer(req));
    let email = normEmail(u.email);
    if (!email) {
      const { rows } = await runSqlClient(null).query('select email::text as email from auth.users where id = $1::uuid and not disabled', [u.id]);
      email = normEmail(rows[0]?.email);
    }
    if (!email) return res.status(401).json({ error: 'unauthorized' });
    return res.status(200).json({ email, services: await membership(email) });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[portal] me', e);
    return res.status(status).json({ error: status === 401 ? 'unauthorized' : 'server' });
  }
};

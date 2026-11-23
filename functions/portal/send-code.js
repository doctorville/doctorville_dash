// 통합 포털 — 인증코드 발송 · Nhost Functions
// POST https://<subdomain>.functions.<region>.nhost.run/v1/portal/send-code  { email }
// 포털 계정 또는 서비스 계정이 있으면 Nhost 이메일 인증코드(OTP)를 보냅니다.
import { applyCors, readBody } from '../teamwork/_lib/http.js';
import { normEmail, isEmail, authUser, membership, ensureAuthUser, authBase } from './_lib/portal.js';

export default async (req, res) => {
  if (applyCors(req, res)) return;
  const out = (body, status = 200) => res.status(status).json(body);
  try {
    const email = normEmail((await readBody(req)).email);
    if (!isEmail(email)) return out({ ok: false, message: '이메일 형식을 확인해 주세요.' }, 400);
    const user = await authUser(email);
    const m = await membership(email);
    if (user?.disabled || m.blocked) return out({ ok: false, message: '사용 중지된 계정입니다. 포털 관리자에게 문의해 주세요.' }, 403);
    if (!m.allowed) return out({ ok: false, message: '등록된 계정이 아닙니다. 포털 관리자에게 계정을 요청해 주세요.' }, 404);
    if (!user) await ensureAuthUser(email);

    const r = await fetch(authBase() + '/signin/otp/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
    });
    if (!r.ok) {
      console.error('[portal] otp', r.status, (await r.text()).slice(0, 300));
      return out({ ok: false, message: r.status === 429 ? '요청이 많습니다. 1분 후 다시 시도해 주세요.' : '인증코드를 보내지 못했습니다.' }, r.status === 429 ? 429 : 502);
    }
    return out({ ok: true });
  } catch (e) {
    console.error('[portal] send-code', e);
    return out({ ok: false, message: '서버 오류가 발생했습니다.' }, e.status || 500);
  }
};

// 서버 함수 공통: CORS · Hasura GraphQL 호출 · 호출한 사람 확인
// NHOST_GRAPHQL_URL · NHOST_ADMIN_SECRET 는 Nhost가 자동으로 넣어 줍니다 (따로 설정하지 않음).
import { makeHdb } from './hdb.js';

export const ALLOW_ORIGINS = ['https://doctorville.github.io', 'https://ojungin.github.io'];

export function cors(req, res) {
  const o = req.headers.origin || '';
  res.set('Access-Control-Allow-Origin', ALLOW_ORIGINS.includes(o) ? o : ALLOW_ORIGINS[0]);
  res.set('Access-Control-Allow-Headers', 'authorization, x-client-info, content-type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return true; }
  return false;
}

function gqlUrl() {
  const u = process.env.NHOST_GRAPHQL_URL;
  if (!u) throw new Error('NHOST_GRAPHQL_URL 이 없습니다.');
  return u;
}
async function gql(headers, query, variables) {
  const r = await fetch(gqlUrl(), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (j.errors && j.errors.length) throw new Error(j.errors[0].message || 'GraphQL 오류');
  if (!r.ok) throw new Error('GraphQL HTTP ' + r.status);
  return j.data;
}
// 관리자 권한 (Hasura admin secret) — 서버 안에서만 사용
export const adminGql = (q, v) => gql({ 'x-hasura-admin-secret': process.env.NHOST_ADMIN_SECRET || '' }, q, v);
export const adminDb = () => makeHdb(adminGql);
// 호출한 사람 권한 (로그인 토큰 그대로 → Hasura 권한 적용)
export const userDb = (authz) => makeHdb((q, v) => gql({ authorization: authz }, q, v));

// 로그인 토큰 확인: Hasura가 토큰 서명을 검증하고, 본인 프로필 행을 돌려줌
export async function whoami(req) {
  const authz = req.headers.authorization || '';
  const jwt = authz.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt.split('.').length !== 3) return null;
  let sub = '';
  try { sub = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).sub || ''; } catch { return null; }
  if (!/^[0-9a-f-]{36}$/i.test(sub)) return null;
  try {
    const d = await gql({ authorization: authz }, 'query($id:uuid!){p:profiles_by_pk(id:$id){id role active}}', { id: sub });
    return d && d.p ? { ...d.p, authz } : { id: sub, role: null, active: false, authz };
  } catch { return null; }
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

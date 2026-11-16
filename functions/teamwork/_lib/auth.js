// Nhost 로그인 토큰(JWT) 검증. Nhost Function에는 NHOST_JWT_SECRET({"type":"HS256","key":"..."})이 자동 주입됩니다.
import {createHmac,timingSafeEqual} from 'node:crypto';
const b64=s=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64');
export function jwtSecret(env=process.env){
 const raw=env.NHOST_JWT_SECRET||env.HASURA_GRAPHQL_JWT_SECRET;
 if(!raw)throw Object.assign(Error('서버에 NHOST_JWT_SECRET이 없습니다.'),{status:500});
 let cfg;try{cfg=JSON.parse(raw);}catch{throw Object.assign(Error('NHOST_JWT_SECRET 형식 오류'),{status:500});}
 if(cfg.type!=='HS256'&&cfg.type!=='HS512')throw Object.assign(Error('지원하지 않는 JWT 방식입니다: '+cfg.type+' (HS256/HS512만 지원)'),{status:500});
 return cfg;
}
export function verifyToken(token,env=process.env,now=Date.now()){
 const fail=msg=>Object.assign(Error(msg||'로그인이 만료되었습니다. 다시 로그인해주세요.'),{status:401});
 if(!token)throw fail('로그인이 필요합니다.');
 const parts=String(token).split('.');if(parts.length!==3)throw fail();
 let header,payload;try{header=JSON.parse(b64(parts[0]).toString('utf8'));payload=JSON.parse(b64(parts[1]).toString('utf8'));}catch{throw fail();}
 const cfg=jwtSecret(env),alg=cfg.type;
 if(header.alg!==alg)throw fail();
 const expected=createHmac(alg==='HS512'?'sha512':'sha256',cfg.key).update(parts[0]+'.'+parts[1]).digest();
 const given=b64(parts[2]);
 if(given.length!==expected.length||!timingSafeEqual(given,expected))throw fail();
 if(typeof payload.exp!=='number'||payload.exp*1000<=now)throw fail();
 const claims=payload['https://hasura.io/jwt/claims']||{};
 const id=String(claims['x-hasura-user-id']||payload.sub||'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw fail();
 return {id,email:payload.email||null,claims};
}

// NHOST_JWT_SECRET이 함수에 없으면 Hasura(GraphQL)에 토큰을 보내 서명을 검증합니다(대시보드 함수와 같은 방식).
export async function verifyRequestToken(token,env=process.env,fetchImpl=fetch){
 if(env.NHOST_JWT_SECRET||env.HASURA_GRAPHQL_JWT_SECRET)return verifyToken(token,env);
 const fail=msg=>Object.assign(Error(msg||'로그인이 만료되었습니다. 다시 로그인해주세요.'),{status:401});
 if(!token||String(token).split('.').length!==3)throw fail('로그인이 필요합니다.');
 const url=env.NHOST_GRAPHQL_URL;if(!url)throw Object.assign(Error('서버에 NHOST_GRAPHQL_URL이 없습니다.'),{status:500});
 const r=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({query:'query{__typename}'})});
 const j=await r.json().catch(()=>({}));if(!r.ok||j.errors?.length)throw fail();
 let payload;try{payload=JSON.parse(b64(String(token).split('.')[1]).toString('utf8'));}catch{throw fail();}
 const claims=payload['https://hasura.io/jwt/claims']||{},id=String(claims['x-hasura-user-id']||payload.sub||'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw fail();
 return {id,email:payload.email||null,claims};
}

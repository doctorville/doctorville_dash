// Nhost 로그인 토큰(JWT) 검증. Nhost Function에는 NHOST_JWT_SECRET이 자동 주입됩니다.
// 지원: HS256/HS512(공유 키), RS256/RS384/RS512(공개 키 key). 키를 쓸 수 없으면 Hasura(GraphQL)에 토큰을 보내 검증합니다.
import {createHmac,timingSafeEqual,createPublicKey,verify as rsaVerify} from 'node:crypto';
const b64=s=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=msg=>Object.assign(Error(msg||'로그인이 만료되었습니다. 다시 로그인해주세요.'),{status:401});
export function jwtSecret(env=process.env){
 const raw=env.NHOST_JWT_SECRET||env.HASURA_GRAPHQL_JWT_SECRET;
 if(!raw)return null;
 try{return JSON.parse(raw);}catch{return null;}
}
function decode(token){
 if(!token)throw fail('로그인이 필요합니다.');
 const parts=String(token).split('.');if(parts.length!==3)throw fail();
 try{return {parts,header:JSON.parse(b64(parts[0]).toString('utf8')),payload:JSON.parse(b64(parts[1]).toString('utf8'))};}catch{throw fail();}
}
function userOf(payload,now=Date.now()){
 if(typeof payload.exp!=='number'||payload.exp*1000<=now)throw fail();
 const claims=payload['https://hasura.io/jwt/claims']||{};
 const id=String(claims['x-hasura-user-id']||payload.sub||'');
 if(!UUID.test(id))throw fail();
 return {id,email:payload.email||null,claims};
}
const HS={HS256:'sha256',HS512:'sha512'},RS={RS256:'sha256',RS384:'sha384',RS512:'sha512'};
// 키로 직접 검증할 수 있으면 true/false, 할 수 없으면 null
function verifyWithKey(parts,header,cfg){
 if(!cfg||!cfg.key||header.alg!==cfg.type)return null;
 const data=Buffer.from(parts[0]+'.'+parts[1]),sig=b64(parts[2]);
 if(HS[cfg.type]){const expected=createHmac(HS[cfg.type],cfg.key).update(data).digest();return sig.length===expected.length&&timingSafeEqual(sig,expected);}
 if(RS[cfg.type]){try{return rsaVerify(RS[cfg.type],data,createPublicKey(cfg.key),sig);}catch{return null;}}
 return null;
}
export function verifyToken(token,env=process.env,now=Date.now()){
 const {parts,header,payload}=decode(token);
 const ok=verifyWithKey(parts,header,jwtSecret(env));
 if(ok===null)throw Object.assign(Error('토큰 검증 키를 사용할 수 없습니다.'),{status:500});
 if(!ok)throw fail();
 return userOf(payload,now);
}
function graphqlUrl(env){
 if(env.NHOST_GRAPHQL_URL)return env.NHOST_GRAPHQL_URL;
 if(env.NHOST_SUBDOMAIN&&env.NHOST_REGION)return 'https://'+env.NHOST_SUBDOMAIN+'.graphql.'+env.NHOST_REGION+'.nhost.run/v1';
 return null;
}
export async function verifyRequestToken(token,env=process.env,fetchImpl=fetch){
 const {parts,header,payload}=decode(token);
 const ok=verifyWithKey(parts,header,jwtSecret(env));
 if(ok===true)return userOf(payload);
 if(ok===false)throw fail();
 // 키로 검증할 수 없는 방식(JWKS 등): Hasura가 서명을 검증하도록 토큰을 보내 확인
 const url=graphqlUrl(env);if(!url)throw Object.assign(Error('서버에 NHOST_GRAPHQL_URL이 없습니다.'),{status:500});
 const r=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({query:'query{__typename}'})});
 const j=await r.json().catch(()=>({}));if(!r.ok||j.errors?.length)throw fail();
 return userOf(payload);
}

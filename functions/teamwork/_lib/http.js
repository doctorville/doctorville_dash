// Nhost Function(Express 형식 req/res) 공통: CORS·JSON 응답·Bearer 토큰 추출
// ALLOWED_ORIGINS: 쉼표로 구분한 허용 출처. 비우면 기본값(doctorville·ojungin GitHub Pages)을 씁니다.
export const DEFAULT_ORIGINS='https://doctorville.github.io,https://ojungin.github.io';
export function allowedOrigins(env=process.env){return String(env.ALLOWED_ORIGINS||DEFAULT_ORIGINS).split(',').map(s=>s.trim().replace(/\/+$/,'')).filter(Boolean);}
export function applyCors(req,res,env=process.env){
 const origin=String(req.headers?.origin||'').replace(/\/+$/,''),list=allowedOrigins(env);
 if(origin&&list.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
 res.setHeader('Access-Control-Allow-Headers','authorization, content-type');
 res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
 res.setHeader('Access-Control-Max-Age','600');
 if(req.method==='OPTIONS'){res.status(204).end();return true;}
 if(req.method!=='POST'){res.status(405).json({error:'POST 요청만 허용됩니다.'});return true;}
 return false;
}
export function bearer(req){const m=/^Bearer\s+(\S+)$/i.exec(String(req.headers?.authorization||''));return m?m[1]:null;}
export async function readBody(req){
 if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;
 const raw=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString('utf8'):'';
 if(!raw.trim())return {};
 try{return JSON.parse(raw);}catch{throw Object.assign(Error('잘못된 요청 형식입니다.'),{status:400});}
}

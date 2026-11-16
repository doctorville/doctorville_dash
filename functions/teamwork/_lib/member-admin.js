// POST /teamwork/member-admin : 관리자/책임자가 팀원 로그인 계정을 만들고 팀원으로 등록
// 같은 이메일의 Nhost 계정(대시보드 계정 포함)이 있으면 재사용하고, 없으면 비밀번호 없는 계정을 만듭니다.
import {applyCors,bearer,readBody} from './http.js';
import {verifyRequestToken} from './auth.js';
import {withUser,errorBody} from './db.js';
export function memberInput(body){
 if(body?.action!=='create')throw Object.assign(Error('지원하지 않는 요청입니다.'),{status:400});
 const email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim(),team=String(body.team||'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Object.assign(Error('이메일 형식을 확인해주세요.'),{status:400});
 if(name.length<1||name.length>100||team.length<1||team.length>100)throw Object.assign(Error('이름과 소속을 1~100자로 입력해주세요.'),{status:400});
 return {email,name,team};
}
export default async function memberAdminHandler(req,res){
 if(applyCors(req,res))return;
 try{
  const caller=await verifyRequestToken(bearer(req));
  const role=await withUser(caller.id,async c=>(await c.query('select role from teamwork.members where id=$1',[caller.id])).rows[0]?.role);
  if(role!=='admin')return res.status(403).json({error:'관리자/책임자만 팀원 계정을 등록할 수 있습니다.'});
  const input=memberInput(await readBody(req));
  // 계정 생성과 팀원 등록을 한 문장(한 트랜잭션)으로 처리합니다.
  const result=await withUser(null,async c=>{
   const {rows:[r]}=await c.query("with acc as (select id,created from teamwork.ensure_auth_user($1,$2)), ins as (insert into teamwork.members(id,name,team,role) select id,$2,$3,'member' from acc on conflict(id) do nothing returning id) select acc.id::text as id, acc.created, (select count(*) from ins)::int as inserted from acc",[input.email,input.name,input.team]);
   if(!Number(r.inserted))throw Object.assign(Error('이미 팀원으로 등록된 계정입니다: '+input.email),{status:409});
   return {id:r.id,email:input.email,created:r.created===true||r.created==='t'};
  });
  res.status(200).json(result);
 }catch(err){
  if(err?.status&&!err.severity)return res.status(err.status).json({error:err.message});
  const {status,body}=errorBody(err);res.status(status).json({error:'처리 중 오류가 발생했습니다: '+body.error.message});
 }
}

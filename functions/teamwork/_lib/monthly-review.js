// 월 업무 정리 AI 분석: 한 팀원의 해당 월 주간 보고(제출본)를 업무별로 묶어 잘한 점·미흡한 점, 일정 지연 이유·대응 방안을 요약합니다.
// 호출: POST /teamwork/report-ai {mode:'monthly-review', month:'YYYY-MM', member_id?:uuid}
// 권한: 본인 또는 관리자(admin). 조회·저장 모두 호출자 권한(RLS)으로 실행합니다.
import {withUser,execute} from './db.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const str=(v,n=3000)=>String(v??'').trim().slice(0,n);
export const nextMonthStart=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);};
export const reviewStore={
 role:userId=>withUser(userId,async c=>(await c.query('select role from teamwork.members where id=$1',[userId])).rows[0]?.role||null),
 reports:(userId,target,month)=>withUser(userId,c=>execute(c,{action:'select',table:'reports',columns:'*',filters:[['eq','user_id',target],['eq','status','submitted'],['gte','week_start',month+'-01'],['lt','week_start',nextMonthStart(month)]],order:[['week_start',true]]})),
 review:(userId,target,month)=>withUser(userId,async c=>(await execute(c,{action:'select',table:'monthly_reviews',columns:'*',filters:[['eq','user_id',target],['eq','month',month]]}))[0]||null),
 saveAI:(userId,target,month,ai)=>withUser(userId,async c=>{const cur=(await execute(c,{action:'select',table:'monthly_reviews',columns:'id',filters:[['eq','user_id',target],['eq','month',month]]}))[0];const values={ai_summary:ai,ai_generated_at:new Date().toISOString()};return (cur?await execute(c,{action:'update',table:'monthly_reviews',values,filters:[['eq','id',cur.id]],returning:true,columns:'*'}):await execute(c,{action:'insert',table:'monthly_reviews',values:{...values,user_id:target,month},returning:true,columns:'*'}))[0]||null;})
};
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
// 주간 보고 → 업무별 이력(같은 업무 ID를 주차별로 묶음). 지연 여부는 서버가 계산해 모델에 전달하고 결과에도 강제합니다.
export function monthlyTaskDigest(reports,month,today){
 const end=monthEnd(month),cut=today<end?today:end,map=new Map();
 for(const r of [...reports].sort((a,b)=>String(a.week_start).localeCompare(String(b.week_start))))(r.items||[]).forEach((i,n)=>{const key=String(i.id||r.id+'-'+n).slice(0,120);const t=map.get(key)||{task_key:key,title:'',project:'',service:'',start_date:'',target_date:'',weeks:[]};Object.assign(t,{title:str(i.title,300),project:str(i.project,100),service:str(i.service,30),start_date:str(i.start_date,10)||t.start_date||r.week_start,target_date:str(i.target_date,10)});t.weeks.push({week:r.week_start,state:str(i.state,10),progress:Number(i.progress)||0,result:str(i.result),week_done:str(i.week_done),next_todo:str(i.next_todo)});map.set(key,t);});
 return [...map.values()].map(t=>{const last=t.weeks.at(-1);return {...t,final_state:last.state,final_progress:last.progress,delayed:!!t.target_date&&t.target_date<cut&&last.state!=='완료'};});
}
export const reviewSchema=keys=>({type:'object',additionalProperties:false,required:['overview','tasks'],properties:{overview:{type:'string'},tasks:{type:'array',items:{type:'object',additionalProperties:false,required:['task_key','progress_summary','strengths','weaknesses','delay_reason','response_plan'],properties:{task_key:keys.length?{type:'string',enum:keys}:{type:'string'},progress_summary:{type:'string'},strengths:{type:'string'},weaknesses:{type:'string'},delay_reason:{type:'string'},response_plan:{type:'string'}}}}}});
export const reviewInstructions=['당신은 의료 전문가 플랫폼 운영팀의 업무 코치입니다. 한 팀원의 한 달치 주간 업무 보고를 업무별로 정리합니다.','입력 tasks의 각 업무마다 정확히 하나의 결과를 task_key 그대로 작성합니다. 입력에 없는 업무를 만들지 않습니다.','progress_summary: 이번 달 진척 흐름(시작 상태→최종 상태·진행률)과 주요 한 일을 2~3문장으로 요약합니다.','strengths: 보고 내용에 근거한 잘한 점 1~3가지. weaknesses: 보고 내용에 근거한 미흡한 점·개선이 필요한 점 1~3가지. 근거가 부족하면 "보고 내용이 부족해 판단하기 어렵습니다"라고 씁니다.','delayed가 true인 업무만 delay_reason(보고 내용에서 추정되는 지연 이유, 추정이면 "추정"이라고 표시)과 response_plan(구체적인 대응 방안과 다음 확인 시점)을 씁니다. delayed가 false이면 두 칸은 빈 문자열입니다.','overview: 이번 달 전체 업무 흐름을 3문장 이내로 요약합니다.','모든 문장은 한국어 존댓말 보고체로, 사실과 다른 내용이나 입력에 없는 수치를 만들지 않습니다.'].join('\n');
export function validReview(parsed,tasks){
 const byKey=new Map(tasks.map(t=>[t.task_key,t])),seen=new Set(),out=[];
 for(const r of Array.isArray(parsed?.tasks)?parsed.tasks:[]){const t=byKey.get(r?.task_key);if(!t||seen.has(t.task_key))continue;seen.add(t.task_key);out.push({task_key:t.task_key,title:t.title,progress_summary:str(r.progress_summary,1500),strengths:str(r.strengths,1500),weaknesses:str(r.weaknesses,1500),delayed:t.delayed,delay_reason:t.delayed?str(r.delay_reason,1500):'',response_plan:t.delayed?str(r.response_plan,1500):''});}
 return {overview:str(parsed?.overview,2000),tasks:out};
}
export async function runMonthlyReview({user,body,env=process.env,fetchImpl=fetch,store=reviewStore,callOpenAI,today=new Date().toISOString().slice(0,10)}){
 const month=String(body?.month||'');if(!MONTH.test(month))return [400,{error:'월을 YYYY-MM 형식으로 선택해주세요.'}];
 const target=body?.member_id?String(body.member_id):user.id;if(!UUID.test(target))return [400,{error:'잘못된 팀원입니다.'}];
 if(target!==user.id&&await store.role(user.id)!=='admin')return [403,{error:'본인 또는 관리자/책임자만 분석할 수 있습니다.'}];
 const apiKey=env.OPENAI_API_KEY,model=env.OPENAI_REPORT_MODEL||'gpt-4.1-mini';if(!apiKey)return [503,{error:'서버에 OPENAI_API_KEY를 등록해주세요.'}];
 const tasks=monthlyTaskDigest(await store.reports(user.id,target,month),month,today);
 if(!tasks.length)return [400,{error:'이 달에 제출된 주간 보고가 없습니다.'}];
 const input=JSON.stringify({month,today,tasks});if(input.length>200000)throw Error('이 달의 보고 내용이 너무 많습니다. 관리자에게 문의해주세요.');
 const {parsed,model:used}=await callOpenAI({apiKey,model,instructions:reviewInstructions,input,maxTokens:8000,name:'monthly_work_review',schema:reviewSchema(tasks.map(t=>t.task_key)),fetchImpl});
 const ai={...validReview(parsed,tasks),model:used,generated_at:new Date().toISOString()};
 const review=await store.saveAI(user.id,target,month,ai);
 return [200,{review,ai}];
}

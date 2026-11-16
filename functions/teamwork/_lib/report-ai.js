// POST /teamwork/report-ai : 주간·월간 통합 보고서 GPT 요약 / 경영진 보고서 생성
// 필요한 환경 변수: OPENAI_API_KEY, 선택 OPENAI_REPORT_MODEL(기본 gpt-4.1-mini)
// 주의: OpenAI 응답 대기(최대 110초) 동안 함수가 살아 있어야 하므로 Nhost Functions 실행 시간 제한을 확인하세요.
import {applyCors,bearer,readBody} from './http.js';
import {verifyRequestToken} from './auth.js';
import {withUser,execute,errorBody} from './db.js';
import {summaryInstructions,metricHighlights,taskDigest,sourceBoundSchema,validSummary,executiveSchema,executiveInstructions,executiveMetrics,validExecutive} from './summary.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// DB 접근(테스트에서 바꿔 끼울 수 있음). 모두 호출자 권한(RLS)으로 실행합니다.
export const dbStore={
 document:(userId,id)=>withUser(userId,async c=>(await execute(c,{action:'select',table:'report_documents',columns:'*',filters:[['eq','id',id]]}))[0]||null),
 role:userId=>withUser(userId,async c=>(await c.query('select role from teamwork.members where id=$1',[userId])).rows[0]?.role||null),
 rpc:(userId,fn,args)=>withUser(userId,c=>execute(c,{action:'rpc',fn,args},{server:true}))
};

export async function callOpenAI({apiKey,model,instructions,input,maxTokens,name,schema,fetchImpl=fetch}){
 const response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(110000),headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,instructions,input,max_output_tokens:maxTokens,text:{format:{type:'json_schema',name,strict:true,schema}}})});
 if(!response.ok)throw Error('GPT 요청에 실패했습니다. 서버의 API 키·모델·사용 한도를 확인해주세요.');
 const output=await response.json();
 if(output.status!=='completed')throw Error('GPT 요약이 완료되지 않았습니다. 다시 시도해주세요.');
 const text=output.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 if(!text?.trim())throw Error('GPT가 요약 내용을 반환하지 않았습니다. 모델 응답을 확인해주세요.');
 try{return {parsed:JSON.parse(text),model:output.model};}catch{throw Error('GPT 요약 JSON이 불완전합니다. 다시 시도해주세요.');}
}

export async function runReportAI({user,body,env=process.env,fetchImpl=fetch,store=dbStore}){
 const rpc=store.rpc;
 if(typeof body?.document_id!=='string'||!UUID.test(body.document_id))return [400,{error:'잘못된 문서입니다.'}];
 const apiKey=env.OPENAI_API_KEY,model=env.OPENAI_REPORT_MODEL||'gpt-4.1-mini';
 const doc=await store.document(user.id,body.document_id);
 if(!doc)return [404,{error:'보고서를 찾을 수 없습니다.'}];
 if(body.mode==='executive'){
  if(doc.kind!=='weekly')return [400,{error:'주간 통합 보고서를 선택해주세요.'}];
  const role=await store.role(user.id);
  if(role!=='admin')return [403,{error:'관리자/책임자만 경영진 보고서를 생성할 수 있습니다.'}];
  if(!doc.snapshot?.ai_summary)return [400,{error:'1차 통합 보고서의 요약을 먼저 생성해주세요.'}];
  if(!apiKey)return [503,{error:'서버에 OPENAI_API_KEY를 등록해주세요.'}];
  await rpc(user.id,'claim_executive_report_ai',{document_id:doc.id});
  const input=JSON.stringify({period:doc.period,summary:doc.snapshot.ai_summary,metrics:doc.snapshot.metrics,reports:doc.snapshot.reports});
  if(input.length>350000)throw Error('보고서 내용이 너무 많습니다. 관리자에게 문의해주세요.');
  const {parsed}=await callOpenAI({apiKey,model,instructions:executiveInstructions,input,maxTokens:5000,name:'executive_report',schema:executiveSchema,fetchImpl});
  const executive=validExecutive(parsed);executive.metrics=executiveMetrics(doc.snapshot);
  return [200,{executive,source_document_id:doc.id,source_created_at:doc.created_at,week:doc.period,generated_at:new Date().toISOString()}];
 }
 if(doc.created_by!==user.id)return [403,{error:'본인이 생성한 보고서만 GPT 요약을 실행할 수 있습니다.'}];
 if(doc.snapshot?.ai_summary)return [200,{document:doc}];
 if(!apiKey)return [503,{error:'서버에 OPENAI_API_KEY를 등록해주세요. 원본 보고서는 저장되었습니다.'}];
 await rpc(user.id,'claim_report_ai',{document_id:doc.id});
 try{
  const s=doc.snapshot,reportIds=s.reports.map(r=>r.id),tasks=doc.kind==='monthly'?taskDigest(s):[],taskKeys=tasks.map(t=>t.task_key);
  const schema=sourceBoundSchema(reportIds,[],taskKeys);
  const input=JSON.stringify({kind:doc.kind,period:doc.period,members:s.members,reports:s.reports,metric_highlights:metricHighlights(s.metrics,doc.kind==='monthly'?'전월':'전주'),tasks:tasks.map(({user_id,report_ids,...t})=>t)});
  if(input.length>350000)throw Error('보고서 내용이 너무 많습니다. 관리자에게 문의해주세요.');
  const {parsed,model:used}=await callOpenAI({apiKey,model,instructions:summaryInstructions,input,maxTokens:12000,name:'team_report_summary',schema,fetchImpl});
  const summary=validSummary(parsed,reportIds,[],taskKeys);
  const saved=await rpc(user.id,'save_report_ai',{document_id:doc.id,summary_data:{...summary,model:used,generated_at:new Date().toISOString()}});
  return [200,{document:saved}];
 }catch(err){try{await rpc(user.id,'release_report_ai',{document_id:doc.id});}catch{}throw err;}
}

export default async function reportAIHandler(req,res){
 if(applyCors(req,res))return;
 try{
  const user=await verifyRequestToken(bearer(req));
  const [status,payload]=await runReportAI({user,body:await readBody(req)});
  res.status(status).json(payload);
 }catch(err){
  const status=err?.status&&!err.severity?err.status:400;
  res.status(status).json({error:err?.severity?'DB 요청 실패: '+err.message:(err?.message||'GPT 요약 생성 실패')});
 }
}

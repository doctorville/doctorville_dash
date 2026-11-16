// teamwork 스키마 DB 접근 계층.
// 브라우저 요청(아래 spec)을 허용 목록 기반의 매개변수화된 SQL로 바꾸고,
// 트랜잭션마다 "set local role teamwork_user" + teamwork.user_id를 설정해 기존 RLS 정책을 그대로 적용합니다.
// DB 연결 방식(자동 선택):
//  1) TEAMWORK_DATABASE_URL이 있으면 pg 드라이버로 직접 연결(선택 TEAMWORK_DATABASE_SSL=disable, pg 의존성 필요)
//  2) 없으면 Nhost가 함수에 자동으로 넣어 주는 NHOST_ADMIN_SECRET으로 Hasura run_sql을 호출(추가 설정·의존성 없음)

const IDENT=/^[a-z_][a-z0-9_]{0,62}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 브라우저가 쓸 수 있는 테이블과 동작(권한의 최종 판단은 DB의 GRANT·RLS가 합니다).
export const TABLES={
 members:['select','update'],
 reports:['select','insert','update'],
 report_documents:['select'],
 member_role_changes:['select'],
 personal_goal_sets:['select','insert','update'],
 team_goals:['select','insert','update'],
 team_goal_strategies:['select','insert','update'],
 team_responsibilities:['select','insert','update','delete'],
 handovers:['select','insert','update','delete']
};
// 브라우저가 호출할 수 있는 함수: 인자 이름·타입과 반환 형태(row=객체, rows=배열, void=null)
export const RPCS={
 set_member_role:{args:{member_id:'uuid',new_role:'text'},returns:'row'},
 generate_report_document:{args:{document_kind:'text',document_period:'text'},returns:'row'},
 generate_summary_report_document:{args:{document_kind:'text',document_period:'text',metric_summary:'jsonb'},returns:'row'},
 save_report_advisory:{args:{document_id:'uuid',advisory_text:'text'},returns:'row'},
 save_report_edits:{args:{document_id:'uuid',edits:'jsonb',advisory_text:'text'},returns:'row'},
 admin_member_accounts:{args:{},returns:'rows'},
 dashboard_profile:{args:{},returns:'rows'},
 dashboard_datasets:{args:{dataset_keys:'text[]'},returns:'rows'},
 dashboard_latest_report:{args:{svc:'text'},returns:'rows'}
};
// 서버 함수(report-ai)만 쓰는 함수
export const SERVER_RPCS={
 claim_report_ai:{args:{document_id:'uuid'},returns:'void'},
 release_report_ai:{args:{document_id:'uuid'},returns:'void'},
 save_report_ai:{args:{document_id:'uuid',summary_data:'jsonb'},returns:'row'},
 claim_executive_report_ai:{args:{document_id:'uuid'},returns:'void'}
};
const FILTERS={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'like',ilike:'ilike',in:'in',is:'is'};

export class RequestError extends Error{constructor(message,code='PGRST100',status=400){super(message);this.code=code;this.status=status;}}
const q=name=>{if(typeof name!=='string'||!IDENT.test(name))throw new RequestError('잘못된 이름입니다: '+String(name).slice(0,64));return '"'+name+'"';};
const jsonParam=v=>v===undefined||v===null?null:(typeof v==='object'?JSON.stringify(v):v);

function columns(spec){
 const raw=spec==null||spec===''?'*':String(spec);
 if(raw.trim()==='*')return '*';
 return raw.split(',').map(c=>c.trim()).filter(Boolean).map(q).join(',');
}
function where(filters,values,alias='t'){
 if(filters==null)return '';
 if(!Array.isArray(filters)||filters.length>20)throw new RequestError('잘못된 조건입니다.');
 const parts=filters.map(f=>{
  if(!Array.isArray(f)||f.length!==3||!FILTERS[f[0]])throw new RequestError('지원하지 않는 조건입니다.');
  const [op,col,val]=f,c=alias+'.'+q(col);
  if(op==='is'){if(val!==null&&val!==true&&val!==false)throw new RequestError('is 조건은 null/true/false만 허용됩니다.');return c+' is '+(val===null?'null':val?'true':'false');}
  if(op==='in'){if(!Array.isArray(val)||val.length>500)throw new RequestError('in 조건 형식 오류');values.push(val.map(v=>v==null?null:String(v)));return c+'::text = any($'+values.length+'::text[])';}
  values.push(jsonParam(val));return c+' '+FILTERS[op]+' $'+values.length;
 });
 return parts.length?' where '+parts.join(' and '):'';
}
function orderBy(order){
 if(order==null)return '';
 if(!Array.isArray(order)||order.length>5)throw new RequestError('정렬 형식 오류');
 return order.length?' order by '+order.map(([c,asc,nullsFirst])=>'t.'+q(c)+(asc===false?' desc':' asc')+(nullsFirst===true?' nulls first':nullsFirst===false?' nulls last':'')).join(','):'';
}
function limit(n){if(n==null)return '';if(!Number.isInteger(n)||n<1||n>5000)throw new RequestError('limit 형식 오류');return ' limit '+n;}
function rowsOf(value){
 const rows=Array.isArray(value)?value:[value];
 if(!rows.length||rows.length>200||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new RequestError('저장할 값 형식 오류');
 const keys=[...new Set(rows.flatMap(Object.keys))];
 if(!keys.length)throw new RequestError('저장할 값이 없습니다.');
 keys.forEach(q);return {rows,keys};
}

// spec → {text, values, shape}. 테스트를 위해 SQL만 만드는 순수 함수입니다.
export function buildQuery(spec,{server=false}={}){
 if(!spec||typeof spec!=='object')throw new RequestError('잘못된 요청입니다.');
 const values=[];
 if(spec.action==='rpc'){
  const def=RPCS[spec.fn]||(server?SERVER_RPCS[spec.fn]:null);
  if(!def)throw new RequestError('허용되지 않은 함수입니다: '+String(spec.fn).slice(0,64),'PGRST202',404);
  const args=spec.args&&typeof spec.args==='object'?spec.args:{};
  for(const k of Object.keys(args))if(!(k in def.args))throw new RequestError('알 수 없는 인자: '+k,'PGRST202',404);
  const call='teamwork.'+q(spec.fn)+'('+Object.entries(def.args).filter(([k])=>k in args).map(([k,type])=>{values.push(type==='jsonb'?jsonParam(args[k]):args[k]??null);return q(k)+' => $'+values.length+'::'+type;}).join(', ')+')';
  const text=def.returns==='void'?'select '+call+' is null as done':'select to_jsonb(f) as r from '+call+' f';
  return {text,values,shape:def.returns};
 }
 const table=spec.table;
 if(!TABLES[table]?.includes(spec.action))throw new RequestError('허용되지 않은 요청입니다: '+String(table).slice(0,64)+'.'+String(spec.action).slice(0,16),'42501',403);
 const t='teamwork.'+q(table),cols=columns(spec.columns),pick=cols==='*'?'r':'jsonb_build_object('+cols.split(',').map(c=>"'"+c.slice(1,-1)+"',r."+c).join(',')+')';
 const single=spec.single==='single'||spec.single==='maybe'?spec.single:null;
 const shape=single||'rows';
 if(spec.action==='select'){
  const inner='select '+(cols==='*'?'t.*':cols.split(',').map(c=>'t.'+c).join(','))+' from '+t+' t'+where(spec.filters,values)+orderBy(spec.order)+limit(spec.limit);
  return {text:'select to_jsonb(r) as r from ('+inner+') r',values,shape};
 }
 const returning=!!spec.returning;
 const out=(cte)=>'with r as ('+cte+' returning t.*) select '+(returning?(cols==='*'?'to_jsonb(r)':pick):'null::jsonb')+' as r from r';
 if(spec.action==='insert'){
  const {rows,keys}=rowsOf(spec.values);values.push(JSON.stringify(rows));
  const list=keys.map(q).join(',');
  return {text:out('insert into '+t+' as t ('+list+') select '+list+' from jsonb_populate_recordset(null::'+t+', $1::jsonb)'),values,shape:returning?shape:'none'};
 }
 if(spec.action==='update'){
  if(!Array.isArray(spec.filters)||!spec.filters.length)throw new RequestError('수정 조건이 필요합니다.');
  if(!spec.values||typeof spec.values!=='object'||Array.isArray(spec.values))throw new RequestError('수정할 값 형식 오류');
  const {keys}=rowsOf(spec.values);values.push(JSON.stringify(spec.values));
  const set=keys.map(k=>q(k)+' = v.'+q(k)).join(', ');
  return {text:out('update '+t+' as t set '+set+' from jsonb_populate_record(null::'+t+', $1::jsonb) v'+where(spec.filters,values)),values,shape:returning?shape:'none'};
 }
 if(spec.action==='delete'){
  if(!Array.isArray(spec.filters)||!spec.filters.length)throw new RequestError('삭제 조건이 필요합니다.');
  return {text:out('delete from '+t+' as t'+where(spec.filters,values)),values,shape:returning?shape:'none'};
 }
 throw new RequestError('지원하지 않는 요청입니다.');
}

export function shapeResult(rows,shape){
 const list=rows.map(x=>x.r);
 if(shape==='none'||shape==='void')return null;
 if(shape==='rows')return list;
 if(shape==='row')return list[0]??null;
 if(shape==='maybe'){if(list.length>1)throw new RequestError('결과가 여러 행입니다.','PGRST116',406);return list[0]??null;}
 if(shape==='single'){if(list.length!==1)throw new RequestError(list.length?'결과가 여러 행입니다.':'대상 데이터를 찾지 못했습니다. 다른 사람이 먼저 수정했거나 권한이 없을 수 있습니다. 새로고침 후 다시 시도해주세요.','PGRST116',406);return list[0];}
 return list;
}

let pool;
export async function getPool(env=process.env){
 if(pool)return pool;
 const url=env.TEAMWORK_DATABASE_URL;
 if(!url)throw new RequestError('서버에 TEAMWORK_DATABASE_URL이 설정되지 않았습니다.','CONFIG',500);
 const {default:pg}=await import(['p','g'].join('')); // pg 경로를 쓸 때만 필요(배포 번들이 pg를 찾지 않도록 동적 지정)
 pool=new pg.Pool({connectionString:url,max:Number(env.TEAMWORK_DATABASE_POOL||3),idleTimeoutMillis:10000,ssl:env.TEAMWORK_DATABASE_SSL==='disable'?false:{rejectUnauthorized:false}});
 return pool;
}
export function setPool(p){pool=p;}

// ---- Hasura run_sql 방식 ----
export function sqlLiteral(v){
 if(v===null||v===undefined)return 'NULL';
 if(typeof v==='boolean')return v?'true':'false';
 if(typeof v==='number'){if(!Number.isFinite(v))throw new RequestError('숫자 형식 오류');return String(v);}
 if(Array.isArray(v))return 'ARRAY['+v.map(sqlLiteral).join(',')+']::text[]';
 if(typeof v==='object')v=JSON.stringify(v);
 const t=String(v);if(t.includes('\0'))throw new RequestError('허용되지 않는 문자');
 return "'"+t.replace(/'/g,"''")+"'";
}
export function inlineParams(text,values=[]){return text.replace(/\$(\d+)/g,(m,n)=>{const i=Number(n)-1;if(i<0||i>=values.length)throw new RequestError('매개변수 오류');return sqlLiteral(values[i]);});}
export function hasuraQueryUrl(env=process.env){
 if(env.NHOST_HASURA_URL)return env.NHOST_HASURA_URL.replace(/\/+$/,'').replace(/\/v1(\/graphql)?$/,'')+'/v2/query';
 if(env.NHOST_GRAPHQL_URL)return env.NHOST_GRAPHQL_URL.replace('.graphql.','.hasura.').replace(/\/v1(\/graphql)?\/?$/,'')+'/v2/query';
 if(env.NHOST_SUBDOMAIN&&env.NHOST_REGION)return 'https://'+env.NHOST_SUBDOMAIN+'.hasura.'+env.NHOST_REGION+'.nhost.run/v2/query';
 throw new RequestError('서버에 DB 연결 정보(TEAMWORK_DATABASE_URL 또는 NHOST_ADMIN_SECRET)가 없습니다.','CONFIG',500);
}
// 한 번의 run_sql = 한 트랜잭션. 사용자 설정·역할 전환·실행할 문장을 한 SQL로 묶고, 역할 전환이 실패하면 실행하지 않습니다.
export function runSqlClient(userId,env=process.env,fetchImpl=fetch){
 const url=hasuraQueryUrl(env),secret=env.NHOST_ADMIN_SECRET;
 if(!secret)throw new RequestError('서버에 NHOST_ADMIN_SECRET이 없습니다.','CONFIG',500);
 const timeout=String(Number(env.TEAMWORK_STATEMENT_TIMEOUT_MS||20000));
 return {async query(text,values=[]){
  if(/^\s*(begin|commit|rollback)\s*$/i.test(text))return {rows:[],rowCount:0};
  const prelude="select set_config('timezone','UTC',true), set_config('statement_timeout','"+timeout+"',true)"+(userId!==null?", set_config('teamwork.user_id','"+userId+"',true);\nset local role teamwork_user;\nselect 1/(case when current_user='teamwork_user' then 1 else 0 end);\n":";\n");
  const sql=prelude+inlineParams(text,values)+';';
  const r=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json','x-hasura-admin-secret':secret},body:JSON.stringify({type:'run_sql',args:{source:'default',sql,cascade:false,read_only:false,check_metadata_consistency:false}})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.error){const e=j.internal?.error||{};throw Object.assign(new Error(e.message||j.error||('DB 요청 실패 (HTTP '+r.status+')')),{code:e.status_code||j.code||'XX000',severity:'ERROR',detail:e.description||null,hint:e.hint||null});}
  if(j.result_type!=='TuplesOk'||!Array.isArray(j.result))return {rows:[],rowCount:0};
  const [head,...data]=j.result;
  const rows=data.map(row=>Object.fromEntries(head.map((h,i)=>{const v=row[i];if(v===null)return [h,null];if(h==='r'&&v!=null)return [h,JSON.parse(v)];if(v==='t'||v==='f')return [h,v==='t'];return [h,v];})));
  return {rows,rowCount:rows.length};
 }};
}

// 로그인 사용자 권한으로 실행(RLS 적용). userId=null이면 관리자 연결(서버 전용 작업).
export async function withUser(userId,fn,env=process.env){
 if(userId!==null&&!UUID.test(String(userId)))throw new RequestError('잘못된 사용자입니다.','401',401);
 if(!env.TEAMWORK_DATABASE_URL)return fn(runSqlClient(userId,env));
 const client=await (await getPool(env)).connect();
 try{
  await client.query('begin');
  await client.query("select set_config('timezone','UTC',true), set_config('statement_timeout',$1,true)",[String(Number(env.TEAMWORK_STATEMENT_TIMEOUT_MS||20000))]);
  if(userId!==null){await client.query("select set_config('teamwork.user_id',$1,true)",[userId]);await client.query('set local role teamwork_user');}
  const result=await fn(client);
  await client.query('commit');
  return result;
 }catch(err){try{await client.query('rollback');}catch{}throw err;}
 finally{client.release();}
}
export async function execute(client,spec,options){const {text,values,shape}=buildQuery(spec,options);const {rows}=await client.query(text,values);return shapeResult(rows,shape);}
export function errorBody(err){
 if(err instanceof RequestError)return {status:err.status,body:{error:{message:err.message,code:err.code}}};
 if(err&&typeof err.code==='string'&&err.severity){ // Postgres 오류: 메시지·코드 그대로(기존 화면 문구 호환)
  return {status:err.code==='42501'?403:400,body:{error:{message:err.message,code:err.code,details:err.detail||null,hint:err.hint||null}}};
 }
 return {status:err?.status||500,body:{error:{message:err?.status?err.message:'서버 처리 중 오류가 발생했습니다.',code:'500'}}};
}

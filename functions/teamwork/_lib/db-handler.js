// POST /teamwork/db : 브라우저의 테이블 조회·저장, RPC 호출
import {applyCors,bearer,readBody} from './http.js';
import {verifyRequestToken} from './auth.js';
import {withUser,execute,errorBody} from './db.js';
export default async function dbHandler(req,res){
 if(applyCors(req,res))return;
 try{
  const user=await verifyRequestToken(bearer(req));
  const spec=await readBody(req);
  const data=await withUser(user.id,client=>execute(client,spec));
  res.status(200).json({data});
 }catch(err){const {status,body}=errorBody(err);res.status(status).json(body);}
}

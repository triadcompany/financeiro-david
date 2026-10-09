import express from 'express';import helmet from 'helmet';import {rateLimit} from 'express-rate-limit';import {randomBytes,randomUUID,randomInt,timingSafeEqual} from 'node:crypto';
import {sendResetEmail,mailConfigured} from './mail.mjs';
import {hashPassword,checkPassword,digest} from './password.mjs';
export function createApp({pool,transaction,sendReset=sendResetEmail,canReset=mailConfigured}){
const app=express();app.disable('x-powered-by');app.set('trust proxy',Number(process.env.TRUST_PROXY||0));
app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"],'connect-src':["'self'"],'img-src':["'self'",'data:'],'upgrade-insecure-requests':process.env.NODE_ENV==='production'?[]:null}}}));
app.use(express.json({limit:'1mb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(req.headers.origin&&req.headers.origin!==process.env.APP_ORIGIN)return res.status(403).json({message:'Origem não autorizada.'});next();});
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false}));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
async function issue(c,id){const token=randomBytes(32).toString('hex'),expires=Math.floor(Date.now()/1000)+43200;await c.query("delete from auth.sessions where expires_at<now()");await c.query('insert into auth.sessions values($1,$2,to_timestamp($3))',[digest(token),id,expires]);return {access_token:token,refresh_token:token,expires_at:expires,expires_in:43200,user:{id}};}
app.post('/api/auth/v1/token',async(req,res)=>{if(req.query.grant_type==='refresh_token'){const token=String(req.body.refresh_token||'');const r=await pool.query('select user_id from auth.sessions where token_hash=$1 and expires_at>now()',[digest(token)]);if(!r.rowCount)throw fail('Entre novamente.',401);const expires=Math.floor(Date.now()/1000)+43200;await pool.query('update auth.sessions set expires_at=to_timestamp($2) where token_hash=$1',[digest(token),expires]);return res.json({access_token:token,refresh_token:token,expires_at:expires,user:{id:r.rows[0].user_id}});}if(req.query.grant_type!=='password')throw fail('Operação inválida.');const email=String(req.body.email||'').trim().toLowerCase();const r=await pool.query('select id,password_hash from auth.users where lower(email)=$1',[email]);if(!await checkPassword(req.body.password,r.rows[0]?.password_hash))throw fail('E-mail ou senha inválidos.',401);res.json(await transaction(c=>issue(c,r.rows[0].id)));});
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const passwordHash=async value=>{if(typeof value!=='string'||value.length<8||value.length>256)throw fail('Use uma senha entre 8 e 256 caracteres.');return hashPassword(value);};
app.post('/api/auth/v1/signup',async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(),name=String(req.body.name||'').trim();
 if(req.body.invite)throw fail('Cada usuário deve criar sua própria conta. Convites foram desativados.',403);
 if(!validEmail(email))throw fail('Informe um e-mail válido.');
 if(!name||name.length>100)throw fail('Informe seu nome (até 100 caracteres).');
 const hash=await passwordHash(req.body.password);
 const session=await transaction(async c=>{

  const existing=await c.query('select id from auth.users where lower(email)=$1',[email]);if(existing.rowCount)throw fail('Esse e-mail já tem cadastro. Entre ou redefina sua senha.');
  const id=randomUUID();await c.query('insert into auth.users(id,email,password_hash) values($1,$2,$3)',[id,email,hash]);
  const family=randomUUID();await c.query('insert into public.familias(id,nome) values($1,$2)',[family,'Finanças de '+name]);await c.query('insert into public.pessoas(id,familia_id,usuario_id,nome) values($1,$2,$3,$4)',[randomUUID(),family,id,name]);
  return issue(c,id);
 });res.json(session);
});
app.post('/api/auth/v1/recover',async(req,res)=>{
 if(!canReset())throw fail('Recuperação por e-mail ainda não configurada. Contate o administrador.',503);
 const email=String(req.body.email||'').trim().toLowerCase();if(!validEmail(email))throw fail('Informe um e-mail válido.');
 const message='Se esse e-mail estiver cadastrado, você receberá um link para redefinir sua senha. Confira também o spam.';
 const r=await pool.query('select id from auth.users where lower(email)=$1',[email]);
 if(r.rowCount){const token=randomBytes(32).toString('hex'),hash=digest(token);
 const created=await transaction(async c=>{await c.query('select id from auth.users where id=$1 for update',[r.rows[0].id]);const recent=await c.query("select 1 from auth.password_resets where user_id=$1 and created_at>now()-interval '2 minutes'",[r.rows[0].id]);if(recent.rowCount)return false;await c.query('delete from auth.password_resets where expires_at<now()');await c.query("insert into auth.password_resets(token_hash,user_id,expires_at) values($1,$2,now()+interval '30 minutes')",[hash,r.rows[0].id]);return true;});
 if(created){try{await sendReset(email,new URL('/#redefinir='+token,process.env.APP_ORIGIN).href);}catch{await pool.query('delete from auth.password_resets where token_hash=$1',[hash]);console.error('Falha no envio da recuperação de senha. Verifique SMTP.');}}
 }res.json({message});
});
app.post('/api/auth/v1/reset',async(req,res)=>{
 const token=String(req.body.token||'');if(!/^[a-f0-9]{64}$/.test(token))throw fail('Link inválido ou expirado. Solicite outro.');
 const hash=await passwordHash(req.body.password);
 await transaction(async c=>{
 const r=await c.query('select user_id from auth.password_resets where token_hash=$1',[digest(token)]);if(!r.rowCount)throw fail('Link inválido ou expirado. Solicite outro.');
 const id=r.rows[0].user_id;await c.query('select id from auth.users where id=$1 for update',[id]);
 const used=await c.query('delete from auth.password_resets where token_hash=$1 and expires_at>now() returning user_id',[digest(token)]);if(!used.rowCount)throw fail('Link inválido ou expirado. Solicite outro.');
 await c.query('update auth.users set password_hash=$1,email_confirmed_at=now() where id=$2',[hash,id]);await c.query('delete from auth.sessions where user_id=$1',[id]);await c.query('delete from auth.password_resets where user_id=$1',[id]);
 });res.json({message:'Senha atualizada. Entre com sua nova senha.'});
});
// Secure, test-only entry for the NORTH n8n agent. Does not modify financial records.
app.post('/api/agent/inbound',rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:true,legacyHeaders:false}),(req,res)=>{
 const configured=process.env.NORTH_AGENT_API_KEY||'';
 if(configured.length<32)return res.status(503).json({ok:false,error:'agent_not_configured'});
 const supplied=req.get('x-north-agent-key')||'';
 const expected=digest(configured),actual=digest(supplied);
 if(!supplied||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))return res.status(401).json({ok:false,error:'unauthorized'});
 const data=req.body;
 if(!data||typeof data!=='object'||Array.isArray(data)||data.accepted!==true||!['text','audio','image','document'].includes(data.message_type)||typeof data.external_event_id!=='string'||data.external_event_id.length<1||data.external_event_id.length>200)return res.status(400).json({ok:false,error:'invalid_payload'});
 res.status(202).json({ok:true,status:'received_test_only',event_id:data.external_event_id,processed:false,recorded:false});
});
// WhatsApp pairing: the logged-in user requests a code, then sends it from the same number.
const waPhone=value=>{const n=String(value||'').replace(/\D/g,'');return /^55\d{10,11}$/.test(n)?n:null;};
const waHash=(user,code)=>digest(user+':'+code+':'+(process.env.NORTH_AGENT_API_KEY||''));
const waLimit=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false});
app.post('/api/agent/whatsapp/verify',waLimit,async(req,res)=>{
 const secret=process.env.NORTH_AGENT_API_KEY||'',supplied=req.get('x-north-agent-key')||'';
 if(secret.length<32)return res.status(503).json({message:'Integração não configurada.'});
 if(!supplied||!timingSafeEqual(Buffer.from(digest(secret)),Buffer.from(digest(supplied))))return res.status(401).json({message:'Não autorizado.'});
 const data=req.body||{},phone=waPhone(data.sender_phone),match=/^NORTH\s+(\d{6})$/i.exec(String(data.text||'').trim());
 if(data.provider!=='evolution'||data.instance!=='financeiro-david'||data.accepted!==true||!phone||!match)return res.json({status:'not_verification'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const result=await client.query("select user_id,code_hash,attempts from public.north_whatsapp_challenges where phone=$1 and expires_at>now() for update",[phone]);
  if(!result.rowCount){await client.query('COMMIT');return res.json({status:'invalid_or_expired'});}
  const item=result.rows[0];
  await client.query('update public.north_whatsapp_challenges set attempts=attempts+1 where user_id=$1',[item.user_id]);
  if(item.attempts>=5||!timingSafeEqual(Buffer.from(waHash(item.user_id,match[1])),Buffer.from(item.code_hash))){await client.query('COMMIT');return res.json({status:'invalid_or_expired'});}
  const taken=await client.query('select 1 from public.north_whatsapp_links where phone=$1 and user_id<>$2',[phone,item.user_id]);
  if(taken.rowCount){await client.query('COMMIT');return res.status(409).json({status:'already_linked'});}
  await client.query('delete from public.north_whatsapp_links where user_id=$1',[item.user_id]);
  await client.query('insert into public.north_whatsapp_links(user_id,phone) values($1,$2)',[item.user_id,phone]);
  await client.query('delete from public.north_whatsapp_challenges where user_id=$1',[item.user_id]);
  await client.query('COMMIT');return res.json({status:'verified'});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});
// Resolve the verified WhatsApp account; no financial data is exposed here.
app.post('/api/agent/whatsapp/resolve',waLimit,async(req,res)=>{
 const configured=process.env.NORTH_AGENT_API_KEY||'';
 const supplied=req.get('x-north-agent-key')||'';
 if(configured.length<32)return res.status(503).json({status:'unavailable'});
 if(!supplied||!timingSafeEqual(Buffer.from(digest(configured)),Buffer.from(digest(supplied))))return res.status(401).json({status:'unauthorized'});
 const data=req.body||{};
 const phone=waPhone(data.sender_phone);
 if(data.accepted!==true||data.provider!=='evolution'||data.instance!=='financeiro-david'||data.channel!=='whatsapp'||!phone||typeof data.external_event_id!=='string'||data.external_event_id.length<1||data.external_event_id.length>200)return res.status(400).json({status:'invalid_payload'});
 const r=await pool.query('select user_id from public.north_whatsapp_links where phone=$1',[phone]);
 if(!r.rowCount)return res.json({status:'unlinked',linked:false});
 return res.json({status:'linked',linked:true,user_id:r.rows[0].user_id});
});
// Idempotency gate for WhatsApp agent: no financial writes.
app.post('/api/agent/events/claim',waLimit,async(req,res)=>{
 const secret=process.env.NORTH_AGENT_API_KEY||'',key=req.get('x-north-agent-key')||'';
 if(secret.length<32)return res.status(503).json({status:'unavailable'});
 if(!key||!timingSafeEqual(Buffer.from(digest(secret)),Buffer.from(digest(key))))return res.status(401).json({status:'unauthorized'});
 const data=req.body||{},phone=waPhone(data.sender_phone);
 const eventId=data.external_event_id;
 if(data.accepted!==true||data.provider!=='evolution'||data.channel!=='whatsapp'||data.instance!=='financeiro-david'||!phone||typeof eventId!=='string'||eventId.length<1||eventId.length>200)return res.status(400).json({status:'invalid_payload'});
 const linked=await pool.query('select user_id from public.north_whatsapp_links where phone=$1',[phone]);
 if(!linked.rowCount)return res.json({status:'unlinked',linked:false,is_new:false});
 const userId=linked.rows[0].user_id;
 const result=await pool.query('insert into public.north_agent_events(instance,external_event_id,user_id) values($1,$2,$3) on conflict(instance,external_event_id) do nothing returning id',['financeiro-david',eventId,userId]);
 res.json({status:result.rowCount?'claimed':'duplicate',linked:true,is_new:!!result.rowCount,user_id:userId});
});
// n8n integration: proposals and confirmations remain test-only; never write fin_movimentos.
function agentAuth(req,res){
 const secret=process.env.NORTH_AGENT_API_KEY||'',key=req.get('x-north-agent-key')||'';
 if(secret.length<32){res.status(503).json({status:'unavailable'});return false;}
 if(!key||!timingSafeEqual(Buffer.from(digest(secret)),Buffer.from(digest(key)))){res.status(401).json({status:'unauthorized'});return false;}
 return true;
}
async function agentLinkedUser(req,res){
 const d=req.body||{},phone=waPhone(d.sender_phone);
 if(d.accepted!==true||d.provider!=='evolution'||d.instance!=='financeiro-david'||d.channel!=='whatsapp'||!phone||typeof d.external_event_id!=='string'||!d.external_event_id||d.external_event_id.length>200){res.status(400).json({status:'invalid_payload'});return null;}
 const r=await pool.query('select user_id from public.north_whatsapp_links where phone=$1',[phone]);
 if(!r.rowCount){res.status(404).json({status:'unlinked'});return null;}
 return r.rows[0].user_id;
}
// Return the actual family category catalog for the linked WhatsApp user.
app.post('/api/agent/whatsapp/catalog',waLimit,async(req,res)=>{
 if(!agentAuth(req,res))return;
 const userId=await agentLinkedUser(req,res);if(!userId)return;
 const families=await pool.query('select distinct familia_id from public.pessoas where usuario_id=$1',[userId]);
 if(families.rowCount!==1)return res.status(409).json({status:'family_not_resolved'});
 const familyId=families.rows[0].familia_id;
 const categories=await pool.query("select c.id,c.nome,c.tipo,coalesce((select json_agg(s.nome order by s.nome) from public.fin_subcategorias s where s.familia_id=c.familia_id and s.categoria_id=c.id),'[]'::json) as subcategorias from public.categorias c where c.familia_id=$1 and c.ativa=true order by c.tipo,c.nome",[familyId]);
 res.json({status:'ok',categorias:categories.rows});
});
// Stateful conversational intake. Incomplete messages never produce financial movements.
app.post('/api/agent/whatsapp/conversation',waLimit,async(req,res)=>{
 if(!agentAuth(req,res))return;
 const userId=await agentLinkedUser(req,res);if(!userId)return;
 const raw=String(req.body.text||'').trim(),provided=req.body.payload;
 const rows=await pool.query('select state,missing_field from public.north_agent_conversations where user_id=$1 and expires_at>now()',[userId]);
 const active=rows.rows[0], state=active?.state||{};
 const fold=v=>String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim();
 if(active?.missing_field&&fold(raw)==='cancelar'){
  await pool.query('delete from public.north_agent_conversations where user_id=$1',[userId]);
  return res.json({status:'cancelled',financial_recorded:false,message:'Lançamento descartado.'});
 }
 let input={};
 if(active?.missing_field){
  input={...state};
  const field=active.missing_field;
  if(field==='valor'){const v=Number(raw.replace(/[^0-9,.]/g,'').replace(',','.'));if(Number.isFinite(v)&&v>0)input.valor=v;}
  else if(field==='descricao')input.descricao=raw;
  else if(field==='categoria')input.categoria=raw;
  else if(field==='subcategoria')input.subcategoria=raw;
  else if(field==='forma_pagamento')input.forma_pagamento=raw;
  else if(field==='cartao_ou_conta')input.cartao_ou_conta=raw;
  else if(field==='parcelas'){const v=Number(raw.replace(/\\D/g,''));if(Number.isInteger(v)&&v>0)input.parcelas=v;}
  else if(field==='data')input.data=raw;
  else if(field==='pessoa')input.pessoa=raw;
 }else if(provided&&typeof provided==='object'&&!Array.isArray(provided))input={...provided};
 else return res.status(400).json({status:'invalid_payload'});
 if(!input.data)input.data=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!input.forma_pagamento)input.forma_pagamento='pix';
 const people=await pool.query('select familia_id from public.pessoas where usuario_id=$1',[userId]);
 if(people.rowCount!==1)return res.status(409).json({status:'family_not_resolved'});
 const family=people.rows[0].familia_id;
 const categoryRows=(await pool.query('select nome,tipo,id from public.categorias where familia_id=$1 and ativa=true',[family])).rows;
 const expected=input.tipo==='entrada'?'entrada':'saida',categories=categoryRows.filter(c=>c.tipo===expected);
 const lookup=(name,list)=>list.filter(c=>fold(c.nome)===fold(name));
 let missing=null,message='';
 if(!input.tipo||!['despesa','entrada'].includes(input.tipo)) {missing='tipo';message='Foi uma despesa ou receita?';}
 else if(!input.descricao||!String(input.descricao).trim()){missing='descricao';message='Qual é a descrição desse lançamento?';}
 else if(!Number.isFinite(Number(input.valor))||Number(input.valor)<=0){missing='valor';message='Qual foi o valor do lançamento?';}
 else if(!input.categoria||lookup(input.categoria,categories).length!==1){
  missing='categoria';
  const samples=categories.slice(0,4).map(c=>c.nome);
  message='Em qual categoria devo registrar? '+(samples.length?'Algumas opções: '+samples.join(', ')+'.':'Cadastre uma categoria no NORTH.');
 }else{
  input.categoria=lookup(input.categoria,categories)[0].nome;
  if(input.subcategoria){
   const subs=(await pool.query('select nome from public.fin_subcategorias where familia_id=$1 and categoria_id=$2',[family,lookup(input.categoria,categories)[0].id])).rows;
   if(lookup(input.subcategoria,subs).length!==1){missing='subcategoria';message='Não encontrei essa subcategoria. Qual devo utilizar?';}
  }
 }
 if(!missing&&fold(input.forma_pagamento).includes('credito')){
  const cards=(await pool.query('select nome from public.cartoes where familia_id=$1 and ativo=true',[family])).rows;
  if(!input.cartao_ou_conta&&cards.length===1)input.cartao_ou_conta=cards[0].nome;
  if(!input.cartao_ou_conta||lookup(input.cartao_ou_conta,cards).length!==1){missing='cartao_ou_conta';message='Qual cartão de crédito foi utilizado? '+cards.map(c=>c.nome).join(', ');}
 }
 if(!missing&&input.parcelas!=null&&(!Number.isInteger(Number(input.parcelas))||Number(input.parcelas)<1)){missing='parcelas';message='Em quantas parcelas foi a compra?';}
 if(!missing){
  const accounts=(await pool.query('select nome,padrao from public.contas where familia_id=$1 and ativa=true',[family])).rows;
  if(!fold(input.forma_pagamento).includes('credito')&&!input.cartao_ou_conta&&accounts.length!==1&&!accounts.some(a=>a.padrao)){missing='cartao_ou_conta';message='Qual conta foi utilizada? '+accounts.map(a=>a.nome).join(', ');}
 }
 const store=async(field)=>{
  const firstEvent=state._event_id||req.body.external_event_id;
  const next={...input,_event_id:firstEvent};
  await pool.query("insert into public.north_agent_conversations(user_id,state,missing_field,updated_at,expires_at) values($1,$2,$3,now(),now()+interval '24 hours') on conflict(user_id) do update set state=excluded.state,missing_field=excluded.missing_field,updated_at=now(),expires_at=excluded.expires_at",[userId,JSON.stringify(next),field]);
 };
 if(missing){await store(missing);return res.json({status:'needs_info',missing_field:missing,message,financial_recorded:false});}
 let payload;try{payload=cleanDraft(input);}catch(e){return res.status(422).json({status:'invalid_financial_data',message:e.message,financial_recorded:false});}
 const eventId=state._event_id||req.body.external_event_id;
 const draft=await pool.query("insert into public.north_agent_drafts(user_id,external_event_id,payload) values($1,$2,$3) on conflict(user_id,external_event_id) do update set updated_at=public.north_agent_drafts.updated_at returning id",[userId,eventId,JSON.stringify(payload)]);
 try{
  const posted=await postFinancialDraft(draft.rows[0].id,userId);
  await pool.query('delete from public.north_agent_conversations where user_id=$1',[userId]);
  return res.json({...posted,payload,message:posted.financial_recorded?'Lançamento registrado no NORTH.':'Lançamento não registrado.'});
 }catch(e){
  if(e.status===422){
   const hint=String(e.message||'');
   let field=hint.includes('categor')?'categoria':hint.includes('conta')?'cartao_ou_conta':hint.includes('cartão')?'cartao_ou_conta':null;
   if(field){await store(field);return res.json({status:'needs_info',missing_field:field,message:hint,financial_recorded:false});}
  }
  throw e;
 }
});
app.post('/api/agent/whatsapp/drafts',waLimit,async(req,res)=>{
 if(!agentAuth(req,res))return;
 const userId=await agentLinkedUser(req,res);if(!userId)return;
 const payload=cleanDraft(req.body?.payload);
 const event=req.body.external_event_id;
 const r=await pool.query("insert into public.north_agent_drafts(user_id,external_event_id,payload) values($1,$2,$3) on conflict(user_id,external_event_id) do update set updated_at=public.north_agent_drafts.updated_at returning id,status,payload",[userId,event,JSON.stringify(payload)]);
 const item=r.rows[0];
 res.json({status:item.status,id:item.id,reference:item.id.slice(0,8).toUpperCase(),payload:item.payload,confirmation_required:true,financial_recorded:false});
});
// Convert a linked WhatsApp message to a financial movement. The agent key is required.
app.post('/api/agent/whatsapp/post',waLimit,async(req,res)=>{
 if(!agentAuth(req,res))return;
 const userId=await agentLinkedUser(req,res);
 if(!userId)return;
 const payload=cleanDraft(req.body?.payload);
 const eventId=req.body.external_event_id;
 const r=await pool.query("insert into public.north_agent_drafts(user_id,external_event_id,payload) values($1,$2,$3) on conflict(user_id,external_event_id) do update set updated_at=public.north_agent_drafts.updated_at returning id,status",[userId,eventId,JSON.stringify(payload)]);
 const result=await postFinancialDraft(r.rows[0].id,userId);
 res.json({...result,payload,confirmation_required:false});
});
app.post('/api/agent/whatsapp/drafts/preview-confirm',waLimit,async(req,res)=>{
 if(!agentAuth(req,res))return;
 const userId=await agentLinkedUser(req,res);if(!userId)return;
 const ref=String(req.body?.reference||'').trim().toLowerCase();
 if(!/^[0-9a-f]{8}$/.test(ref))return res.status(400).json({status:'reference_required'});
 // The prefix identifies a single proposal, scoped to the verified phone's user.
 const rows=await pool.query("select id,status from public.north_agent_drafts where user_id=$1 and left(id::text,8)=$2 order by created_at desc limit 2",[userId,ref]);
 if(rows.rowCount!==1)return res.status(409).json({status:rows.rowCount?'ambiguous_reference':'draft_not_found'});
 const r=await pool.query("update public.north_agent_drafts set status='confirmed_preview',updated_at=now() where id=$1 and user_id=$2 and status='pending' returning id,status",[rows.rows[0].id,userId]);
 if(!r.rowCount)return res.status(409).json({status:'already_handled'});
 res.json({status:'confirmed_preview',id:r.rows[0].id,financial_recorded:false,message:'Confirmação de teste recebida. Nenhum lançamento foi registrado.'});
});
// Short conversational replies: never generate real movements.
app.post('/api/agent/whatsapp/drafts/reply',waLimit,async(req,res)=>{
 if(!agentAuth(req,res))return;
 const userId=await agentLinkedUser(req,res);if(!userId)return;
 const raw=req.body?.text;
 if(typeof raw!=='string'||raw.length>120)return res.status(400).json({status:'invalid_reply'});
 const normalized=raw.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[.!?]+$/g,'').trim();
 const accepts=new Set(['sim','s','ok','okay','confirmar','confirmo','pode registrar','pode lancar','pode salvar','isso']);
 const declines=new Set(['nao','n','cancelar','cancela','descartar','descarte']);
 if(!accepts.has(normalized)&&!declines.has(normalized))return res.json({status:'not_confirmation',handled:false});
 const pending=await pool.query("select id from public.north_agent_drafts where user_id=$1 and status='pending' order by created_at desc limit 2",[userId]);
 if(pending.rowCount===0)return res.json({status:'no_pending',handled:true,financial_recorded:false});
 if(pending.rowCount>1)return res.json({status:'multiple_pending',handled:true,financial_recorded:false,message:'Há mais de uma proposta pendente; identifique qual deseja confirmar ou cancelar.'});
 const status=accepts.has(normalized)?'confirmed_preview':'discarded';
 const updated=await pool.query("update public.north_agent_drafts set status=$1,updated_at=now() where id=$2 and user_id=$3 and status='pending' returning id,status",[status,pending.rows[0].id,userId]);
 if(!updated.rowCount)return res.status(409).json({status:'already_handled',handled:true,financial_recorded:false});
 return res.json({status,handled:true,id:updated.rows[0].id,financial_recorded:false,message:status==='confirmed_preview'?'Confirmação recebida em modo de teste. Nenhuma movimentação foi registrada.':'Proposta descartada.'});
});
app.use('/api',async(req,res,next)=>{const token=(req.headers.authorization||'').replace(/^Bearer /,'');const r=await pool.query('select user_id from auth.sessions where token_hash=$1 and expires_at>now()',[digest(token)]);if(!r.rowCount)throw fail('Entre novamente.',401);req.user=r.rows[0].user_id;req.token=token;next();});
// Draft-only financial proposals, scoped to the authenticated NORTH user.
const cleanDraft=input=>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Proposta inválida.');
 const {tipo,descricao,valor,data,forma_pagamento,categoria,subcategoria,cartao_ou_conta,pessoa,parcelas}=input;
 if(!['entrada','despesa'].includes(tipo)||typeof descricao!=='string'||!descricao.trim()||descricao.length>250)throw fail('Tipo ou descrição inválidos.');
 const amount=Number(valor);
 if(!Number.isFinite(amount)||amount<=0||amount>999999999)throw fail('Valor inválido.');
 const localNow=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const effectiveDate=data||localNow;
 if(typeof effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||Number.isNaN(Date.parse(effectiveDate+'T12:00:00Z')))throw fail('Data inválida.');
 const optional=v=>v==null?null:(typeof v==='string'&&v.length<=120?v:null);
 if([forma_pagamento,categoria,subcategoria,cartao_ou_conta,pessoa].some(v=>v!=null&&optional(v)===null))throw fail('Campo inválido.');
 const count=parcelas==null?1:Number(parcelas);
 if(!Number.isInteger(count)||count<1||count>600)throw fail('Parcelas inválidas.');
 return {tipo,descricao:descricao.trim(),valor:Math.round(amount*100)/100,data:effectiveDate,forma_pagamento:optional(forma_pagamento),categoria:optional(categoria),subcategoria:optional(subcategoria),cartao_ou_conta:optional(cartao_ou_conta),pessoa:optional(pessoa),parcelas:count};
};
app.get('/api/agent/drafts',async(req,res)=>{
 const r=await pool.query('select id,external_event_id,payload,status,created_at from public.north_agent_drafts where user_id=$1 order by created_at desc limit 50',[req.user]);
 res.json(r.rows);
});
app.post('/api/agent/drafts',async(req,res)=>{
 const event=String(req.body?.external_event_id||'');
 if(!event||event.length>200)return res.status(400).json({message:'Identificador obrigatório.'});
 const payload=cleanDraft(req.body?.payload);
 const r=await pool.query("insert into public.north_agent_drafts(user_id,external_event_id,payload) values($1,$2,$3) on conflict(user_id,external_event_id) do nothing returning id,status,payload",[req.user,event,JSON.stringify(payload)]);
 if(!r.rowCount)return res.status(409).json({status:'duplicate_draft'});
 res.status(201).json({...r.rows[0],financial_recorded:false,confirmation_required:true});
});
// Financial posting is permitted only from an authenticated NORTH session.
// The unauthenticated WhatsApp webhook never calls this route.
async function postFinancialDraft(draftId,userId){
 if(!/^[0-9a-f-]{36}$/i.test(draftId))throw fail('Identificador inválido.');
 const result=await transaction(async c=>{
  const draft=(await c.query("select * from public.north_agent_drafts where id=$1 and user_id=$2 for update",[draftId,userId])).rows[0];
  if(!draft)throw fail('Proposta não encontrada.',404);
  if(draft.status==='posted'){
   const existing=await c.query("select id from public.fin_planos where id=$1",[draft.id]);
   if(!existing.rowCount)throw fail('Registro inconsistente; contate o suporte.',409);
   return {status:'posted',plan_id:draft.id,already_recorded:true,financial_recorded:true};
  }
  if(draft.status!=='pending')throw fail('Proposta não está pendente.',409);
  const d=cleanDraft(draft.payload),tipo=d.tipo==='despesa'?'saida':'entrada';
  const persons=(await c.query('select familia_id,id from public.pessoas where usuario_id=$1',[userId])).rows;
  if(persons.length!==1)throw fail('Identifique a pessoa e família antes de registrar.',409);
  const familia=persons[0].familia_id;
  const resolve=async(table,label,filter,required)=>{
   const rows=(await c.query('select id,nome from public.'+table+' where familia_id=$1 '+filter,[familia])).rows;
   if(label){
    const match=rows.filter(x=>x.nome?.trim().toLocaleLowerCase('pt-BR')===label.trim().toLocaleLowerCase('pt-BR'));
    if(match.length!==1)throw fail('Cadastro ambíguo ou inexistente: '+label,422);
    return match[0].id;
   }
   if(required&&rows.length!==1)throw fail('Informe o cadastro: '+table,422);
   return rows.length===1?rows[0].id:null;
  };
  const categoria=await resolve('categorias',d.categoria,"and tipo='"+tipo+"' and ativa=true",true);
  const subcat=d.subcategoria?await resolve('fin_subcategorias',d.subcategoria,'and categoria_id=\''+categoria+'\'',true):null;
  const payment=(d.forma_pagamento||'pix').trim().toLocaleLowerCase('pt-BR');
  const forma=payment==='pix'?'pix':payment==='dinheiro'?'dinheiro':payment==='débito'||payment==='debito'?'debito':payment==='crédito'||payment==='credito'?'credito':null;
  if(!forma)throw fail('Informe a forma de pagamento.',422);
  let conta=null,cartao=null,fatura=null;
  if(forma==='credito'){
   if(tipo!=='saida')throw fail('Pagamento no crédito só é aceito para despesas.',422);
   cartao=await resolve('cartoes',d.cartao_ou_conta,'and ativo=true',true);
   const info=(await c.query('select dia_fechamento,dia_vencimento from public.cartoes where id=$1 and familia_id=$2',[cartao,familia])).rows[0];
   if(!info?.dia_fechamento||!info?.dia_vencimento)throw fail('Configure fechamento e vencimento do cartão.',422);
   fatura=(await c.query('select public.fin_primeira_fatura($1::date,$2::integer,$3::integer) as mes',[d.data,info.dia_fechamento,info.dia_vencimento])).rows[0].mes;
  }else {
   if(d.cartao_ou_conta)conta=await resolve('contas',d.cartao_ou_conta,'and ativa=true',true);
   else {
    const options=(await c.query('select id,padrao from public.contas where familia_id=$1 and ativa=true',[familia])).rows;
    if(options.length===1)conta=options[0].id;
    else {
     const chosen=options.filter(a=>a.padrao);
     if(chosen.length!==1)throw fail('Defina uma conta padrão nas configurações.',422);
     conta=chosen[0].id;
    }
   }
  }
  if(d.pessoa&&d.pessoa.trim()){
   const p=(await c.query('select id from public.pessoas where familia_id=$1 and lower(nome)=lower($2)',[familia,d.pessoa.trim()])).rows;
   if(p.length!==1||p[0].id!==persons[0].id)throw fail('Pessoa não identificada como titular da sessão.',422);
  }
  const today=(await c.query('select current_date::text as today')).rows[0].today;
  const status=forma==='credito'||d.data>today?'pendente':'concluido';
  const dados={tipo,descricao:d.descricao,valor:d.valor,status,forma,conta_id:conta,cartao_id:cartao,categoria_id:categoria,subcategoria_id:subcat,pessoa_id:persons[0].id,fatura_mes:fatura,data_realizada:status==='concluido'?d.data:null};
  await c.query('select public.fin_criar($1::uuid,$2::uuid,$3::text,$4::date,$5::date,$6::text,$7::integer,$8::jsonb)',[draft.id,familia,d.parcelas>1?'parcelado':'unico',d.data,null,'mensal',d.parcelas,JSON.stringify(dados)]);
  await c.query("update public.north_agent_drafts set status='posted',updated_at=now() where id=$1 and user_id=$2",[draft.id,userId]);
  return {status:'posted',plan_id:draft.id,already_recorded:false,financial_recorded:true};
 },userId);
 return result;
}

app.post('/api/agent/drafts/:id/post',async(req,res)=>{
 res.json(await postFinancialDraft(req.params.id,req.user));
});
app.post('/api/agent/drafts/:id/preview-confirm',async(req,res)=>{
 if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.status(400).json({message:'Identificador inválido.'});
 const r=await pool.query("update public.north_agent_drafts set status='confirmed_preview',updated_at=now() where id=$1 and user_id=$2 and status='pending' returning id,status",[req.params.id,req.user]);
 if(!r.rowCount)return res.status(404).json({message:'Proposta não encontrada ou já respondida.'});
 res.json({...r.rows[0],financial_recorded:false,message:'Confirmação recebida em modo de teste; nenhum lançamento financeiro criado.'});
});
app.post('/api/agent/drafts/:id/discard',async(req,res)=>{
 if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.status(400).json({message:'Identificador inválido.'});
 const r=await pool.query("update public.north_agent_drafts set status='discarded',updated_at=now() where id=$1 and user_id=$2 and status='pending' returning id,status",[req.params.id,req.user]);
 if(!r.rowCount)return res.status(404).json({message:'Proposta não encontrada ou já respondida.'});
 res.json(r.rows[0]);
});
app.post('/api/accounts/:id/default',async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id))throw fail('Conta inválida.');
 const r=await transaction(async c=>{
  const found=await c.query('select c.id,c.familia_id from public.contas c join public.pessoas p on p.familia_id=c.familia_id where c.id=$1 and c.ativa=true and p.usuario_id=$2',[req.params.id,req.user]);
  if(found.rowCount!==1)throw fail('Conta não encontrada ou inativa.',404);
  const family=found.rows[0].familia_id;
  await c.query('update public.contas set padrao=false where familia_id=$1 and padrao=true',[family]);
  await c.query('update public.contas set padrao=true where familia_id=$1 and id=$2',[family,req.params.id]);
  return {status:'ok',default_account_id:req.params.id};
 },req.user);
 res.json(r);
});
app.get('/api/whatsapp/link/status',async(req,res)=>{const r=await pool.query('select phone,verified_at from public.north_whatsapp_links where user_id=$1',[req.user]);res.json({connected:!!r.rowCount,phone:r.rows[0]?.phone||null,verified_at:r.rows[0]?.verified_at||null});});
app.post('/api/whatsapp/link/request',waLimit,async(req,res)=>{
 const phone=waPhone(req.body?.phone);
 if(!phone)return res.status(400).json({message:'Informe o número com DDD e código do Brasil (+55).'});
 const taken=await pool.query('select 1 from public.north_whatsapp_links where phone=$1 and user_id<>$2',[phone,req.user]);
 if(taken.rowCount)return res.status(409).json({message:'Número vinculado a outro usuário.'});
 const pending=await pool.query('select 1 from public.north_whatsapp_challenges where phone=$1 and user_id<>$2 and expires_at>now()',[phone,req.user]);
 if(pending.rowCount)return res.status(409).json({message:'Número já possui uma verificação pendente.'});
 const recent=await pool.query("select 1 from public.north_whatsapp_challenges where user_id=$1 and created_at>now()-interval '60 seconds'",[req.user]);
 if(recent.rowCount)return res.status(429).json({message:'Aguarde 60 segundos para solicitar outro código.'});
 const code=String(randomInt(1000000)).padStart(6,'0');
 await pool.query("insert into public.north_whatsapp_challenges(user_id,phone,code_hash,expires_at) values($1,$2,$3,now()+interval '10 minutes') on conflict(user_id) do update set phone=excluded.phone,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=now()",[req.user,phone,waHash(req.user,code)]);
 res.json({status:'pending',phone,code,expires_in_seconds:600});
});
app.delete('/api/whatsapp/link',async(req,res)=>{await pool.query('delete from public.north_whatsapp_challenges where user_id=$1',[req.user]);await pool.query('delete from public.north_whatsapp_links where user_id=$1',[req.user]);res.json({connected:false});});
app.post('/api/auth/v1/logout',async(req,res)=>{await pool.query('delete from auth.sessions where token_hash=$1',[digest(req.token)]);res.json(null);});
const tables=new Set(['familias','pessoas','contas','cartoes','categorias','lancamentos','fin_subcategorias','fin_metas','fin_orcamentos','fin_movimentos','fin_planos']);
const writes=new Set(['contas','cartoes','categorias','fin_subcategorias','fin_metas','fin_orcamentos','fin_movimentos','fin_planos']);
const rpcs={fin_criar:['p_id','p_familia','p_modalidade','p_inicio','p_fim','p_frequencia','p_quantidade','p_dados'],fin_atualizar_recorrencias:[],fin_editar:['p_id','p_futuras','p_descricao','p_valor','p_pessoa','p_categoria','p_subcategoria','p_data','p_real'],fin_editar_compra:['p_id','p_futuras','p_descricao','p_valor','p_pessoa','p_categoria','p_subcategoria','p_data','p_real','p_compra'],fin_cancelar:['p_id','p_futuras'],fin_excluir:['p_id','p_escopo'],fin_confirmar_cobranca:['p_id','p_efetivada'],fin_versao_cartoes:[]};
app.post('/api/rest/v1/rpc/:name',async(req,res)=>{const keys=rpcs[req.params.name];if(!keys)throw fail('Função indisponível.',404);const result=await transaction(async c=>(await c.query(`select public.${req.params.name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,keys.map(k=>req.body[k]??null))).rows[0].result,req.user);res.json(result);});
const columns=new Map();async function tableColumns(c,t){if(!columns.has(t))columns.set(t,new Set((await c.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[t])).rows.map(x=>x.column_name)));return columns.get(t);}
app.all('/api/rest/v1/:table',async(req,res)=>{const t=req.params.table;if(!tables.has(t))throw fail('Tabela indisponível.',404);const result=await transaction(async c=>{const allowed=await tableColumns(c,t);const vals=[],where=[];for(const [key,value]of Object.entries(req.query)){if(['select','order','limit','offset','on_conflict'].includes(key))continue;if(!['id','familia_id','plano_id'].includes(key)||!allowed.has(key)||typeof value!=='string'||!value.startsWith('eq.'))throw fail('Filtro inválido.');vals.push(value.slice(3));where.push(`"${key}"=$${vals.length}`);}const filter=where.length?' where '+where.join(' and '):'';
if(req.method==='GET'){const limit=Math.min(500,Math.max(1,parseInt(req.query.limit)||500)),offset=Math.max(0,parseInt(req.query.offset)||0);return(await c.query(`select * from public.${t}${filter} order by id limit ${limit} offset ${offset}`,vals)).rows;}
if(!writes.has(t))throw fail('Operação não permitida.',403);
const clean=row=>{if(!row||typeof row!=='object'||Array.isArray(row))throw fail('Dados inválidos.');const keys=Object.keys(row);if(!keys.length||keys.some(k=>!allowed.has(k)))throw fail('Campo inválido.');return keys;};
if(req.method==='PATCH'){if(!where.length)throw fail('Selecione um registro.');const keys=clean(req.body);if(keys.some(k=>['id','familia_id','usuario_id'].includes(k)))throw fail('Campo protegido.',403);const set=keys.map(k=>{vals.push(req.body[k]);return `"${k}"=$${vals.length}`;});return(await c.query(`update public.${t} set ${set.join(',')}${filter} returning *`,vals)).rows;}
if(req.method==='POST'){const rows=Array.isArray(req.body)?req.body:[req.body];if(rows.length>500)throw fail('Lote grande demais.');const output=[];for(const row of rows){const keys=clean(row);const ignore=req.headers.prefer?.includes('resolution=ignore-duplicates');const r=await c.query(`insert into public.${t} (${keys.map(k=>'"'+k+'"').join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ${ignore?'on conflict(id) do nothing':''} returning *`,keys.map(k=>row[k]));output.push(...r.rows);}return output;}
throw fail('Método não permitido.',405);},req.user);res.json(result);});
app.get('/health',async(req,res)=>{await pool.query('select 1');res.json({status:'ok'});});
app.use(express.static(new URL('../dist',import.meta.url).pathname,{index:'index.html',maxAge:0}));
app.use((err,req,res,next)=>{const status=err.status||(['42501'].includes(err.code)?403:err.code?.startsWith('23')||err.code==='P0001'||err.code==='22P02'?400:500);if(status===500)console.error('Erro no servidor:',err.code||err.name);res.status(status).json({message:status===500?'Erro interno. Consulte o administrador.':err.code==='P0001'?err.message:err.status?err.message:'Dados inválidos ou operação não permitida.'});});
return app;
}


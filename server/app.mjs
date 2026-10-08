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
app.use('/api',async(req,res,next)=>{const token=(req.headers.authorization||'').replace(/^Bearer /,'');const r=await pool.query('select user_id from auth.sessions where token_hash=$1 and expires_at>now()',[digest(token)]);if(!r.rowCount)throw fail('Entre novamente.',401);req.user=r.rows[0].user_id;req.token=token;next();});
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


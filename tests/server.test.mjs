import {PGlite} from '@electric-sql/pglite';import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';import {hashPassword} from '../server/password.mjs';
const db=new PGlite();const root=new URL('..',import.meta.url).pathname;
for(const name of ['000-base.sql','upgrade.sql','cards-v2.sql','003-access.sql','004-password-resets.sql'])await db.exec(await fs.readFile(root+'/db/'+name,'utf8'));
const uid=randomUUID(),fam=randomUUID(),pid=randomUUID(),outsider=randomUUID(),fam2=randomUUID();
await db.query('insert into auth.users(id,email,email_confirmed_at,password_hash) values($1,$2,now(),$3),($4,$5,now(),$3)',[uid,'david@test.local',await hashPassword('a-test-password-123'),outsider,'other@test.local']);
await db.query('insert into familias values($1,$2),($3,$4)',[fam,'David e Carol',fam2,'Outro']);await db.query('insert into pessoas(id,familia_id,usuario_id,nome) values($1,$2,$3,$4),($5,$6,$7,$8)',[pid,fam,uid,'David',randomUUID(),fam2,outsider,'Outro']);
const pool={query:(...args)=>db.query(...args)};
const transaction=async(fn,user)=>{await db.exec('begin');try{if(user){await db.exec('set local role authenticated');await db.query("select set_config('app.user_id',$1,true)",[user]);}const r=await fn(pool);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}};
const server=createApp({pool,transaction}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
async function call(path,method='GET',body,token){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
try{
assert.equal((await call('/api/rest/v1/familias')).status,401);
assert.equal((await call('/api/auth/v1/token?grant_type=password','POST',{email:'david@test.local',password:'wrong'})).status,401);
const login=await call('/api/auth/v1/token?grant_type=password','POST',{email:'david@test.local',password:'a-test-password-123'});assert.equal(login.status,200);const token=login.data.access_token;
let r=await call('/api/rest/v1/familias','GET',undefined,token);assert.equal(r.data.length,1);assert.equal(r.data[0].id,fam);
r=await call('/api/rest/v1/contas','POST',{id:randomUUID(),familia_id:fam2,nome:'Intruso',tipo:'bancaria'},token);assert.equal(r.status,403);
const cat=randomUUID();r=await call('/api/rest/v1/categorias','POST',{id:cat,familia_id:fam,nome:'Restaurantes',tipo:'saida',ativa:true},token);assert.equal(r.status,200,JSON.stringify(r));
const card=randomUUID();assert.equal((await call('/api/rest/v1/cartoes','POST',{id:card,familia_id:fam,nome:'Itaú Azul',dia_fechamento:2,dia_vencimento:9},token)).status,200);
const plan=randomUUID();r=await call('/api/rest/v1/rpc/fin_criar','POST',{p_id:plan,p_familia:fam,p_modalidade:'parcelado',p_inicio:'2026-10-01',p_fim:null,p_frequencia:'mensal',p_quantidade:3,p_dados:{tipo:'saida',forma:'credito',descricao:'Compra teste',valor:300,cartao_id:card,categoria_id:cat,fatura_mes:'2026-10-01',status:'pendente'}},token);assert.equal(r.status,200,JSON.stringify(r));
r=await call('/api/rest/v1/fin_movimentos','GET',undefined,token);assert.equal(r.data.length,3);const mid=r.data[0].id;
r=await call('/api/rest/v1/rpc/fin_excluir','POST',{p_id:mid,p_escopo:'serie'},token);assert.equal(r.status,200,JSON.stringify(r));assert.equal((await call('/api/rest/v1/fin_movimentos','GET',undefined,token)).data.length,0);
assert.equal((await call('/api/rest/v1/rpc/not_allowed','POST',{},token)).status,404);
assert.equal((await call('/api/rest/v1/pessoas?id=eq.'+pid,'PATCH',{usuario_id:outsider},token)).status,403);
assert.equal((await call('/api/rest/v1/fin_convites','POST',{},token)).status,404);
assert.equal((await call('/api/rest/v1/rpc/fin_aceitar_convite','POST',{},token)).status,404);
assert.equal((await call('/api/auth/v1/signup','POST',{name:'Outro',email:'invite@test.local',password:'password-123',invite:'legacy-token'})).status,403);
assert.equal((await call('/api/auth/v1/logout','POST',{},token)).status,200);assert.equal((await call('/api/rest/v1/familias','GET',undefined,token)).status,401);
console.log('PASS VPS: fresh schema, own login/logout, family isolation, protected writes, cards/installments/deletion, disabled shared invitations.');
}finally{server.close();await db.close();}


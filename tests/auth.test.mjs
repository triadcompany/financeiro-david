import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';import {digest} from '../server/password.mjs';
const db=new PGlite();
for(const name of ['000-base.sql','upgrade.sql','cards-v2.sql','003-access.sql','004-password-resets.sql'])await db.exec(await fs.readFile(new URL('../db/'+name,import.meta.url),'utf8'));
const pool={query:(...args)=>db.query(...args)};
const transaction=async(fn,user)=>{await db.exec('begin');try{if(user){await db.exec('set local role authenticated');await db.query("select set_config('app.user_id',$1,true)",[user]);}const result=await fn(pool);await db.exec('commit');return result;}catch(e){await db.exec('rollback');throw e;}};
const sent=[];let configured=true;
process.env.APP_ORIGIN='https://finance.example';
const server=createApp({pool,transaction,canReset:()=>configured,sendReset:async(email,url)=>sent.push({email,url})}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
async function call(path,body,token){const r=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
try{
 let r=await call('auth/v1/signup',{name:'Nova pessoa',email:'new@test.local',password:'short'});assert.equal(r.status,400);
 r=await call('auth/v1/signup',{name:'Nova pessoa',email:'invalid',password:'password-123'});assert.equal(r.status,400);
 r=await call('auth/v1/signup',{name:'Nova pessoa',email:'new@test.local',password:'password-123',invite:'11111111-1111-1111-1111-111111111111'});assert.equal(r.status,403);
 r=await call('auth/v1/signup',{name:'Nova pessoa',email:' NEW@test.local ',password:'password-123'});assert.equal(r.status,200,JSON.stringify(r));const first=r.data;
 r=await call('auth/v1/signup',{name:'Outra pessoa',email:'other@test.local',password:'password-123'});assert.equal(r.status,200);const second=r.data;
 r=await call('auth/v1/signup',{name:'Duplicado',email:'NEW@test.local',password:'password-123'});assert.equal(r.status,400);
 const f1=await call('rest/v1/familias',undefined,first.access_token),f2=await call('rest/v1/familias',undefined,second.access_token);assert.equal(f1.data.length,1);assert.equal(f2.data.length,1);assert.notEqual(f1.data[0].id,f2.data[0].id);
 assert.equal((await call('rest/v1/pessoas',undefined,first.access_token)).data[0].nome,'Nova pessoa');
 assert.equal((await call('rest/v1/cartoes',undefined,first.access_token)).data.length,0);
 assert.equal((await call('rest/v1/contas',{familia_id:f2.data[0].id,nome:'Intrusão',tipo:'bancaria'},first.access_token)).status,403);
 const recovery=await call('auth/v1/recover',{email:'new@test.local'});assert.equal(recovery.status,200);assert.equal(sent.length,1);assert.equal(recovery.data.message,(await call('auth/v1/recover',{email:'absent@test.local'})).data.message);
 await call('auth/v1/recover',{email:'new@test.local'});assert.equal(sent.length,1);
 const token=new URL(sent[0].url).hash.split('=')[1];assert.equal(new URL(sent[0].url).origin,process.env.APP_ORIGIN);assert.equal((await db.query('select token_hash from auth.password_resets')).rows[0].token_hash,digest(token));
 assert.equal((await call('auth/v1/reset',{token,password:'bad'})).status,400);
 assert.equal((await call('auth/v1/reset',{token:'bad',password:'new-password-123'})).status,400);
 assert.equal((await call('auth/v1/reset',{token,password:'new-password-123'})).status,200);
 assert.equal((await call('rest/v1/familias',undefined,first.access_token)).status,401);
 assert.equal((await call('auth/v1/reset',{token,password:'new-password-456'})).status,400);
 assert.equal((await call('auth/v1/token?grant_type=password',{email:'new@test.local',password:'password-123'})).status,401);
 assert.equal((await call('auth/v1/token?grant_type=password',{email:'new@test.local',password:'new-password-123'})).status,200);
 await call('auth/v1/recover',{email:'new@test.local'});const expired=new URL(sent[1].url).hash.split('=')[1];await db.query("update auth.password_resets set expires_at=now()-interval '1 minute'");assert.equal((await call('auth/v1/reset',{token:expired,password:'password-456'})).status,400);
 configured=false;assert.equal((await call('auth/v1/recover',{email:'new@test.local'})).status,503);
 assert.equal((await call('rest/v1/familias',undefined,second.access_token)).status,200);
 console.log('PASS auth: independent signup, duplicate/invalid signup, tenant isolation, recovery email, throttling, hashed one-use expiring tokens, session revocation, new login and SMTP configuration.');
}finally{server.close();await db.close();}

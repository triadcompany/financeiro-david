import fs from 'node:fs/promises';import {pool,transaction} from '../server/db.mjs';
const file=process.argv[2];if(!file)throw Error('Uso: npm run import:data -- /caminho/export.json');const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.format!==1||!data.tables)throw Error('Formato inválido.');
const order=['familias','pessoas','contas','cartoes','categorias','lancamentos','fin_subcategorias','fin_metas','fin_orcamentos','fin_planos','fin_movimentos','fin_convites','fin_exclusoes'];
try{await transaction(async c=>{if(Number((await c.query('select count(*) from public.familias')).rows[0].count))throw Error('Importação exige banco vazio; não sobrescreve dados.');for(const p of data.tables.pessoas||[]){if(p.usuario_id)await c.query('insert into auth.users(id,email) values($1,$2) on conflict(id) do nothing',[p.usuario_id,p.usuario_id+'@invalid.local']);}
// Validate the complete dataset before inserting; do not silently discard unknown fields.
for(const name of order){const cols=new Set((await c.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[name])).rows.map(x=>x.column_name));for(const row of data.tables[name]||[])for(const key of Object.keys(row))if(!cols.has(key))throw Error(`Campo ${name}.${key} não mapeado. Importação cancelada; ajuste o esquema antes de continuar.`);}
// Reserve validation depends on full history, not the arbitrary UUID order in the export.
await c.query('alter table public.fin_movimentos disable trigger fin_checar_reservas');
for(const name of order){for(const row of data.tables[name]||[]){const keys=Object.keys(row);await c.query(`insert into public.${name} (${keys.map(k=>'"'+k+'"').join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}const count=Number((await c.query(`select count(*) from public.${name}`)).rows[0].count);if(count!==(data.tables[name]||[]).length)throw Error('Contagem divergente: '+name);console.log(name+': '+count);}
await c.query('alter table public.fin_movimentos enable trigger fin_checar_reservas');
// Backfill dates using original plans / legacy dates; never invent purchase dates.
const sql=(await fs.readFile(new URL('../db/cards-v2.sql',import.meta.url),'utf8')).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');await c.query(sql);
console.log('Importação concluída. Configure os acessos por PERSON_ID e confira os saldos antes da troca.');});}finally{await pool.end();}

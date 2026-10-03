import pg from 'pg';
if(!process.env.DATABASE_URL)throw Error('Configure DATABASE_URL no ambiente.');
// Keep SQL dates as YYYY-MM-DD, not timezone-dependent JavaScript timestamps.
pg.types.setTypeParser(1082,v=>v);
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000,options:'-c timezone=America/Sao_Paulo'});
export async function transaction(fn,user){const c=await pool.connect();try{await c.query('BEGIN');if(user){await c.query('SET LOCAL ROLE authenticated');await c.query("select set_config('app.user_id',$1,true)",[user]);}const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}

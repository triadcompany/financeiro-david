import {pool,transaction} from './db.mjs';import {createApp} from './app.mjs';
const app=createApp({pool,transaction});
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Painel iniciado.'));process.on('SIGTERM',()=>server.close(()=>pool.end().then(()=>process.exit(0))));

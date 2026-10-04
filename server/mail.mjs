import nodemailer from 'nodemailer';
export function mailConfigured(){try{return Boolean(process.env.SMTP_HOST&&process.env.SMTP_FROM&&new URL(process.env.APP_ORIGIN).protocol==='https:');}catch{return false;}}
export async function sendResetEmail(to,url){
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',requireTLS:process.env.SMTP_SECURE!=='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
 await transport.sendMail({from:process.env.SMTP_FROM,to:{address:to},subject:'Redefina sua senha — Finanças',text:`Recebemos uma solicitação para redefinir sua senha.\n\nAbra o link abaixo em até 30 minutos:\n${url}\n\nO link funciona uma única vez. Se você não fez essa solicitação, ignore este e-mail.`});
}

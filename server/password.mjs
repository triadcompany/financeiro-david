import {scrypt as derive,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive);
export async function hashPassword(password){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Use uma senha entre 12 e 256 caracteres.');const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
export async function checkPassword(password,stored){const [salt,hash]=(stored||'dummy:').split(':');const key=await scrypt(String(password).slice(0,256),salt,64);const target=Buffer.from(hash,'hex');return target.length===key.length&&timingSafeEqual(key,target);}
export const digest=token=>createHash('sha256').update(token).digest('hex');

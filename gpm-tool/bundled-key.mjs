import {readFile} from 'node:fs/promises';
import {scrypt as scryptCallback,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';

// Key AI đi kèm app được mã hoá bằng mật khẩu (scrypt + AES-256-GCM).
// Repository và DMG chỉ chứa file đã mã hoá; người dùng nhập mật khẩu 1 lần để mở khoá.
const scrypt=promisify(scryptCallback);
export const BUNDLED_KEY_FILE=new URL('./bundled-key.enc.json',import.meta.url);
export const BUNDLED_KEY_FORMAT='hoanxu-bundled-key';
// N=2^18 làm mỗi lần thử mật khẩu tốn khoảng 256 MB RAM và vài trăm ms, giúp chậm việc dò mật khẩu.
export const DEFAULT_COST=Object.freeze({N:2**18,r:8,p:1});
export const WRONG_PASSWORD='Mật khẩu không đúng.';

const b64=value=>Buffer.from(value).toString('base64');
const fromB64=(value,length)=>{if(typeof value!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('File key mã hoá không hợp lệ.');const out=Buffer.from(value,'base64');if(length&&out.length!==length)throw Error('File key mã hoá không hợp lệ.');return out;};
const aad=bundle=>Buffer.from(BUNDLED_KEY_FORMAT+':'+bundle.version+':'+bundle.id);

function checkPassword(password){
 if(typeof password!=='string'||!password.length)throw Error('Chưa nhập mật khẩu.');
 if(password.length>200)throw Error('Mật khẩu quá dài.');
}
async function derive(password,kdf){
 const {N,r,p}=kdf;
 return scrypt(password.normalize('NFC'),fromB64(kdf.salt,16),32,{N,r,p,maxmem:256*N*r});
}

export function validateBundle(bundle){
 if(!bundle||typeof bundle!=='object'||bundle.format!==BUNDLED_KEY_FORMAT||bundle.version!==1)throw Error('File key mã hoá không đúng định dạng.');
 if(typeof bundle.id!=='string'||!/^[a-f0-9]{16}$/.test(bundle.id))throw Error('File key mã hoá thiếu mã nhận dạng.');
 const {kdf,cipher}=bundle;
 if(kdf?.name!=='scrypt'||!Number.isInteger(kdf.N)||kdf.N<2**14||kdf.N>2**20||(kdf.N&(kdf.N-1))!==0||!Number.isInteger(kdf.r)||kdf.r<1||kdf.r>16||!Number.isInteger(kdf.p)||kdf.p<1||kdf.p>4)throw Error('Thông số giải mã key không hợp lệ.');
 if(cipher?.name!=='aes-256-gcm')throw Error('Thuật toán mã hoá key không hợp lệ.');
 fromB64(kdf.salt,16);fromB64(cipher.iv,12);fromB64(cipher.tag,16);fromB64(cipher.data);
 return bundle;
}

export async function encryptKey(apiKey,password,{cost=DEFAULT_COST,id=randomBytes(8).toString('hex')}={}){
 if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.trim().length>512)throw Error('API key không hợp lệ.');
 checkPassword(password);
 const kdf={name:'scrypt',N:cost.N,r:cost.r,p:cost.p,salt:b64(randomBytes(16))};
 const bundle={format:BUNDLED_KEY_FORMAT,version:1,id,kdf,cipher:{name:'aes-256-gcm'}};
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await derive(password,kdf),iv);
 cipher.setAAD(aad(bundle));
 const data=Buffer.concat([cipher.update(apiKey.trim(),'utf8'),cipher.final()]);
 bundle.cipher={name:'aes-256-gcm',iv:b64(iv),tag:b64(cipher.getAuthTag()),data:b64(data)};
 return validateBundle(bundle);
}

export async function decryptKey(bundle,password){
 validateBundle(bundle);checkPassword(password);
 const decipher=createDecipheriv('aes-256-gcm',await derive(password,bundle.kdf),fromB64(bundle.cipher.iv,12));
 decipher.setAAD(aad(bundle));decipher.setAuthTag(fromB64(bundle.cipher.tag,16));
 let apiKey;
 try{apiKey=Buffer.concat([decipher.update(fromB64(bundle.cipher.data)),decipher.final()]).toString('utf8');}
 catch{throw Error(WRONG_PASSWORD);}
 if(!apiKey.trim()||apiKey.length>512)throw Error('Key giải mã không hợp lệ.');
 return apiKey;
}

export async function loadBundledKey(file=BUNDLED_KEY_FILE){
 let text;
 try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 return validateBundle(JSON.parse(text));
}

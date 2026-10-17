import {createCipheriv,createDecipheriv,randomBytes,scrypt,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
const derive=promisify(scrypt),aad=Buffer.from('hoanxu-gmail-vault-v1');
const options={N:32768,r:8,p:1,maxmem:64*1024*1024};
function bytes(value,length){if(typeof value!=='string'||! /^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Gói Gmail mã hóa không hợp lệ.');const b=Buffer.from(value,'base64');if(length&&b.length!==length)throw Error('Gói Gmail mã hóa không hợp lệ.');return b;}
export function validateVault(v){if(v?.format!=='hoanxu-gmail-vault'||v.version!==1||typeof v.ciphertext!=='string'||v.ciphertext.length>200000)throw Error('Gói Gmail mã hóa không hợp lệ.');bytes(v.salt,16);bytes(v.iv,12);bytes(v.tag,16);bytes(v.ciphertext);return v;}
function encrypt(data,key,salt){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);return {format:'hoanxu-gmail-vault',version:1,salt,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};}
function decrypt(v,key){try{validateVault(v);const cipher=createDecipheriv('aes-256-gcm',key,bytes(v.iv,12));cipher.setAAD(aad);cipher.setAuthTag(bytes(v.tag,16));return JSON.parse(Buffer.concat([cipher.update(bytes(v.ciphertext)),cipher.final()]).toString('utf8'));}catch{throw Error('Mật khẩu không đúng hoặc gói Gmail bị hỏng.');}}
function validateContents(data){if(!/^[a-z0-9._-]+@gmail\.com$/i.test(data?.account)||!data.token?.refresh_token||!data.token.client_id||!data.token.client_secret)throw Error('Gói Gmail thiếu thông tin OAuth.');return data;}
export async function sealGmailVault(data,password){validateContents(data);if(typeof password!=='string'||password.length<12||password.length>512)throw Error('Mật khẩu mở app cần 12–512 ký tự.');const salt=randomBytes(16),key=await derive(password,salt,32,options);try{return encrypt(data,key,salt.toString('base64'));}finally{key.fill(0);}}
export class GmailVault{
 constructor(envelope,dataDir){this.envelope=validateVault(envelope);this.id=createHash('sha256').update(JSON.stringify(envelope)).digest('hex');this.file=path.join(dataDir,'gmail-vault',this.id+'.enc.json');this.key=null;}
 get locked(){return !this.key;}
 async unlock(password){const key=await derive(typeof password==='string'&&password.length<=512?password:'',bytes(this.envelope.salt,16),32,options);try{this.acceptKey(key);}finally{key.fill(0);}}
 acceptKey(key){const candidate=Buffer.from(key);try{validateContents(decrypt(this.envelope,candidate));this.key?.fill(0);this.key=candidate;}catch(e){candidate.fill(0);throw e;}}
 exportKey(){if(this.locked)throw Error('Nhập mật khẩu mở app trước.');return this.key.toString('base64');}
 clientOptions(){
  if(this.locked)throw Error('Nhập mật khẩu mở app trước.');const original=validateContents(decrypt(this.envelope,this.key));
  return {config:{account:original.account,tokenFile:this.file},tokenStorage:{
   read:async()=>{try{const cached=JSON.parse(await fs.readFile(this.file,'utf8'));if(cached.salt!==this.envelope.salt)throw Error();return validateContents(decrypt(cached,this.key)).token;}catch(e){if(e.code==='ENOENT')return original.token;throw Error('Không đọc được bộ nhớ Gmail mã hóa.');}},
   write:async token=>{const temporary=this.file+'.'+randomBytes(8).toString('hex')+'.tmp';try{await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await fs.writeFile(temporary,JSON.stringify(encrypt({account:original.account,token},this.key,this.envelope.salt)),{mode:0o600,flag:'wx'});await fs.rename(temporary,this.file);}catch{await fs.unlink(temporary).catch(()=>{});throw Error('Không lưu được token Gmail mã hóa.');}}
  }};
 }
 async prepare(){await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});}
 close(){this.key?.fill(0);this.key=null;}
}
export async function loadGmailVault(file,dataDir){try{return new GmailVault(JSON.parse(await fs.readFile(file,'utf8')),dataDir);}catch(e){if(e.code==='ENOENT')return null;throw Error('Không đọc được gói Gmail mã hóa trong app.');}}

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sealGmailVault,validateVault} from '../gpm-tool/gmail-vault.mjs';
import {loadGmailOAuthConfig} from '../gpm-tool/gmail-oauth.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function bundleGmailVault(payload){
 const source=process.env.HOANXU_BUILD_VAULT_FILE||path.join(root,'packaging/gmail-vault.enc.json');
 let bytes;try{bytes=await fs.readFile(source,'utf8');}catch(e){if(e.code==='ENOENT'&&!process.env.HOANXU_BUILD_VAULT_FILE)return false;throw Error('Không đọc được gói Gmail mã hóa để build.');}
 validateVault(JSON.parse(bytes));await fs.writeFile(path.join(payload,'gmail-vault.enc.json'),bytes,{mode:0o600});return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const config=await loadGmailOAuthConfig(process.argv[2]);if(!config)throw Error('Cần file cấu hình Gmail OAuth.');
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1024)throw Error('Mật khẩu quá dài.');}const password=input.replace(/\r?\n$/,'');
  const token=JSON.parse(await fs.readFile(config.tokenFile,'utf8'));
  if(config.credentialsFile){const file=JSON.parse(await fs.readFile(config.credentialsFile,'utf8')),credentials=file.installed||file.web||file;token.client_id??=credentials.client_id;token.client_secret??=credentials.client_secret;}
  const envelope=await sealGmailVault({account:config.account,token},password),destination=process.argv[3]||path.join(root,'packaging/gmail-vault.enc.json');
  await fs.writeFile(destination,JSON.stringify(envelope)+'\n',{mode:0o600});console.log('Đã tạo gói Gmail mã hóa. Không lưu mật khẩu hoặc OAuth dạng rõ.');
 }catch{console.error('Không tạo được gói Gmail mã hóa. Kiểm tra cấu hình OAuth và mật khẩu (12–512 ký tự qua stdin).');process.exitCode=1;}
}

// Tạo gpm-tool/bundled-key.enc.json từ API key và mật khẩu mở app.
// Key đọc từ HOANXU_API_KEY (ví dụ: node --env-file=.env tools/encrypt-key.mjs).
// Mật khẩu đọc từ HOANXU_KEY_PASSWORD, hoặc hỏi ẩn trong terminal nếu không đặt biến.
// File tạo ra chỉ chứa key đã mã hoá nên được phép commit; không commit .env.
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {BUNDLED_KEY_FILE,encryptKey,decryptKey} from '../bundled-key.mjs';

async function ask(question){
 if(!process.stdin.isTTY)throw Error('Đặt biến HOANXU_KEY_PASSWORD hoặc chạy script trong terminal để nhập mật khẩu.');
 process.stdout.write(question);process.stdin.setRawMode(true);process.stdin.resume();
 let value='';
 return new Promise((resolve,reject)=>{
  const done=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
  const onData=chunk=>{
   for(const ch of chunk.toString('utf8')){
    if(ch==='\r'||ch==='\n'){done();return resolve(value);}
    if(ch==='\u0003'){done();return reject(Error('Đã huỷ.'));}
    if(ch==='\u007f'||ch==='\b'){value=value.slice(0,-1);continue;}
    value+=ch;
   }
  };
  process.stdin.on('data',onData);
 });
}

const apiKey=process.env.HOANXU_API_KEY?.trim();
if(!apiKey)throw Error('Chưa có HOANXU_API_KEY. Chạy: node --env-file=.env tools/encrypt-key.mjs');
let password=process.env.HOANXU_KEY_PASSWORD;
if(!password){
 password=await ask('Mật khẩu mở app: ');
 if(password!==await ask('Nhập lại mật khẩu: '))throw Error('Hai lần nhập mật khẩu không khớp.');
}
const bundle=await encryptKey(apiKey,password);
if(await decryptKey(bundle,password)!==apiKey)throw Error('Kiểm tra giải mã thất bại.');
await writeFile(BUNDLED_KEY_FILE,JSON.stringify(bundle,null,2)+'\n');
console.log('Đã ghi '+fileURLToPath(BUNDLED_KEY_FILE)+' · mã key '+bundle.id);
console.log('Máy nào đã mở khoá mã cũ sẽ được hỏi mật khẩu 1 lần nữa sau khi cập nhật.');

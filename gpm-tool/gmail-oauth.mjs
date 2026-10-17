import https from 'node:https';
import {readFile,writeFile,rename,unlink,open,chmod,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me',TOKEN='https://oauth2.googleapis.com/token';
const failure=(message,extra={})=>Object.assign(Error(message),{gmailCodeError:true,...extra});
const mailbox=value=>String(value||'').toLowerCase().replace(/@googlemail\.com$/,'@gmail.com');
export function validateGmailOAuthConfig(input,folder=process.cwd()){
 if(!input||input.enabled===false)return null;
 const account=mailbox(input.account);
 if(!/^[a-z0-9._-]+@gmail\.com$/.test(account))throw failure('Cấu hình Gmail OAuth cần địa chỉ Gmail gốc đã kết nối.');
 if(typeof input.tokenFile!=='string'||!input.tokenFile.trim()||input.tokenFile.length>2000)throw failure('Chưa cấu hình file token OAuth Gmail.');
 return {account,tokenFile:path.resolve(folder,input.tokenFile),...(input.credentialsFile?{credentialsFile:path.resolve(folder,input.credentialsFile)}:{})};
}
export async function loadGmailOAuthConfig(file){
 let input;try{input=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw failure('Không đọc được gmail-oauth.json. Kiểm tra cấu hình Gmail trong dữ liệu app.');}
 return validateGmailOAuthConfig(input,path.dirname(file));
}
export async function googleRequest(url,{method='GET',headers={},body,shouldContinue=()=>true,timeoutMs=10000}={}){
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!['gmail.googleapis.com','oauth2.googleapis.com'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.port)throw failure('Địa chỉ Google OAuth/Gmail không hợp lệ.');
 if(!shouldContinue())throw failure('Đã dừng lấy mã Gmail.');
 return new Promise((resolve,reject)=>{
  let done=false,timer,cancel,req;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(cancel);error?reject(error):resolve(value);};
  try{req=https.request(parsed,{method,headers:{Accept:'application/json',...headers},agent:false},res=>{
   let bytes=0;const chunks=[];
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){finish(failure('Phản hồi Gmail vượt giới hạn.'));req.destroy();}else chunks.push(chunk);});
   res.on('error',()=>finish(failure('Mất kết nối Gmail.',{transient:true})));
   res.on('end',()=>{
    if(done)return;const status=res.statusCode;let data=null;
    try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}
    // Preserve HTTP failures (including HTML/empty bodies) so OAuth and Gmail can
    // distinguish rejected credentials from a temporary outage. Malformed 2xx is retryable.
    if(status>=200&&status<300&&(!data||typeof data!=='object'||Array.isArray(data)))return finish(failure('Google/Gmail tạm trả dữ liệu không hợp lệ. Đang chờ thử lại.',{transient:true}));
    finish(null,{status,data});
   });
  });}catch{return finish(failure('Không kết nối được Google/Gmail.',{transient:true}));}
  req.on('error',()=>finish(failure(!shouldContinue()?'Đã dừng lấy mã Gmail.':'Không kết nối được Google/Gmail.',{transient:shouldContinue()})));
  timer=setTimeout(()=>{finish(failure('Google/Gmail quá thời gian phản hồi.',{transient:true}));req.destroy();},Math.max(1,timeoutMs));
  cancel=setInterval(()=>{if(!shouldContinue()){finish(failure('Đã dừng lấy mã Gmail.'));req.destroy();}},100);
  req.end(body);
 });
}
async function jsonFile(file,message){try{return JSON.parse(await readFile(file,'utf8'));}catch{throw failure(message);}}
async function saveToken(file,value){
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temporary,file);await chmod(file,0o600);}catch{await unlink(temporary).catch(()=>{});throw failure('Không lưu được token Gmail đã làm mới. Kiểm tra quyền thư mục dữ liệu app.');}
}
// Workers share a token file. A bounded file lock avoids overlapping refreshes and partial writes.
async function refreshLock(file,{check,wait,deadline,now}){
 const lock=file+'.refresh.lock';
 while(now()<deadline){
  check();try{const handle=await open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();return ()=>unlink(lock).catch(()=>{});}catch(error){if(error.code!=='EEXIST')throw failure('Không khóa được file token Gmail để làm mới.');}
  try{const owner=JSON.parse(await readFile(lock,'utf8'));if(Number.isSafeInteger(owner.pid)){try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH'){await unlink(lock).catch(()=>{});continue;}}}}catch{}
  try{if(now()-(await stat(lock)).mtimeMs>120000){await unlink(lock).catch(()=>{});continue;}}catch{}
  await wait(Math.min(100,deadline-now()));
 }
 throw failure('Hết thời gian chờ làm mới token Gmail.');
}
function addresses(value){
 return String(value||'').split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(part=>{const angle=part.match(/<([^<>]+)>/);return (angle?angle[1]:part).trim().toLowerCase();}).filter(value=>/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(value));
}
export function instagramCodeFromMessage(message,{recipient,after,now=Date.now()}){
 const headers=message?.payload?.headers;if(!Array.isArray(headers))return null;
 const values=name=>headers.filter(h=>h.name?.toLowerCase()===name).map(h=>h.value||'').join(',');
 const senders=addresses(values('from')),to=addresses(values('to')),received=Number(message.internalDate),match=values('subject').trim().match(/^(\d{6})\s+is your Instagram code$/i);
 if(senders.length!==1||senders[0]!=='no-reply@mail.instagram.com'||!to.includes(recipient.toLowerCase())||!Number.isSafeInteger(received)||received<after*1000||received>now+60000||!match)return null;
 return {code:match[1],received};
}
export class GmailOAuthClient{
 constructor(config,{request=googleRequest,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){this.config=validateGmailOAuthConfig(config);this.request=request;this.now=now;this.wait=wait;}
 async session({shouldContinue=()=>true,deadline=this.now()+60000}={}){
  if(!this.config)throw failure('Chưa kết nối Gmail trong app. Cấu hình gmail-oauth.json hoặc tự nhập mã.');
  const check=()=>{if(!shouldContinue())throw failure('Đã dừng lấy mã Gmail.');if(this.now()>=deadline)throw failure('Chưa nhận được mã Gmail sau 60 giây. Bạn nhập mã thủ công.');};
  const call=async(url,options={})=>{check();let result;try{result=await this.request(url,{...options,shouldContinue,timeoutMs:Math.min(10000,deadline-this.now())});}catch(error){if(error.gmailCodeError)throw error;throw failure('Không kết nối được Google/Gmail.',{transient:true});}check();return result;};
  let token=await jsonFile(this.config.tokenFile,'Không đọc được token OAuth Gmail. Kết nối lại Gmail hoặc nhập mã thủ công.');
  const refresh=async(force=false)=>{
   check();const previous=token.token||token.access_token,release=await refreshLock(this.config.tokenFile,{check,wait:this.wait,deadline,now:this.now});
   try{
    token=await jsonFile(this.config.tokenFile,'Không đọc được token OAuth Gmail.');
    const expiry=Date.parse(token.expiry||'')||Number(token.expiry_date)||0;
    if((token.token||token.access_token)&&expiry>this.now()+30000&&(!force||(token.token||token.access_token)!==previous))return;
    let credentials=token;if((!token.client_id||!token.client_secret)&&this.config.credentialsFile){const file=await jsonFile(this.config.credentialsFile,'Không đọc được credentials OAuth Gmail.');credentials=file.installed||file.web||file;}
    if(!token.refresh_token||!credentials.client_id||!credentials.client_secret)throw failure('Thiếu refresh token hoặc thông tin OAuth Gmail. Cần kết nối lại Gmail.');
    const body=new URLSearchParams({client_id:credentials.client_id,client_secret:credentials.client_secret,refresh_token:token.refresh_token,grant_type:'refresh_token'}).toString();
    const response=await call(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    if(response.status===429||response.status>=500)throw failure('Google OAuth tạm thời chưa phản hồi. Đang chờ thử lại.',{transient:true});
    if(response.status!==200||typeof response.data?.access_token!=='string'||!Number.isFinite(Number(response.data.expires_in))||Number(response.data.expires_in)<=0||Number(response.data.expires_in)>86400)throw failure('Không làm mới được quyền Gmail. OAuth có thể hết hạn hoặc bị thu hồi; cần kết nối lại Gmail.');
    token={...token,token:response.data.access_token,expiry:new Date(this.now()+Number(response.data.expires_in)*1000).toISOString(),...(response.data.refresh_token?{refresh_token:response.data.refresh_token}:{})};delete token.access_token;delete token.expiry_date;
    await saveToken(this.config.tokenFile,token);
   }finally{await release();}
  };
  if(!(token.token||token.access_token)||(Date.parse(token.expiry||'')||Number(token.expiry_date)||0)<=this.now()+30000)await refresh();
  const get=async url=>{
   let response=await call(url,{headers:{Authorization:'Bearer '+(token.token||token.access_token)}});
   if(response.status===401){await refresh(true);response=await call(url,{headers:{Authorization:'Bearer '+(token.token||token.access_token)}});}
   if(response.status===401||response.status===403)throw failure('Gmail từ chối quyền truy cập. Kết nối lại Gmail với quyền chỉ đọc.');
   if(response.status===429||response.status>=500)throw failure('Gmail tạm thời chưa phản hồi. Đang chờ thử lại.',{transient:true});
   if(response.status===404)return null;
   if(response.status!==200)throw failure('Gmail không chấp nhận yêu cầu. Bạn kiểm tra kết nối Gmail trong app.');
   return response.data;
  };
  const profile=await get(GMAIL+'/profile?fields=emailAddress');if(typeof profile?.emailAddress!=='string')throw failure('Gmail tạm chưa trả thông tin hộp thư. Đang chờ thử lại.',{transient:true});if(mailbox(profile.emailAddress)!==this.config.account)throw failure('Token OAuth không thuộc Gmail đã cấu hình. Kiểm tra lại kết nối Gmail.');
  return {get,check};
 }
 async checkConnection(){await this.session();return {ok:true,account:this.config.account};}
 async pollCode({recipient,after,shouldContinue=()=>true,onProgress=()=>{}}={}){
  if(!this.config)throw failure('Chưa kết nối Gmail trong app. Cấu hình gmail-oauth.json hoặc tự nhập mã.');
  if(typeof recipient!=='string'||!/^[-a-z0-9._%+]+@(?:gmail|googlemail)\.com$/i.test(recipient)||mailbox(recipient).replace(/\+[^@]*@/,'@')!==this.config.account||!Number.isSafeInteger(after)||after<0)throw failure('Gmail nhận mã phải là hộp thư OAuth đã kết nối hoặc địa chỉ cộng của hộp thư đó.');
  const deadline=this.now()+60000,guard=()=>shouldContinue()&&this.now()<deadline;let session,nextProgress=0;const cache=new Map();
  try{
   const initialWait=Math.min(10000,Math.max(0,after*1000+10000-this.now()));
   if(initialWait>0){
    await onProgress('Đang chờ email về Gmail · kiểm tra mã sau khoảng '+Math.ceil(initialWait/1000)+' giây.');
    for(let left=initialWait;left>0;){if(!shouldContinue())throw failure('Đã dừng lấy mã Gmail.');const part=Math.min(100,left);await this.wait(part);left-=part;}
   }
   while(this.now()<deadline){
    if(!shouldContinue())throw failure('Đã dừng lấy mã Gmail.');const started=this.now();
    try{
     session??=await this.session({shouldContinue:guard,deadline});session.check();
     const url=new URL(GMAIL+'/messages');url.searchParams.set('q',`from:no-reply@mail.instagram.com to:${recipient} after:${after}`);url.searchParams.set('maxResults','50');url.searchParams.set('fields','messages/id');
     const list=await session.get(url.href),messages=Array.isArray(list?.messages)?list.messages.slice(0,50):[],found=[];
     for(let i=0;i<messages.length;i+=5){
      await Promise.all(messages.slice(i,i+5).map(async item=>{
       if(typeof item.id!=='string'||!/^[-a-z0-9_]{1,200}$/i.test(item.id))return;
       if(!cache.has(item.id)){const detail=new URL(GMAIL+'/messages/'+encodeURIComponent(item.id));detail.searchParams.set('format','metadata');detail.searchParams.set('fields','id,internalDate,payload/headers');for(const name of ['Subject','To','From'])detail.searchParams.append('metadataHeaders',name);cache.set(item.id,await session.get(detail.href));}
       const code=instagramCodeFromMessage(cache.get(item.id),{recipient,after,now:this.now()});if(code)found.push(code);
      }));
     }
     if(found.length){found.sort((a,b)=>b.received-a.received);return {code:found[0].code};}
    }catch(error){if(!shouldContinue())throw failure('Đã dừng lấy mã Gmail.');if(this.now()>=deadline)break;if(!error.transient)throw error;}
    if(this.now()>=nextProgress){await onProgress('Đang chờ email Instagram trong Gmail · tối đa 60 giây.');nextProgress=this.now()+15000;}
    for(let left=Math.min(Math.max(0,3000-(this.now()-started)),deadline-this.now());left>0;){if(!shouldContinue())throw failure('Đã dừng lấy mã Gmail.');const part=Math.min(100,left);await this.wait(part);left-=part;}
   }
  }finally{cache.clear();}
  throw failure('Chưa nhận được mã Gmail sau 60 giây. Bạn kiểm tra Gmail và nhập mã thủ công.');
 }
}

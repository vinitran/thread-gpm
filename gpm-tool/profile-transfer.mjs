import {GpmApi,proxy} from './gpm-api.mjs';
export const TRANSFER_FORMAT='hoanxu-profile-transfer';
const validId=id=>typeof id==='string'&&/^[-\w]{1,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const metaHost=host=>['threads.com','threads.net','instagram.com','facebook.com'].some(root=>host===root||host.endsWith('.'+root));
export function sessionForTransfer(state){return validateSession({cookies:(state.cookies||[]).filter(c=>metaHost(c.domain.replace(/^\./,''))),origins:(state.origins||[]).filter(o=>{try{return metaHost(new URL(o.origin).hostname);}catch{return false;}}).map(o=>({origin:o.origin,localStorage:o.localStorage||[]}))});}
export async function captureSession(context){
 const state=await context.storageState(),origins=new Map((state.origins||[]).map(o=>[o.origin,o]));
 // CDP may attach after navigation; include storage from pages already open when the tool connected.
 for(const page of context.pages()){let url;try{url=new URL(page.url());}catch{continue;}if(url.protocol!=='https:'||!metaHost(url.hostname))continue;
  try{const storage=await page.evaluate(()=>({origin:location.origin,localStorage:Object.keys(localStorage).map(name=>({name,value:localStorage.getItem(name)}))}));if(storage.origin===url.origin)origins.set(storage.origin,storage);}catch{if(!page.isClosed())throw Error('Không đọc được local storage. Đợi trang tải xong rồi xuất lại.');}
 }
 return sessionForTransfer({...state,origins:[...origins.values()]});
}
export function validateSession(session){
 if(!session||!Array.isArray(session.cookies)||!Array.isArray(session.origins)||session.cookies.length>5000||session.origins.length>100)throw Error('Dữ liệu phiên không hợp lệ.');
 const cookies=session.cookies.map(c=>{if(!c||typeof c.name!=='string'||typeof c.value!=='string'||typeof c.domain!=='string'||!metaHost(c.domain.replace(/^\./,''))||typeof c.path!=='string'||!c.path.startsWith('/')||typeof c.expires!=='number'||!Number.isFinite(c.expires)||typeof c.httpOnly!=='boolean'||typeof c.secure!=='boolean'||!['Strict','Lax','None'].includes(c.sameSite))throw Error('Cookie trong file không hợp lệ.');return {name:c.name,value:c.value,domain:c.domain,path:c.path,expires:c.expires,httpOnly:c.httpOnly,secure:c.secure,sameSite:c.sameSite,...(typeof c.partitionKey==='string'?{partitionKey:c.partitionKey}:{})};});
 const origins=session.origins.map(o=>{let u;try{u=new URL(o.origin);}catch{throw Error('Origin phiên không hợp lệ.');}if(u.protocol!=='https:'||u.origin!==o.origin||!metaHost(u.hostname)||!Array.isArray(o.localStorage)||o.localStorage.length>5000)throw Error('Origin phiên không hợp lệ.');return {origin:u.origin,localStorage:o.localStorage.map(item=>{if(typeof item.name!=='string'||typeof item.value!=='string')throw Error('Local storage không hợp lệ.');return {name:item.name,value:item.value};})};});
 return {cookies,origins};
}
export function parseTransfer(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>5*1024*1024)throw Error('File chuyển máy tối đa 5 MB.');let data;try{data=JSON.parse(text);}catch{throw Error('File chuyển máy không hợp lệ.');}
 if(data.format!==TRANSFER_FORMAT||data.version!==1||!Array.isArray(data.profiles)||!data.profiles.length||data.profiles.length>50)throw Error('File chuyển máy cần 1–50 profile, phiên bản 1.');
 const seen=new Set();return data.profiles.map(p=>{if(!validId(p.id)||seen.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||/[\x00-\x1f]/.test(p.name)||typeof p.proxy!=='string'||typeof p.browserVersion!=='string'||p.browserVersion&&!/^\d+\.\d+\.\d+\.\d+$/.test(p.browserVersion))throw Error('Profile trong file chuyển máy không hợp lệ.');seen.add(p.id);if(p.proxy)proxy(p.proxy);return {id:p.id,name:p.name,proxy:p.proxy,browserVersion:p.browserVersion,session:validateSession(p.session)};});
}
export async function restoreSession(context,session){
 const safe=validateSession(session);await context.addCookies(safe.cookies);
 for(const origin of safe.origins){if(!origin.localStorage.length)continue;const page=await context.newPage();
  try{await page.goto(origin.origin+'/',{waitUntil:'domcontentloaded',timeout:30000});if(new URL(page.url()).origin!==origin.origin)throw Error('Không khôi phục được local storage của '+origin.origin);await page.evaluate(data=>{for(const item of data.localStorage)localStorage.setItem(item.name,item.value);},origin);}
  finally{await page.close().catch(()=>{});}
 }
 for(const page of context.pages())if(/^https:\/\/(www\.)?threads\.(com|net)\//.test(page.url()))await page.reload({waitUntil:'domcontentloaded',timeout:30000});
}
export class ProfileTransfer{
 constructor(manager,{apiFactory=base=>new GpmApi(base)}={}){this.manager=manager;this.apiFactory=apiFactory;}
 async export(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw Error('Chọn 1–50 profile để chuyển máy.');
  const profiles=[];
  for(const id of ids){const row=this.manager.rows().find(p=>p.id===id);if(!row)throw Error('Profile không có trong tool.');const data=await this.manager.profileStore(id);const metadata=await this.apiFactory(data.value.settings.gpmApi).call('/profiles/'+encodeURIComponent(id));let session;try{session=await this.manager.worker(id).call('profile-session-export',{});}catch{throw Error('Không đọc được phiên của '+row.name+'. Bấm Mở và kiểm tra đăng nhập Threads trước khi xuất.');}if(!session.cookies.length)throw Error(row.name+' chưa có cookie Threads/Meta. Đăng nhập trước khi xuất.');profiles.push({id,name:metadata.name||row.name,proxy:metadata.raw_proxy||'',browserVersion:metadata.browser?.version||metadata.browser_version||'',session});}
  const file={format:TRANSFER_FORMAT,version:1,exportedAt:new Date().toISOString(),profiles};if(Buffer.byteLength(JSON.stringify(file))>5*1024*1024)throw Error('File vượt 5 MB. Chọn ít profile hơn để xuất.');parseTransfer(JSON.stringify(file));return file;
 }
 async preview(text,base,browserVersion=''){
  if(typeof browserVersion!=='string'||browserVersion&&!/^\d+\.\d+\.\d+\.\d+$/.test(browserVersion))throw Error('Phiên bản Chrome không hợp lệ.');const profiles=parseTransfer(text),remote=await this.apiFactory(base).list({metadata:true});const registry=this.manager.store.value.profileRegistry||{};
  const rows=profiles.map(p=>{const existing=Object.values(registry).find(r=>r.id===p.id||r.transferSourceId===p.id);return {id:p.id,name:p.name,proxy:p.proxy,status:existing&&!existing.transferPending?'existing':'ready',targetId:existing?.id||remote.find(r=>r.id===p.id)?.id||null,message:existing&&!existing.transferPending?'Đã có trong tool · giữ phiên hiện tại':existing?.transferPending?'Thử lại khôi phục phiên':remote.some(r=>r.id===p.id)?'Khôi phục phiên vào profile GPM cùng ID':'Tạo profile GPM mới và khôi phục phiên'};});return {rows,transfer:true,transferData:{profiles,browserVersion},groups:[],limited:false};
 }
 async commit(preview,ids){
  const results=[],api=this.apiFactory(preview.base);
  for(const sourceId of ids){const item=preview.transferData.profiles.find(p=>p.id===sourceId),row=preview.rows.find(r=>r.id===sourceId);let targetId;
   try{const previous=this.manager.rows().find(r=>r.id===sourceId||r.transferSourceId===sourceId);if(previous&&!previous.transferPending){results.push({id:previous.id,status:'existing',message:'Đã có trong tool · giữ phiên hiện tại'});continue;}
    const target=previous|| (row.targetId?await api.call('/profiles/'+encodeURIComponent(row.targetId)):await api.create({name:item.name,rawProxy:item.proxy,browserVersion:preview.transferData.browserVersion||item.browserVersion}));targetId=target.id;
    const shared=this.manager.store.value.sharedSettings||this.manager.store.value.settings,settings={...structuredClone(shared),profileId:targetId,profileName:target.name||item.name,proxy:target.raw_proxy??target.proxy??item.proxy,gpmApi:preview.base,cdp:'http://127.0.0.1:9222/'};
    await this.manager.register(settings,'nhập phiên từ máy khác');const registry=this.manager.store.value.profileRegistry;registry[targetId]={...registry[targetId],transferSourceId:sourceId,transferPending:true};await this.manager.store.set({profileRegistry:registry});
    const opened=await this.manager.open(settings);if(opened.cancelled)throw Error('transfer-cancelled');await this.manager.worker(targetId).call('profile-session-import',{session:item.session},300000);const current=this.manager.store.value.profileRegistry;current[targetId]={...current[targetId],transferPending:false};await this.manager.store.set({profileRegistry:current});results.push({id:targetId,name:item.name,status:'imported',message:'Đã khôi phục cookie/phiên · kiểm tra đăng nhập trước khi chạy'});
   }catch(e){results.push({id:targetId||sourceId,status:'error',message:e.message==='transfer-cancelled'?'Đã hủy khôi phục do Dừng.':'Không khôi phục được phiên. '+(targetId?'Profile đã tạo được giữ lại để thử nhập lại. ':'')+(String(e.message).includes('Phiên bản')||String(e.message).includes('Chrome')?'Kiểm tra phiên bản Chrome đã cài trong GPM.':'Kiểm tra GPM và kết nối profile.')});}
  }this.manager.onChange();return {results,transfer:true};
 }
}

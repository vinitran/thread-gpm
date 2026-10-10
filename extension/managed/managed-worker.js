import {autoPage} from './auto-dom.js';
import {extractPosts} from './extract.js';
import {replyAction} from './reply-dom.js';
import {engagementPage} from './idle-engagement.js';
import {pointerTarget} from './pointer-input.js';
const functions={autoPage,extractPosts,replyAction,engagementPage,pointerTarget};
const attached=new Set();chrome.debugger.onDetach.addListener(target=>attached.delete(target.tabId));
let configured,loopRunning=false,configurationEpoch=0;
const sameConnection=(a,b)=>!!a&&!!b&&a.base===b.base&&a.token===b.token;
async function request(path,body,connection){
 if(!connection){if(!configured)await initialization;connection=configured;}
 if(!connection)throw Error('Chưa nhận cấu hình từ app · chọn profile và bấm Chạy bằng extension trong app HoanXu GPM. Nút Mở chỉ mở trình duyệt.');
 let response;
 try{response=await fetch(connection.base+'/api/extension/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Extension-Token':connection.token},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(25000)});}
 catch{throw Error('Không kết nối được app tại '+connection.base+' · kiểm tra app đang mở, proxy cho phép truy cập localhost và bấm Chạy bằng extension lại trong app.');}
 const value=await response.json();if(response.status===403)throw Error('Kết nối extension đã hết hiệu lực · bấm Chạy bằng extension lại trong app để kết nối phiên mới.');if(!response.ok)throw Error(value.error||'App không phản hồi.');return value;
}
async function execute(job){
 const a=job.args;
 switch(job.method){
 case 'tabs.query':return chrome.tabs.query({});
 case 'tabs.get':return chrome.tabs.get(a.id);
 case 'tabs.create':return loaded(await chrome.tabs.create(a.options));
 case 'tabs.update':{const tab=await chrome.tabs.update(a.id,a.options);return a.options.url?loaded(tab):tab;}
 case 'tabs.reload':await chrome.tabs.reload(a.id);await loaded({id:a.id});return true;
 case 'tabs.remove':await chrome.tabs.remove(a.id);return true;
 case 'script':{
  const func=functions[a.name];if(!func)throw Error('Hàm DOM không được hỗ trợ: '+a.name);
  const results=await chrome.scripting.executeScript({target:{tabId:a.id},func,args:a.args,...(a.name==='replyAction'&&a.args[0]==='upload'?{world:'MAIN'}:{})});
  const frame=results.find(r=>r.frameId===0)||results[0];if(frame?.error)throw Error(frame.error.message);return frame?.result;
 }
 case 'debugger.attach':if(!attached.has(a.id)){await chrome.debugger.attach({tabId:a.id},'1.3');attached.add(a.id);}return true;
 case 'debugger.detach':try{await chrome.debugger.detach({tabId:a.id});}finally{attached.delete(a.id);}return true;
 case 'debugger.send':return chrome.debugger.sendCommand({tabId:a.id},a.method,a.params);
 default:throw Error('Lệnh extension không được hỗ trợ.');
 }
}
async function loaded(tab){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){const current=await chrome.tabs.get(tab.id);if(current.status==='complete')return current;await new Promise(r=>setTimeout(r,100));}
 throw Error('Trang chưa tải xong sau 30 giây.');
}
async function synchronize(){
 const connection=configured;if(!connection)return;
 try{const state=await request('status',undefined,connection);if(sameConnection(configured,connection))await chrome.storage.local.set({autoRun:{status:state.status},managedStatus:state});}catch(e){if(sameConnection(configured,connection))await disconnected(e);}
}
async function disconnected(error){await chrome.storage.local.set({autoRun:{status:'disconnected'},managedStatus:{status:'disconnected',message:error?.message||'Mất kết nối app · đã ngừng thao tác.'}}).catch(()=>{});}
async function runLoop(){
 if(loopRunning||!configured)return;loopRunning=true;
 try{while(configured){
  const connection=configured;
  try{const {job,status}=await request('poll',undefined,connection);if(!sameConnection(configured,connection))continue;await chrome.storage.local.set({autoRun:{status}});if(!job||!sameConnection(configured,connection))continue;
   let result,error;try{result=await execute(job);}catch(e){error=e.message;}
   // Never replay a browser action if its acknowledgement is lost.
   await request('result',{id:job.id,result:result??null,error},connection);
  }catch(e){if(sameConnection(configured,connection)){await disconnected(e);await new Promise(r=>setTimeout(r,1000));}}
 }}finally{loopRunning=false;}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message.type==='configure-managed'){
  const config=message.config;
  if(typeof config?.base!=='string'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.base)||typeof config.token!=='string'||!/^[a-f0-9]{64}$/.test(config.token)){reply({ok:false,error:'Cấu hình kết nối không hợp lệ.'});return;}
  const epoch=++configurationEpoch;
  // Reconnecting to the same bridge must keep its outstanding poll valid.
  if(configured?.base!==config.base||configured?.token!==config.token)configured=config;
  chrome.storage.local.set({managedConfig:config}).then(async()=>{
   await request('status',undefined,config);
   if(epoch!==configurationEpoch)throw Error('Đã nhận cấu hình kết nối mới hơn.');
   runLoop();await synchronize();
   if(epoch!==configurationEpoch)throw Error('Đã nhận cấu hình kết nối mới hơn.');
   reply({ok:true});
  }).catch(async e=>{if(epoch===configurationEpoch)await disconnected(e);reply({ok:false,error:e.message});});return true;
 }
 if(message.type==='managed-state'){request('status').then(value=>reply({ok:true,value})).catch(e=>reply({ok:false,error:e.message}));return true;}
 if(message.type==='managed-stop'){request('stop').then(value=>reply({ok:true,value})).catch(e=>reply({ok:false,error:e.message}));return true;}
});
chrome.alarms.create('managed-keepalive',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(()=>{runLoop();synchronize();});
setInterval(()=>{chrome.runtime.getPlatformInfo().catch(()=>{});synchronize();},1000);
// A delayed startup read must not replace a newer bootstrap configuration.
const initialization=chrome.storage.local.get('managedConfig').then(({managedConfig})=>{if(configurationEpoch!==0)return;configured=managedConfig;runLoop();synchronize();}).catch(e=>disconnected(Error('Không đọc được cấu hình extension: '+e.message)));

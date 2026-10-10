import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MANAGED_EXTENSION_ID} from './managed-extension-id.mjs';
export {MANAGED_EXTENSION_ID};
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../extension');
export async function stageManagedExtension(dir){
 const destination=path.join(dir,'managed-extension');await fs.rm(destination,{recursive:true,force:true});await fs.mkdir(destination,{recursive:true});
 const files=['auto-dom.js','extract.js','reply-dom.js','pointer-input.js'];let fingerprint='';
 for(const name of files){const data=await fs.readFile(path.join(source,name));fingerprint+=data.toString();await fs.writeFile(path.join(destination,name),data);}
 for(const name of (await fs.readdir(path.join(source,'managed'))).sort()){const data=await fs.readFile(path.join(source,'managed',name));fingerprint+=data.toString();await fs.writeFile(path.join(destination,name),data);}
 const idle=await fs.readFile(new URL('./idle-engagement.mjs',import.meta.url));fingerprint+=idle.toString();await fs.writeFile(path.join(destination,'idle-engagement.js'),idle);
 return {directory:destination,revision:createHash('sha256').update(fingerprint).digest('hex')};
}
export function extensionArguments(directory){if(/["\r\n]/.test(directory))throw Error('Đường dẫn extension không hợp lệ.');return '--enable-unsafe-extension-debugging --proxy-bypass-list="localhost;127.0.0.1;[::1]" --load-extension="'+directory+'"';}
async function openBootstrap(tab){
 const url='chrome-extension://'+MANAGED_EXTENSION_ID+'/bootstrap.html',deadline=Date.now()+15000;
 while(true){
  try{await tab.goto(url,{waitUntil:'domcontentloaded',timeout:Math.max(1,Math.min(3000,deadline-Date.now()))});return;}
  catch(e){
   // runtime.reload closes the old page before Chrome has registered the new extension.
   if(tab.isClosed()||Date.now()>=deadline||!/ERR_BLOCKED_BY_CLIENT|ERR_FILE_NOT_FOUND|ERR_FAILED|ERR_ABORTED|Timeout/.test(e.message))throw e;
   await new Promise(r=>setTimeout(r,200));
  }
 }
}
export async function connectManagedExtension(browser,bridge,{directory,base,loadExtension=true}){
 if(loadExtension){
  const session=await browser.browser.newBrowserCDPSession();
  let loaded=false;
  try{
   // The fixed ID belongs only to this app; never remove the user's other extensions.
   try{await session.send('Extensions.uninstall',{id:MANAGED_EXTENSION_ID});}catch{}
   try{await session.send('Extensions.loadUnpacked',{path:directory});loaded=true;}catch{}
  }finally{await session.detach();}
  if(!loaded){
   // Older GPM cores use --load-extension. Reload the same ID to discard the old worker.
   const previous=await browser.context.newPage();
   try{
    await openBootstrap(previous);
    await Promise.all([previous.waitForEvent('close',{timeout:10000}),previous.evaluate(()=>{setTimeout(()=>chrome.runtime.reload(),0);})]);
   }finally{await previous.close().catch(()=>{});}
  }
 }
 const tab=await browser.context.newPage();
 try{
  await openBootstrap(tab);
  // Send through the extension page's runtime directly, rather than a URL fragment.
  const handshake=await tab.evaluate(async config=>{
   const result=await chrome.runtime.sendMessage({type:'configure-managed',config});
   if(!result?.ok)return {ok:false,error:result?.error||'Extension không xác nhận cấu hình.'};
   const saved=(await chrome.storage.local.get('managedConfig')).managedConfig;
   if(saved?.base!==config.base||saved?.token!==config.token)return {ok:false,error:'Extension chưa lưu đúng cấu hình kết nối.'};
   const status=await chrome.runtime.sendMessage({type:'managed-state'});
   return status?.ok?{ok:true}:{ok:false,error:status?.error||'Extension chưa đọc được trạng thái app.'};
  },{base,token:bridge.token});
  if(!handshake?.ok)throw Error(handshake?.error||'Extension chưa nhận cấu hình từ app.');
  // Status alone is insufficient: verify the command polling loop also responds.
  await bridge.call('tabs.query',{},20000);
  await bridge.ready();browser.extensionBridge=bridge;
 }catch(e){throw Error('Không kết nối được bộ chạy extension: '+e.message+' · Kiểm tra app đang mở và Chrome/GPM hỗ trợ extension.');}
 finally{await tab.close().catch(()=>{});}
}

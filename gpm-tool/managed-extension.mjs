import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MANAGED_EXTENSION_ID} from './managed-extension-id.mjs';
export {MANAGED_EXTENSION_ID};
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../extension');
export async function stageManagedExtension(dir){
 const destination=path.join(dir,'managed-extension');await fs.mkdir(destination,{recursive:true});
 const files=['auto-dom.js','extract.js','reply-dom.js','pointer-input.js'];let fingerprint='';
 for(const name of files){const data=await fs.readFile(path.join(source,name));fingerprint+=data.toString();await fs.writeFile(path.join(destination,name),data);}
 for(const name of (await fs.readdir(path.join(source,'managed'))).sort()){const data=await fs.readFile(path.join(source,'managed',name));fingerprint+=data.toString();await fs.writeFile(path.join(destination,name),data);}
 const idle=await fs.readFile(new URL('./idle-engagement.mjs',import.meta.url));fingerprint+=idle.toString();await fs.writeFile(path.join(destination,'idle-engagement.js'),idle);
 return {directory:destination,revision:createHash('sha256').update(fingerprint).digest('hex')};
}
export function extensionArguments(directory){if(/["\r\n]/.test(directory))throw Error('Đường dẫn extension không hợp lệ.');return '--enable-unsafe-extension-debugging --proxy-bypass-list="localhost;127.0.0.1;[::1]" --load-extension="'+directory+'"';}
export async function connectManagedExtension(browser,bridge,{directory,base}){
 const session=await browser.browser.newBrowserCDPSession();
 try{try{await session.send('Extensions.loadUnpacked',{path:directory});}catch{/* Older GPM cores load it through addition_args instead. */}}finally{await session.detach();}
 const tab=await browser.context.newPage();
 try{
  await tab.goto('chrome-extension://'+MANAGED_EXTENSION_ID+'/bootstrap.html#'+encodeURIComponent(JSON.stringify({base,token:bridge.token})),{waitUntil:'domcontentloaded',timeout:15000});
  await tab.waitForFunction(()=>document.body.dataset.ready==='true'||document.body.dataset.error==='true',{},{timeout:15000});
  if(await tab.evaluate(()=>document.body.dataset.error==='true'))throw Error(await tab.locator('#status').innerText());
  await bridge.ready();browser.extensionBridge=bridge;
 }catch(e){throw Error('Không kết nối được bộ chạy extension: '+e.message+' · Kiểm tra app đang mở và Chrome/GPM hỗ trợ extension.');}
 finally{await tab.close().catch(()=>{});}
}

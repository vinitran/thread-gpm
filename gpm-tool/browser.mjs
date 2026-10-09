import {chromium} from 'playwright';
import {randomBytes} from 'node:crypto';
export function endpoint(value){const url=new URL(value);if(!['http:','https:','ws:','wss:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('CDP phải là địa chỉ localhost của profile GPM trên máy này.');return url.href;}
export class GpmBrowser{
 constructor(store){this.store=store;this.pages=new Map();this.sessions=new Map();this.serial=0;this.tracking=new WeakMap();this.targets={};this.windows=new Map();}
 async connect(address){
  const resolved=endpoint(address);
  if(this.browser?.isConnected()&&this.context){if(this.address!==resolved)throw Error('Đang kết nối CDP khác. Khởi động lại tool trước khi đổi profile.');return;}
  this.address=resolved;
  this.pages.clear();this.sessions.clear();this.tracking=new WeakMap();this.windows.clear();
  // GPM can return the CDP port before Chromium starts listening.
  const deadline=Date.now()+20000;
  while(true){
   try{this.browser=await chromium.connectOverCDP(resolved,{timeout:Math.max(1000,deadline-Date.now())});break;}
   catch(e){if(!/ECONNREFUSED/.test(e.message))throw e;if(Date.now()>=deadline)throw Error('Cổng CDP chưa sẵn sàng sau 20 giây. Đóng profile đang mở thủ công rồi bấm Mở / kết nối profile; tool giữ nguyên proxy.');await new Promise(r=>setTimeout(r,500));}
  }
  const connectedBrowser=this.browser;
  this.browser.once('disconnected',()=>{if(this.browser!==connectedBrowser)return;this.context=null;this.pages.clear();this.sessions.clear();this.windows.clear();this.onDisconnected?.();});
  this.context=this.browser.contexts()[0];if(!this.context)throw Error('Không tìm thấy context GPM.');
  const connectedContext=this.context;
  this.context.once('close',()=>{if(this.context!==connectedContext)return;this.context=null;this.pages.clear();this.sessions.clear();this.windows.clear();this.onDisconnected?.();});
  this.statusBinding='__threadtool_'+randomBytes(12).toString('hex');
  await this.context.exposeBinding(this.statusBinding,()=>({autoRun:this.store.value.autoRun?{status:this.store.value.autoRun.status}:null}));
  const {browserTargets={}}=await this.store.get('browserTargets');this.targets=browserTargets;this.serial=Math.max(0,...Object.values(browserTargets));
  await Promise.all(this.context.pages().map(p=>this.track(p)));
  this.context.on('page',p=>{if(this.context===connectedContext)this.track(p).catch(()=>{});});
 }
 async ensureConnected(shouldContinue=()=>true){
  if(!shouldContinue())throw Error('Đã dừng · không kết nối lại trình duyệt.');
  if(this.browser?.isConnected()&&this.context)return;
  if(!this.address)throw Error('Chưa có địa chỉ CDP của profile GPM.');
  try{await this.connect(this.address);}catch{throw Error('Mất kết nối trình duyệt GPM. Profile có thể đã đóng hoặc cổng CDP đã đổi; bấm Áp dụng & mở rồi chạy lại.');}
  if(!shouldContinue())throw Error('Đã dừng trong lúc kết nối lại · không mở tab mới.');
 }
 async track(page){
  if(this.tracking.has(page))return this.tracking.get(page);
  const context=this.context;
  const pending=(async()=>{const cdp=await context.newCDPSession(page);let targetId;
   try{targetId=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;try{this.windows.set(page,(await cdp.send('Browser.getWindowForTarget',{targetId})).windowId);}catch{this.windows.set(page,1);}}finally{await cdp.detach();}
   if(this.context!==context||page.isClosed())throw Error('Tab đã đóng trong lúc kết nối.');
   const id=this.targets[targetId]||++this.serial;this.targets[targetId]=id;await this.store.set({browserTargets:this.targets});if(this.context!==context||page.isClosed())throw Error('Tab đã đóng trong lúc kết nối.');this.pages.set(id,page);
   page.once('close',()=>{if(this.pages.get(id)===page){this.pages.delete(id);this.sessions.delete(id);}});return id;})();this.tracking.set(page,pending);return pending;
 }
 page(id){const p=this.pages.get(id);if(!p||p.isClosed())throw Error('No tab '+id);return p;}
 nativeId(id){if(!Number.isInteger(id)||id>=0)throw Error('Tab không thuộc bộ chạy extension.');return -id;}
 extensionTab(tab){return {...tab,id:-tab.id,url:tab.url||tab.pendingUrl||''};}
 async describe(id){if(this.extensionBridge)return this.extensionTab(await this.extensionBridge.call('tabs.get',{id:this.nativeId(id)}));const p=this.page(id);return {id,url:p.url(),windowId:this.windows.get(p),status:'complete',active:await p.evaluate(()=>document.hasFocus()).catch(()=>false),title:await p.title().catch(()=>p.url())};}
 async query(){if(this.extensionBridge)return (await this.extensionBridge.call('tabs.query')).map(t=>this.extensionTab(t));const rows=await Promise.all([...this.pages.keys()].map(async id=>{try{return await this.describe(id);}catch(e){if(!this.pages.has(id)||this.pages.get(id).isClosed())return null;throw e;}}));return rows.filter(Boolean);}
 async create(options,{shouldContinue=()=>true}={}){
  if(this.extensionBridge){if(!shouldContinue())throw Error('Đã dừng · không mở tab mới.');return this.extensionTab(await this.extensionBridge.call('tabs.create',{options}));}
  await this.ensureConnected(shouldContinue);
  if(!shouldContinue())throw Error('Đã dừng · không mở tab mới.');
  let p;
  const owner=[...this.pages.values()].find(page=>this.windows.get(page)===options.windowId);
  if(owner&&options.url==='about:blank'){
   const waiting=this.context.waitForEvent('page',{timeout:10000});
   await owner.evaluate(()=>{window.open('about:blank','_blank');});p=await waiting;
  }else p=await this.context.newPage();
  await this.track(p);await p.goto(options.url,{waitUntil:'domcontentloaded'});return this.describe([...this.pages.entries()].find(([,page])=>page===p)[0]);
 }
 async update(id,options){if(this.extensionBridge)return this.extensionTab(await this.extensionBridge.call('tabs.update',{id:this.nativeId(id),options}));const p=this.page(id);if(options.url)await p.goto(options.url,{waitUntil:'domcontentloaded',timeout:30000});if(options.active)await p.bringToFront();return this.describe(id);}
 async reload(id){if(this.extensionBridge)return this.extensionBridge.call('tabs.reload',{id:this.nativeId(id)});return this.page(id).reload({waitUntil:'domcontentloaded'});}
 async remove(id){if(this.extensionBridge)return this.extensionBridge.call('tabs.remove',{id:this.nativeId(id)});return this.page(id).close();}
 async evaluate(id,func,args=[]){
  if(this.extensionBridge)return this.extensionBridge.call('script',{id:this.nativeId(id),name:func.name,args});
  // Only live run status is exposed, so Stop takes effect between scroll steps.
  const source=`((chrome)=>(${func.toString()})(...${JSON.stringify(args)}))({storage:{local:{get:()=>window[${JSON.stringify(this.statusBinding)}]()}}})`;
  return this.page(id).evaluate(source);
 }
 installChrome(){globalThis.chrome={storage:{local:this.store},tabs:{query:()=>this.query(),get:id=>this.describe(id),create:o=>this.create(o),update:(id,o)=>this.update(id,o),reload:id=>this.reload(id),remove:id=>this.remove(id)},scripting:{executeScript:async({target,func,args})=>[{frameId:0,result:await this.evaluate(target.tabId,func,args)}]},debugger:{attach:async({tabId})=>{if(this.extensionBridge)return this.extensionBridge.call('debugger.attach',{id:this.nativeId(tabId)});if(!this.sessions.has(tabId))this.sessions.set(tabId,await this.context.newCDPSession(this.page(tabId)));},sendCommand:async({tabId},method,params)=>{if(this.extensionBridge)return this.extensionBridge.call('debugger.send',{id:this.nativeId(tabId),method,params});const session=this.sessions.get(tabId);if(!session)throw Error('Debugger chưa kết nối');return session.send(method,params);},detach:async({tabId})=>{if(this.extensionBridge)return this.extensionBridge.call('debugger.detach',{id:this.nativeId(tabId)});const session=this.sessions.get(tabId);if(session){this.sessions.delete(tabId);await session.detach();}}}};}
}

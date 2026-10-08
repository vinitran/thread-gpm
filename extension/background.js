import {collectFreshPosts} from './feed-collector.js';
import {retryTabEdit,activateTab,replaceSourceTab,closeTabPreservingWindow} from './tab-actions.js';
import {AutoRunner} from './auto-runner.js';
import {autoPage} from './auto-dom.js';
import {DEFAULT_API_KEY} from './ai-defaults.js';
import {extractPosts} from './extract.js';
import {DEFAULT_MODEL,models,generate,signature,selectPosts} from './ai.js';
import {readFolder,selectReplyAssets,makeReplyAttachments} from './reply-assets.js';
import {postReply,checkReply,returnToFeed} from './post-reply.js';
let busy=false;
let aiBusy=false;
let posting=false;
const isThreads=url=>{try{return new URL(url).origin==='https://www.threads.com';}catch{return false;}};
async function listTabs(){return (await chrome.tabs.query({url:'https://www.threads.com/*'})).map(t=>({id:t.id,title:t.title||'Threads',url:t.url,active:t.active}));}
const PROMPT_REVISION='2026-10-06-user-rewrite-v3-voucher';
async function resolveAISettings(saved={},withPrompt=false){
  const settings={...saved,apiKey:saved.apiKey||DEFAULT_API_KEY,model:saved.model||DEFAULT_MODEL};
  if(withPrompt&&(!settings.prompt?.trim()||saved.promptRevision!==PROMPT_REVISION)){
    const response=await fetch(chrome.runtime.getURL('default-prompt.txt'));
    if(!response.ok)throw Error('Không đọc được prompt mặc định.');
    settings.prompt=await response.text();settings.promptRevision=PROMPT_REVISION;
    await chrome.storage.local.set({aiSettings:{...saved,prompt:settings.prompt,promptRevision:PROMPT_REVISION}});
  }
  return settings;
}
async function handle(m,internal=false){
  if(m.type==='auto-state'){const state=await runner.load();const {replyReceipts={},tabLifecycle=[]}=await chrome.storage.local.get(['replyReceipts','tabLifecycle']);return {state,receipts:replyReceipts,tabLifecycle};}
  if(m.type==='auto-start'){if(busy||aiBusy||posting)throw Error('Chờ thao tác thủ công hiện tại hoàn tất.');return {state:await runner.start(m.config)};}
  if(m.type==='auto-stop')return {state:await runner.stop()};
  if(!internal&&['capture','reload-capture','generate-response','post-response','check-response','save-ai-settings'].includes(m.type)){
    const state=await runner.load();if(['running','stopping'].includes(state.status))throw Error('Dừng phiên tự động trước khi thao tác thủ công.');
  }
  if(m.type==='get-reply-state'){const {replyReceipts={}}=await chrome.storage.local.get('replyReceipts');return {receipts:replyReceipts};}
  if(m.type==='post-response'||m.type==='check-response'){
    if(posting)throw Error('Một comment đang được xử lý.');
    if(!/^https:\/\/www\.threads\.com\/@[\w.]+\/post\/[-\w]+$/.test(m.url))throw Error('Link bài không hợp lệ.');
    posting=true;const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
    try{
      const {aiResults={},replyReceipts={}}=await chrome.storage.local.get(['aiResults','replyReceipts']);
      const progress=stage=>{if(internal)runner.progress(stage).catch(console.error);chrome.runtime.sendMessage({type:'reply-progress',url:m.url,stage}).catch(()=>{});};
      if(internal&&replyReceipts[m.url]?.state==='sent_unverified')return {receipt:await returnToFeed(replyReceipts[m.url],progress,{waitBeforeHome:true,shouldContinue:()=>runner.active()})};
      if(m.type==='check-response'||replyReceipts[m.url])return {receipt:await checkReply(m.url,progress)};
      const response=aiResults[m.url];if(!response?.text)throw Error('Chưa có response AI cho bài này.');
      const image=m.withImages===false?{files:[],names:[]}:await makeReplyAttachments(selectReplyAssets(await readFolder()),{optimizeUpload:true});
      const stepDelayMs=Number(m.stepDelayMs??2000);if(!Number.isFinite(stepDelayMs)||stepDelayMs<500||stepDelayMs>10000)throw Error('Thời gian chờ phải từ 0.5 đến 10 giây.');
      const typingDelayMs=Number(m.typingDelayMs??60);if(!Number.isFinite(typingDelayMs)||typingDelayMs<0||typingDelayMs>500)throw Error('Tốc độ nhập phải từ 0 đến 500 ms.');
      const targetTabId=internal?runner.state.source:(await listTabs()).sort((a,b)=>Number(b.active)-Number(a.active))[0]?.id;
      const receipt=await postReply(m.url,response.text,image,progress,{stepDelayMs,typingDelayMs,skipVerification:true,waitBeforeHome:true,tabId:targetTabId,shouldContinue:internal?()=>runner.active():undefined});return {receipt,image};
    }finally{posting=false;clearInterval(keepAlive);}
  }
  if(m.type==='get-ai-settings'){
    const {aiSettings={},aiResults={}}=await chrome.storage.local.get(['aiSettings','aiResults']);
    const resolved=await resolveAISettings(aiSettings,true);
    return {settings:{model:resolved.model,prompt:resolved.prompt,hasKey:!!(aiSettings.apiKey||DEFAULT_API_KEY),usingDefaultKey:!aiSettings.apiKey},results:aiResults};
  }
  if(m.type==='save-ai-settings'){
    const {aiSettings={}}=await chrome.storage.local.get('aiSettings');
    const apiKey=typeof m.apiKey==='string'&&m.apiKey.trim()?m.apiKey.trim():(aiSettings.apiKey||DEFAULT_API_KEY);
    if(!apiKey||apiKey.length>512)throw Error('Nhập API key hợp lệ.');
    if(typeof m.model!=='string'||!/^[-\w/.]{1,100}$/.test(m.model)||typeof m.prompt!=='string'||!m.prompt.trim()||m.prompt.length>50000)throw Error('Model/prompt không hợp lệ.');
    await chrome.storage.local.set({aiSettings:{apiKey,model:m.model,prompt:m.prompt,promptRevision:PROMPT_REVISION}});return {};
  }
  if(m.type==='ai-models'){const {aiSettings={}}=await chrome.storage.local.get('aiSettings');return {models:await models(await resolveAISettings(aiSettings))};}
  if(m.type==='generate-response'){
    if(aiBusy)throw Error('Đang lấy response cho bài khác.');
    const post=m.post;
    if(!post||typeof post.text!=='string'||post.text.length>50000||!Array.isArray(post.images)||post.images.length>100||!/^https:\/\/www\.threads\.com\/@[\w.]+\/post\/[-\w]+$/.test(post.url))throw Error('Dữ liệu bài không hợp lệ.');
    aiBusy=true;
    try{
      const {aiSettings={},aiResults={}}=await chrome.storage.local.get(['aiSettings','aiResults']);
      const settings=await resolveAISettings(aiSettings,true);
      if(m.withImages===false)settings.prompt+='\n\nYêu cầu cho lượt này: viết comment chữ không có ảnh quảng bá đính kèm. Giữ giọng và yêu cầu của prompt trên, thêm đúng @hoanxu.app một lần thật tự nhiên khi giới thiệu tài khoản Threads của Hoàn Xu. Không nói xem ảnh hoàn tiền đính kèm. Tổng tối đa 450 ký tự gồm cả @hoanxu.app.';
      const cache_id=await signature(post,settings),cached=aiResults[post.url];
      if(!m.force&&cached?.cache_id===cache_id)return {result:{...cached,cached:true}};
      const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
      let result;
      try{result=await generate(post,settings);}finally{clearInterval(keepAlive);}
      const {collage,...saved}=result;
      if(m.withImages===false&&!saved.text.includes('@hoanxu.app'))saved.text=[...saved.text].slice(0,475).join('').trimEnd()+' @hoanxu.app';
      const entry={...saved,cache_id};delete aiResults[post.url];aiResults[post.url]=entry;
      const trimmed=Object.fromEntries(Object.entries(aiResults).slice(-1000));await chrome.storage.local.set({aiResults:trimmed});
      return {result:{...entry,collage}};
    }finally{aiBusy=false;}
  }
  if(m.type==='tabs')return {tabs:await listTabs()};
  if(m.type==='open-inspector'){await chrome.tabs.create({url:chrome.runtime.getURL('inspector.html')});return {};}
  if(m.type==='open-home'){
    const tabs=await listTabs(),home=tabs.find(t=>t.url==='https://www.threads.com/');
    const t=home?await activateTab(home.id):await chrome.tabs.create({url:'https://www.threads.com/',active:true});return {tabId:t.id};
  }
  if(!['capture','reload-capture'].includes(m.type))throw Error('Unsupported action');
  if(busy)throw Error('Đang đọc dữ liệu. Chờ lần chạy trước hoàn tất.');
  if(!Number.isInteger(m.tabId)||!Number.isInteger(m.limit)||m.limit<1||m.limit>100||!['feed','post'].includes(m.mode))throw Error('Tham số không hợp lệ.');
  const tab=await chrome.tabs.get(m.tabId);
  if(!isThreads(tab.url))throw Error('Chọn tab https://www.threads.com/');
  if(m.mode==='post'&&!/^\/@[\w.]+\/post\/[\w-]+\/?$/.test(new URL(tab.url).pathname))throw Error('Mở một bài cụ thể trên Threads rồi chọn chế độ Bài đang mở.');
  if(busy)throw Error('Đang đọc dữ liệu. Chờ lần chạy trước hoàn tất.');
  busy=true;const started=Date.now();
  try{
    if(m.type==='reload-capture'){
      const check=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>[...document.querySelectorAll('[contenteditable="true"],textarea')].some(e=>(e.innerText||e.value||'').trim())});
      if(check[0]?.result!==false)throw Error('Tab có bản nháp hoặc không kiểm tra được bản nháp. Giữ lại nội dung rồi thử reload.');
      await chrome.tabs.reload(tab.id);
    }
    let data;
    const deadline=Date.now()+15000;
    do{
      const current=await chrome.tabs.get(tab.id);
      if(!isThreads(current.url))throw Error('Tab đã chuyển khỏi Threads.');
      if(m.type==='capture'||current.status==='complete'){
        const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractPosts,args:[{limit:m.limit,mode:m.mode,excludeURLs:internal&&Array.isArray(m.excludeURLs)?m.excludeURLs:[]}]});
        data=result[0]?.result;
        if(m.type==='capture'||data?.posts?.length)break;
      }
      await new Promise(r=>setTimeout(r,300));
    }while(Date.now()<deadline);
    if(m.type==='reload-capture'&&!data?.posts?.length)throw Error('Reload xong nhưng chưa đọc được bài sau 15 giây. Kiểm tra tab Threads trước khi chạy lại.');
    if(!data||!Array.isArray(data.posts))throw Error('Không đọc được dữ liệu. Reload extension và tab Threads rồi thử lại.');
    if(!data.posts.length)data.warnings.push('Chưa thấy bài có thể đọc. Kiểm tra đăng nhập, chờ tải hoặc tự cuộn bảng tin rồi bấm lấy lại.');
    await chrome.storage.local.set({lastCapture:data,lastRun:{time:new Date().toISOString(),duration_ms:Date.now()-started,count:data.count,error:null}});
    return {data};
  }catch(e){await chrome.storage.local.set({lastRun:{time:new Date().toISOString(),duration_ms:Date.now()-started,error:e.message}});throw e;}
  finally{busy=false;}
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return false;
  handle(m).then(value=>respond({ok:true,...value})).catch(e=>respond({ok:false,error:e.message}));return true;
});

const AUTO_ALARM='threads-auto-run';
const runner=new AutoRunner({
 now:()=>Date.now(),random:()=>Math.random(),
 read:async()=> (await chrome.storage.local.get('autoRun')).autoRun,
 write:async autoRun=>chrome.storage.local.set({autoRun}),
 schedule:async when=>chrome.alarms.create(AUTO_ALARM,{when:Math.max(Date.now()+1000,when),periodInMinutes:1}),
 clear:async()=>chrome.alarms.clear(AUTO_ALARM),
 keepAlive:()=>setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000),endKeepAlive:id=>clearInterval(id),
 prepare:async()=>{selectReplyAssets(await readFolder());const {aiSettings={}}=await chrome.storage.local.get('aiSettings');await resolveAISettings(aiSettings,true);},
 source:async()=>{const tabs=await listTabs();const existing=tabs.find(t=>new URL(t.url).pathname==='/');const tab=existing?await activateTab(existing.id):tabs.length?await retryTabEdit(()=>chrome.tabs.update(tabs[0].id,{url:'https://www.threads.com/',active:true})):await chrome.tabs.create({url:'https://www.threads.com/',active:true});return tab.id;},
 newSource:async()=>{const t=await retryTabEdit(()=>chrome.tabs.create({url:'https://www.threads.com/',active:true}),{shouldContinue:()=>runner.active()});return t.id;},
 closeSource:async id=>{if(!id)return;let t;try{t=await chrome.tabs.get(id);}catch{return;}if(isThreads(t.url))await closeTabPreservingWindow(id,'nghỉ giữa phiên 3 giờ');},
 replaceSource:async(oldTabId,options)=>replaceSourceTab(oldTabId,options),
 receipts:async()=> (await chrome.storage.local.get('replyReceipts')).replyReceipts||{},
 capture:async(tabId,excludeURLs=[])=>{
  const tab=await chrome.tabs.get(tabId);if(!isThreads(tab.url)||new URL(tab.url).pathname!=='/')throw Error('Tab nguồn không còn ở trang chủ Threads.');
  const health=(await chrome.scripting.executeScript({target:{tabId},func:autoPage,args:['check']}))[0]?.result;
  if(!health?.self)throw Error('Tab nguồn chưa sẵn sàng hoặc chưa đăng nhập.');
  return collectFreshPosts({
    read:async()=>{const {data}=await handle({type:'capture',tabId,mode:'feed',limit:50,excludeURLs},true);return {...data,self:health.self};},
    scroll:async()=>{await activateTab(tabId,{shouldContinue:()=>runner.active()});await chrome.scripting.executeScript({target:{tabId},func:autoPage,args:['scroll']});},
    shouldContinue:()=>runner.active(),onProgress:message=>runner.activity('searching',message)
  });
 },
 refresh:async tabId=>{await handle({type:'reload-capture',tabId,mode:'feed',limit:50},true);},
 idleScroll:async tabId=>{const tab=await chrome.tabs.get(tabId);if(!isThreads(tab.url)||new URL(tab.url).pathname!=='/')throw Error('Tab nguồn đã đổi trang.');await chrome.scripting.executeScript({target:{tabId},func:autoPage,args:['idle-scroll']});},
 scroll:async tabId=>{await activateTab(tabId,{shouldContinue:()=>runner.active(),onProgress:message=>runner.activity('waiting',message).catch(console.error)});await chrome.scripting.executeScript({target:{tabId},func:autoPage,args:['scroll']});},
 savePosts:async batch=>{
  const {collectedCapture}=await chrome.storage.local.get('collectedCapture');const byURL=new Map((collectedCapture?.posts||[]).map(p=>[p.url,p]));for(const p of batch.posts)byURL.set(p.url,p);
  const posts=[...byURL.values()].slice(-1000);await chrome.storage.local.set({collectedCapture:{...batch,posts,count:posts.length}});
 },
 classify:async(posts,topics)=>{const {aiSettings={}}=await chrome.storage.local.get('aiSettings');return selectPosts(posts,await resolveAISettings(aiSettings),topics);},
 generate:async(post,withImages=true)=>(await handle({type:'generate-response',post,withImages},true)).result,
 post:async(url,stepDelayMs,shouldContinue,typingDelayMs,withImages=true)=>(await handle({type:'post-response',url,stepDelayMs,typingDelayMs,withImages},true)).receipt,
 check:async url=>(await handle({type:'check-response',url},true)).receipt
});
chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name===AUTO_ALARM)runner.tick().catch(console.error);});
chrome.runtime.onStartup?.addListener(async()=>{const state=await runner.load();if(state.status==='running')await chrome.alarms.create(AUTO_ALARM,{when:Date.now()+30000,periodInMinutes:1});});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {Store} from './store.mjs';
import {GpmBrowser,endpoint} from './browser.mjs';
import {attachments,createRunner} from './runner.mjs';
import {AUTO_DEFAULTS} from '../extension/auto-runner.js';
import {postReply} from '../extension/post-reply.js';
import {replyAction} from '../extension/reply-dom.js';
import {closeTabPreservingWindow} from '../extension/tab-actions.js';
import {selectPosts,generate} from './ai.mjs';

test('GPM rating and generation tolerate responses beyond the former 25-second deadline',async()=>{
 const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout,post={url:'https://www.threads.com/@demo/post/a',text:'Bài kiểm thử',images:[]},settings={apiKey:'test',model:'m',prompt:'Prompt'};
 // Scale deadlines down to keep this regression test fast.
 AbortSignal.timeout=ms=>originalTimeout.call(AbortSignal,ms>=90000?200:1);
 globalThis.fetch=async(url,options)=>new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(Error('request timeout'));};
  const timer=setTimeout(()=>{options.signal.removeEventListener('abort',abort);const body=JSON.parse(options.body),isRating=body.max_tokens===1600;resolve({ok:true,json:async()=>({choices:[{message:{content:isRating?JSON.stringify({ratings:[{url:post.url,language:'vi',eligible:true,score:80}]}):'Response @hoanxu.app'}}]})});},20);
  options.signal.addEventListener('abort',abort,{once:true});
 });
 try{assert.deepEqual(await selectPosts([post],settings,'topics'),[post.url]);assert.equal((await generate(post,settings,false)).text,'Response');}finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
});

test('GPM accepts partial and empty ratings across AI batches',async()=>{
 const original=globalThis.fetch,posts=Array.from({length:12},(_,i)=>({url:'https://www.threads.com/@demo/post/'+i,text:'Bài '+i}));let calls=0;
 globalThis.fetch=async(url,options)=>{const batch=JSON.parse(JSON.parse(options.body).messages[1].content).posts;calls++;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({ratings:calls===1?[{url:batch[3].url,language:'vi',eligible:true,score:80},{url:batch[0].url,language:'vi',eligible:true,score:90}]:[]})}}]})};};
 try{assert.deepEqual(await selectPosts(posts,{apiKey:'test',model:'m'},'topics'),[posts[0].url,posts[3].url]);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});

test('GPM still rejects malformed ratings, outside URLs, duplicates and invalid scores',async()=>{
 const original=globalThis.fetch,posts=[{url:'https://www.threads.com/@demo/post/a'},{url:'https://www.threads.com/@demo/post/b'}],rating={url:posts[0].url,language:'vi',eligible:true,score:80};
 try{for(const [ratings,message] of [[{},/không hợp lệ/],[[{...rating,url:'https://example.com/'}],/ngoài nhóm/],[[rating,rating],/không hợp lệ/],[[{...rating,score:101}],/không hợp lệ/],[[{...rating,language:'invalid'}],/không hợp lệ/],[[{...rating,eligible:'true'}],/không hợp lệ/]]){
  globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({ratings})}}]})});
  await assert.rejects(()=>selectPosts(posts,{apiKey:'test',model:'m'},'topics'),message);
 }}finally{globalThis.fetch=original;}
});

test('GPM retries every AI error three times at two-minute intervals and preserves retries after restart',async()=>{
 for(const stage of ['filtering','generating'])for(const message of ['HTTP 503','quota 429','HTTP 401','AI lọc bài trả JSON không hợp lệ.']){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-ai-retry-')),store=await new Store(dir).load();let runner,time=0,calls=0,posted=0;
  const post={url:'https://www.threads.com/@demo/post/a',author:'demo'};
  const configure=()=>{runner=createRunner(store,{});runner.d.now=()=>time;runner.d.schedule=async()=>{};runner.d.post=async()=>{posted++;};runner.d[stage==='filtering'?'classify':'generate']=async()=>{calls++;throw Error(message);};};
  try{
   await store.set({autoRun:{status:'running',config:{...AUTO_DEFAULTS,idleScroll:false},source:1,history:{},events:[],stats:{failed:0},queue:[],nextAt:0,...(stage==='filtering'?{selectionBatch:{posts:[post],batch:{posts:[post]},retries:0}}:{current:{post,phase:'generating',withImages:false}})}});
   configure();
   for(let retry=1;retry<=3;retry++){
    await runner.tick();assert.equal(calls,retry);assert.equal(store.value.autoRun.status,'running');assert.equal(store.value.autoRun.nextAt,time+120000);
    if(retry===1){runner.dispose();configure();}
    time+=119999;await runner.tick();assert.equal(calls,retry);time++;
   }
   await runner.tick();assert.equal(calls,4);assert.equal(store.value.autoRun.status,'attention');assert.match(store.value.autoRun.activity.message,/sau 3 lần gọi lại/);assert.equal(posted,0);
   time+=120000;await runner.tick();assert.equal(calls,4);
  }finally{runner?.dispose();await fs.rm(dir,{recursive:true,force:true});}
 }
});

test('Stop during GPM AI retry cooldown prevents another request',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-ai-stop-')),store=await new Store(dir).load();let runner,time=0,calls=0;
 try{
  await store.set({autoRun:{status:'running',config:{...AUTO_DEFAULTS,idleScroll:false},source:1,history:{},events:[],stats:{failed:0},queue:[],nextAt:0,current:{post:{url:'https://www.threads.com/@demo/post/a'},phase:'generating'}}});
  runner=createRunner(store,{});runner.d.now=()=>time;runner.d.schedule=async()=>{};runner.d.generate=async()=>{calls++;throw Error('quota 429');};
  await runner.tick();await runner.stop();time+=120000;await runner.tick();assert.equal(calls,1);assert.equal(store.value.autoRun.status,'stopped');
 }finally{runner?.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('atomic store persists scheduling and credentials but returns independent snapshots',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-store-'));
 try{const store=await new Store(dir).load();await Promise.all([store.set({autoRun:{status:'running',nextAt:123}}),store.set({settings:{apiKey:'test'}})]);const read=await store.get('autoRun');read.autoRun.status='wrong';assert.equal((await store.get('autoRun')).autoRun.status,'running');assert.equal((await new Store(dir).load()).value.settings.apiKey,'test');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('CDP accepts local endpoints and rejects remote or credential-bearing destinations',()=>{
 assert.equal(endpoint('http://127.0.0.1:9222'),'http://127.0.0.1:9222/');assert.ok(endpoint('ws://localhost:9222/devtools/browser/test'));
 for(const value of ['https://example.com','file:///etc/passwd','http://user:pass@localhost:9222'])assert.throws(()=>endpoint(value));
});
test('bundled assets become three separate uploads with store image in the middle',async()=>{
 const result=await attachments();assert.equal(result.files.length,3);assert.match(result.files[1].name,/^app_store\./i);assert.notEqual(result.names[0],result.names[2]);assert.ok(result.files.every(f=>f.size>0&&f.data_url.startsWith('data:image/')));
});
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
const fixture=`<!doctype html><html><body><a href="/" aria-label="Threads">Threads</a><main><a href="/@demo/post/abc"><time datetime="2026-10-07">now</time></a><button aria-label="Reply">Reply</button><div><div contenteditable="true" role="textbox" style="min-height:80px;min-width:200px"></div><button aria-label="Send" onclick="sessionStorage.setItem('sent',document.querySelector('[contenteditable]').innerText);document.querySelector('[contenteditable]').innerText=''">↑</button></div></main></body></html>`;
test('real CDP adapter runs shared text-post DOM flow, resumes stable IDs and protects last window',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-browser-')),port=await freePort();
 const executable=process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome');
 let context;const previous=globalThis.chrome;
 try{
  context=await chromium.launchPersistentContext(path.join(dir,'profile'),{executablePath:executable,headless:true,args:[`--remote-debugging-port=${port}`]});
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:fixture}));
  const page=context.pages()[0];await page.goto('https://www.threads.com/@demo/post/abc');
  const store=await new Store(path.join(dir,'data')).load();const browser=new GpmBrowser(store);await browser.connect('http://127.0.0.1:'+port);browser.installChrome();
  await store.set({autoRun:{status:'running'}});const pendingStatus=browser.evaluate((await browser.query())[0].id,async()=>{await new Promise(r=>setTimeout(r,200));return (await chrome.storage.local.get('autoRun')).autoRun.status;});await store.set({autoRun:{status:'stopped'}});assert.equal(await pendingStatus,'stopped');
  const tab=(await browser.query()).find(t=>t.url.includes('/post/abc'));assert.ok(tab);
  const result=await postReply(tab.url,'test @hoanxu.app',{files:[],names:[]},()=>{},{tabId:tab.id,skipVerification:true,waitBeforeHome:false,stepDelayMs:0,typingDelayMs:0});
  assert.equal(result.state,'sent_unverified');assert.equal(await page.evaluate(()=>sessionStorage.getItem('sent')),'test @hoanxu.app');assert.equal(page.url(),'https://www.threads.com/');
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg';input.multiple=true;document.body.append(input);input.addEventListener('change',()=>document.body.dataset.uploaded=String(input.files.length));});
  const files=await attachments();const upload=await browser.evaluate(tab.id,replyAction,['upload',{files:files.files}]);assert.equal(upload.files,3);assert.equal(await page.locator('body').getAttribute('data-uploaded'),'3');
  const browser2=new GpmBrowser(store);await browser2.connect('http://127.0.0.1:'+port);assert.equal((await browser2.query()).find(t=>t.url==='https://www.threads.com/').id,tab.id);
  await closeTabPreservingWindow(tab.id,'fixture close');assert.ok(browser.browser.isConnected());assert.ok((await browser.query()).some(t=>t.url==='about:blank'));assert.equal(store.value.tabLifecycle.at(-1).reason,'fixture close');
  const surviving=(await browser.query()).find(t=>t.url==='about:blank');
  await browser.browser.close();assert.equal(browser.context,null);assert.equal(browser.pages.size,0);assert.equal(context.pages().some(p=>!p.isClosed()),true);
  await assert.rejects(()=>browser.create({url:'about:blank'},{shouldContinue:()=>false}),/Đã dừng/);assert.equal(browser.browser.isConnected(),false);
  const recovered=await browser.create({url:'about:blank'});assert.ok(browser.browser.isConnected());assert.ok(recovered.id);assert.ok((await browser.query()).some(t=>t.id===surviving.id));
  const disconnected=new GpmBrowser(store);disconnected.address='http://127.0.0.1:'+port;disconnected.connect=async()=>{throw Error('ECONNREFUSED');};await assert.rejects(()=>disconnected.create({url:'about:blank'}),/Mất kết nối trình duyệt GPM/);
 }finally{globalThis.chrome=previous;if(context)await context.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('AI image input merges only three original post images and never uses promotional attachments',async()=>{
 const {collage}=await import('./ai.mjs');const {default:sharp}=await import('sharp');const previous=globalThis.fetch;let calls=0;
 const png=await sharp({create:{width:80,height:60,channels:3,background:'red'}}).png().toBuffer();
 globalThis.fetch=async url=>{assert.match(url,/cdninstagram.com/);calls++;return new Response(png,{headers:{'Content-Type':'image/png'}});};
 try{const r=await collage({images:[1,2,3,4].map(n=>({src:'https://cdninstagram.com/'+n+'.png'}))});assert.equal(r.image_count,3);assert.equal(calls,3);const meta=await sharp(Buffer.from(r.data_url.split(',')[1],'base64')).metadata();assert.equal(meta.format,'jpeg');assert.ok(meta.width<=1536);assert.equal(await collage({images:[]}),null);}finally{globalThis.fetch=previous;}
});

test('proxy validation never leaks credentials into labels',async()=>{
 const {proxy,proxyLabel,localApi}=await import('./gpm-api.mjs');
 assert.equal(proxy('10.0.0.1:8080:user:pass'),'10.0.0.1:8080:user:pass');assert.equal(proxyLabel('10.0.0.1:8080:user:pass'),'10.0.0.1:8080');assert.equal(proxyLabel('http://user:pass@10.0.0.1:8080'),'http://10.0.0.1:8080');
 assert.throws(()=>proxy('x:99999:u:p'));assert.equal(proxy('x:8080:u:p\n'),'x:8080:u:p');assert.throws(()=>localApi('http://remote.example:9495'));assert.equal(localApi('http://localhost:9495'),'http://localhost:9495');
});
test('GPM proxy workflow updates only selected profile and obtains its CDP after restart',async()=>{
 const {GpmApi}=await import('./gpm-api.mjs');const calls=[];let updated=false;
 const api=new GpmApi('http://localhost:9495',async(url,options)=>{
  calls.push({url,options});let data;
  if(url.endsWith('/profiles/demo'))data={id:'demo',name:'Demo',raw_proxy:updated?'10.0.0.1:8080:user:pass':''};
  else if(url.endsWith('/update/demo')){assert.deepEqual(JSON.parse(options.body),{raw_proxy:'10.0.0.1:8080:user:pass'});updated=true;}
  else if(url.endsWith('/start/demo'))data={profile_id:'demo',remote_debugging_port:9223};
  return new Response(JSON.stringify({success:true,data}));
 });
 const r=await api.applyAndOpen('demo','10.0.0.1:8080:user:pass');assert.equal(r.cdp,'http://127.0.0.1:9223');assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/api/v1/profiles/demo','/api/v1/profiles/stop/demo','/api/v1/profiles/update/demo','/api/v1/profiles/demo','/api/v1/profiles/start/demo']);
 const wrong=new GpmApi('http://localhost:9495',async()=>new Response(JSON.stringify({success:true,data:{id:'wrong'}})));await assert.rejects(()=>wrong.applyAndOpen('demo','x:8080'),/khớp ID/);
});

test('settings persist all run controls, allow clearing profile and reject invalid intervals',async()=>{
 const {validateSettings,publicSettings,redact}=await import('./settings.mjs');
 const old={apiKey:'private-key',proxy:'10.0.0.1:80:user:secret',profileId:'old',profileName:'Old'};
 const input={cdp:'http://localhost:9222',gpmApi:'http://localhost:9495',model:'m',prompt:'Prompt',profileId:'',runConfig:{minRestSeconds:130,maxRestSeconds:175,searchDelaySeconds:45,typingDelayMs:90,stepSeconds:3,idleScroll:false,keywords:'mua sách'}};
 const settings=validateSettings(input,old);assert.equal(settings.apiKey,old.apiKey);assert.equal(settings.profileId,'');assert.equal(settings.profileName,undefined);assert.equal(settings.runConfig.idleScroll,false);assert.equal(settings.runConfig.searchDelaySeconds,45);
 const safe=JSON.stringify(publicSettings(settings));assert.ok(!safe.includes('private-key'));assert.equal(publicSettings(settings).proxy,old.proxy);assert.equal(redact('private-key secret',settings),'[secret] [secret]');
 assert.throws(()=>validateSettings({...input,runConfig:{minRestSeconds:180,maxRestSeconds:120}},old));
});
test('dashboard separates confirmed sends from unknown and respects Vietnam daily boundary',async()=>{
 const {dashboard}=await import('./dashboard.mjs');
 const result=dashboard({autoRun:{status:'running',stats:{posted:1,sent:1,unknown:2},history:{private:'omitted'},sessionHistory:[{stats:{posted:25}}]},replyReceipts:{a:{state:'posted',created_at:'2026-10-06T16:59:00Z'},b:{state:'sent_unverified',created_at:'2026-10-06T17:01:00Z'},c:{state:'unknown',created_at:'2026-10-06T17:02:00Z'}}},true,Date.parse('2026-10-06T18:00:00Z'));
 assert.equal(result.counts.today,1);assert.equal(result.counts.total,2);assert.equal(result.counts.session,3);assert.equal(result.counts.unverified,2);assert.equal(result.counts.sessions,1);assert.equal(result.state.history,undefined);
});
test('custom assets validate folder and enforce center image',async()=>{
 const {listAssets,attachments}=await import('./assets.mjs');const {default:sharp}=await import('sharp');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-images-'));
 try{const png=await sharp({create:{width:32,height:32,channels:3,background:'blue'}}).png().toBuffer();for(const name of ['a.png','b.png'])await fs.writeFile(path.join(dir,name),png);await assert.rejects(()=>listAssets(dir),/app_store/);await fs.writeFile(path.join(dir,'app_store.png'),png);assert.equal((await listAssets(dir)).files.length,3);assert.equal((await attachments(dir)).files[1].name,'app_store.png');}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('opening a profile without proxy calls only read and start, never stop or update',async()=>{
 const {GpmApi}=await import('./gpm-api.mjs');const calls=[];
 const api=new GpmApi('http://localhost:9495',async(url,options)=>{
  calls.push({path:new URL(url).pathname,method:options.method,body:options.body});
  return {ok:true,json:async()=>({success:true,data:url.endsWith('/start/demo')?{profile_id:'demo',remote_debugging_port:9345}:{id:'demo',name:'Demo'}})};
 });
 assert.deepEqual(await api.open('demo'),{cdp:'http://127.0.0.1:9345',profileId:'demo',profileName:'Demo'});
 assert.deepEqual(calls,[{path:'/api/v1/profiles/demo',method:'GET',body:undefined},{path:'/api/v1/profiles/start/demo',method:'GET',body:undefined}]);
 await assert.rejects(()=>api.open(''),/Profile ID/);
});

test('already-open GPM profile returns its CDP without changing the profile',async()=>{
 const {GpmApi}=await import('./gpm-api.mjs');const calls=[];
 const api=new GpmApi('http://localhost:9495',async url=>{calls.push(new URL(url).pathname);return {ok:true,json:async()=>url.includes('/start/')?{success:false,message:'ProfileInUse',data:{profile_id:'demo',remote_debugging_port:61863}}:{success:true,data:{id:'demo',name:'Demo'}}};});
 assert.equal((await api.open('demo')).cdp,'http://127.0.0.1:61863');
 assert.deepEqual(calls,['/api/v1/profiles/demo','/api/v1/profiles/start/demo']);
 for(const data of [{profile_id:'other',remote_debugging_port:61863},{profile_id:'demo',remote_debugging_port:0}]){
  const bad=new GpmApi('http://localhost:9495',async()=>({ok:true,json:async()=>({success:false,message:'ProfileInUse',data})}));
  await assert.rejects(()=>bad.call('/profiles/start/demo'),/GPM từ chối/);
 }
});

test('blank proxy clears saved settings and clears profile network before start',async()=>{
 const {validateSettings}=await import('./settings.mjs');const {GpmApi}=await import('./gpm-api.mjs');
 const old={cdp:'http://localhost:9222',gpmApi:'http://localhost:9495',model:'m',prompt:'p',proxy:'10.0.0.1:80:u:p'};
 assert.equal(validateSettings({...old,proxy:''},old).proxy,'');
 const calls=[];let updated=false;
 const api=new GpmApi('http://localhost:9495',async(url,opts)=>{
  calls.push({path:new URL(url).pathname,body:opts.body});if(url.includes('/update/'))updated=true;
  return {ok:true,json:async()=>({success:true,data:url.includes('/start/')?{profile_id:'demo',remote_debugging_port:9223}:{id:'demo',name:'Demo',raw_proxy:updated?'':old.proxy}})};
 });
 await api.applyAndOpen('demo','');
 const update=calls.find(x=>x.path.includes('/update/'));assert.deepEqual(JSON.parse(update.body),{raw_proxy:''});
 assert.ok(calls.findIndex(x=>x.path.includes('/update/'))<calls.findIndex(x=>x.path.includes('/start/')));
});

test('GPM stop false with OK/null is idempotent and continues proxy update',async()=>{
 const {GpmApi}=await import('./gpm-api.mjs');let updated=false;const calls=[];
 const api=new GpmApi('http://localhost:9495',async(url,opts)=>{
  calls.push(new URL(url).pathname);
  if(url.includes('/stop/'))return {ok:true,json:async()=>({success:false,message:'OK',data:null})};
  if(url.includes('/update/'))updated=true;
  return {ok:true,json:async()=>({success:true,data:url.includes('/start/')?{profile_id:'demo',remote_debugging_port:9321}:{id:'demo',name:'Demo',raw_proxy:updated?'x:80':''}})};
 });
 assert.equal((await api.applyAndOpen('demo','x:80')).cdp,'http://127.0.0.1:9321');assert.ok(calls.includes('/api/v1/profiles/update/demo'));
 const bad=new GpmApi('http://localhost:9495',async()=>({ok:true,json:async()=>({success:false,message:'Denied',data:null})}));await assert.rejects(()=>bad.call('/profiles/stop/demo'),/từ chối/);
});

test('create profile uses installed Chrome version and includes optional proxy before any opening',async()=>{
 const {GpmApi}=await import('./gpm-api.mjs');const calls=[];
 const api=new GpmApi('http://localhost:9495',async(url,opts)=>{calls.push({path:new URL(url).pathname,opts});return {ok:true,json:async()=>({success:true,data:url.includes('/create')?{id:'new',name:'Hoàn Xu 02'}:{id:'old',browser:{name:'chrome',version:'152.0.7977.140'}}})};});
 const created=await api.create({name:' Hoàn Xu 02 ',sourceProfileId:'old',rawProxy:'host:80:u:p',osType:3});assert.equal(created.id,'new');const body=JSON.parse(calls[1].opts.body);assert.deepEqual(body,{name:'Hoàn Xu 02',group_id:null,raw_proxy:'host:80:u:p',browser_type:1,browser_version:'152.0.7977.140',os_type:3});assert.equal(calls[1].opts.method,'POST');assert.equal(calls.some(c=>c.path.includes('/start/')),false);
 await api.create({name:'No proxy',browserVersion:'152.0.7977.140',osType:3});assert.equal(JSON.parse(calls.at(-1).opts.body).raw_proxy,'');
 await assert.rejects(()=>api.create({name:'',browserVersion:'152.0.7977.140'}),/Tên profile/);await assert.rejects(()=>api.create({name:'n',browserVersion:'bad'}),/phiên bản Chrome/i);await assert.rejects(()=>api.create({name:'n',browserVersion:'152.0.7977.140',rawProxy:'invalid'}),/Proxy/);
});

test('profile edit verifies persisted name/proxy and stops only when proxy changes; deletion is soft',async()=>{
 const {GpmApi}=await import('./gpm-api.mjs');let profile={id:'demo',name:'Old',raw_proxy:'host:80:u:p'};const calls=[];
 const api=new GpmApi('http://localhost:9495',async(url,opts)=>{calls.push({url,opts});if(url.includes('/update/'))profile={...profile,...JSON.parse(opts.body)};return {ok:true,json:async()=>({success:true,data:url.includes('/stop/')||url.includes('/delete/')?null:profile})};});
 assert.deepEqual(await api.edit('demo',{name:' New ',rawProxy:''}),{id:'demo',name:'New',proxy:''});assert.ok(calls.findIndex(c=>c.url.includes('/stop/'))<calls.findIndex(c=>c.url.includes('/update/')));assert.equal(calls.some(c=>c.url.includes('/start/')),false);
 calls.length=0;await api.edit('demo',{name:'Rename',rawProxy:''});assert.equal(calls.some(c=>c.url.includes('/stop/')),false);
 await api.remove('demo');assert.equal(new URL(calls.at(-1).url).searchParams.get('mode'),'soft');
 const unchanged=new GpmApi('http://localhost:9495',async()=>({ok:true,json:async()=>({success:true,data:profile})}));await assert.rejects(()=>unchanged.edit('demo',{name:'Not saved',rawProxy:''}),/chưa lưu đúng/);await assert.rejects(()=>api.edit('demo',{name:'',rawProxy:''}),/Tên profile/);
});

test('GPM rating errors identify invalid fields and record bounded diagnostics without response or credentials',async()=>{
 const original=globalThis.fetch,post={url:'https://www.threads.com/@demo/post/a'},settings={apiKey:'do-not-record-key',model:'m'},valid={url:post.url,language:'vi',eligible:true,score:80};
 try{for(const [ratings,field,type] of [[{},'ratings','object'],[[{...valid,eligible:'true'}],'eligible','string'],[[{...valid,score:'80'}],'score','string'],[[{...valid,language:'Vietnamese'}],'language','string'],[[valid,valid],'url',undefined]]){
  // Each fixture has exactly one invalid contract field.
  const payload=field==='ratings'?ratings:field==='url'?ratings:Array.isArray(ratings)?ratings:[ratings];let captured;
  globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({ratings:payload})}}]})});
  await assert.rejects(()=>selectPosts([post],settings,'',d=>{captured=d;}),/không hợp lệ/);assert.equal(captured.field,field);if(type)assert.equal(captured.receivedType,type);assert.equal(captured.finishReason,'stop');assert.ok(!JSON.stringify(captured).includes(settings.apiKey));assert.ok(!JSON.stringify(captured).includes(post.url));assert.equal('content' in captured,false);
 }
 let captured;globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"ratings":['}}]})});await assert.rejects(()=>selectPosts([post],settings,'',d=>{captured=d;}),/finish_reason=length/);assert.equal(captured.finishReason,'length');
 }finally{globalThis.fetch=original;}
});

test('saving live settings updates runner config without changing the current job, wait or receipts',async()=>{
 const {assertLiveSettings,applyRunnerSettings}=await import('./settings.mjs');const {AutoRunner,AUTO_DEFAULTS}=await import('../extension/auto-runner.js');
 const old={profileId:'a',gpmApi:'http://localhost:9495',cdp:'http://localhost:9222',proxy:''},settings={...old,model:'new-model',prompt:'new-prompt',runConfig:{...AUTO_DEFAULTS,typingDelayMs:85,idleEngagement:false,keywords:'new topic'}};
 assert.doesNotThrow(()=>assertLiveSettings(settings,old,true));assert.doesNotThrow(()=>assertLiveSettings({...settings,cdp:old.cdp+'/'},old,true));for(const key of ['gpmApi','cdp','proxy','profileId'])assert.throws(()=>assertLiveSettings({...settings,[key]:'changed'},old,true),/Dừng profile/);
 let saved;const current={phase:'posting',post:{url:'https://www.threads.com/@test/post/demo'}},runner=new AutoRunner({now:()=>100,read:async()=>({status:'running',config:AUTO_DEFAULTS,current,nextAt:5000,history:{keep:{state:'sent_unverified'}},events:[]}),write:async state=>{saved=state;}});
 await applyRunnerSettings(runner,settings);assert.equal(runner.state.config.typingDelayMs,85);assert.equal(runner.state.config.idleEngagement,false);assert.equal(runner.state.config.keywords,'new topic');assert.equal(saved.status,'running');assert.equal(saved.nextAt,5000);assert.deepEqual(saved.current,current);assert.ok(saved.history.keep);
});

test('one average rest setting derives a random range and legacy min/max settings remain supported',async()=>{
 const {autoConfig}=await import('../extension/auto-runner.js');const c=autoConfig({restAverageSeconds:150});assert.equal(c.minRestSeconds,120);assert.equal(c.maxRestSeconds,180);assert.deepEqual([autoConfig({restAverageSeconds:120}).minRestSeconds,autoConfig({restAverageSeconds:120}).maxRestSeconds],[96,144]);assert.equal(autoConfig(c).restAverageSeconds,150);assert.equal(autoConfig({minRestSeconds:130,maxRestSeconds:170}).minRestSeconds,130);for(const seconds of [0,30,60,181,300,600]){const config=autoConfig({restAverageSeconds:seconds});assert.equal(config.restAverageSeconds,seconds);assert.equal(config.minRestSeconds,Math.round(seconds*.8));assert.equal(config.maxRestSeconds,Math.round(seconds*1.2));assert.equal(autoConfig(config).restAverageSeconds,seconds);}for(const value of [NaN,-1,Infinity])assert.throws(()=>autoConfig({restAverageSeconds:value}));
});

test('next AI generation reads the newly saved model and invalidates results from the previous model',async()=>{
 const {createRunner}=await import('./runner.mjs');const original=globalThis.fetch;
 const value={settings:{model:'cx/gpt-5.6-sol',prompt:'test',apiKey:'fixture-key'},autoRun:{status:'running',events:[]},aiResults:{}};
 const store={get:async key=>({[key]:structuredClone(value[key])}),set:async patch=>Object.assign(value,structuredClone(patch))},models=[];
 const runner=createRunner(store,{}),post={url:'https://www.threads.com/@fixture/post/model',text:'test',images:[]};
 try{globalThis.fetch=async(url,options)=>{models.push(JSON.parse(options.body).model);return {ok:true,json:async()=>({choices:[{message:{content:'Test @hoanxu.app'}}]})};};
 for(const model of ['cx/gpt-5.6-sol','cx/gpt-5.6-luna','cx/gpt-5.6-sol']){value.settings.model=model;const result=await runner.d.generate(post,false);assert.equal(result.model,model);}
 assert.deepEqual(models,['cx/gpt-5.6-sol','cx/gpt-5.6-luna','cx/gpt-5.6-sol']);
 }finally{runner.dispose();globalThis.fetch=original;}
});

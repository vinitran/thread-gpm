import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {chromium} from 'playwright';import {GpmBrowser} from './browser.mjs';import {ExtensionBridge} from './extension-bridge.mjs';import {stageManagedExtension,connectManagedExtension,MANAGED_EXTENSION_ID} from './managed-extension.mjs';
import {postReply} from '../extension/post-reply.js';
import {replyAction} from '../extension/reply-dom.js';import {extractPosts} from '../extension/extract.js';import {autoPage} from '../extension/auto-dom.js';import {engagementPage} from './idle-engagement.mjs';
const markup=`<a href="/@me" aria-label="Profile">Me</a><main id="card"><a href="/@demo/post/a"><time>now</time></a><span>Fixture text</span><button aria-label="Reply">Reply</button><button id="like" aria-label="Like">Like</button><button id="repost" aria-label="Repost">Repost</button></main><textarea id="editor"></textarea>`;
test('real MV3 extension loads automatically and performs native tab, DOM, Like and debugger operations', {timeout:120000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-managed-'));let context,browser;let status='running';
 const bridge=new ExtensionBridge(()=>({status,message:'fixture'}));
 const server=http.createServer(async(req,res)=>{try{
  if(!bridge.authorize(req.headers,MANAGED_EXTENSION_ID)){res.writeHead(403);res.end('{}');return;}
  let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text||'{}');let result;
  if(req.url.endsWith('/poll'))result=await bridge.poll();else if(req.url.endsWith('/result'))result={ok:bridge.result(input)};else{bridge.touch();result=bridge.status();}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const staged=await stageManagedExtension(dir);
  // An old bootstrap script can fail to read its fragment; the app must still configure directly.
  await fs.writeFile(path.join(staged.directory,'bootstrap.js'),"document.body.dataset.error='true';document.getElementById('status').textContent='Fixture bootstrap failed';");
  // Official Chrome supports Extensions.loadUnpacked with this debugging flag.
  context=await chromium.launchPersistentContext(path.join(dir,'chrome'),{executablePath:process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome'),headless:true,args:['--enable-unsafe-extension-debugging','--remote-debugging-port=0'],ignoreDefaultArgs:['--disable-extensions']});
  await context.route('https://www.threads.com/**',r=>r.fulfill({contentType:'text/html',body:markup}));
  const [cdpPort]= (await fs.readFile(path.join(dir,'chrome','DevToolsActivePort'),'utf8')).split('\n');
  const values={autoRun:{status:'running'}};const store={value:values,async get(k){return {[k]:values[k]};},async set(patch){Object.assign(values,patch);}};
  browser=new GpmBrowser(store);await browser.connect('http://127.0.0.1:'+cdpPort);
  await connectManagedExtension(browser,bridge,{directory:staged.directory,base:'http://127.0.0.1:'+server.address().port});browser.installChrome();
  const tab=await browser.create({url:'https://www.threads.com/',active:true});assert.ok(tab.id<0);assert.equal(tab.status,'complete');
  const page=browser.context.pages().find(p=>p.url()==='https://www.threads.com/');assert.ok(page);await page.setContent(markup);
  await page.evaluate(()=>{window.likes=0;window.reposts=0;document.getElementById('like').onclick=()=>{window.likes++;document.getElementById('like').setAttribute('aria-label','Unlike');};document.getElementById('repost').onclick=()=>window.reposts++;});
  assert.ok((await browser.query()).some(t=>t.id===tab.id));assert.equal((await browser.describe(tab.id)).url,'https://www.threads.com/');
  assert.equal((await browser.evaluate(tab.id,autoPage,['check'])).self,'me');
  assert.ok(await browser.evaluate(tab.id,extractPosts,[{limit:10,mode:'feed'}]));
  assert.equal((await browser.evaluate(tab.id,replyAction,['feed-ready',{},true])).ready,true);
  assert.equal((await browser.evaluate(tab.id,engagementPage,[{action:'candidates'}])).posts.length,1);
  assert.equal((await browser.evaluate(tab.id,engagementPage,[{action:'engage',url:'https://www.threads.com/@demo/post/a',stepDelayMs:1500}])).like,'clicked');
  assert.deepEqual(await page.evaluate(()=>[window.likes,window.reposts]),[1,0]);
  await page.evaluate(()=>{window.pointerEvents=[];document.addEventListener('mousemove',e=>window.pointerEvents.push({type:e.type,trusted:e.isTrusted}));document.addEventListener('wheel',e=>window.pointerEvents.push({type:e.type,trusted:e.isTrusted}));const space=document.createElement('div');space.style.height='2500px';document.body.append(space);});
  const initialScroll=await page.evaluate(()=>scrollY);await browser.evaluate(tab.id,autoPage,['scroll']);assert.ok(await page.evaluate(()=>scrollY)>initialScroll);
  const beforeIdle=await page.evaluate(()=>scrollY);await browser.evaluate(tab.id,autoPage,['idle-scroll']);assert.ok(Math.abs((await page.evaluate(()=>scrollY))-beforeIdle)<3);
  const nativeEvents=await page.evaluate(()=>window.pointerEvents);assert.ok(nativeEvents.some(e=>e.type==='wheel'&&e.trusted));assert.ok(nativeEvents.some(e=>e.type==='mousemove'&&e.trusted));
  await page.setContent(markup);
  await page.evaluate(()=>{window.likes=1;window.reposts=0;});
  await page.focus('#editor');await globalThis.chrome.debugger.attach({tabId:tab.id},'1.3');
  await globalThis.chrome.debugger.sendCommand({tabId:tab.id},'Input.insertText',{text:'Fixture only'});await globalThis.chrome.debugger.detach({tabId:tab.id});
  assert.equal(await page.inputValue('#editor'),'Fixture only');
  status='stopped';await page.evaluate(()=>{document.getElementById('editor').value='';document.getElementById('like').setAttribute('aria-label','Like');});await new Promise(r=>setTimeout(r,1500));
  assert.equal((await browser.evaluate(tab.id,engagementPage,[{action:'engage',url:'https://www.threads.com/@demo/post/a'}])).stopped,true);
  assert.deepEqual(await page.evaluate(()=>[window.likes,window.reposts]),[1,0]);
  status='running';await new Promise(r=>setTimeout(r,1500));
  await page.setContent(`<a href="/@me" aria-label="Profile">Me</a><a href="/" aria-label="Home">Home</a><main><div style="position:relative;width:40px;height:40px"><a href="/@demo"><img alt="demo's profile picture" width="40" height="40" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aV8AAAAASUVORK5CYII="></a><button id="follow" aria-label="Follow" style="position:absolute;left:25px;top:25px;width:16px;height:16px;padding:0">+</button></div><a href="/@demo/post/a"><time>now</time></a><p dir="auto">Fixture text</p><button id="reply" aria-label="Reply">Reply</button><div id="composer" style="display:none"><div contenteditable="true" role="textbox"></div><input type="file" accept="image/png" multiple><section id="media"></section><button id="post">Post</button></div></main>`);
  await page.evaluate(()=>{
   window.follows=0;window.posts=0;
   document.getElementById('follow').onclick=e=>{window.followTrusted=e.isTrusted;window.follows++;e.currentTarget.remove();};
   document.getElementById('reply').onclick=()=>{document.getElementById('composer').style.display='block';document.getElementById('composer').setAttribute('role','dialog');};
   document.querySelector('input').onchange=e=>{for(const file of e.target.files){const im=document.createElement('img');im.src=URL.createObjectURL(file);document.getElementById('media').append(im);}};
   document.getElementById('post').onclick=e=>{window.postTrusted=e.isTrusted;window.posts++;document.getElementById('composer').style.display='none';const reply=document.createElement('article');reply.innerHTML='<a href="/@me/post/fixture-reply"><time>now</time></a><p dir="auto">Fixture</p>';for(const original of document.querySelectorAll('#media img')){const im=original.cloneNode();im.width=80;im.height=80;reply.append(im);}document.body.append(reply);};
   document.querySelector('[aria-label="Home"]').onclick=e=>e.preventDefault();
  });
  const url='https://www.threads.com/@demo/post/a',events=[],waits=[];let verificationClock=Date.now(),waitingAfterPost=false;
  const image={files:['a.png','app_store.png','b.png'].map(name=>({name,type:'image/png',data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aV8AAAAASUVORK5CYII='})),names:['a.png','app_store.png','b.png']};
  // Even legacy follow options must not trigger follow or its pre-comment delay.
  const options={tabId:tab.id,followAuthor:true,followRandom:()=>0,random:()=>0,now:()=>verificationClock,wait:async ms=>{waits.push(ms);if(waitingAfterPost)verificationClock+=ms;},stepDelayMs:0,typingDelayMs:0,skipVerification:true,verifyAfterPost:true,shouldContinue:()=>true};
  const receipt=await postReply(url,'Fixture',image,m=>{events.push(m);if(m.startsWith('Đã bấm Post · đã lưu')){waitingAfterPost=true;verificationClock=Date.now();}},options);
  assert.equal(receipt.state,'posted');assert.equal(values.replyReceipts[url].state,'posted');assert.equal(receipt.comment_url,'https://www.threads.com/@me/post/fixture-reply');assert.ok(events.some(m=>m.includes('Đã xác minh bình luận: '+receipt.comment_url)));assert.equal(values.replyFollowDecisions,undefined);
  assert.deepEqual(await page.evaluate(()=>[window.follows,window.posts,document.querySelector('input').files.length]),[0,1,3]);
  assert.equal(await page.evaluate(()=>window.postTrusted),true);
  assert.ok(waits.filter(ms=>ms===1000).length<30);assert.ok(!events.some(m=>/follow|210 giây/i.test(m)));
  assert.equal((await postReply(url,'Fixture',image,()=>{},options)).reused,true);
  assert.deepEqual(await page.evaluate(()=>[window.follows,window.posts]),[0,1]);
  await browser.reload(tab.id);assert.equal((await browser.describe(tab.id)).status,'complete');
  await browser.remove(tab.id);assert.ok(!(await browser.query()).some(t=>t.id===tab.id));
 }finally{bridge.close();await browser?.browser?.close();await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('real profile worker installs extension through app API, keeps Open free of navigation, and popup Stop calls GPM', {timeout:120000},async()=>{
 const {Store}=await import('./store.mjs'),{ProfileWorker}=await import('./profile-manager.mjs'),{AUTO_DEFAULTS}=await import('../extension/auto-runner.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-managed-api-'));let context,worker,debugPort;const routes=[];
 const gpm=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');routes.push(u);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,message:'OK',data:u.pathname.includes('/start/')?{profile_id:'fixture',remote_debugging_port:Number(debugPort)}:{id:'fixture',name:'Fixture',raw_proxy:''}}));
 });await new Promise(r=>gpm.listen(0,'127.0.0.1',r));
 try{
  context=await chromium.launchPersistentContext(path.join(dir,'chrome'),{executablePath:process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome'),headless:true,args:['--enable-unsafe-extension-debugging','--remote-debugging-port=0','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=localhost;127.0.0.1;[::1];www.threads.com'],ignoreDefaultArgs:['--disable-extensions']});
  [debugPort]=(await fs.readFile(path.join(dir,'chrome','DevToolsActivePort'),'utf8')).split('\n');
  await context.route('https://www.threads.com/**',r=>r.fulfill({contentType:'text/html',body:markup}));
  const dataDir=path.join(dir,'fixture'),store=await new Store(dataDir).load();
  await store.set({settings:{profileId:'fixture',profileName:'Fixture',gpmApi:'http://127.0.0.1:'+gpm.address().port+'/api/v1',proxy:'',cdp:'http://127.0.0.1:'+debugPort,apiKey:'fixture-key',model:'fixture',prompt:'Fixture',imagesFolder:'',runConfig:AUTO_DEFAULTS}});
  worker=new ProfileWorker(dataDir,()=>{});
  const result=await worker.call('profile-open',{useCurrentProxy:true,engine:'extension'},180000);
  assert.equal(result.engine,'extension');assert.equal((await worker.call('state')).engine,'extension');
  assert.match(routes.find(u=>u.pathname.includes('/start/')).searchParams.get('addition_args'),/--load-extension=/);
  assert.ok(context.pages().every(p=>!p.url().includes('threads.com')));
  const denied=await fetch(worker.base+'/api/extension/status',{method:'POST',headers:{'Content-Type':'application/json','X-Extension-Token':'wrong'},body:'{}'});assert.equal(denied.status,403);
  const origin='chrome-extension://'+MANAGED_EXTENSION_ID;
  const preflight=await fetch(worker.base+'/api/extension/status',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-extension-token','Access-Control-Request-Private-Network':'true'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
  const foreign=await fetch(worker.base+'/api/extension/status',{method:'OPTIONS',headers:{Origin:'https://untrusted.example','Access-Control-Request-Method':'POST'}});assert.equal(foreign.headers.get('access-control-allow-origin'),null);
  await worker.call('start',{},90000);
  assert.equal((await worker.call('state')).state.status,'running');assert.ok(context.pages().some(p=>p.url()==='https://www.threads.com/'));
  const popup=await context.newPage();await popup.goto('chrome-extension://'+MANAGED_EXTENSION_ID+'/managed-popup.html');await popup.waitForFunction(()=>!document.getElementById('state').textContent.includes('Đang tải'));assert.ok(!(await popup.locator('#state').innerText()).includes('Failed to fetch'));
  // Simulate persisted configuration pointing at a worker port that no longer exists.
  const broken=await popup.evaluate(async()=>{const {managedConfig}=await chrome.storage.local.get('managedConfig');return chrome.runtime.sendMessage({type:'configure-managed',config:{...managedConfig,base:'http://127.0.0.1:1'}});});
  assert.equal(broken.ok,false);assert.match(broken.error,/Không kết nối được app/);
  const opens=routes.filter(u=>u.pathname.includes('/start/')).length;
  assert.equal((await worker.call('extension-reconnect',{},45000)).reconnected,true);
  const replacementPopup=await context.newPage();await replacementPopup.goto('chrome-extension://'+MANAGED_EXTENSION_ID+'/managed-popup.html');
  const restored=await replacementPopup.evaluate(()=>chrome.runtime.sendMessage({type:'managed-state'}));assert.equal(restored.ok,true);assert.equal(restored.value.status,'running');
  assert.equal(routes.filter(u=>u.pathname.includes('/start/')).length,opens);
  assert.equal((await worker.call('state')).state.status,'running');
  // Restart the app-side worker while Chrome and its extension keep running.
  const oldBase=worker.base;
  await worker.close();worker=new ProfileWorker(dataDir,()=>{});await worker.boot();
  assert.notEqual(worker.base,oldBase);
  const resumeDeadline=Date.now()+30000;let resumed;
  while(Date.now()<resumeDeadline){resumed=await worker.call('state');if(!resumed.operation)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(resumed.operation,null);assert.equal(resumed.state.status,'running');assert.equal(resumed.engine,'extension');
  const freshPopup=await context.newPage();await freshPopup.goto('chrome-extension://'+MANAGED_EXTENSION_ID+'/managed-popup.html');
  const freshConfig=await freshPopup.evaluate(async()=>({config:(await chrome.storage.local.get('managedConfig')).managedConfig,state:await chrome.runtime.sendMessage({type:'managed-state'})}));
  assert.equal(freshConfig.config.base,worker.base);assert.equal(freshConfig.state.ok,true);assert.equal(freshConfig.state.value.status,'running');
  await freshPopup.click('#stop');
  const deadline=Date.now()+5000;while(!routes.some(u=>u.pathname.includes('/stop/'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert.equal(routes.filter(u=>u.pathname.includes('/stop/')).length,1);assert.equal((await worker.call('state')).state.status,'stopped');
  await worker.close();worker=null;
  await freshPopup.waitForFunction(()=>document.getElementById('state').textContent.includes('Không kết nối được app'),{},{timeout:10000});
  assert.equal((await new Store(dataDir).load()).value.executionMode,'extension');
 }finally{await worker?.close({force:true});await context?.close();gpm.closeAllConnections();await new Promise(r=>gpm.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('four isolated profile workers connect concurrently and replacing one extension leaves the other three connected', {timeout:120000},async()=>{
 const {Store}=await import('./store.mjs'),{ProfileWorker}=await import('./profile-manager.mjs'),{AUTO_DEFAULTS}=await import('../extension/auto-runner.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-four-')),profiles=[];
 const gpm=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost'),id=u.pathname.split('/').pop(),p=profiles.find(p=>p.id===id);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:u.pathname.includes('/start/')?{profile_id:id,remote_debugging_port:Number(p?.port)}:{id,name:id,raw_proxy:''}}));
 });await new Promise(r=>gpm.listen(0,'127.0.0.1',r));
 try{
  await Promise.all(Array.from({length:4},async(_,i)=>{
   const p={id:'fixture-'+i};profiles.push(p);p.dir=path.join(dir,p.id);
   p.context=await chromium.launchPersistentContext(path.join(dir,'chrome-'+i),{executablePath:process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome'),headless:true,args:['--enable-unsafe-extension-debugging','--remote-debugging-port=0'],ignoreDefaultArgs:['--disable-extensions']});
   [p.port]=(await fs.readFile(path.join(dir,'chrome-'+i,'DevToolsActivePort'),'utf8')).split('\n');
   const store=await new Store(p.dir).load();await store.set({settings:{profileId:p.id,profileName:p.id,gpmApi:'http://127.0.0.1:'+gpm.address().port+'/api/v1',cdp:'http://127.0.0.1:'+p.port,apiKey:'fixture-key',model:'fixture',prompt:'Fixture',proxy:'',imagesFolder:'',runConfig:AUTO_DEFAULTS}});
   p.worker=new ProfileWorker(p.dir,()=>{});assert.equal((await p.worker.call('profile-open',{useCurrentProxy:true,engine:'extension'},90000)).engine,'extension');
   p.popup=await p.context.newPage();await p.popup.goto('chrome-extension://'+MANAGED_EXTENSION_ID+'/managed-popup.html');
   p.config=await p.popup.evaluate(async()=>{const c=(await chrome.storage.local.get('managedConfig')).managedConfig;await chrome.storage.local.set({obsoleteFixture:true});return c;});
   assert.equal(p.config.base,p.worker.base);
  }));
  assert.equal(new Set(profiles.map(p=>p.config.base)).size,4);assert.equal(new Set(profiles.map(p=>p.config.token)).size,4);
  const first=profiles[0];await fs.writeFile(path.join(first.dir,'managed-extension','obsolete-fixture.js'),'obsolete');
  await first.worker.call('profile-open',{useCurrentProxy:true,engine:'extension'},90000);
  await assert.rejects(fs.access(path.join(first.dir,'managed-extension','obsolete-fixture.js')));
  first.popup=await first.context.newPage();await first.popup.goto('chrome-extension://'+MANAGED_EXTENSION_ID+'/managed-popup.html');
  assert.equal(await first.popup.evaluate(async()=>(await chrome.storage.local.get('obsoleteFixture')).obsoleteFixture),undefined);
  const rejected=await fetch(first.worker.base+'/api/extension/status',{method:'POST',headers:{'Content-Type':'application/json','X-Extension-Token':first.config.token},body:'{}'});assert.equal(rejected.status,403);
  for(const p of profiles){
   const result=await p.popup.evaluate(()=>chrome.runtime.sendMessage({type:'managed-state'}));assert.equal(result.ok,true);assert.equal(result.value.status,'idle');
   assert.ok(p.context.pages().every(page=>!page.url().includes('threads.com')));
  }
 }finally{
  await Promise.allSettled(profiles.map(async p=>{await p.worker?.close({force:true});await p.context?.close();}));gpm.closeAllConnections();await new Promise(r=>gpm.close(r));await fs.rm(dir,{recursive:true,force:true});
 }
});

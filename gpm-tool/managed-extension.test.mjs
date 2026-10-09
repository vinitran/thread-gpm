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
  const options={tabId:tab.id,followAuthor:true,followRandom:()=>0,random:()=>0,now:()=>verificationClock,wait:async ms=>{waits.push(ms);if(waitingAfterPost)verificationClock+=ms;},stepDelayMs:0,typingDelayMs:0,skipVerification:true,verifyAfterPost:true,shouldContinue:()=>true};
  const receipt=await postReply(url,'Fixture',image,m=>{events.push(m);if(m.startsWith('Đã bấm Post · đã lưu')){waitingAfterPost=true;verificationClock=Date.now();}},options);
  assert.equal(receipt.state,'posted');assert.equal(values.replyReceipts[url].state,'posted');assert.equal(receipt.comment_url,'https://www.threads.com/@me/post/fixture-reply');assert.ok(events.some(m=>m.includes('Đã xác minh bình luận: '+receipt.comment_url)));assert.equal(values.replyFollowDecisions[url].selected,true);
  assert.deepEqual(await page.evaluate(()=>[window.follows,window.posts,document.querySelector('input').files.length]),[1,1,3]);
  assert.deepEqual(await page.evaluate(()=>[window.followTrusted,window.postTrusted]),[true,true]);
  assert.ok(waits.filter(ms=>ms===1000).length>=234);assert.ok(waits.filter(ms=>ms===1000).length<=235);assert.ok(events.some(m=>m.includes('210 giây')));
  assert.equal((await postReply(url,'Fixture',image,()=>{},options)).reused,true);
  assert.deepEqual(await page.evaluate(()=>[window.follows,window.posts]),[1,1]);
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
  const popup=await context.newPage();await popup.goto('chrome-extension://'+MANAGED_EXTENSION_ID+'/managed-popup.html');await popup.waitForFunction(()=>!document.getElementById('state').textContent.includes('Đang tải'));assert.ok(!(await popup.locator('#state').innerText()).includes('Failed to fetch'));await popup.click('#stop');
  const deadline=Date.now()+5000;while(!routes.some(u=>u.pathname.includes('/stop/'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert.equal(routes.filter(u=>u.pathname.includes('/stop/')).length,1);assert.equal((await worker.call('state')).state.status,'stopped');
  await worker.close();worker=null;
  await popup.waitForFunction(()=>document.getElementById('state').textContent.includes('Không kết nối được app'),{},{timeout:10000});
  assert.equal((await new Store(dataDir).load()).value.executionMode,'extension');
 }finally{await worker?.close({force:true});await context?.close();gpm.closeAllConnections();await new Promise(r=>gpm.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

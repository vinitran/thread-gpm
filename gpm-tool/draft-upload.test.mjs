import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {GpmBrowser} from './browser.mjs';
import {postReply} from '../extension/post-reply.js';

for(const kind of ['post','reply'])test(kind+': image draft targets its own Reply and uploads only to active composer without Post', {timeout:60000}, async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoanxu-draft-'));let context,browser;
 const original=globalThis.chrome;
 try{
  context=await chromium.launchPersistentContext(dir,{executablePath:process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome'),headless:true,args:['--remote-debugging-port=0']});
  const targetPath=kind==='post'?'/@demo/post/a':'/@child/post/reply';
  let markup=`<a href="/@me" aria-label="Profile">Me</a><main><a href="/@demo/post/a"><time>now</time></a><button id="reply" aria-label="Reply">Reply</button><section id="inline"><div contenteditable="true" role="textbox"></div><input id="inline-file" type="file" accept="image/png" multiple><button id="expand" aria-label="Expand composer">Expand</button></section></main><input id="foreign-file" type="file" accept="image/png" multiple><div id="modal" role="dialog" style="display:none"><div contenteditable="true" role="textbox"></div><input id="modal-file" type="file" accept="image/png" multiple><section id="previews"></section><button id="post">Post</button></div>`;
  if(kind==='reply')markup=markup.replace('/@demo/post/a',targetPath).replace('<main>','<main><a href="/@demo/post/a"><time>parent</time></a><button id="wrong-reply" aria-label="Reply">Reply</button><article>').replace('</main>','</article></main>');
  else markup=markup.replace('</main>','<article><a href="/@child/post/reply"><time>child</time></a><button id="wrong-reply" aria-label="Reply">Reply</button></article></main>');
  await context.route('https://www.threads.com/**',r=>r.fulfill({contentType:'text/html',body:markup}));
  const page=await context.newPage();await page.goto('https://www.threads.com'+targetPath);
  await page.evaluate(kind=>{
   window.actions=[];window.postClicks=0;
   for(const id of ['reply','expand','post','wrong-reply'])document.getElementById(id).onclick=e=>{window.actions.push({id,trusted:e.isTrusted});if(id==='expand'||id==='reply'&&kind==='post'){document.getElementById('inline').style.display='none';document.getElementById('modal').style.display='block';}if(id==='post')window.postClicks++;};
   document.getElementById('modal-file').onchange=e=>{window.actions.push({id:'upload'});for(const file of e.target.files){const image=document.createElement('img');image.src=URL.createObjectURL(file);document.getElementById('previews').append(image);}};
   document.querySelector('#modal [contenteditable]').onclick=e=>window.actions.push({id:'focus',trusted:e.isTrusted});
   document.addEventListener('mousemove',e=>window.actions.push({id:'move',trusted:e.isTrusted}));
  },kind);
  const [port]=(await fs.readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n');
  const values={autoRun:{status:'running'}},store={value:values,async get(k){return {[k]:values[k]};},async set(v){Object.assign(values,v);}};
  browser=new GpmBrowser(store);await browser.connect('http://127.0.0.1:'+port);browser.installChrome();
  const tab=(await browser.query()).find(t=>t.url.endsWith(targetPath));
  const files=['first.png','app_store.png','last.png'].map(name=>({name,type:'image/png',data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aV8AAAAASUVORK5CYII='}));
  let active=true;const progress=[];
  await assert.rejects(()=>postReply(tab.url,'QA draft',{files,names:files.map(f=>f.name)},m=>{progress.push(m);if(m==='Sẵn sàng đăng…')active=false;},{tabId:tab.id,stepDelayMs:0,typingDelayMs:0,shouldContinue:()=>active}),/Đã dừng/);
  const result=await page.evaluate(()=>({posts:window.postClicks,actions:window.actions,files:[...document.querySelectorAll('input[type="file"]')].map(e=>({id:e.id,names:[...e.files].map(f=>f.name)})),images:document.querySelectorAll('#previews img').length,text:document.querySelector('#modal [contenteditable]').innerText}));
  assert.equal(result.posts,0);assert.equal(result.images,3);assert.equal(result.text,'QA draft');assert.equal(values.replyReceipts?.[tab.url],undefined);
  assert.deepEqual(result.files.find(f=>f.id==='modal-file').names,files.map(f=>f.name));
  assert.ok(result.files.filter(f=>f.id!=='modal-file').every(f=>f.names.length===0));
  assert.deepEqual(result.actions.filter(e=>e.id!=='move').map(e=>e.id),kind==='post'?['reply','focus','upload']:['reply','expand','focus','upload']);
  for(const id of kind==='post'?['reply','focus']:['reply','expand','focus']){const index=result.actions.findIndex(e=>e.id===id);assert.equal(result.actions[index].trusted,true);assert.ok(result.actions.slice(0,index).some(e=>e.id==='move'&&e.trusted));}
  assert.ok(progress.includes('Sẵn sàng đăng…'));
 }finally{globalThis.chrome=original;await browser?.browser?.close();await context?.close();await fs.rm(dir,{recursive:true,force:true});}
});

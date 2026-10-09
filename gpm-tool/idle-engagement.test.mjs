import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRunner} from './runner.mjs';
import {AUTO_DEFAULTS} from '../extension/auto-runner.js';
import {engagementPage} from './idle-engagement.mjs';

function fixture(config={}){
 let time=100000,runner;const actions=[],scheduled=[];
 const posts=Array.from({length:6},(_,i)=>({url:'https://www.threads.com/@demo/post/'+i}));
 const store={value:{autoRun:{status:'running',config:{...AUTO_DEFAULTS,idleScroll:false,...config},source:1,current:null,history:{},events:[],stats:{},queue:[],activity:{phase:'resting'},nextAt:time+180000}},async get(key){return {[key]:structuredClone(this.value[key])};},async set(patch){Object.assign(this.value,structuredClone(patch));}};
 const browser={evaluate:async(id,fn,[args])=>{
  if(args.action==='candidates')return {posts};
  assert.equal(store.value.autoRun.idleEngagementHistory[args.url].state,'attempting');
  actions.push(args.url);return {like:'clicked'};
 }};
 const reopen=async()=>{runner?.dispose();runner=createRunner(store,browser);runner.d.now=()=>time;runner.d.random=()=>0;runner.d.schedule=async at=>scheduled.push(at);await runner.load();return runner;};
 return {store,posts,actions,scheduled,reopen,get runner(){return runner;},at(value){time=value;},now:()=>time};
}

test('idle engagement is limited to a random quota with distinct posts, random gaps and persisted windows',async()=>{
 const f=fixture();await f.reopen();await f.runner.scheduleNext();assert.equal(f.scheduled.at(-1),f.now()+20000);
 for(let i=0;i<2;i++){
  f.at(f.runner.state.engagementWait.nextAt);if(i===0)f.runner.d.random=()=>1-Number.EPSILON;
  await f.runner.tick();assert.equal(f.actions.length,i+1);assert.equal(f.runner.state.engagementWait.nextAt,f.now()+(i===0?45000:20000));
  if(i===0)await f.reopen();
 }
 f.at(f.now()+20000);await f.runner.tick();assert.equal(f.actions.length,2);assert.equal(new Set(f.actions).size,2);assert.equal(f.scheduled.at(-1),f.runner.state.nextAt);
 f.runner.state.nextAt=f.now()+180000;await f.runner.scheduleNext();f.at(f.runner.state.engagementWait.nextAt);await f.runner.tick();assert.equal(f.actions.length,3);assert.equal(new Set(f.actions).size,3);
 f.runner.dispose();
});

test('disabled engagement, short waits, posting and three-hour rest perform no interactions',async()=>{
 for(const mode of ['disabled','short','posting','session-rest']){
  const f=fixture(mode==='disabled'?{idleEngagement:false}:{});await f.reopen();
  if(mode==='short')f.runner.state.nextAt=f.now()+4000;
  if(mode==='posting')f.runner.state.current={phase:'posting'};
  if(mode==='session-rest')f.runner.state.sessionRest={until:f.now()+10800000};
  await f.runner.scheduleNext();await f.runner.idle();assert.equal(f.actions.length,0);f.runner.dispose();
 }
});

test('Stop after candidate lookup prevents clicks and an interrupted receipt is never repeated',async()=>{
 const f=fixture();await f.reopen();await f.runner.scheduleNext();f.at(f.runner.state.engagementWait.nextAt);
 f.runner.d.idleCandidates=async()=>{await f.runner.stop();return {posts:f.posts};};
 await f.runner.tick();assert.equal(f.actions.length,0);assert.equal(f.store.value.autoRun.status,'stopped');f.runner.dispose();
 const g=fixture();await g.reopen();g.runner.state.idleEngagementHistory={[g.posts[0].url]:{state:'attempting'}};
 await g.runner.scheduleNext();g.at(g.runner.state.engagementWait.nextAt);await g.runner.tick();assert.ok(!g.actions.includes(g.posts[0].url));g.runner.dispose();
});

const markup=`<a href="/@me" aria-label="Profile">Me</a><main id="card"><a href="/@demo/post/a"><time>now</time></a><button aria-label="Reply">Reply</button><button id="like" aria-label="Like">Like</button><button id="repost" aria-label="Repost">Repost</button></main>`;
test('real DOM only clicks Like and never opens Repost; skips liked posts, drafts and Stop',async()=>{
 const executablePath=process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome');
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:markup}));await page.goto('https://www.threads.com/');
  const setup=async()=>{await page.setContent(markup);await page.evaluate(()=>{
   window.fixtureStatus='running';window.likes=0;window.reposts=0;window.quotes=0;
   window.chrome??={};window.chrome.storage={local:{get:async()=>({autoRun:{status:window.fixtureStatus}})}};
   document.getElementById('like').onclick=e=>{window.likes++;e.currentTarget.setAttribute('aria-label','Unlike');};
   document.getElementById('repost').onclick=()=>{const menu=document.createElement('div');menu.role='menu';const quote=document.createElement('button');quote.textContent='Quote';quote.onclick=()=>window.quotes++;const confirm=document.createElement('button');confirm.role='menuitem';confirm.textContent='Repost';confirm.onclick=()=>{window.reposts++;document.getElementById('repost').setAttribute('aria-label','Undo repost');menu.remove();};menu.append(quote,confirm);document.body.append(menu);};
  });};
  await setup();assert.equal((await page.evaluate(engagementPage,{action:'candidates'})).posts.length,1);
  assert.deepEqual(await page.evaluate(engagementPage,{action:'engage',url:'https://www.threads.com/@demo/post/a'}),{url:'https://www.threads.com/@demo/post/a',like:'clicked'});
  assert.deepEqual(await page.evaluate(()=>[window.likes,window.reposts,window.quotes]),[1,0,0]);
  assert.equal((await page.evaluate(engagementPage,{action:'candidates'})).posts.length,0);
  await page.evaluate(engagementPage,{action:'engage',url:'https://www.threads.com/@demo/post/a'});assert.deepEqual(await page.evaluate(()=>[window.likes,window.reposts]),[1,0]);
  await setup();await page.evaluate(()=>{document.getElementById('like').onclick=()=>{window.likes++;window.fixtureStatus='stopped';};});
  assert.equal((await page.evaluate(engagementPage,{action:'engage',url:'https://www.threads.com/@demo/post/a'})).stopped,true);assert.deepEqual(await page.evaluate(()=>[window.likes,window.reposts]),[1,0]);
  await setup();await page.evaluate(()=>{const draft=document.createElement('textarea');draft.value='Nháp';document.body.append(draft);});assert.equal((await page.evaluate(engagementPage,{action:'candidates'})).posts.length,0);
  await setup();await page.evaluate(()=>document.querySelector('#card a').href='/@me/post/a');assert.equal((await page.evaluate(engagementPage,{action:'candidates'})).posts.length,0);
  await setup();await page.evaluate(engagementPage,{action:'engage',url:'https://www.threads.com/@demo/post/a',until:Date.now()-1000});assert.deepEqual(await page.evaluate(()=>[window.likes,window.reposts]),[0,0]);
 }finally{await browser.close();}
});

test('Stop interrupts a pacing delay before any click and short wait budgets do not open a popup',async()=>{
 const executablePath=process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome');const browser=await chromium.launch({executablePath,headless:true});
 try{const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:markup}));await page.goto('https://www.threads.com/');await page.evaluate(()=>{window.clicks=0;window.fixtureStatus='running';window.chrome??={};window.chrome.storage={local:{get:async()=>({autoRun:{status:window.fixtureStatus}})}};document.querySelectorAll('button').forEach(b=>b.onclick=()=>window.clicks++);});
 const short=await page.evaluate(engagementPage,{action:'engage',url:'https://www.threads.com/@demo/post/a',until:Date.now()+5000});assert.match(short.skipped,/Không đủ thời gian/);assert.equal(await page.evaluate(()=>window.clicks),0);
 await page.evaluate(()=>setTimeout(()=>window.fixtureStatus='stopped',100));const start=Date.now();const stopped=await page.evaluate(engagementPage,{action:'engage',url:'https://www.threads.com/@demo/post/a'});assert.equal(stopped.stopped,true);assert.equal(await page.evaluate(()=>window.clicks),0);assert.ok(Date.now()-start<1500);
 }finally{await browser.close();}
});


test('each wait randomly chooses 2 to 5 posts and preserves quota after reload',async()=>{
 for(const [random,limit] of [[0,2],[0.25,3],[0.5,4],[0.999,5]]){
  const f=fixture();await f.reopen();f.runner.d.random=()=>random;await f.runner.scheduleNext();
  assert.equal(f.runner.state.engagementWait.limit,limit);
  await f.reopen();await f.runner.scheduleNext();assert.equal(f.runner.state.engagementWait.limit,limit);
  f.runner.state.nextAt=f.now()+200000;f.runner.d.random=()=>0;await f.runner.scheduleNext();assert.equal(f.runner.state.engagementWait.limit,2);f.runner.dispose();
 }
});

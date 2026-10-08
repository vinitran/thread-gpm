import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RandomReload,randomDelay} from './extension/random-reload.js';
import {extractPosts} from './extension/extract.js';
let listener,hold=null,injections=0,reloads=0,hasDraft=false;
const store={};
globalThis.chrome={
  runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}},getURL:p=>'chrome-extension://test/'+p},
  storage:{local:{async get(){return structuredClone(store);},async set(v){Object.assign(store,structuredClone(v));}}},
  tabs:{async query(){return [{id:1,url:'https://www.threads.com/',title:'Threads',active:true}];},async get(id){return {id,url:id===9?'https://example.com/':'https://www.threads.com/',status:'complete'};},async reload(){reloads++;},async update(id){return {id};},async create(){return {id:2};}},
  scripting:{async executeScript(input){if(input.func!==extractPosts)return [{result:hasDraft}];injections++;if(hold)await hold;return [{result:{source_url:'https://www.threads.com/',captured_at:new Date().toISOString(),count:1,posts:[{text:'demo'}],warnings:[]}}];}}
};
await import('./extension/background.js');
const send=m=>new Promise(resolve=>listener(m,{id:'test'},resolve));
test('posting enables debugger but still needs no local bridge',async()=>{
  const manifest=JSON.parse(await readFile(new URL('./extension/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.permissions,['storage','scripting','debugger','alarms']);
  assert.ok(manifest.host_permissions.includes('https://www.threads.com/*'));
  assert.ok(manifest.host_permissions.includes('https://ai.hoanxu.com/*'));
  assert.ok(!manifest.host_permissions.some(p=>p.includes('127.0.0.1')));
});
test('UI lists Threads tabs and reads data without MCP',async()=>{
  assert.equal((await send({type:'tabs'})).tabs[0].url,'https://www.threads.com/');
  const r=await send({type:'capture',tabId:1,mode:'feed',limit:20});
  assert.equal(r.ok,true);assert.equal(r.data.count,1);assert.equal(store.lastCapture.posts[0].text,'demo');
});
test('non-Threads tabs and invalid limits are rejected before injection',async()=>{
  const n=injections;
  for(const args of [{tabId:9,mode:'feed',limit:20},{tabId:1,mode:'feed',limit:101},{tabId:1,mode:'comment',limit:20}])assert.equal((await send({type:'capture',...args})).ok,false);
  assert.equal(injections,n);
});
test('post mode requires opening an exact post, and comment is unsupported',async()=>{
  assert.equal((await send({type:'capture',tabId:1,mode:'post',limit:20})).ok,false);
  assert.equal((await send({type:'comment',text:'x'})).ok,false);
});
test('concurrent capture is rejected',async()=>{
  let release;hold=new Promise(r=>{release=r;});const one=send({type:'capture',tabId:1,mode:'feed',limit:20});
  await new Promise(r=>setTimeout(r,10));const two=await send({type:'capture',tabId:1,mode:'feed',limit:20});
  assert.equal(two.ok,false);hold=null;release();assert.equal((await one).ok,true);
});
function fixture(){
  const vis={getClientRects:()=>[{}]};
  const body={};
  const time={getAttribute:k=>k==='datetime'?'2026-10-06T00:00:00Z':null};
  const caption={...vis,innerText:'hello mom\nTranslate',closest:()=>null,querySelector:()=>null,contains:()=>false};
  const button=(label,text)=>({...vis,innerText:text,getAttribute:()=>null,querySelector:s=>s==='svg title'?{textContent:label}:null});
  const image=(src,alt,width=300)=>({...vis,src,currentSrc:src,alt,width,height:300,naturalWidth:600,naturalHeight:600,getAttribute:()=>null});
  const root={...vis,parentElement:body,querySelectorAll:s=>s==='button,[role="button"]'?[button('Unlike','1.2K'),button('Reply','3')]:s==='[dir="auto"]'?[caption]:s==='img'?[image('https://cdn.example/image.jpg','photo'),image('https://cdn.example/image.jpg','same'),image('https://cdn.example/avatar.jpg',"demo's profile picture")]:[]};
  const anchor={...vis,href:'https://www.threads.com/@demo/post/abc',parentElement:root,querySelector:s=>s==='time'?time:null};
  globalThis.location={href:anchor.href};globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.document={body,querySelectorAll:()=>[anchor,anchor]};
}
test('extract caption, exact URL, timestamp, image source and displayed counts from DOM fixture',()=>{
  fixture();const data=extractPosts({limit:20,mode:'feed'});
  assert.equal(data.count,1);const p=data.posts[0];
  assert.equal(p.text,'hello mom');assert.equal(p.author,'demo');assert.equal(p.id,'abc');assert.equal(p.published_at,'2026-10-06T00:00:00Z');
  assert.equal(p.images.length,1);assert.equal(p.images[0].src,'https://cdn.example/image.jpg');
  assert.equal(p.counts.likes,'1.2K');assert.equal(p.counts.shares,null);
});
test('exact-post mode excludes other loaded posts',()=>{
  fixture();globalThis.location.href='https://www.threads.com/@other/post/xyz';
  assert.equal(extractPosts({mode:'post'}).count,0);
});

test('reload waits for load and captures; drafts block reload',async()=>{
  const before=reloads;
  const r=await send({type:'reload-capture',tabId:1,mode:'feed',limit:20});
  assert.equal(r.ok,true);assert.equal(reloads,before+1);assert.equal(r.data.count,1);
  hasDraft=true;
  const blocked=await send({type:'reload-capture',tabId:1,mode:'feed',limit:20});
  assert.equal(blocked.ok,false);assert.equal(reloads,before+1);hasDraft=false;
});
test('random delay is inclusive and rejects invalid ranges',()=>{
  assert.equal(randomDelay(30,90,()=>0),30000);
  assert.equal(randomDelay(30,90,()=>.99999),90000);
  for(const pair of [[0,10],[90,30],[30,4000],[5.5,10]])assert.throws(()=>randomDelay(...pair));
});
test('random scheduler never queues a new reload until capture finishes and stop prevents rearming',async()=>{
  const queued=new Map();let id=0,release,runs=0;
  const scheduler=new RandomReload({timer:fn=>{queued.set(++id,fn);return id;},clear:id=>queued.delete(id),now:()=>0});
  scheduler.start(5,5,async()=>{runs++;await new Promise(r=>{release=r;});});
  assert.equal(queued.size,1);
  const [key,fn]=[...queued][0];queued.delete(key);const running=fn();
  assert.equal(runs,1);assert.equal(queued.size,0);
  scheduler.stop();release();await running;assert.equal(queued.size,0);assert.equal(scheduler.active,false);
});
test('random scheduler stops when reading fails',async()=>{
  let fn;const states=[];
  const scheduler=new RandomReload({timer:f=>{fn=f;return 1;},clear:()=>{},onState:s=>states.push(s)});
  scheduler.start(5,5,async()=>{throw Error('tab closed');});await fn();
  assert.equal(scheduler.active,false);assert.equal(states.at(-1).error,'tab closed');
});
test('default browser timers retain their global receiver (Illegal invocation regression)',()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  let scheduled=0,cleared=0;
  globalThis.setTimeout=function(){if(this!==globalThis)throw TypeError('Illegal invocation');scheduled++;return 77;};
  globalThis.clearTimeout=function(){if(this!==globalThis)throw TypeError('Illegal invocation');cleared++;};
  try{
    const scheduler=new RandomReload();scheduler.start(5,5,async()=>{});
    assert.equal(scheduled,1);assert.equal(scheduler.active,true);
    scheduler.stop();assert.equal(scheduler.active,false);assert.equal(cleared,2);
  }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
test('AI settings keep key private and unchanged posts reuse stored response',async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async(url,options)=>{requests++;assert.equal(JSON.parse(options.body).messages[0].content,'Exact prompt fixture');return {ok:true,json:async()=>({choices:[{message:{content:'response fixture'}}]})};};
  try{
    assert.equal((await send({type:'save-ai-settings',apiKey:'test-secret',model:'cx/gpt-5.6-luna',prompt:'Exact prompt fixture'})).ok,true);
    const settings=await send({type:'get-ai-settings'});
    assert.equal(settings.settings.hasKey,true);assert.ok(!JSON.stringify(settings).includes('test-secret'));
    const post={url:'https://www.threads.com/@demo/post/abc',text:'Bài fixture',images:[]};
    const first=await send({type:'generate-response',post});assert.equal(first.ok,true);assert.equal(first.result.text,'response fixture');
    const again=await send({type:'generate-response',post});assert.equal(again.result.cached,true);assert.equal(requests,1);
    assert.ok(!JSON.stringify(first).includes('test-secret'));
  }finally{globalThis.fetch=original;}
});

 test('default key and prompt work without saving config; key stays out of UI payloads',{skip:!(await import('./extension/ai-defaults.js')).DEFAULT_API_KEY},async()=>{
  const previous=store.aiSettings,original=globalThis.fetch;
  delete store.aiSettings;
  const {DEFAULT_API_KEY}=await import('./extension/ai-defaults.js');
  let calls=0;
  globalThis.fetch=async(url,options)=>{
    if(url.startsWith('chrome-extension://'))return {ok:true,text:async()=> 'Default prompt fixture'};
    calls++;
    assert.equal(options.headers.Authorization,'Bearer '+DEFAULT_API_KEY);
    assert.equal(JSON.parse(options.body).messages[0].content,'Default prompt fixture');
    return {ok:true,json:async()=>({choices:[{message:{content:'Default response'}}]})};
  };
  try{
    const settings=await send({type:'get-ai-settings'});
    assert.equal(settings.settings.hasKey,true);
    assert.equal(settings.settings.usingDefaultKey,true);
    assert.ok(!JSON.stringify(settings).includes(DEFAULT_API_KEY));
    const result=await send({type:'generate-response',post:{url:'https://www.threads.com/@demo/post/default',text:'Default test',images:[]}});
    assert.equal(result.ok,true);assert.equal(result.result.text,'Default response');assert.equal(calls,1);
  }finally{globalThis.fetch=original;if(previous)store.aiSettings=previous;else delete store.aiSettings;}
});

test('exclude processed URLs before batch limit so appended posts can be captured',()=>{
 fixture();const old=document.querySelectorAll()[0];const next={...old,href:'https://www.threads.com/@fresh/post/new'};
 globalThis.document.querySelectorAll=()=>[old,next];
 const result=extractPosts({limit:1,excludeURLs:[old.href]});assert.equal(result.posts[0].url,next.href);
});

test('user prompt update replaces legacy saved prompt once and preserves key/model',async()=>{
 const previous=store.aiSettings,original=globalThis.fetch;let loads=0;
 store.aiSettings={apiKey:'private-fixture',model:'cx/gpt-5.6-luna',prompt:'Legacy conflicting prompt'};
 globalThis.fetch=async()=>{loads++;return {ok:true,text:async()=> 'Updated user prompt with confirmed experience'};};
 try{
  const first=await send({type:'get-ai-settings'});assert.equal(first.settings.prompt,'Updated user prompt with confirmed experience');assert.equal(store.aiSettings.apiKey,'private-fixture');
  await send({type:'get-ai-settings'});assert.equal(loads,1);
  await send({type:'save-ai-settings',model:'cx/gpt-5.6-luna',prompt:'User later edit'});const edited=await send({type:'get-ai-settings'});assert.equal(edited.settings.prompt,'User later edit');assert.equal(loads,1);
 }finally{globalThis.fetch=original;store.aiSettings=previous;}
});

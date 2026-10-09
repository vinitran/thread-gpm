import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=(await fs.readFile(new URL('../extension/managed/managed-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const config=port=>({base:'http://127.0.0.1:'+port,token:'a'.repeat(64)});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function worker(fetcher){
 const startup=deferred(),data={},calls=[];let listener;
 const chrome={debugger:{onDetach:{addListener(){}},attach:async()=>{},sendCommand:async()=>{}},runtime:{id:'fixture',onMessage:{addListener(fn){listener=fn;}},getPlatformInfo:async()=>({})},alarms:{create(){},onAlarm:{addListener(){}}},storage:{local:{get:()=>startup.promise,set:async patch=>Object.assign(data,patch)}},tabs:{create:async options=>{calls.push(options);return {id:1,status:'complete'};},get:async()=>({id:1,status:'complete'})}};
 vm.runInNewContext(source,{chrome,fetch:fetcher,AbortSignal,Error,setInterval(){},setTimeout(){},autoPage(){},extractPosts(){},replyAction(){},engagementPage(){},pointerTarget(){}});
 const message=body=>new Promise(resolve=>listener(body,{id:'fixture'},resolve));
 return {startup,data,calls,message,chrome};
}
test('slow startup storage read cannot overwrite configuration accepted from the app',async()=>{
 const urls=[],w=worker(async url=>{urls.push(url);if(url.endsWith('/poll'))return new Promise(()=>{});return Response.json({status:'running'});});
 assert.equal((await w.message({type:'configure-managed',config:config(50002)})).ok,true);
 w.startup.resolve({managedConfig:config(50001)});await flush();urls.length=0;
 assert.equal((await w.message({type:'managed-state'})).ok,true);
 assert.equal(urls[0],config(50002).base+'/api/extension/status');
});
test('a late poll from the old connection cannot execute a browser action after reconfiguration',async()=>{
 const oldPoll=deferred(),w=worker(async url=>{
  if(url===config(50001).base+'/api/extension/poll')return oldPoll.promise;
  if(url.endsWith('/poll'))return new Promise(()=>{});
  return Response.json({status:'running'});
 });
 w.startup.resolve({managedConfig:config(50001)});await flush();
 assert.equal((await w.message({type:'configure-managed',config:config(50002)})).ok,true);
 oldPoll.resolve(Response.json({status:'running',job:{id:'old',method:'tabs.create',args:{options:{url:'https://www.threads.com/'}}}}));await flush();
 assert.deepEqual(w.calls,[]);
});
test('an unavailable app cannot produce a successful configure acknowledgement',async()=>{
 const w=worker(async()=>{throw Error('Connection refused');});w.startup.resolve({});await flush();
 const result=await w.message({type:'configure-managed',config:config(49599)});
 assert.equal(result.ok,false);assert.match(result.error,/49599/);assert.equal(w.data.autoRun.status,'disconnected');assert.deepEqual(w.calls,[]);
});

test('a status response from the old app cannot overwrite the new running state',async()=>{
 const oldStatus=deferred(),w=worker(async url=>{
  if(url.endsWith('/poll'))return new Promise(()=>{});
  if(url.startsWith(config(50001).base))return oldStatus.promise;
  return Response.json({status:'running'});
 });
 w.startup.resolve({managedConfig:config(50001)});await flush();
 assert.equal((await w.message({type:'configure-managed',config:config(50002)})).ok,true);assert.equal(w.data.autoRun.status,'running');
 oldStatus.resolve(Response.json({status:'stopped'}));await flush();assert.equal(w.data.autoRun.status,'running');
});

test('an action already dispatched reports its result only to its original connection and is never replayed',async()=>{
 const action=deferred(),urls=[];let first=true;
 const w=worker(async url=>{
  urls.push(url);
  if(url.endsWith('/poll')){
   if(first){first=false;return Response.json({status:'running',job:{id:'dispatched',method:'tabs.create',args:{options:{url:'about:blank'}}}});}
   return new Promise(()=>{});
  }
  return Response.json({status:'running'});
 });
 w.chrome.tabs.create=async options=>{w.calls.push(options);return action.promise;};
 w.startup.resolve({managedConfig:config(50001)});await flush();assert.equal(w.calls.length,1);
 assert.equal((await w.message({type:'configure-managed',config:config(50002)})).ok,true);
 action.resolve({id:1,status:'complete'});await flush();
 assert.deepEqual(urls.filter(url=>url.endsWith('/result')),[config(50001).base+'/api/extension/result']);assert.equal(w.calls.length,1);
});

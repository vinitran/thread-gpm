import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from './store.mjs';import {ProfileManager} from './profile-manager.mjs';import {AUTO_DEFAULTS} from '../extension/auto-runner.js';
const settings=id=>({profileId:id,profileName:id.toUpperCase(),proxy:'',cdp:'http://localhost:9222',gpmApi:'http://localhost:9495',prompt:'Prompt',model:'m',apiKey:'test-key',runConfig:AUTO_DEFAULTS});
function fakeFactory(calls){return (dir,onView)=>({boot:async()=>{},close:async()=>{},call:async(route,input)=>{
 const store=await new Store(dir).load();const id=path.basename(dir);calls.push({id,route,input});
 if(route==='settings'){await store.set({settings:input});return {ok:true};}
 if(route==='profile-open')return {ok:true,profileName:id.toUpperCase(),cdp:'http://localhost:9222'};
 if(route==='start'){await new Promise(r=>setTimeout(r,20));await store.set({autoRun:{status:'running',stats:{sent:id==='a'?25:2},sessionRest:id==='a'?{until:Date.now()+10800000}:null},replyReceipts:{['same-post']:{state:'sent_unverified',created_at:new Date().toISOString(),post_url:'https://www.threads.com/@x/post/shared'}}});}
 if(route==='stop')await store.set({autoRun:{...store.value.autoRun,status:'stopped'}});
 const {dashboard}=await import('./dashboard.mjs');const view=dashboard(store.value,true);onView(view);return {...view,ok:true};
 }});}
test('two profiles run concurrently with independent session counts, receipts and Stop',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-profiles-'));const store=await new Store(dir).load();const calls=[];const manager=new ProfileManager(store,{workerFactory:fakeFactory(calls)});
 try{await manager.register(settings('a'));await manager.register({...settings('b'),proxy:'host:80:user:pass'});await manager.init();
 const result=await manager.batch('start',['a','b']);assert.ok(result.results.every(r=>r.ok));
 const a=manager.rows().find(r=>r.id==='a'),b=manager.rows().find(r=>r.id==='b');assert.equal(a.view.counts.session,25);assert.equal(b.view.counts.session,2);assert.ok(a.view.state.sessionRest);assert.equal(b.view.state.sessionRest,null);assert.equal(b.proxy,'host:80:user:pass');
 assert.equal(Object.keys((await manager.history('a')).receipts).length,1);assert.equal(Object.keys((await manager.history('b')).receipts).length,1);
 await manager.stop('a');assert.equal(manager.views.get('a').state.status,'stopped');assert.equal(manager.views.get('b').state.status,'running');
 const before=calls.filter(c=>c.route==='start').length;await manager.start('b');assert.equal(calls.filter(c=>c.route==='start').length,before);
 const reopened=new ProfileManager(await new Store(dir).load(),{workerFactory:fakeFactory([])});await reopened.init();assert.equal(reopened.views.get('a').counts.session,25);assert.equal(reopened.views.get('b').counts.session,2);
 }finally{await manager.close();await store.pending;await fs.rm(dir,{recursive:true,force:true});}
});
test('legacy data migrates once to its own profile without being assigned to another profile',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-migration-'));const store=await new Store(dir).load();
 try{await store.set({settings:settings('old'),autoRun:{status:'stopped',stats:{sent:2}},replyReceipts:{original:{state:'sent_unverified',created_at:new Date().toISOString()}}});const manager=new ProfileManager(store,{workerFactory:fakeFactory([])});await manager.init();await manager.register(settings('new'));assert.equal((await manager.history('old')).state.stats.sent,2);assert.equal(Object.keys((await manager.history('new')).receipts).length,0);
 await store.set({replyReceipts:{wrong:{}}});await manager.init();assert.ok((await manager.history('old')).receipts.original);assert.equal((await manager.history('old')).receipts.wrong,undefined);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Stop during profile opening cancels pending Start without affecting another profile',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-profile-stop-'));const store=await new Store(dir).load();let release,opened;const opening=new Promise(r=>opened=r);let starts=0;
 const factory=(dir,onView)=>({boot:async()=>{},close:async()=>{},call:async(route)=>{if(route==='state')return {state:{status:'idle'}};if(route==='profile-open'){opened();await new Promise(r=>release=r);}if(route==='start')starts++;return {ok:true};}});
 try{const manager=new ProfileManager(store,{workerFactory:factory,gpmFactory:()=>({call:async()=>null})});await manager.register(settings('a'));const start=manager.start('a');await opening;await manager.stop('a');release();assert.equal((await start).cancelled,true);assert.equal(starts,0);await assert.rejects(()=>manager.batch('start',['../escape']));}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('real child workers keep separate data and controls across processes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-real-workers-'));const store=await new Store(dir).load();const manager=new ProfileManager(store);
 try{
  for(const [id,sent] of [['a',4],['b',7]]){await manager.register(settings(id));const data=await manager.profileStore(id);await data.set({autoRun:{status:'stopped',stats:{sent},events:[]}});}
  await manager.init();const [a,b]=await Promise.all(['a','b'].map(id=>manager.worker(id).call('state')));
  assert.equal(a.counts.session,4);assert.equal(b.counts.session,7);assert.notEqual(manager.worker('a').child.pid,manager.worker('b').child.pid);assert.notEqual(manager.worker('a').base,manager.worker('b').base);
  for(const view of [a,b])for(const key of ['token','settings','assets','defaults'])assert.equal(key in view,false);
  await manager.stop('a');assert.equal((await manager.worker('b').call('state')).counts.session,7);
  assert.equal('token' in manager.views.get('a'),false);assert.equal('settings' in manager.views.get('a'),false);
 }finally{await manager.close();await store.pending;await fs.rm(dir,{recursive:true,force:true});}
});

test('closing one profile stops its runner and browser without affecting other profiles or history',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-close-profile-')),store=await new Store(dir).load(),calls=[],gpmCalls=[];
 const manager=new ProfileManager(store,{workerFactory:fakeFactory(calls),gpmFactory:()=>({call:async route=>gpmCalls.push(route)})});
 try{await manager.register(settings('a'));await manager.register(settings('b'));await manager.init();await manager.batch('start',['a','b']);const result=await manager.batch('close',['a']);assert.deepEqual(result.results,[{id:'a',ok:true}]);
 assert.deepEqual(gpmCalls,['/profiles/stop/a']);assert.equal(manager.workers.has('a'),false);assert.equal(manager.views.get('a').state.status,'stopped');assert.equal(manager.views.get('b').state.status,'running');assert.equal(manager.views.get('a').connected,false);assert.ok(Object.keys((await manager.history('a')).receipts).length);
 }finally{await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('GPM metadata stays live in memory, stale/deleted states are explicit and polling never opens profiles',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-live-')),store=await new Store(dir).load();let remote=[{id:'a',name:'Tên GPM',proxy:'live:80',groupId:'group'}],failed=false,calls=0;
 const manager=new ProfileManager(store,{workerFactory:fakeFactory([]),gpmFactory:()=>({list:async options=>{calls++;assert.equal(options.metadata,true);if(failed)throw Error('offline');return remote;}})});
 try{await manager.register(settings('a'));store.value.profileRegistry.a.view={token:'legacy-secret',connected:true};await store.set({profileRegistry:store.value.profileRegistry});await manager.init();assert.equal('view' in store.value.profileRegistry.a,false);
 await Promise.all([manager.syncLive(),manager.syncLive()]);assert.equal(calls,1);assert.equal(manager.rows()[0].name,'Tên GPM');assert.equal(manager.rows()[0].proxy,'live:80');assert.equal(manager.rows()[0].gpm.fresh,true);assert.equal(store.value.profileRegistry.a.name,'A');assert.equal(store.value.profileRegistry.a.proxy,'');
 remote=[{id:'a',name:'Đổi ngoài GPM',proxy:''}];await manager.syncLive();assert.equal(manager.rows()[0].name,'Đổi ngoài GPM');assert.equal(manager.rows()[0].proxy,'');
 failed=true;await manager.syncLive();assert.equal(manager.rows()[0].gpm.fresh,false);assert.equal(manager.rows()[0].gpm.status,'unavailable');assert.equal(manager.rows()[0].name,'Đổi ngoài GPM');
 failed=false;remote=[];await manager.syncLive();assert.equal(manager.rows()[0].gpm.status,'missing');assert.equal(manager.rows().length,1);assert.ok((await manager.history('a')).receipts);
 }finally{await manager.close();await store.pending;await fs.rm(dir,{recursive:true,force:true});}
});
test('fresh GPM settings override cached proxy only at explicit open, keeping tool configuration',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-current-')),store=await new Store(dir).load(),routes=[];
 const manager=new ProfileManager(store,{gpmFactory:()=>({call:async route=>{routes.push(route);return {id:'a',name:'Live A',raw_proxy:'new:80'};}})});
 try{const result=await manager.currentSettings(settings('a'));assert.equal(result.proxy,'new:80');assert.equal(result.profileName,'Live A');assert.equal(result.apiKey,'test-key');assert.deepEqual(routes,['/profiles/a']);}finally{await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('Stop dispatches to GPM before worker RPC or disk access, despite busy state and locks',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-stop-first-')),store=await new Store(dir).load(),order=[];
 await store.set({settings:{gpmApi:'http://localhost:9495'}});const manager=new ProfileManager(store,{gpmFactory:base=>({call:async route=>{order.push('gpm:'+route);assert.equal(base,'http://localhost:9555');}})});manager.endpoints.set('a','http://localhost:9555');manager.locks.set('a',true);manager.views.set('a',{connected:true,state:{status:'running',current:{phase:'posting'}}});manager.workers.set('a',{call:async()=>{order.push('worker-stop');await new Promise(()=>{});},close:async options=>{order.push('worker-close');assert.equal(options.force,true);}});manager.profileStore=async()=>{order.push('disk');throw Error('database unavailable');};
 try{const pending=manager.closeProfile('a');assert.equal(order[0],'gpm:/profiles/stop/a');const result=await pending;assert.equal(result.ok,true);assert.match(result.warning,/chưa lưu/);assert.equal(manager.views.get('a').state.status,'stopped');assert.equal(manager.workers.has('a'),false);assert.ok(order.indexOf('disk')>order.indexOf('gpm:/profiles/stop/a'));}finally{manager.locks.clear();await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('Stop accepts an unregistered ID, retries the GPM call on each press and reports GPM failures',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-stop-unknown-')),store=await new Store(dir).load(),calls=[];let failed=false;
 const manager=new ProfileManager(store,{gpmFactory:()=>({call:async route=>{calls.push(route);if(failed)throw Error('GPM offline');}})});manager.profileStore=async()=>{throw Error('No database');};
 try{await manager.closeProfile('unknown');await manager.closeProfile('unknown');assert.deepEqual(calls,['/profiles/stop/unknown','/profiles/stop/unknown']);failed=true;await assert.rejects(()=>manager.closeProfile('unknown'),/GPM offline/);const result=await manager.batch('close',['unknown']);assert.equal(result.results[0].ok,false);assert.equal(result.results[0].error,'GPM offline');assert.equal(calls.length,4);assert.equal(manager.stoppingProfiles.size,0);}finally{await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('Stop during an outstanding GPM open sends stop immediately and again after the cancelled open resolves',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-stop-open-')),store=await new Store(dir).load(),gpmCalls=[];let release,opened;const opening=new Promise(r=>opened=r);let starts=0;
 const factory=()=>({boot:async()=>{},close:async()=>{},call:async route=>{if(route==='state')return {state:{status:'idle'}};if(route==='profile-open'){opened();await new Promise(r=>release=r);}if(route==='start')starts++;return {ok:true};}});
 const manager=new ProfileManager(store,{workerFactory:factory,gpmFactory:()=>({call:async route=>gpmCalls.push(route)})});
 try{await manager.register(settings('a'));const start=manager.start('a');await opening;const stop=manager.closeProfile('a');assert.deepEqual(gpmCalls,['/profiles/stop/a']);await stop;release();assert.equal((await start).cancelled,true);assert.equal(starts,0);assert.deepEqual(gpmCalls,['/profiles/stop/a','/profiles/stop/a']);assert.equal((await manager.profileStore('a')).value.autoRun?.status,'stopped');assert.equal(manager.views.get('a').connected,false);}finally{await manager.close();await store.pending;await fs.rm(dir,{recursive:true,force:true});}
});

test('direct Stop ends a real worker and persists stopped checkpoint without restarting it',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-direct-real-')),store=await new Store(dir).load(),calls=[];const manager=new ProfileManager(store,{gpmFactory:()=>({call:async route=>calls.push(route)})});
 try{await manager.register(settings('a'));const data=await manager.profileStore('a');await data.set({autoRun:{status:'stopped',stats:{sent:7}},replyReceipts:{keep:{state:'sent_unverified'}}});const worker=manager.worker('a');await worker.call('state');const child=worker.child;const result=await manager.closeProfile('a');assert.equal(result.ok,true);assert.equal(result.warning,undefined);assert.deepEqual(calls,['/profiles/stop/a']);assert.equal(manager.workers.has('a'),false);assert.ok(child.exitCode!==null||child.signalCode!==null);const saved=await manager.profileStore('a');assert.equal(saved.value.autoRun.status,'stopped');assert.equal(saved.value.autoRun.stats.sent,7);assert.ok(saved.value.replyReceipts.keep);
 }finally{await manager.close();await store.pending;await fs.rm(dir,{recursive:true,force:true});}
});

test('live settings update an existing worker without start or overwriting history; idle save does not boot a worker',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-live-settings-'));const store=await new Store(dir).load();const calls=[];const manager=new ProfileManager(store,{workerFactory:fakeFactory(calls)});
 try{await manager.register(settings('a'));await manager.updateSettings({...settings('a'),prompt:'Idle saved'});assert.equal(manager.workers.size,0);assert.equal((await manager.profileStore('a')).value.settings.prompt,'Idle saved');await manager.start('a');const starts=calls.filter(c=>c.route==='start').length;
 await manager.updateSettings({...settings('a'),prompt:'Live prompt',runConfig:{...AUTO_DEFAULTS,typingDelayMs:85}});assert.equal(calls.filter(c=>c.route==='start').length,starts);const data=await manager.profileStore('a');assert.equal(data.value.settings.prompt,'Live prompt');assert.equal(data.value.autoRun.status,'running');assert.ok(data.value.replyReceipts['same-post']);
 }finally{await manager.close();await store.pending;await fs.rm(dir,{recursive:true,force:true});}
});

test('shared settings switch every profile to the selected model in both directions and preserve profile data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-shared-')),store=await new Store(dir).load(),calls=[];
 const manager=new ProfileManager(store,{workerFactory:fakeFactory(calls)});
 try{
 await store.set({settings:settings('a')});await manager.register(settings('a'));await manager.register({...settings('b'),proxy:'different:80',cdp:'http://localhost:9333'});await manager.register(settings('c'));await manager.init();await manager.batch('start',['a','b']);
 const before=(await manager.profileStore('b')).value;
 for(const model of ['cx/gpt-5.6-sol','cx/gpt-5.6-luna']){
 const shared={...settings(''),model,prompt:'Shared prompt',runConfig:{...AUTO_DEFAULTS,restAverageSeconds:60}};
 const results=await manager.applySharedSettings(shared);assert.ok(results.every(r=>r.ok));
 for(const id of ['a','b','c'])assert.equal((await manager.profileStore(id)).value.settings.model,model);
 assert.equal(store.value.sharedSettings.model,model);
 const after=(await manager.profileStore('b')).value;assert.equal(after.settings.proxy,'different:80');assert.equal(after.settings.cdp,'http://localhost:9333');assert.deepEqual(after.replyReceipts,before.replyReceipts);assert.deepEqual(after.autoRun,before.autoRun);
 }
 assert.equal(manager.workers.has('c'),false);assert.equal(calls.filter(c=>c.route==='start').length,2);
 }finally{await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('saving global GPM address updates existing profiles and stop endpoints, but refuses during a run',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-address-')),store=await new Store(dir).load(),calls=[];
 const manager=new ProfileManager(store,{workerFactory:fakeFactory([]),gpmFactory:base=>({call:async route=>calls.push({base,route})})});
 try{
 await store.set({settings:settings('a')});await manager.register(settings('a'));await manager.register({...settings('b'),proxy:'host:80'});
 const shared={...settings(''),gpmApi:'http://127.0.0.1:19995/api/v3'};
 manager.views.set('b',{state:{status:'running'}});
 await assert.rejects(()=>manager.applySharedSettings(shared),/Dừng profile/);
 assert.equal(store.value.sharedSettings,undefined);assert.equal((await manager.profileStore('a')).value.settings.gpmApi,settings('a').gpmApi);
 manager.views.set('b',{state:{status:'stopped'}});
 assert.ok((await manager.applySharedSettings(shared)).every(r=>r.ok));
 for(const id of ['a','b']){assert.equal((await manager.profileStore(id)).value.settings.gpmApi,shared.gpmApi);await manager.gpmStop(id);}
 assert.ok(calls.every(c=>c.base===shared.gpmApi));assert.equal((await manager.profileStore('b')).value.settings.proxy,'host:80');
 }finally{await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});

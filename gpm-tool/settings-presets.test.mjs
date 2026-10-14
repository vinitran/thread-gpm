import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';
import {Store} from './store.mjs';import {ProfileManager} from './profile-manager.mjs';import {ProfileImporter} from './profile-import.mjs';import {AUTO_DEFAULTS} from '../extension/auto-runner.js';import {validatePreset} from './settings-presets.mjs';
const base={profileId:'',profileName:'',prompt:'Original prompt',model:'original',apiKey:'private-fixture',proxy:'',cdp:'http://localhost:9222',gpmApi:'http://localhost:9495',imagesFolder:'',runConfig:{...AUTO_DEFAULTS,keywords:'Original topics'}};
async function fixture(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hx-presets-')),store=await new Store(dir).load(),calls=[];await store.set({settings:base});
 const manager=new ProfileManager(store,{workerFactory:(dir,onView)=>({close:async()=>{},call:async(route,input)=>{calls.push({id:path.basename(dir),route,input});if(route==='settings'){const data=await new Store(dir).load();await data.set({settings:input,autoRun:{...data.value.autoRun,config:input.runConfig}});}return {state:{status:'running'},ok:true};}})});
 return {dir,store,manager,calls,close:async()=>{await manager.close();await fs.rm(dir,{recursive:true,force:true});}};
}
test('legacy profiles migrate to Default using existing global prompt/topics and preserve history and connections',async()=>{
 const f=await fixture();try{
  await f.store.set({profileMigrationDone:true,sharedSettings:base,profileRegistry:{a:{id:'a',name:'A'},b:{id:'b',name:'B'}}});
  for(const id of ['a','b']){const data=await f.manager.profileStore(id,{...base,profileId:id,proxy:id+':80',prompt:'Old per-profile prompt'});await data.set({replyReceipts:{keep:{state:'posted'}},autoRun:{status:'stopped',config:base.runConfig,history:{keep:{state:'posted'}}}});}
  await f.manager.init();assert.deepEqual(f.store.value.settingsPresets,[{id:'default',name:'Mặc định',prompt:base.prompt,keywords:base.runConfig.keywords}]);
  for(const id of ['a','b']){const s=(await f.manager.profileStore(id)).value;assert.equal(s.settings.settingPresetId,'default');assert.equal(s.settings.prompt,base.prompt);assert.equal(s.settings.proxy,id+':80');assert.ok(s.replyReceipts.keep);assert.ok(s.autoRun.history.keep);assert.equal(f.manager.rows().find(r=>r.id===id).settingPresetName,'Mặc định');}
  assert.equal(f.manager.workers.size,0);
 }finally{await f.close();}
});
test('saving common model and pacing never overwrites either assigned preset; association survives restart',async()=>{
 const f=await fixture();try{
  await f.manager.init();const p=(await f.manager.savePreset({name:'Food',prompt:'Food prompt',keywords:'Food topics',model:'must-not-store',apiKey:'must-not-store'})).preset;
  for(const id of ['a','b'])await f.manager.register(f.manager.effectiveSettings({...base,profileId:id,settingPresetId:id==='a'?'default':p.id}));
  assert.equal((await f.manager.assignPreset(['b'],p.id)).ok,true);
  await f.manager.applySharedSettings({...base,model:'luna',prompt:'Do not spread',runConfig:{...AUTO_DEFAULTS,restAverageSeconds:60,keywords:'Do not spread'}});
  for(const id of ['a','b']){const settings=(await f.manager.profileStore(id)).value.settings;assert.equal(settings.model,'luna');assert.equal(settings.runConfig.restAverageSeconds,60);assert.equal(settings.prompt,id==='a'?base.prompt:'Food prompt');assert.equal(settings.runConfig.keywords,id==='a'?base.runConfig.keywords:'Food topics');}
  assert.deepEqual(Object.keys(f.store.value.settingsPresets.find(s=>s.id===p.id)).sort(),['id','keywords','name','prompt']);
  await f.manager.savePreset({...f.store.value.settingsPresets[0],prompt:'Changed Default',keywords:'Changed default topics'});assert.equal((await f.manager.profileStore('a')).value.settings.prompt,'Changed Default');assert.equal((await f.manager.profileStore('b')).value.settings.prompt,'Food prompt');assert.equal((await f.manager.profileStore('a')).value.settings.model,'luna');
  const fresh=new ProfileManager(await new Store(f.dir).load());await fresh.init();assert.equal((await fresh.profileStore('b')).value.settings.settingPresetId,p.id);assert.equal((await fresh.profileStore('b')).value.settings.prompt,'Food prompt');await fresh.close();
 }finally{await f.close();}
});
test('preset edit and reassignment update only affected running profiles in both engines without starting or posting',async()=>{
 const f=await fixture();try{
  await f.manager.init();const p=(await f.manager.savePreset({name:'Shopping',prompt:'Shop',keywords:'Shopping'})).preset;
  for(const [id,engine] of [['a','direct'],['b','extension'],['c','direct']]){await f.manager.register(f.manager.effectiveSettings({...base,profileId:id,settingPresetId:id==='c'?'default':p.id}));const data=await f.manager.profileStore(id);await data.set({autoRun:{status:'running',current:{phase:'posting',post:{url:'keep'}},stats:{posted:4},config:data.value.settings.runConfig},replyReceipts:{keep:{state:'sent_unverified'}}});f.manager.worker(id);f.manager.views.set(id,{engine,state:{status:'running'}});}
  const updated=await f.manager.savePreset({...p,prompt:'New shop prompt',keywords:'New shop topics'});assert.equal(updated.ok,true);assert.deepEqual(f.calls.map(c=>c.id).sort(),['a','b']);
  for(const id of ['a','b']){const data=(await f.manager.profileStore(id)).value;assert.equal(data.settings.prompt,'New shop prompt');assert.equal(data.autoRun.config.keywords,'New shop topics');assert.equal(data.autoRun.current.phase,'posting');assert.equal(data.autoRun.stats.posted,4);assert.ok(data.replyReceipts.keep);}
  f.calls.length=0;assert.equal((await f.manager.assignPreset(['a'],'default')).ok,true);assert.deepEqual(f.calls.map(c=>c.id),['a']);assert.equal((await f.manager.profileStore('a')).value.settings.prompt,base.prompt);assert.ok(f.calls.every(c=>c.route==='settings'));
 }finally{await f.close();}
});
test('preset validation and deletion reject invalid selections and deletion of assigned or default presets',async()=>{
 const f=await fixture();try{
  await f.manager.init();const p=(await f.manager.savePreset({name:'Saved',prompt:'Prompt',keywords:'Topics'})).preset;
  await assert.rejects(()=>f.manager.savePreset({name:'Saved',prompt:'Prompt',keywords:'Topics'}),/tồn tại/);await assert.rejects(()=>f.manager.deletePreset('default'),/Mặc định/);
  await f.manager.register(f.manager.effectiveSettings({...base,profileId:'a',settingPresetId:p.id}));await assert.rejects(()=>f.manager.deletePreset(p.id),/profile dùng/);await assert.rejects(()=>f.manager.assignPreset(['a'],'missing'),/không tồn tại/);await assert.rejects(()=>f.manager.assignPreset(['constructor'],p.id),/profile đã thêm/);
  await f.manager.assignPreset(['a'],'default');assert.equal((await f.manager.deletePreset(p.id)).ok,true);assert.equal(f.store.value.settingsPresets.length,1);
  for(const input of [{name:'',prompt:'x',keywords:'x'},{name:'x',prompt:'',keywords:'x'},{name:'x',prompt:'x',keywords:''}])assert.throws(()=>validatePreset(input));
 }finally{await f.close();}
});
test('import from GPM assigns the selected saved preset to all new profiles without opening workers',async()=>{
 const f=await fixture();try{
  await f.manager.init();const p=(await f.manager.savePreset({name:'Imported',prompt:'Import prompt',keywords:'Import topics'})).preset;
  const importer=new ProfileImporter(f.manager,{apiFactory:()=>({list:async()=>[{id:'a',name:'A',proxy:''},{id:'b',name:'B',proxy:''}]})});const preview=await importer.preview({fromGpm:true});
  await assert.rejects(()=>importer.commit({token:preview.token,ids:['a'],settingPresetId:'missing'}),/không tồn tại/);
  const result=await importer.commit({token:preview.token,ids:['a','b'],settingPresetId:p.id});assert.ok(result.results.every(r=>r.status==='imported'));
  for(const id of ['a','b'])assert.equal((await f.manager.profileStore(id)).value.settings.prompt,'Import prompt');assert.equal(f.manager.workers.size,0);
 }finally{await f.close();}
});
test('app API exposes presets, keeps common fields global, and creates profiles with selected settings',async()=>{
 const f=await fixture();let child;let created=0;
 const gpm=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');if(url.pathname.endsWith('/profiles/create')){created++;res.end(JSON.stringify({success:true,data:{id:'new-'+created,name:'New',raw_proxy:''}}));}else res.end(JSON.stringify({success:true,data:[]}));});await new Promise(r=>gpm.listen(0,'127.0.0.1',r));
 try{
  await f.store.set({settings:{...base,gpmApi:'http://127.0.0.1:'+gpm.address().port+'/api/v1'}});
  let resolveReady;const ready=new Promise(r=>resolveReady=r);child=spawn(process.execPath,['server.mjs'],{cwd:path.dirname(new URL(import.meta.url).pathname),env:{...process.env,GPM_TOOL_DATA:f.dir,PORT:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolveReady(match[0]);});
  const address=await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Server not ready')),15000);timer.unref();})]);
  const state=await fetch(address+'/api/state').then(r=>r.json());assert.equal(state.settingsPresets[0].id,'default');
  const api=async(route,input)=>{const r=await fetch(address+'/api/'+route,{method:'POST',headers:{Origin:address,'X-Tool-Token':state.token,'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;};
  const p=(await api('settings-preset-save',{name:'Travel',prompt:'Travel prompt',keywords:'Travel topics'})).preset;
  await assert.rejects(()=>api('profile-create',{name:'New',proxy:'',settingPresetId:'missing'}),/không tồn tại/);assert.equal(created,0);
  await api('profile-create',{name:'New',proxy:'',settingPresetId:p.id});assert.equal((await fetch(address+'/api/profile-settings?profileId=new-1').then(r=>r.json())).settings.prompt,'Travel prompt');
  await api('settings',{...state.settings,prompt:'Common must not change preset',runConfig:{...state.settings.runConfig,keywords:'Common must not change preset'},model:'luna',scope:'all'});
  const after=await fetch(address+'/api/profile-settings?profileId=new-1').then(r=>r.json());assert.equal(after.settings.model,'luna');assert.equal(after.settings.prompt,'Travel prompt');assert.equal(after.settings.runConfig.keywords,'Travel topics');
  await api('settings-preset-save',{...p,prompt:'Updated Travel'});const updated=await fetch(address+'/api/profile-settings?profileId=new-1').then(r=>r.json());assert.equal(updated.settings.prompt,'Updated Travel');
  assert.equal((await fetch(address+'/api/state').then(r=>r.json())).profiles[0].settingPresetName,'Travel');
 }finally{if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}gpm.closeAllConnections();await new Promise(r=>gpm.close(r));await f.close();}
});

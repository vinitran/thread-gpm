import {readPersistedState} from './store.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {parseProfileList,resolveProfileList,ProfileImporter} from './profile-import.mjs';import {ProfileManager} from './profile-manager.mjs';import {Store} from './store.mjs';import {AUTO_DEFAULTS} from '../extension/auto-runner.js';
const profiles=[{id:'a',name:'A',proxy:'live:80'},{id:'b',name:'B',proxy:''},{id:'c',name:'Same',proxy:''},{id:'d',name:'Same',proxy:''}];
test('profile lists accept GPM JSON envelopes, quoted CSV/TSV and plain ID/name lists while ignoring unrelated fields',()=>{
 for(const json of [profiles,{profiles},{data:profiles},{data:{data:profiles}}])assert.equal(parseProfileList(JSON.stringify(json),'gpm.json').length,4);
 assert.deepEqual(parseProfileList('\uFEFFprofile_id;profile_name;raw_proxy\r\nb;"B; quoted";old:80\r\n','gpm.csv'),[{id:'b',name:'B; quoted'}]);
 assert.deepEqual(parseProfileList('ID\tName\na\t"A ""quoted""\nline"','gpm.csv'),[{id:'a',name:'A "quoted"\nline'}]);
 assert.equal(parseProfileList('a\nB\n','ids.txt').length,2);
 const rows=resolveProfileList(parseProfileList('[{"id":"b","apiKey":"untrusted","proxy":"old:80","cdp":"http://bad"}]'),profiles);assert.equal(rows[0].proxy,'');assert.ok(!JSON.stringify(rows).includes('untrusted'));
 for(const [text,name] of [['[{','a.json'],['id,name\nb,"unclosed','a.csv'],['id,name\na,B,C','a.csv'],['anything','a.xlsx'],['','a.txt'],['cookie,value\na,b','a.csv']])assert.throws(()=>parseProfileList(text,name));
 assert.throws(()=>parseProfileList('x'.repeat(1024*1024+1)));assert.throws(()=>parseProfileList(Array(501).fill('a').join('\n')));
});
test('matching uses IDs, reports duplicate/missing/ambiguous names and preserves configured profiles',()=>{
 const rows=resolveProfileList([{id:'a'},{id:'b'},{id:'b'},{name:'Same'},{id:'missing',name:'B'},{lookup:'B'},{id:'../escape'},{id:'__proto__'}],profiles,{a:{}});
 assert.deepEqual(rows.map(r=>r.status),['existing','ready','duplicate','invalid','invalid','duplicate','invalid','invalid']);assert.match(rows[3].message,/cần ID/);assert.equal(rows[4].id,'missing');
});
test('preview is read-only; confirm rechecks live GPM and imports only new profiles, preserving history, config and empty proxies',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-import-')),store=await new Store(dir).load();let remote=structuredClone(profiles),time=1000,listCalls=0;
 const settings={profileId:'a',profileName:'A',proxy:'old:80',cdp:'http://localhost:1234',gpmApi:'http://localhost:9495',apiKey:'saved-key',model:'m',prompt:'Saved prompt',runConfig:AUTO_DEFAULTS};await store.set({settings,profileMigrationDone:true});
 const manager=new ProfileManager(store,{workerFactory:()=>{throw Error('Import must not boot a worker');}});await manager.register(settings);const a=await manager.profileStore('a');await a.set({replyReceipts:{keep:{state:'posted'}},autoRun:{status:'running'}});
 const importer=new ProfileImporter(manager,{now:()=>time,apiFactory:()=>({list:async options=>{assert.equal(options.metadata,true);listCalls++;return remote;}})});
 try{const before=JSON.stringify(await readPersistedState(dir));const preview=await importer.preview({text:JSON.stringify([{id:'a'},{id:'b',proxy:'old:80',apiKey:'bad'},{id:'c'}]),filename:'export.json'});assert.equal(JSON.stringify(await readPersistedState(dir)),before);assert.equal(manager.workers.size,0);await assert.rejects(()=>importer.commit({token:preview.token,ids:['a']}));await assert.rejects(()=>importer.commit({token:'bad',ids:['b']}));
 remote=remote.filter(p=>p.id!=='c').map(p=>p.id==='b'?{...p,name:'B renamed',proxy:''}:p);
 const result=await importer.commit({token:preview.token,ids:['b','c']});assert.deepEqual(result.results.map(r=>r.status),['imported','invalid']);assert.equal(listCalls,2);assert.equal(manager.workers.size,0);
 const b=await manager.profileStore('b');assert.equal(b.value.settings.apiKey,'saved-key');assert.equal(b.value.settings.proxy,'');assert.equal(b.value.settings.profileName,'B renamed');assert.equal(b.value.settings.cdp,'http://127.0.0.1:9222/');assert.equal(b.value.autoRun,undefined);assert.equal(b.value.replyReceipts,undefined);assert.ok((await manager.profileStore('a')).value.replyReceipts.keep);assert.equal(store.value.settings.profileId,'a');
 assert.equal((await importer.commit({token:preview.token,ids:['b']})).results[0].status,'existing');time+=300001;await assert.rejects(()=>importer.commit({token:preview.token,ids:['b']}),/hết hạn/);
 }finally{await manager.close();await store.pending;await fs.rm(dir,{recursive:true,force:true});}
});

test('GPM picker truncates large lists without rejecting and forwards name/ID searches',async()=>{
 let options;const manager={store:{value:{settings:{},profileRegistry:{}}}};
 const importer=new ProfileImporter(manager,{apiFactory:()=>({list:async value=>{options=value;return Array.from({length:value.search?1:501},(_,i)=>({id:'id-'+i,name:'Account '+i}));}})});
 const large=await importer.preview({fromGpm:true});assert.equal(large.rows.length,500);assert.equal(large.limited,true);assert.equal(options.limit,501);
 const searched=await importer.preview({fromGpm:true,query:' Account '});assert.equal(options.search,'Account');assert.equal(searched.rows.length,1);assert.equal(searched.limited,false);
 await assert.rejects(()=>importer.commit({token:searched.token,ids:['id-500']}),/hợp lệ/);
 await assert.rejects(()=>importer.preview({fromGpm:true,query:'x'.repeat(201)}),/200/);
});


test('web export round trips into another tool without secrets, overwrites or GPM mutations',async()=>{
 const {exportProfileList}=await import('./public/profile-list.js');
 const file=exportProfileList([{...profiles[0],apiKey:'secret-key',proxy:'secret-proxy',view:{secret:'runtime'}},profiles[1]],null,new Date('2026-10-08T00:00:00Z'));
 assert.deepEqual(file.profiles,[{id:'a',name:'A'},{id:'b',name:'B'}]);assert.ok(!JSON.stringify(file).includes('secret'));assert.deepEqual(exportProfileList(profiles,['b']).profiles,[{id:'b',name:'B'}]);assert.throws(()=>exportProfileList([]));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-roundtrip-')),store=await new Store(dir).load();await store.set({settings:{gpmApi:'http://localhost:9495',model:'m',prompt:'Destination prompt',apiKey:'destination-key',runConfig:AUTO_DEFAULTS},profileMigrationDone:true});
 const manager=new ProfileManager(store,{workerFactory:()=>{throw Error('Restore must not start a worker');}}),importer=new ProfileImporter(manager,{apiFactory:()=>({list:async()=>profiles})});
 try{const preview=await importer.preview({text:JSON.stringify(file),filename:'hoanxu-profiles.json'});assert.ok(preview.rows.every(p=>p.status==='ready'));const result=await importer.commit({token:preview.token,ids:['a','b']});assert.ok(result.results.every(p=>p.status==='imported'));assert.equal((await manager.profileStore('a')).value.settings.proxy,'live:80');assert.equal((await manager.profileStore('b')).value.settings.apiKey,'destination-key');assert.equal(manager.workers.size,0);const duplicate=await importer.preview({text:JSON.stringify(file)});assert.ok(duplicate.rows.every(p=>p.status==='existing'));}finally{await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('native web lists larger than 500 import while unsupported versions and excessive lists are rejected',async()=>{
 const {exportProfileList}=await import('./public/profile-list.js');const list=Array.from({length:1001},(_,i)=>({id:'p-'+i,name:'Profile '+i})),file=exportProfileList(list);
 assert.equal(parseProfileList(JSON.stringify(file),'web.json').length,1001);assert.throws(()=>parseProfileList(JSON.stringify({...file,version:2})),/Phiên bản/);assert.throws(()=>exportProfileList(Array.from({length:10001},(_,i)=>({id:'p-'+i}))));
});

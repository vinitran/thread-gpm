import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';import {Store,readPersistedState} from './store.mjs';
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoanxu-sqlite-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('SQLite migrates global/profile JSON once into separate namespaces and retains a backup',()=>fixture(async dir=>{
 const legacy={settings:{apiKey:'fixture-private',model:'luna'},replyReceipts:{post:{state:'sent_unverified'}},autoRun:{status:'stopped'},profileRegistry:{a:{id:'a'}},unknownFutureField:{keep:true}};
 await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(legacy));const profile=path.join(dir,'profiles','a');await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'state.json'),JSON.stringify({settings:{model:'profile'},replyReceipts:{a:{state:'posted'}}}));
 const global=await new Store(dir).load(),a=await new Store(profile).load();assert.deepEqual(global.value,legacy);assert.equal(global.file,a.file);assert.notEqual(global.namespace,a.namespace);assert.equal(a.value.settings.model,'profile');assert.equal(JSON.parse(await fs.readFile(path.join(dir,'state.pre-sqlite.json'),'utf8')).settings.apiKey,'fixture-private');
 await global.set({settings:{model:'new'}});await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({settings:{model:'stale'}}));assert.equal((await new Store(dir).load()).value.settings.model,'new');assert.equal((await readPersistedState(profile)).replyReceipts.a.state,'posted');assert.deepEqual((await readPersistedState(dir)).unknownFutureField,{keep:true});
}));
test('SQLite transactions preserve independent writes from stale store instances and isolate profiles',()=>fixture(async dir=>{
 const first=await new Store(dir).load(),second=await new Store(dir).load();await Promise.all([first.set({settings:{model:'first'}}),second.set({replyReceipts:{keep:{state:'posted'}}})]);
 const data=await readPersistedState(dir);assert.equal(data.settings.model,'first');assert.equal(data.replyReceipts.keep.state,'posted');
 const a=await new Store(path.join(dir,'profiles','a')).load(),b=await new Store(path.join(dir,'profiles','b')).load();await Promise.all([a.set({autoRun:{status:'running'}}),b.set({autoRun:{status:'stopped'}})]);assert.equal((await readPersistedState(a.dir)).autoRun.status,'running');assert.equal((await readPersistedState(b.dir)).autoRun.status,'stopped');
 const db=new DatabaseSync(first.file);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
}));
test('invalid legacy JSON and newer schema never get silently reset',()=>fixture(async dir=>{
 await fs.writeFile(path.join(dir,'state.json'),'{bad');await assert.rejects(new Store(dir).load());assert.equal(await fs.readFile(path.join(dir,'state.json'),'utf8'),'{bad');
 await fs.writeFile(path.join(dir,'state.json'),'{}');const store=await new Store(dir).load();await store.set({settings:{model:'keep'}});const db=new DatabaseSync(store.file);db.exec('PRAGMA user_version=99');db.close();await assert.rejects(new Store(dir).load(),/mới hơn/);assert.equal((await readPersistedState(dir)).settings.model,'keep');
}));
test('concurrent worker processes write the same SQLite database without losing either profile',()=>fixture(async dir=>{
 await new Store(dir).load();const module=new URL('./store.mjs',import.meta.url).href;
 const run=id=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',`import {Store} from ${JSON.stringify(module)};const s=await new Store(process.argv[1]).load();for(let i=0;i<20;i++)await s.set({counter:i,replyReceipts:{keep:{state:'posted'}}});`,path.join(dir,'profiles',id)],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',data=>error+=data);child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(error)));});
 await Promise.all([run('a'),run('b')]);for(const id of ['a','b']){const v=await readPersistedState(path.join(dir,'profiles',id));assert.equal(v.counter,19);assert.equal(v.replyReceipts.keep.state,'posted');}
}));
test('a failed SQL transaction rolls back every key and the next save can recover',()=>fixture(async dir=>{
 const store=await new Store(dir).load();await store.set({keep:'original'});let db=new DatabaseSync(store.file);db.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON state_values WHEN NEW.key='reject' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");db.close();
 await assert.rejects(store.set({keep:'wrong',reject:'bad'}),/fixture write failure/);assert.equal((await readPersistedState(dir)).keep,'original');assert.equal((await readPersistedState(dir)).reject,undefined);assert.equal(store.value.keep,'original');
 db=new DatabaseSync(store.file);db.exec('DROP TRIGGER reject_fixture');db.close();await store.set({keep:'recovered'});assert.equal((await readPersistedState(dir)).keep,'recovered');
}));

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {sealGmailVault,GmailVault,loadGmailVault} from './gmail-vault.mjs';import {GmailOAuthClient} from './gmail-oauth.mjs';import {ProfileWorker} from './profile-manager.mjs';import {bundleGmailVault} from '../packaging/gmail-vault.mjs';
const password='fixture-vault-password',data={account:'fixture@gmail.com',token:{token:'fixture-access-secret',refresh_token:'fixture-refresh-secret',client_id:'fixture-client',client_secret:'fixture-client-secret',expiry:'2000-01-01T00:00:00Z'}};
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hx-vault-')),envelope=await sealGmailVault(data,password);return {dir,envelope,close:()=>fs.rm(dir,{recursive:true,force:true})};}
test('vault needs the password, authenticates ciphertext, and stores refreshed OAuth encrypted across restarts',async()=>{
 const f=await fixture();try{
  const vault=new GmailVault(f.envelope,f.dir);assert.equal(vault.locked,true);assert.throws(()=>vault.clientOptions());await assert.rejects(()=>vault.unlock('wrong-password'));assert.equal(vault.locked,true);
  await vault.unlock(password);await vault.prepare();assert.equal(vault.locked,false);
  let refreshes=0;const request=async url=>url.includes('oauth2.googleapis.com')?(refreshes++,{status:200,data:{access_token:'fixture-new-access',expires_in:3600}}):{status:200,data:{emailAddress:data.account}};
  const opts=vault.clientOptions();await new GmailOAuthClient(opts.config,{tokenStorage:opts.tokenStorage,request}).checkConnection();assert.equal(refreshes,1);
  const cached=await fs.readFile(vault.file,'utf8');for(const secret of [password,data.account,...Object.values(data.token),'fixture-new-access'])assert.ok(!cached.includes(secret));
  const restored=new GmailVault(f.envelope,f.dir);restored.acceptKey(Buffer.from(vault.exportKey(),'base64'));const next=restored.clientOptions();await new GmailOAuthClient(next.config,{tokenStorage:next.tokenStorage,request}).checkConnection();assert.equal(refreshes,1);
  const recipient='fixture+123@gmail.com',now=Date.now(),mailRequest=async url=>{const route=new URL(url).pathname;return {status:200,data:route.endsWith('/profile')?{emailAddress:data.account}:route.endsWith('/messages')?{messages:[{id:'fixture-mail'}]}:{internalDate:String(now),payload:{headers:[{name:'From',value:'no-reply@mail.instagram.com'},{name:'To',value:recipient},{name:'Subject',value:'123456 is your Instagram code'}]}}};};
  assert.deepEqual(await new GmailOAuthClient(next.config,{tokenStorage:next.tokenStorage,request:mailRequest}).pollCode({recipient,after:Math.floor(now/1000)-20}),{code:'123456'});
  vault.close();assert.equal(vault.locked,true);assert.throws(()=>vault.exportKey());
  const bad={...f.envelope,ciphertext:Buffer.alloc(Buffer.from(f.envelope.ciphertext,'base64').length).toString('base64')};await assert.rejects(()=>new GmailVault(bad,f.dir).unlock(password));
  const source=path.join(f.dir,'source.enc.json');await fs.writeFile(source,JSON.stringify(f.envelope));assert.equal((await loadGmailVault(source,f.dir)).locked,true);assert.equal(await loadGmailVault(path.join(f.dir,'missing'),f.dir),null);
 }finally{await f.close();}
});
test('both build targets copy only the encrypted envelope with no build password',async()=>{
 const f=await fixture(),previous=process.env.HOANXU_BUILD_VAULT_FILE;try{const source=path.join(f.dir,'source.enc.json');await fs.writeFile(source,JSON.stringify(f.envelope));process.env.HOANXU_BUILD_VAULT_FILE=source;
  for(const platform of ['mac','win']){const output=path.join(f.dir,platform);await fs.mkdir(output);assert.equal(await bundleGmailVault(output),true);const text=await fs.readFile(path.join(output,'gmail-vault.enc.json'),'utf8');assert.deepEqual(JSON.parse(text),f.envelope);assert.ok(!text.includes(password));assert.ok(!text.includes(data.token.refresh_token));}
 }finally{if(previous===undefined)delete process.env.HOANXU_BUILD_VAULT_FILE;else process.env.HOANXU_BUILD_VAULT_FILE=previous;await f.close();}
});
test('backend blocks data/actions until unlocked; worker receives only its key over private IPC',async()=>{
 const f=await fixture(),file=path.join(f.dir,'bundle.enc.json'),dataDir=path.join(f.dir,'data');await fs.writeFile(file,JSON.stringify(f.envelope));
 const env={...process.env,HOANXU_VAULT_FILE:file,GPM_TOOL_DATA:dataDir,PORT:'0'};delete env.GPM_TOOL_WORKER;delete env.HOANXU_API_KEY;
 const child=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{env,stdio:['ignore','pipe','pipe']});let output='',worker;
 try{
  const address=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Backend start timeout')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/GPM tool UI: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.stderr.on('data',chunk=>output+=chunk);child.once('exit',()=>{clearTimeout(timer);reject(Error('Backend exited'));});});
  const state=await fetch(address+'/api/state').then(r=>r.json());assert.equal(state.locked,true);assert.equal(state.requiresPassword,true);assert.equal(state.settings,undefined);assert.equal(state.profiles,undefined);
  const post=(route,body,token=state.token)=>fetch(address+'/api/'+route,{method:'POST',headers:{Origin:address,'X-Tool-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(address+'/api/history')).status,423);assert.equal((await fetch(address+'/api/events')).status,423);assert.equal((await post('profiles-start',{ids:['fixture']})).status,423);assert.equal((await post('unlock',{password},'bad-token')).status,403);
  assert.equal((await post('unlock',{password})).status,200);assert.ok((await fetch(address+'/api/state').then(r=>r.json())).profiles);assert.equal((await post('unlock',{password:'wrong-password'})).status,400);assert.ok(!output.includes(password));assert.ok(!output.includes(data.token.refresh_token));
  const vault=new GmailVault(f.envelope,dataDir);await vault.unlock(password);const previous=process.env.HOANXU_VAULT_FILE;process.env.HOANXU_VAULT_FILE=file;
  try{worker=new ProfileWorker(path.join(dataDir,'profiles','fixture'),()=>{},{vaultKey:()=>vault.exportKey()});const view=await worker.call('state');assert.equal(view.locked,undefined);assert.ok(view.state);}finally{if(previous===undefined)delete process.env.HOANXU_VAULT_FILE;else process.env.HOANXU_VAULT_FILE=previous;}
  await worker.close({force:true});worker=null;await post('app-quit',{});
 }finally{await worker?.close({force:true});if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}await f.close();}
});

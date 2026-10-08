import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Updater,APP_ID,assertUpdateIdle,newer,repository,validateManifest} from './updates.mjs';
const repo='owner/tool';
const manifest=(extra={})=>({format:'hoanxu-macos-update',bundleId:APP_ID,platform:'darwin',arch:'arm64',version:'0.3.8',bytes:3,sha256:createHash('sha256').update('DMG').digest('hex'),url:'https://github.com/owner/tool/releases/download/v0.3.8/HoanXu-GPM-0.3.8-mac-arm64.dmg',...extra});
test('update versions, architecture and pinned GitHub repository',()=>{
 assert(newer('0.3.10','0.3.9'));assert(!newer('0.3.8','0.3.8'));assert(!newer('0.3.7','0.3.8'));assert.throws(()=>newer('v0.3.8','0.3.7'));assert.throws(()=>repository('../outside/repo'));assert.throws(()=>repository('owner/..'));
 assert.equal(validateManifest(manifest(),repo,'arm64').version,'0.3.8');
 for(const patch of [{url:'https://elsewhere.test/app.dmg'},{arch:'x64'},{bundleId:'another.app'},{version:'0.3.8-beta'},{bytes:0},{bytes:501*1024*1024},{sha256:'bad'}])assert.throws(()=>validateManifest(manifest(patch),repo,'arm64'));
});
test('update install gate blocks running, stopping and outstanding operations',()=>{
 assertUpdateIdle([{view:{state:{status:'stopped'}}}],null);
 for(const status of ['running','stopping'])assert.throws(()=>assertUpdateIdle([{view:{state:{status}}}],null));
 assert.throws(()=>assertUpdateIdle([{view:{operation:'opening'}}],null));assert.throws(()=>assertUpdateIdle([],'importing'));assert.throws(()=>assertUpdateIdle([],null,1));
});
test('GitHub release check handles latest, missing release, redirects and wrong host',async()=>{
 let calls=0;
 const u=new Updater({dir:'/unused',repo,version:'0.3.7',arch:'arm64',platform:'darwin',fetcher:async url=>{calls++;if(url.includes('/latest/'))return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/manifest'}});return new Response(JSON.stringify(manifest()));}});
 assert((await u.check()).available);assert.equal(calls,2);assert.equal(u.status().latestVersion,'0.3.8');
 u.version='0.3.8';assert(!(await u.check()).available);
 u.fetcher=async()=>new Response(null,{status:404});await assert.rejects(u.check(),/Chưa có bản/);
 u.fetcher=async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});await assert.rejects(u.check(),/không hợp lệ/);
 u.fetcher=async()=>new Response('x'.repeat(17000));await assert.rejects(u.check(),/quá lớn/);
 const unsupported=new Updater({repo,platform:'darwin',arch:'x64'});await assert.rejects(unsupported.check(),/chỉ hỗ trợ/);
});
test('Windows x64 downloads are verified and staged without executing the EXE',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoanxu-win-update-'));
 try{
  const target=path.join(dir,'old.exe');await fs.writeFile(target,'old portable');
  const bytes=Buffer.alloc(128);bytes.write('MZ');bytes.writeUInt32LE(64,0x3c);bytes.write('PE\0\0',64);bytes.writeUInt16LE(0x8664,68);
  const m=manifest({format:'hoanxu-windows-update',platform:'win32',arch:'x64',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'https://github.com/owner/tool/releases/download/v0.3.8/HoanXu-GPM-0.3.8-win-x64-portable.exe'});
  const u=new Updater({dir,repo,platform:'win32',arch:'x64',appPath:target,version:'0.3.7',execute:async()=>{throw Error('Must not execute artifact while staging');},fetcher:async url=>new Response(url.endsWith('.json')?JSON.stringify(m):bytes)});
  assert((await u.check()).installSupported);assert((await u.stage()).restarting);const request=JSON.parse(await fs.readFile(path.join(dir,'update-install.json'),'utf8'));assert.deepEqual(await fs.readFile(request.source),bytes);assert.equal(await fs.readFile(target,'utf8'),'old portable');
  await fs.rm(path.join(dir,'update-install.json'));bytes.writeUInt16LE(0x14c,68);m.sha256=createHash('sha256').update(bytes).digest('hex');await u.check();assert((await u.stage()).ok); // Valid NSIS installer stub.
  await fs.rm(path.join(dir,'update-install.json'));bytes.writeUInt16LE(0xaa64,68);m.sha256=createHash('sha256').update(bytes).digest('hex');await u.check();await assert.rejects(u.stage(),/không phải EXE portable/);await assert.rejects(fs.access(path.join(dir,'update-install.json')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('corrupt downloads never mount, write installation request or alter application/data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoanxu-update-test-'));let commands=0;
 try{
  const app=path.join(dir,'HoanXu GPM.app');await fs.mkdir(app);await fs.writeFile(path.join(app,'old'),'keep');await fs.writeFile(path.join(dir,'state.json'),'private fixture');
  const u=new Updater({dir,repo,appPath:app,version:'0.3.7',arch:'arm64',platform:'darwin',execute:async()=>{commands++;},fetcher:async url=>new Response(url.endsWith('.json')?JSON.stringify(manifest()):'BAD')});
  await u.check();await assert.rejects(u.stage(),/checksum/);assert.equal(commands,0);await assert.rejects(fs.access(path.join(dir,'update-install.json')));assert.equal(await fs.readFile(path.join(app,'old'),'utf8'),'keep');assert.equal(await fs.readFile(path.join(dir,'state.json'),'utf8'),'private fixture');
  u.fetcher=async()=>new Response('DMG!');await assert.rejects(u.stage(),/vượt manifest/);assert.equal(commands,0);assert(!u.busy);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('failed checks retain a known update, expose uncertainty and clear the error on recovery',async()=>{
 const u=new Updater({dir:'/unused',repo,version:'0.3.7',arch:'arm64',platform:'darwin',fetcher:async()=>new Response(JSON.stringify(manifest()))});
 assert.equal(u.status().checkedAt,null);assert.equal(u.status().checkError,null);
 await u.check();const checkedAt=u.status().checkedAt;
 u.fetcher=async()=>{throw Error('Fixture offline');};await assert.rejects(u.check(),/offline/);
 assert.equal(u.status().available,true);assert.equal(u.status().latestVersion,'0.3.8');assert.equal(u.status().checkedAt,checkedAt);assert.equal(u.status().checkError,'Fixture offline');
 u.fetcher=async()=>new Response(JSON.stringify(manifest({version:'0.3.7',url:'https://github.com/owner/tool/releases/download/v0.3.7/HoanXu-GPM-0.3.7-mac-arm64.dmg'})));
 await u.check();assert.equal(u.status().available,false);assert.equal(u.status().checkError,null);
 const unknown=new Updater({repo,platform:'darwin',arch:'arm64',fetcher:async()=>new Response(null,{status:404})});
 await assert.rejects(unknown.check(),/Chưa có bản/);assert.equal(unknown.status().checkedAt,null);assert.match(unknown.status().checkError,/Chưa có bản/);
});

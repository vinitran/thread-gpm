import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {platformRelease} from './platform-release.mjs';
const commit='a'.repeat(40),tag='v0.4.99';
test('each platform publishes independently and later Windows upload preserves published Mac assets',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'platform-release-'));let release;const commands=[];
 const gh=async args=>{
  commands.push(args);
  if(args[1]==='view'){if(!release)throw Error('Not found');return JSON.stringify(release);}
  if(args[1]==='create')release={targetCommitish:commit,isDraft:true,assets:[]};
  if(args[1]==='upload')release.assets.push({name:path.basename(args[3])});
  if(args[1]==='edit')release.isDraft=false;
  if(args[1]==='delete-asset')release.assets=release.assets.filter(a=>a.name!==args[3]);
  return '';
 };
 try{
  await platformRelease('reserve',null,{tag,commit,gh});assert.equal(release.isDraft,true);
  for(const platform of ['macos','windows']){
   const folder=path.join(dir,platform);await fs.mkdir(folder);
   const binary=platform==='macos'?'HoanXu-GPM-0.4.99-mac-arm64.dmg':'HoanXu-GPM-0.4.99-win-x64-portable.exe',manifest=platform==='macos'?'hoanxu-macos-arm64.json':'hoanxu-windows-x64.json';
   await fs.writeFile(path.join(folder,binary),'fixture');await fs.writeFile(path.join(folder,binary+'.sha256'),'fixture');await fs.writeFile(path.join(folder,manifest),JSON.stringify({version:'0.4.99',platform:platform==='macos'?'darwin':'win32'}));
   // A lost Windows upload must not unpublish or delete the already available Mac build.
   if(platform==='windows'){
    const before=release.assets.map(a=>a.name);
    await assert.rejects(()=>platformRelease('publish',platform,{tag,commit,dir:folder,gh:async args=>{if(args[1]==='upload')throw Error('Network failure');return gh(args);}}),/Network failure/);
    assert.equal(release.isDraft,false);assert.deepEqual(release.assets.map(a=>a.name),before);
    // Retry repairs a partial upload without touching Mac files.
    release.assets.push({name:binary});
   }
   await platformRelease('publish',platform,{tag,commit,dir:folder,gh});
   assert.equal(release.isDraft,false);assert.ok(release.assets.some(a=>a.name===binary));
   const uploads=commands.filter(a=>a[1]==='upload');assert.equal(path.basename(uploads.at(-1)[3]),manifest);
   const count=uploads.length;await platformRelease('publish',platform,{tag,commit,dir:folder,gh});assert.equal(commands.filter(a=>a[1]==='upload').length,count);
  }
  assert.ok(release.assets.some(a=>a.name==='hoanxu-macos-arm64.json'));assert.ok(release.assets.some(a=>a.name==='hoanxu-windows-x64.json'));
  await assert.rejects(()=>platformRelease('publish','macos',{tag,commit:'b'.repeat(40),dir:path.join(dir,'macos'),gh}),/different commit/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

import {readPersistedState} from '../../gpm-tool/store.mjs';
// Optional GUI smoke test on a Mac desktop; CI uses smoke.mjs without a GUI session.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoanxu-native-ui-'));
const built=path.join(root,'.build/macos-arm64/HoanXu GPM.app'),updating=process.argv.includes('--update');let app=built;
if(updating){
 app=path.join(dir,'Installed HoanXu.app');await fs.cp(built,app,{recursive:true,verbatimSymlinks:true});
 const source=path.join(dir,'updates','stage-fixture','HoanXu GPM.app');await fs.cp(built,source,{recursive:true,verbatimSymlinks:true});
 const version=JSON.parse(await fs.readFile(path.join(root,'gpm-tool/package.json'),'utf8')).version;
 await fs.writeFile(path.join(dir,'update-install.json'),JSON.stringify({source,target:app,version}));
 await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({profileMigrationDone:true,profileRegistry:{},fixtureMarker:'keep during restart'}));
 // Exercise the native launcher -> helper -> new app sequence without a remote release or real profile.
 await fs.writeFile(path.join(app,'Contents/Resources/gpm-tool/server.mjs'),"console.log('GPM tool UI: http://127.0.0.1:0');setTimeout(()=>process.exit(42),2000);\n");
}
const p=spawn(path.join(app,'Contents/MacOS/HoanXuGPM'),[],{env:{...process.env,GPM_TOOL_DATA:dir,PORT:'0',GPM_TOOL_NO_BROWSER:'1'},stdio:'ignore'});
const exited=new Promise(r=>p.once('exit',r));let pid,nextLauncher;
try{
 let saved;const end=Date.now()+30000;while(Date.now()<end){try{saved=JSON.parse(await fs.readFile(path.join(dir,'app-runtime.json'),'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(saved,'Native launcher did not start server');pid=saved.pid;
 if(updating){
  assert.equal(await exited,0);saved=null;
  const deadline=Date.now()+30000;while(Date.now()<deadline){try{const value=JSON.parse(await fs.readFile(path.join(dir,'app-runtime.json'),'utf8'));if(value.pid!==pid&&value.launcherPid){saved=value;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert(saved,'Updated native app did not reopen with the same data folder');pid=saved.pid;
  nextLauncher=saved.launcherPid;
  assert.equal((await readPersistedState(dir)).fixtureMarker,'keep during restart');
 }
 const v=await fetch(saved.address+'/api/state').then(r=>r.json());assert.equal(v.profiles.length,0);assert.equal(v.version,JSON.parse(await fs.readFile(path.join(root,'gpm-tool/package.json'),'utf8')).version);
 assert((await fetch(saved.address+'/api/update-status').then(r=>r.json())).installSupported);
 if(updating){process.kill(saved.launcherPid,'SIGTERM');const end=Date.now()+15000;while(Date.now()<end){try{await fs.access(path.join(dir,'process.lock'));}catch{break;}await new Promise(r=>setTimeout(r,100));}}
 else {p.kill('SIGTERM');assert.equal(await Promise.race([exited,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Native shutdown timeout')),15000);t.unref();})]),0);}
 await assert.rejects(fs.access(path.join(dir,'process.lock')));pid=null;
 console.log(updating?'PASS: native launcher -> update helper -> reopened app, same data folder and clean exit. No GPM/browser actions.':'PASS: native Mac launcher, isolated server, packaged update support and clean exit. No GPM/browser actions.');
}finally{
 if(p.exitCode===null){p.kill('SIGTERM');await Promise.race([exited,new Promise(r=>setTimeout(r,1000))]);if(p.exitCode===null)p.kill('SIGKILL');}
 if(pid)try{process.kill(pid,'SIGTERM');}catch{}
 if(nextLauncher)try{process.kill(nextLauncher,'SIGTERM');}catch{}
 await fs.rm(dir,{recursive:true,force:true});
}

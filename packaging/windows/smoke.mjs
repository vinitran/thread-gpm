import {readPersistedState} from '../../gpm-tool/store.mjs';
// Verify payload/backend on every build host; execute WPF and updater on Windows.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const payload=path.join(root,'.build/windows/payload');
const expectedKey='';await assert.rejects(fs.access(path.join(payload,'bundled-keys.json')));
const require=createRequire(import.meta.url),{dataDir,dashboard}=require('./launcher.cjs');
assert.equal(dataDir({LOCALAPPDATA:'/fixture'}),path.join('/fixture','HoanXu-GPM','data'));
assert.throws(()=>dataDir({}));assert.throws(()=>dashboard('invalid'));
const entries=await fs.readdir(payload,{recursive:true});
assert(!entries.some(p=>/(^|[/\\])(data|\.env|state\.json|process\.lock|ai-defaults\.js)([/\\]|$)/.test(p)));
assert(!entries.some(p=>/\.(dylib|so)$/.test(p)||p.includes('sharp-darwin')));
async function machine(file){const b=await fs.readFile(file);assert.equal(b.toString('ascii',0,2),'MZ');const offset=b.readUInt32LE(0x3c);assert.equal(b.toString('ascii',offset,offset+4),'PE\0\0');return b.readUInt16LE(offset+4);}
assert.equal(await machine(path.join(payload,'node.exe')),0x8664);
assert.equal(await machine(path.join(payload,'HoanXuDesktop.exe')),0x8664);
const natives=entries.filter(p=>p.endsWith('.node')||p.endsWith('.dll'));
assert(natives.some(p=>p.includes('sharp-win32-x64')));
for(const file of natives)assert.equal(await machine(path.join(payload,file)),0x8664,file);
assert(!(await fs.readFile(path.join(payload,'gpm-tool/HUONG-DAN-SU-DUNG.md'),'utf8')).includes('/Users/'));
const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-portable-smoke-'));
let child,pid;
try{
 await fs.cp(payload,fixture,{recursive:true,filter:p=>!p.includes('node_modules')&&!p.endsWith('node.exe')});
 // Native dependencies must match the host for this server smoke test.
 await fs.symlink(path.join(root,'gpm-tool/node_modules'),path.join(fixture,'gpm-tool/node_modules'),'junction');
 const data=path.join(fixture,'data'),env={...process.env,PORT:'0',GPM_TOOL_DATA:data,GPM_TOOL_NO_BROWSER:'1'};
 let output='';
 child=spawn(process.execPath,[path.join(fixture,'launcher.cjs')],{env,stdio:['ignore','pipe','pipe']});
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const address=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Startup timeout: '+output)),15000);
  child.stdout.on('data',b=>{output+=b;const match=output.match(/GPM tool UI: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  child.stderr.on('data',b=>{output+=b;});
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Launcher exited: '+output));});
 });
 pid=JSON.parse(await fs.readFile(path.join(data,'process.lock'),'utf8')).pid;
 const state=await fetch(address+'/api/state').then(r=>r.json());
 assert.equal(state.version,JSON.parse(await fs.readFile(path.join(root,'gpm-tool/package.json'),'utf8')).version);assert.equal(state.profiles.length,0);assert.equal(state.counts.total,0);
 const html=await fetch(address).then(r=>r.text());assert(html.includes('<html'));
 const saved=await readPersistedState(data);if(saved.settings.apiKey!==expectedKey)throw Error('Initial API key differs from build defaults.');
 const second=spawn(process.execPath,[path.join(fixture,'launcher.cjs')],{env:{...env,PORT:new URL(address).port},stdio:['ignore','pipe','pipe']});
 let secondOutput='';second.stdout.on('data',b=>secondOutput+=b);
 const secondCode=await new Promise((resolve,reject)=>{const t=setTimeout(()=>{second.kill();reject(Error('Second launch did not exit'));},5000);second.once('exit',code=>{clearTimeout(t);resolve(code);});});
 assert.equal(secondCode,0);assert(secondOutput.includes('Tool da chay.'));
 assert.equal(JSON.parse(await fs.readFile(path.join(data,'process.lock'),'utf8')).pid,pid);
 const denied=await fetch(address+'/api/app-quit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
 const quit=await fetch(address+'/api/app-quit',{method:'POST',headers:{Origin:address,'X-Tool-Token':state.token,'Content-Type':'application/json'},body:'{}'});assert(quit.ok);
 const result=await Promise.race([exited,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Shutdown timeout')),10000);t.unref();})]);
 assert.equal(result.code,0);pid=null;child=null;
 await assert.rejects(fs.access(path.join(data,'process.lock')));
 if((await readPersistedState(data)).settings.apiKey!==expectedKey)throw Error('API key was not preserved.');
 if(process.platform==='win32'){
  await promisify(execFile)(path.join(payload,'HoanXuDesktop.exe'),['--smoke-test'],{timeout:90000,env:{...process.env,PORT:'0'}});
  const old=path.join(fixture,'fixture portable.exe'),source=path.join(data,'updates','stage-fixture','update.exe');await fs.mkdir(path.dirname(source),{recursive:true});await fs.writeFile(old,'old fixture');await fs.writeFile(source,'new fixture');await fs.writeFile(path.join(data,'update-install.json'),'{}');
  const before=JSON.stringify(await readPersistedState(data));
  await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(payload,'update.ps1'),'-Source',source,'-Target',old,'-PortablePid','2147483647','-DataPath',data,'-NoOpen']);
  assert.equal(await fs.readFile(old,'utf8'),'new fixture');assert.deepEqual(JSON.stringify(await readPersistedState(data)),before);await assert.rejects(fs.access(path.join(data,'update-install.json')));
 }
 console.log('PASS: payload privacy, Windows x64 native GUI/runtime, isolated backend, relaunch and shutdown. '+(process.platform==='win32'?'Native WPF settings/save and update helper executed.':'Native WPF runtime requires Windows; PE and backend checked on build host.'));
}finally{
 if(pid)try{process.kill(pid,'SIGTERM');}catch{}
 if(child)child.kill('SIGTERM');
 await fs.rm(fixture,{recursive:true,force:true});
}

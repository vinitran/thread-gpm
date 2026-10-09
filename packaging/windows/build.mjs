import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {repository,APP_ID} from '../../gpm-tool/updates.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),work=path.join(root,'.build','windows'),app=path.join(work,'payload'),out=path.join(root,'release');
async function run(command,args,cwd=root){await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,stdio:'inherit',env:{...process.env,PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',NSISDIR:process.env.NSISDIR||(process.platform==='win32'&&process.env.MAKENSIS?path.dirname(process.env.MAKENSIS):path.join(work,'nsis'))}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(command+' failed: '+code)));});}
async function download(url,file){const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error('Download HTTP '+r.status+': '+url);const bytes=Buffer.from(await r.arrayBuffer());await fs.writeFile(file,bytes);return createHash('sha256').update(bytes).digest('hex');}
async function copy(relative){const dest=path.join(app,relative);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(root,relative),dest);}
await fs.mkdir(work,{recursive:true});await fs.mkdir(out,{recursive:true});await fs.rm(app,{recursive:true,force:true});await fs.mkdir(app,{recursive:true});
const version=JSON.parse(await fs.readFile(path.join(root,'gpm-tool/package.json'),'utf8')).version;
const updateRepo=repository(process.env.GPM_UPDATE_REPOSITORY||'vinitran/thread-gpm');
await fs.writeFile(path.join(app,'release-config.json'),JSON.stringify({repository:updateRepo,updatesEnabled:process.env.GPM_UPDATES_ENABLED!=='0'}));
for(const name of await fs.readdir(path.join(root,'gpm-tool'))){if(name.endsWith('.mjs')&&!/test|smoke/.test(name))await copy('gpm-tool/'+name);}
for(const name of ['package.json','package-lock.json'])await copy('gpm-tool/'+name);
let windowsGuide=await fs.readFile(path.join(root,'packaging/windows/HUONG-DAN-WINDOWS.md'),'utf8');
windowsGuide=windowsGuide.replace(/HoanXu-GPM-\d+\.\d+\.\d+-win-x64-portable\.exe/g,`HoanXu-GPM-${version}-win-x64-portable.exe`);
const fullGuide=await fs.readFile(path.join(root,'gpm-tool/HUONG-DAN-SU-DUNG.md'),'utf8');
await fs.writeFile(path.join(app,'gpm-tool/HUONG-DAN-SU-DUNG.md'),windowsGuide+'\n\n'+fullGuide.slice(fullGuide.indexOf('## 2. Thêm profile')));
await fs.writeFile(path.join(app,'package.json'),JSON.stringify({private:true,type:'module'}));
await fs.writeFile(path.join(out,'HUONG-DAN-WINDOWS.md'),windowsGuide);
await fs.cp(path.join(root,'gpm-tool/public'),path.join(app,'gpm-tool/public'),{recursive:true});
for(const name of ['pointer-input.js','ai.js','auto-runner.js','auto-dom.js','extract.js','feed-collector.js','post-reply.js','reply-dom.js','reply-assets.js','tab-actions.js','default-prompt.txt'])await copy('extension/'+name);
await fs.cp(path.join(root,'extension/managed'),path.join(app,'extension/managed'),{recursive:true});
await fs.cp(path.join(root,'extension/default-assets'),path.join(app,'extension/default-assets'),{recursive:true});await fs.copyFile(path.join(root,'packaging/windows/launcher.cjs'),path.join(app,'launcher.cjs'));await fs.copyFile(path.join(root,'packaging/windows/update.ps1'),path.join(app,'update.ps1'));
console.log('Publishing native WPF Windows x64 application...');
await run(process.env.DOTNET||'dotnet',['publish',path.join(root,'desktop/windows/HoanXuDesktop.csproj'),'-c','Release','-r','win-x64','--self-contained','true','-o',app]);
console.log('Installing Windows x64 runtime dependencies (staging only)...');
const npmArgs=['ci','--omit=dev','--include=optional','--os=win32','--cpu=x64','--ignore-scripts','--no-audit','--no-fund'];
if(process.platform==='win32'){
 // Windows cannot spawn npm.cmd directly. Execute npm's JS entry with Node.
 const npmCli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
 await fs.access(npmCli);await run(process.execPath,[npmCli,...npmArgs],path.join(app,'gpm-tool'));
}else await run('npm',npmArgs,path.join(app,'gpm-tool'));
const sharpLib=path.join(app,'gpm-tool/node_modules/@img/sharp-win32-x64/lib');if(!(await fs.readdir(sharpLib)).some(name=>/^sharp-win32-x64.*\.node$/.test(name)))throw Error('Windows sharp native binary missing');
const sums=await fetch('https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt').then(r=>{if(!r.ok)throw Error('Cannot read Node checksums');return r.text();});const line=sums.split('\n').find(l=>/node-v[^ ]+-win-x64.zip$/.test(l));if(!line)throw Error('Node Windows x64 checksum missing');const [expected,name]=line.trim().split(/\s+/),nodeZip=path.join(work,name);
console.log('Downloading official Node runtime: '+name);let actual;try{actual=createHash('sha256').update(await fs.readFile(nodeZip)).digest('hex');}catch{}if(actual!==expected)actual=await download('https://nodejs.org/dist/latest-v22.x/'+name,nodeZip);if(actual!==expected)throw Error('Node download checksum mismatch');
const nodeDir=path.join(work,'node-runtime');await fs.mkdir(nodeDir,{recursive:true});
await run('tar',['-xf',nodeZip,'-C',nodeDir]);
const unpacked=path.join(nodeDir,name.replace(/\.zip$/,''));await fs.copyFile(path.join(unpacked,'node.exe'),path.join(app,'node.exe'));await fs.copyFile(path.join(unpacked,'LICENSE'),path.join(app,'NODE-LICENSE.txt'));
const nsisDir=path.join(work,'nsis'),nsisArchive=path.join(work,'nsis.7z'),nsisUrl='https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z';await fs.mkdir(nsisDir,{recursive:true});const makensis=process.platform==='darwin'?path.join(nsisDir,'mac/makensis'):process.platform==='linux'?path.join(nsisDir,'linux/makensis'):process.env.MAKENSIS;
if(!makensis)throw Error('On Windows set MAKENSIS to installed makensis.exe.');
try{await fs.access(makensis);}catch{await download(nsisUrl,nsisArchive);await run('tar',['-xf',nsisArchive,'-C',nsisDir]);}
const artifact=path.join(out,'HoanXu-GPM-'+version+'-win-x64-portable.exe');
const quote=value=>value.replace(/\$/g,'$$$$').replace(/"/g,'$\\"');
// Use the build host's separator: Windows NSIS rejects mixed payload/* paths.
const payloadGlob=path.join(app,'*');
const script=`Unicode true\n!include "x64.nsh"\nName "Hoan Xu GPM Tool"\nOutFile "${quote(artifact)}"\nRequestExecutionLevel user\nSilentInstall silent\nSetCompressor lzma\nSetCompressorDictSize 16\nFunction .onInit\n  \${IfNot} \${RunningX64}\n    MessageBox MB_ICONSTOP "Windows 64-bit is required."\n    Abort\n  \${EndIf}\nFunctionEnd\nSection\n  System::Call 'kernel32::SetEnvironmentVariableW(w "GPM_TOOL_EXE_PATH", w "$EXEPATH") i .r0'\n  System::Call 'kernel32::GetCurrentProcessId() i .r1'\n  System::Call 'kernel32::SetEnvironmentVariableW(w "GPM_TOOL_PORTABLE_PID", w "$1") i .r0'\n  InitPluginsDir\n  SetOutPath "$PLUGINSDIR\\app"\n  File /r "${quote(payloadGlob)}"\n  ExecWait '"$PLUGINSDIR\\app\\HoanXuDesktop.exe"' $0\n  SetErrorLevel $0\nSectionEnd\n`;
const nsi=path.join(work,'portable.nsi');await fs.writeFile(nsi,script);console.log('Building portable EXE...');await run(makensis,['-V2',nsi],nsisDir);
const bytes=await fs.readFile(artifact);if(bytes.toString('ascii',0,2)!=='MZ')throw Error('Artifact is not a Windows executable');const sha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(artifact+'.sha256',sha256+'  '+path.basename(artifact)+'\n');
await fs.writeFile(path.join(out,'hoanxu-windows-x64.json'),JSON.stringify({format:'hoanxu-windows-update',bundleId:APP_ID,version,platform:'win32',arch:'x64',bytes:bytes.length,sha256,url:`https://github.com/${updateRepo}/releases/download/v${version}/${path.basename(artifact)}`},null,2)+'\n');
await fs.writeFile(path.join(out,'windows-build-manifest.json'),JSON.stringify({version,artifact:path.basename(artifact),bytes:bytes.length,sha256,nodeArchive:name,nodeArchiveSha256:expected,platform:'win32',arch:'x64',dataPath:'%LOCALAPPDATA%\\HoanXu-GPM\\data',embeddedApiKey:false,windowsRuntimeTested:false},null,2));console.log('Built '+artifact+' ('+Math.round(bytes.length/1048576)+' MB)');

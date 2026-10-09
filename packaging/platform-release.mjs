import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);
const cli=async args=>(await execute('gh',args,{maxBuffer:4*1024*1024})).stdout;
export async function platformRelease(mode,platform,{tag=process.env.RELEASE_TAG,commit=process.env.RELEASE_COMMIT,dir='release',gh=cli}={}){
 if(!/^v\d+\.\d+\.\d+$/.test(tag||'')||!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Invalid release tag or commit');
 const read=async()=>JSON.parse(await gh(['release','view',tag,'--json','targetCommitish,isDraft,assets']));
 const validate=r=>{if(r.targetCommitish!==commit)throw Error('Release belongs to a different commit');return r;};
 let release;
 if(mode==='reserve'){
  try{release=await read();}catch{await gh(['release','create',tag,'--draft','--target',commit,'--title','HoanXu GPM '+tag,'--generate-notes']);release=await read();}
  validate(release);return;
 }
 if(mode!=='publish'||!['macos','windows'].includes(platform))throw Error('Invalid platform release command');
 release=validate(await read());
 const manifest=platform==='macos'?'hoanxu-macos-arm64.json':'hoanxu-windows-x64.json';
 const metadata=JSON.parse(await fs.readFile(path.join(dir,manifest),'utf8'));
 if('v'+metadata.version!==tag||metadata.platform!==(platform==='macos'?'darwin':'win32'))throw Error('Artifact version/platform does not match release');
 const files=(await fs.readdir(dir)).sort((a,b)=>(a===manifest?1:0)-(b===manifest?1:0));
 const binary=platform==='macos'?`HoanXu-GPM-${metadata.version}-mac-arm64.dmg`:`HoanXu-GPM-${metadata.version}-win-x64-portable.exe`;
 if(!files.includes(binary)||!files.includes(binary+'.sha256'))throw Error('Missing platform binary/checksum');
 const present=new Set(release.assets.map(a=>a.name));
 if(!files.every(f=>present.has(f))){
  // Repair only an incomplete platform upload. Complete published builds are preserved.
  // The other platform's assets are never removed; upload the update manifest last.
  for(const name of files)if(present.has(name))await gh(['release','delete-asset',tag,name,'--yes']);
  for(const name of files)await gh(['release','upload',tag,path.join(dir,name)]);
 }
 // The first completed platform makes the shared draft public. The second adds assets.
 await gh(['release','edit',tag,'--draft=false','--latest']);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await platformRelease(process.argv[2],process.argv[3]);

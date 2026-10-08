import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
export const APP_ID='com.hoanxu.gpm-tool';
const base=path.dirname(fileURLToPath(import.meta.url));
export const VERSION=JSON.parse(await fs.readFile(path.join(base,'package.json'),'utf8')).version;
export function repository(value){
 if(typeof value!=='string'||!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[\w.-]{1,100}$/.test(value)||['.','..'].includes(value.split('/')[1]))throw Error('Repository cập nhật cần có dạng owner/repo.');
 return value;
}
export function newer(a,b){
 if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b)||[...a.split('.'),...b.split('.')].some(n=>!Number.isSafeInteger(Number(n))))throw Error('Phiên bản cập nhật không hợp lệ.');
 const x=a.split('.').map(Number),y=b.split('.').map(Number);
 for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];
 return false;
}
export function validateManifest(v,repo,arch,platform='darwin'){
 const windows=platform==='win32';
 if(!v||v.format!==(windows?'hoanxu-windows-update':'hoanxu-macos-update')||v.bundleId!==APP_ID||v.platform!==platform||v.arch!==arch||!newer(v.version,'0.0.0'))throw Error('Bản cập nhật không đúng ứng dụng hoặc kiến trúc máy.');
 if(!/^[a-f0-9]{64}$/.test(v.sha256)||!Number.isSafeInteger(v.bytes)||v.bytes<1||v.bytes>500*1024*1024)throw Error('Checksum hoặc kích thước bản cập nhật không hợp lệ.');
 const filename=windows?`HoanXu-GPM-${v.version}-win-x64-portable.exe`:`HoanXu-GPM-${v.version}-mac-${arch}.dmg`;
 const url=`https://github.com/${repository(repo)}/releases/download/v${v.version}/${filename}`;
 if(v.url!==url)throw Error('Link cập nhật không thuộc GitHub Releases đã cấu hình.');
 return {version:v.version,sha256:v.sha256,bytes:v.bytes,url,filename};
}
function allowedRedirect(url){const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='github.com'||u.hostname==='release-assets.githubusercontent.com'||u.hostname==='objects.githubusercontent.com');}
async function githubFetch(fetcher,url,signal){
 for(let i=0;i<8;i++){
  if(!allowedRedirect(url))throw Error('Máy chủ tải cập nhật không hợp lệ.');
  const r=await fetcher(url,{redirect:'manual',signal,headers:{'User-Agent':'HoanXu-GPM-Updater','Accept':'application/octet-stream'}});
  if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('location'),url).href;continue;}
  return r;
 }
 throw Error('Quá nhiều chuyển hướng khi tải bản cập nhật.');
}
export function assertUpdateIdle(rows,operation,locks=0){
 if(operation||locks||rows.some(p=>['running','stopping'].includes(p.view?.state?.status)||p.view?.operation))throw Error('Dừng các profile và đợi thao tác hoàn tất trước khi cài cập nhật.');
}
async function safeTree(root,current=root){
 for(const entry of await fs.readdir(current,{withFileTypes:true})){
  const item=path.join(current,entry.name);
  if(entry.isSymbolicLink()){const real=await fs.realpath(item);if(!real.startsWith(root+path.sep))throw Error('App cập nhật có liên kết ra ngoài bộ file.');}
  else if(entry.isDirectory())await safeTree(root,item);
 }
}
export class Updater{
 constructor({dir,repo,appPath=process.env.GPM_TOOL_APP_PATH||process.env.GPM_TOOL_EXE_PATH,version=VERSION,arch=process.arch,platform=process.platform,fetcher=fetch,execute=exec}={}){
  this.dir=dir;this.repo=repo?repository(repo):null;this.appPath=appPath;this.version=version;this.arch=arch;this.platform=platform;this.fetcher=fetcher;this.execute=execute;
  this.value={currentVersion:version,repository:this.repo,installSupported:!!appPath&&((platform==='darwin'&&arch==='arm64')||(platform==='win32'&&arch==='x64')),available:false,checkedAt:null,checkError:null};
 }
 status(){return {...this.value};}
 async check(){
  if(this.busy)throw Error('Đang tải bản cập nhật.');
  try{
  if(!this.repo)throw Error('Chưa cấu hình GitHub repository cho cập nhật.');
  if(!((this.platform==='darwin'&&this.arch==='arm64')||(this.platform==='win32'&&this.arch==='x64')))throw Error('Cập nhật chỉ hỗ trợ Mac Apple Silicon và Windows x64.');
  const r=await githubFetch(this.fetcher,`https://github.com/${this.repo}/releases/latest/download/hoanxu-${this.platform==='win32'?'windows':'macos'}-${this.arch}.json`,AbortSignal.timeout(20000));
  if(!r.ok){if(r.status===404)throw Error('Chưa có bản phát hành phù hợp hoặc repository chưa công khai.');throw Error('Không tải được thông tin cập nhật · HTTP '+r.status);}
  let bytes=Buffer.alloc(0);for await(const chunk of r.body){bytes=Buffer.concat([bytes,Buffer.from(chunk)]);if(bytes.length>16384)throw Error('Thông tin cập nhật quá lớn.');}
  const candidate=validateManifest(JSON.parse(bytes.toString()),this.repo,this.arch,this.platform);
  this.candidate=candidate;this.value={...this.value,checkedAt:new Date().toISOString(),checkError:null,available:newer(candidate.version,this.version),latestVersion:candidate.version,url:candidate.url};
  return this.status();
  }catch(error){this.value={...this.value,checkError:error.message};throw error;}
 }
 async stage(){
  if(this.busy)throw Error('Đang tải bản cập nhật.');
  if(!this.value.installSupported)throw Error('Mở bản app đã đóng gói để cập nhật trong app.');
  if(!this.candidate||!newer(this.candidate.version,this.version))throw Error('Chưa có bản mới. Bấm Kiểm tra cập nhật trước.');
  this.busy=true;this.value.download={phase:'downloading',receivedBytes:0,totalBytes:this.candidate.bytes,percent:0,message:'Đang tải bản cập nhật · 0%'};let work,mounted=false,ready=false;
  try{
   const candidate=this.candidate;
   const windows=this.platform==='win32';
   if(windows?!/\.exe$/i.test(this.appPath):(!this.appPath.endsWith('.app')||this.appPath.startsWith('/Volumes/')))throw Error('Mở EXE portable hoặc kéo app Mac vào Applications trước khi cập nhật.');
   await fs.access(path.dirname(this.appPath),2);
   const updates=path.join(this.dir,'updates');await fs.mkdir(updates,{recursive:true,mode:0o700});work=await fs.mkdtemp(path.join(updates,'stage-'));
   const file=path.join(work,windows?'update.exe':'update.dmg'),volume=path.join(work,'volume'),app=path.join(work,'HoanXu GPM.app');
   const r=await githubFetch(this.fetcher,candidate.url,AbortSignal.timeout(180000));if(!r.ok)throw Error('Tải bản cập nhật thất bại · HTTP '+r.status);
   const hash=createHash('sha256'),handle=await fs.open(file,'wx',0o600);let size=0;
   try{for await(const raw of r.body){const chunk=Buffer.from(raw);size+=chunk.length;if(size>candidate.bytes)throw Error('Kích thước tải xuống vượt manifest.');hash.update(chunk);await handle.writeFile(chunk);this.value.download={phase:'downloading',receivedBytes:size,totalBytes:candidate.bytes,percent:Math.floor(size/candidate.bytes*100),message:`Đang tải bản cập nhật · ${Math.floor(size/candidate.bytes*100)}% · ${(size/1048576).toFixed(1)} / ${(candidate.bytes/1048576).toFixed(1)} MB`};}}finally{await handle.close();}
   if(size!==candidate.bytes||hash.digest('hex')!==candidate.sha256)throw Error('Bản tải về sai checksum hoặc thiếu dữ liệu. Chưa thay đổi app.');
   this.value.download={...this.value.download,phase:'verifying',message:'Đã tải 100% · đang xác minh và chuẩn bị cài đặt…'};
   if(windows){
    const h=await fs.open(file,'r'),header=Buffer.alloc(4096);let n;
    try{n=(await h.read(header,0,header.length,0)).bytesRead;}finally{await h.close();}
    const offset=n>=64?header.readUInt32LE(0x3c):-1;
    // NSIS uses an x86 installer stub; its guarded payload contains Node/Sharp x64.
    if(header.toString('ascii',0,2)!=='MZ'||offset<64||offset+6>n||header.toString('ascii',offset,offset+4)!=='PE\0\0'||![0x8664,0x14c].includes(header.readUInt16LE(offset+4)))throw Error('File cập nhật không phải EXE portable cho Windows x64.');
    const request=path.join(this.dir,'update-install.json');await fs.writeFile(request+'.tmp',JSON.stringify({id:randomUUID(),source:file,target:this.appPath,version:candidate.version}),{mode:0o600});await fs.rename(request+'.tmp',request);ready=true;return {ok:true,restarting:true,version:candidate.version};
   }
   await fs.mkdir(volume);await this.execute('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',volume,file],{timeout:30000});mounted=true;
   const source=path.join(volume,'HoanXu GPM.app');
   await safeTree(await fs.realpath(source));
   await this.execute('/usr/bin/codesign',['--verify','--deep','--strict',source],{timeout:30000});
   const {stdout}=await this.execute('/usr/bin/plutil',['-convert','json','-o','-',path.join(source,'Contents/Info.plist')]);const info=JSON.parse(stdout);
   if(info.CFBundleIdentifier!==APP_ID||info.CFBundleShortVersionString!==candidate.version||info.CFBundleExecutable!=='HoanXuGPM')throw Error('Ứng dụng trong DMG không khớp bản cập nhật.');
   // A Developer ID build only accepts updates from the same team. Ad-hoc builds trust the configured GitHub release and its digest.
   const details=async target=>{const result=await this.execute('/usr/bin/codesign',['-dv','--verbose=4',target]);return (result.stderr||'').match(/TeamIdentifier=([^\n]+)/)?.[1].trim();};
   const oldTeam=await details(this.appPath),newTeam=await details(source);if(oldTeam&&oldTeam!=='not set'&&oldTeam!==newTeam)throw Error('Bản cập nhật không cùng nhà phát hành với app đang dùng.');
   await fs.cp(source,app,{recursive:true,dereference:false,verbatimSymlinks:true});
   await this.execute('/usr/bin/codesign',['--verify','--deep','--strict',app],{timeout:30000});
   const request=path.join(this.dir,'update-install.json'),tmp=request+'.tmp';
   await fs.writeFile(tmp,JSON.stringify({id:randomUUID(),source:app,target:this.appPath,version:candidate.version}),{mode:0o600});await fs.rename(tmp,request);
   ready=true;
   return {ok:true,restarting:true,version:candidate.version};
  }
  finally{if(mounted){try{await this.execute('/usr/bin/hdiutil',['detach',path.join(work,'volume')],{timeout:30000});mounted=false;}catch{}}
   if(work&&!mounted&&!ready)await fs.rm(work,{recursive:true,force:true});
   this.value.download={...this.value.download,phase:ready?'ready':'failed',message:ready?'Đã tải 100% · đang cài và mở lại app…':'Tải/cài cập nhật chưa hoàn tất. Hãy thử lại.'};
   this.busy=false;
  }
 }
}

export async function updateRepository(){
 if(process.env.GPM_UPDATE_REPOSITORY)return repository(process.env.GPM_UPDATE_REPOSITORY);
 try{const config=JSON.parse(await fs.readFile(path.join(base,'../release-config.json'),'utf8'));return config.updatesEnabled===false?null:repository(config.repository);}catch(e){if(e.code==='ENOENT')return null;throw e;}
}

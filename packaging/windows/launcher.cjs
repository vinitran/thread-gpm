const path=require('node:path');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
async function launchUpdater(dir){
 const request=JSON.parse(await fs.readFile(path.join(dir,'update-install.json'),'utf8'));
 const target=process.env.GPM_TOOL_EXE_PATH,portablePid=Number(process.env.GPM_TOOL_PORTABLE_PID);
 if(!target||request.target!==target||!Number.isInteger(portablePid)||portablePid<=0||!request.source.startsWith(path.join(dir,'updates')+path.sep))throw Error('Thong tin cap nhat portable khong hop le.');
 const script=path.join(dir,'updates','helper-'+Date.now()+'.ps1');await fs.copyFile(path.join(__dirname,'update.ps1'),script);
 const helper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Source',request.source,'-Target',target,'-PortablePid',String(portablePid),'-DataPath',dir],{detached:true,windowsHide:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{helper.once('spawn',resolve);helper.once('error',reject);});helper.unref();
}
function dataDir(env=process.env){if(env.GPM_TOOL_DATA)return path.resolve(env.GPM_TOOL_DATA);if(!env.LOCALAPPDATA)throw Error('Khong tim thay LOCALAPPDATA cua Windows.');return path.join(env.LOCALAPPDATA,'HoanXu-GPM','data');}
function dashboard(value='4317'){const port=Number(value);if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT khong hop le.');return 'http://127.0.0.1:'+port;}
function openBrowser(url){if(process.env.GPM_TOOL_NO_BROWSER==='1')return;const child=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}):spawn('open',[url],{stdio:'ignore'});child.on('error',()=>console.log('Mo trinh duyet tai '+url));child.unref();}
async function main(){
 const address=dashboard(process.env.PORT||'4317');
 if(!address.endsWith(':0')){try{const r=await fetch(address+'/api/state',{signal:AbortSignal.timeout(1500)}),v=await r.json();if(r.ok&&typeof v.version==='string'&&v.state&&v.counts){console.log('Tool da chay. Mo '+address);openBrowser(address);return;}}catch{}}
 const dir=dataDir();console.log('Hoan Xu - GPM Tool (Windows portable)');console.log('Mo GPMLogin truoc khi chay profile; kiem tra Local API trong Cai dat tool.');console.log('Du lieu duoc luu tai: '+dir);console.log('Giu cua so nay mo. Dung cac profile dang chay trong dashboard truoc khi dong tool.');
 const child=spawn(process.execPath,[path.join(__dirname,'gpm-tool','server.mjs')],{cwd:path.join(__dirname,'gpm-tool'),env:{...process.env,GPM_TOOL_DATA:dir,PORT:process.env.PORT||'4317'},stdio:['inherit','pipe','inherit']});let buffer='',opened=false;
 child.stdout.on('data',chunk=>{process.stdout.write(chunk);buffer=(buffer+chunk.toString()).slice(-4000);const match=buffer.match(/GPM tool UI: (http:\/\/127\.0\.0\.1:\d+)/);if(match&&!opened){opened=true;openBrowser(match[1]);}});
 // Ctrl+C is broadcast to both console processes; let server flush checkpoints itself.
 const interrupt=()=>console.log('Dang dong tool va luu du lieu...');process.on('SIGINT',interrupt);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?1:0)));});process.off('SIGINT',interrupt);if(code===42){await launchUpdater(dir);return;}if(code!==0)throw Error('Tool thoat voi ma '+code+'. Kiem tra thong bao ben tren.');
}
module.exports={dataDir,dashboard};
if(require.main===module)main().catch(e=>{console.error(e.message);console.error('Nhan Enter de dong.');process.exitCode=1;process.stdin.resume();process.stdin.once('data',()=>process.exit(1));});

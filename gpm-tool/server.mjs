import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from './store.mjs';
import {GpmBrowser} from './browser.mjs';
import {createRunner,root} from './runner.mjs';
import {dryRunProfile} from './dry-run.mjs';
import {GpmApi,checkGpmConnection,parseProxy} from './gpm-api.mjs';
import {AUTO_DEFAULTS,autoConfig} from '../extension/auto-runner.js';
import {autoPage} from '../extension/auto-dom.js';
import {models} from '../extension/ai.js';
import {assetSummary,listAssets} from './assets.mjs';
import {validateSettings,publicSettings,redact,assertLiveSettings,applyRunnerSettings} from './settings.mjs';
import {dashboard} from './dashboard.mjs';
import {ProfileManager} from './profile-manager.mjs';
import {captureSession,restoreSession} from './profile-transfer.mjs';
import {ProfileImporter} from './profile-import.mjs';
import {Updater,VERSION,updateRepository,assertUpdateIdle} from './updates.mjs';
import {ExtensionBridge} from './extension-bridge.mjs';
import {stageManagedExtension,extensionArguments,connectManagedExtension,MANAGED_EXTENSION_ID} from './managed-extension.mjs';
let port=Number(process.env.PORT||4317);const isWorker=process.env.GPM_TOOL_WORKER==='1',dataDir=path.resolve(process.env.GPM_TOOL_DATA||path.join(root,'data'));
await fs.mkdir(dataDir,{recursive:true});
const lockPath=path.join(dataDir,'process.lock');
try{const existing=JSON.parse(await fs.readFile(lockPath,'utf8'));try{process.kill(existing.pid,0);throw Error('Tool đang chạy với data folder này (PID '+existing.pid+').');}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}
const lock=await fs.open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));await lock.close();
const store=await new Store(dataDir).load();
if(!store.value.settings)await store.set({settings:{gpmApi:process.platform==='win32'?'http://127.0.0.1:19995/api/v3':'http://127.0.0.1:9495/api/v1',cdp:'http://127.0.0.1:9222',apiKey:'',model:'cx/gpt-5.6-luna',prompt:await fs.readFile(path.join(root,'../extension/default-prompt.txt'),'utf8'),runConfig:AUTO_DEFAULTS}});
if(!store.value.settings.gpmApi&&process.platform==='win32')await store.set({settings:{...store.value.settings,gpmApi:'http://127.0.0.1:19995/api/v3'}});
const environmentKey=process.env.HOANXU_API_KEY?.trim();
if(environmentKey){
 if(environmentKey.length>512)throw Error('HOANXU_API_KEY không hợp lệ.');
 const patch={};if(!store.value.settings.apiKey)patch.settings={...store.value.settings,apiKey:environmentKey};
 if(store.value.sharedSettings&&!store.value.sharedSettings.apiKey)patch.sharedSettings={...store.value.sharedSettings,apiKey:environmentKey};
 if(Object.keys(patch).length)await store.set(patch);
}
const browser=new GpmBrowser(store),runner=createRunner(store,browser),clients=new Set();
const token=randomBytes(24).toString('hex');let operation=null,startEpoch=0,publishing,shuttingDown=false,manager,importer,pendingPosts=0;
let extensionBridge;
const updater=isWorker?null:new Updater({dir:dataDir,repo:await updateRepository()});
const active=()=>['running','stopping'].includes(runner.state?.status);
function idleOnly(){if(operation||active())throw Error('Stop và đợi thao tác hiện tại hoàn tất trước khi chỉnh cài đặt.');}
function view(){const profiles=manager?.rows();const selected=profiles?.find(p=>p.id===store.value.settings.profileId);return {...(selected?.view||dashboard(store.value,!!browser.browser?.isConnected())),operation,version:VERSION,updateDownload:updater?.status().download,...(manager?{profiles,selectedProfileId:store.value.settings.profileId}:{})};}
browser.onDisconnected=()=>broadcast();
function broadcast(){if(isWorker&&process.connected)process.send({type:'view',view:view()});const message='data: '+JSON.stringify(view())+'\n\n';for(const response of clients){if(response.writableLength>1024*1024){response.destroy();clients.delete(response);}else response.write(message);}}
store.subscribe(()=>{clearTimeout(publishing);publishing=setTimeout(broadcast,150);});
const heartbeat=setInterval(()=>{for(const res of clients)res.write(': heartbeat\n\n');},15000);heartbeat.unref();
async function exclusive(name,fn){if(operation)throw Error('Đang xử lý '+operation+'.');operation=name;broadcast();try{return await fn();}finally{operation=null;broadcast();}}
async function body(req,limit=100000){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>limit)throw Error('Request quá lớn');}return data?JSON.parse(data):{};}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function connect(){const s=store.value.settings;await browser.connect(s.cdp);browser.installChrome();if(isWorker)browser.profileId=s.profileId;}
async function enableExtension(configured,result,epoch=startEpoch,staged){
 staged??=await stageManagedExtension(dataDir);const api=new GpmApi(configured.gpmApi);
 extensionBridge?.close();browser.extensionBridge=null;
 const bridge=new ExtensionBridge(()=>({status:runner.state.status,message:runner.state.activity?.message||'Sẵn sàng',engine:'extension'}));extensionBridge=bridge;
 const check=()=>{if(shuttingDown||startEpoch!==epoch)throw Error('Đã hủy kết nối extension do Dừng.');};
 let restarted=false;
 const restart=async()=>{
  check();await api.stop(configured.profileId);check();
  const deadline=Date.now()+10000;while(browser.browser?.isConnected()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));
  if(browser.browser?.isConnected())throw Error('GPM chưa đóng profile để nạp extension.');
  check();result=await api.open(configured.profileId,{additionArgs:extensionArguments(staged.directory)});check();
  await store.set({settings:{...configured,cdp:result.cdp,profileName:result.profileName}});await connect();restarted=true;
 };
 try{
  if(store.value.extensionRevision&&store.value.extensionRevision!==staged.revision)await restart();
  check();await connect();
  try{await connectManagedExtension(browser,bridge,{directory:staged.directory,base:`http://127.0.0.1:${port}`,loadExtension:!restarted});}
  catch{check();await restart();await connectManagedExtension(browser,bridge,{directory:staged.directory,base:`http://127.0.0.1:${port}`,loadExtension:false});}
  check();browser.installChrome();await store.set({executionMode:'extension',extensionRevision:staged.revision});return result;
 }catch(e){bridge.close();if(extensionBridge===bridge)extensionBridge=null;browser.extensionBridge=null;throw e;}
}
async function assets(folder){try{return await assetSummary(folder);}catch(e){return {error:e.message,count:0,names:[]};}}
const server=http.createServer(async(req,res)=>{
 let trackedPost=false;
 try{
  if(shuttingDown)return json(res,{error:'Tool đang tắt. Hãy mở lại sau.'},503);
  if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`)return json(res,{error:'Invalid host'},403);
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(isWorker&&extensionBridge&&!extensionBridge.closed&&url.pathname.startsWith('/api/extension/')&&req.headers.origin==='chrome-extension://'+MANAGED_EXTENSION_ID){
   res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
   if(req.method==='OPTIONS'){
    if(req.headers['access-control-request-method']!=='POST')return json(res,{error:'Invalid extension method'},403);
    const requested=(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    if(requested.some(h=>!['content-type','x-extension-token'].includes(h)))return json(res,{error:'Invalid extension headers'},403);
    res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, X-Extension-Token','Access-Control-Allow-Private-Network':'true'});return res.end();
   }
  }
  if(isWorker&&req.method==='POST'&&url.pathname.startsWith('/api/extension/')){
   const bridge=extensionBridge;
   if(!bridge?.authorize(req.headers,MANAGED_EXTENSION_ID))return json(res,{error:'Invalid extension origin/token'},403);
   const input=await body(req,8*1024*1024);
   if(bridge!==extensionBridge||!bridge.authorize(req.headers,MANAGED_EXTENSION_ID))return json(res,{error:'Extension connection replaced'},403);
   if(url.pathname==='/api/extension/poll'){
    const aborted=new AbortController(),disconnected=()=>aborted.abort();res.once('close',disconnected);if(res.destroyed)aborted.abort();
    try{const result=await bridge.poll(aborted.signal);if(!res.destroyed)return json(res,result);return;}finally{res.off('close',disconnected);}
   }
   if(url.pathname==='/api/extension/result')return json(res,{ok:extensionBridge.result(input)});
   if(url.pathname==='/api/extension/status'){extensionBridge.touch();return json(res,extensionBridge.status());}
   if(url.pathname==='/api/extension/stop'){startEpoch++;const results=await Promise.allSettled([new GpmApi(store.value.settings.gpmApi).stop(store.value.settings.profileId),runner.stop()]);extensionBridge?.close();for(const r of results)if(r.status==='rejected')throw r.reason;return json(res,{ok:true});}
   return json(res,{error:'Not found'},404);
  }
  if(req.method==='GET'&&url.pathname==='/api/update-status'&&updater)return json(res,updater.status());
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,{...view(),token,settings:publicSettings(manager?(store.value.sharedSettings||store.value.settings):store.value.settings),assets:await assets((manager?(store.value.sharedSettings||store.value.settings):store.value.settings).imagesFolder),defaults:AUTO_DEFAULTS});
  if(req.method==='GET'&&url.pathname==='/api/events'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});clients.add(res);res.write('data: '+JSON.stringify(view())+'\n\n');req.on('close',()=>clients.delete(res));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/profile-settings'&&manager){const id=url.searchParams.get('profileId');if(!store.value.profileRegistry?.[id])throw Error('Profile chưa có cấu hình.');const data=await manager.profileStore(id);const live=manager.live.get(id);const settings=live?.fresh&&live.status==='present'?{...data.value.settings,profileName:live.metadata.name,proxy:live.metadata.proxy}:data.value.settings;return json(res,{settings:publicSettings(settings)});}
  if(req.method==='GET'&&url.pathname==='/api/history'&&manager)return json(res,await manager.history(url.searchParams.get('profileId')||store.value.settings.profileId));
  if(req.method==='GET'&&url.pathname==='/api/history')return json(res,{exportedAt:new Date().toISOString(),state:store.value.autoRun,receipts:store.value.replyReceipts||{},tabLifecycle:store.value.tabLifecycle||{}});
  if(req.method==='GET'&&url.pathname==='/api/asset'){
   const {files}=await listAssets((store.value.sharedSettings||store.value.settings).imagesFolder),index=Number(url.searchParams.get('index'));if(!Number.isInteger(index)||!files[index])return json(res,{error:'Ảnh không tồn tại'},404);
   const name=files[index].name,resType=/\.png$/i.test(name)?'image/png':/\.webp$/i.test(name)?'image/webp':'image/jpeg';res.writeHead(200,{'Content-Type':resType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(await fs.readFile(files[index].filename));
  }
  if(req.method==='POST'){
   if(req.headers['x-tool-token']!==token||req.headers.origin!==`http://${req.headers.host}`)return json(res,{error:'Invalid origin/token'},403);
   pendingPosts++;trackedPost=true;
   const input=await body(req,['/api/profiles-import-preview','/api/profile-session-import'].includes(url.pathname)?6*1024*1024:100000);
   if(operation==='cài bản cập nhật'&&!['/api/stop','/api/profile-close','/api/profiles-stop','/api/profiles-close'].includes(url.pathname))throw Error('Đang cài cập nhật. Đợi tool mở lại trước khi thao tác.');
   if(url.pathname==='/api/proxy-parse')return json(res,parseProxy(input.proxy));
   if(updater&&url.pathname==='/api/update-check')return json(res,await updater.check());
   if(!isWorker&&url.pathname==='/api/app-quit'){json(res,{ok:true});setTimeout(()=>shutdown(),100);return;}
   if(updater&&url.pathname==='/api/update-install'){
    assertUpdateIdle(manager?.rows()||[{view:view()}],operation,(manager?.locks.size||0)+(pendingPosts>1?1:0));
    return json(res,await exclusive('cài bản cập nhật',async()=>{
     const result=await updater.stage();
     assertUpdateIdle(manager?.rows()||[{view:view()}],null,manager?.locks.size||0);
     setTimeout(()=>shutdown(42),500);return result;
    }));
   }
   if(manager&&url.pathname==='/api/profiles-transfer-export')return json(res,await importer.transfer.export(input.ids));
   if(isWorker&&url.pathname==='/api/profile-session-export'){await connect();return json(res,await captureSession(browser.context));}
   if(isWorker&&url.pathname==='/api/profile-session-import'){idleOnly();return json(res,await exclusive('khôi phục phiên Threads',async()=>{await connect();await restoreSession(browser.context,input.session);return {ok:true};}));}
   if(manager&&url.pathname==='/api/profiles-import-preview')return json(res,await importer.preview(input));
   if(manager&&url.pathname==='/api/profiles-import')return json(res,await importer.commit(input));
   if(url.pathname==='/api/stop'){startEpoch++;if(manager){const ids=manager.rows().map(r=>r.id);return json(res,ids.length?await manager.batch('close',ids):{results:[]});}await runner.stop();return json(res,{ok:true});}
   if(manager&&url.pathname==='/api/profile-close')return json(res,await manager.closeProfile(input.id));
   if(manager&&url.pathname==='/api/profile-dry-run')return json(res,await manager.dryRun(input.id));
   if(isWorker&&url.pathname==='/api/dry-run'){idleOnly();return json(res,await exclusive('chạy thử không đăng',async()=>{await connect();const result=await dryRunProfile(browser,store.value.settings);await store.set({lastDryRun:result});return result;}));}
   if(manager&&url.pathname==='/api/profiles-start')return json(res,await manager.batch('start',input.ids));
   if(manager&&url.pathname==='/api/profiles-start-extension')return json(res,await manager.batch('start-extension',input.ids));
   if(manager&&url.pathname==='/api/profiles-stop')return json(res,await manager.batch('close',input.ids));
   if(manager&&url.pathname==='/api/profiles-close')return json(res,await manager.batch('close',input.ids));
   if(url.pathname==='/api/settings'){
    return json(res,await exclusive('lưu cài đặt',async()=>{
     if(manager&&input.scope==='all'){
      const old=store.value.sharedSettings||store.value.settings;
      const settings=validateSettings({...input,profileId:'',proxy:'',cdp:old.cdp},old);settings.profileName='';
      const summary=await assetSummary(settings.imagesFolder);
      const results=await manager.applySharedSettings(settings);
      return {ok:results.every(r=>r.ok),settings:publicSettings(settings),assets:summary,results};
     }

     const saved=manager&&input.profileId?(await manager.profileStore(input.profileId)).value.settings:null;const old=saved||store.value.settings,settings=validateSettings(input,old);
     if(isWorker&&process.env.GPM_PROFILE_ID&&settings.profileId!==process.env.GPM_PROFILE_ID)throw Error('Bộ chạy này chỉ dành cho profile '+process.env.GPM_PROFILE_ID);
     assertLiveSettings(settings,old,manager?['running','stopping'].includes(manager.views.get(settings.profileId)?.state?.status):active());await assetSummary(settings.imagesFolder);
     if(manager&&settings.profileId)await manager.locked(settings.profileId,()=>manager.updateSettings(settings));
     await store.set({settings});
     if(!manager)await applyRunnerSettings(runner,settings);
     return {ok:true,settings:publicSettings(settings),assets:await assets(settings.imagesFolder)};
    }));
   }
   if(manager&&url.pathname==='/api/profile-edit')return json(res,await manager.edit(input.id,input));
   if(manager&&url.pathname==='/api/profile-delete')return json(res,await manager.remove(input.id));
   if(manager&&url.pathname==='/api/profile-create'){
    return json(res,await exclusive('tạo profile mới',async()=>{
     const old=store.value.sharedSettings||store.value.settings;
     const gpmApi=input.gpmApi||old.gpmApi||'http://localhost:9495';
     const profile=await new GpmApi(gpmApi).create({name:input.name,rawProxy:input.proxy??'',browserVersion:input.browserVersion??'',sourceProfileId:store.value.settings.profileId||''});
     const settings={...old,profileId:profile.id,profileName:profile.name,proxy:profile.proxy,gpmApi,cdp:'http://127.0.0.1:9222/'};
     await store.set({settings});await manager.register(settings,'tạo profile');
     broadcast();return {ok:true,profile,settings:publicSettings(settings)};
    }));
   }
   if(url.pathname==='/api/gpm-check')return json(res,await checkGpmConnection(input.gpmApi||(store.value.sharedSettings||store.value.settings).gpmApi));
   if(url.pathname==='/api/profiles')return json(res,{profiles:await new GpmApi(input.gpmApi||(store.value.sharedSettings||store.value.settings).gpmApi||'http://localhost:9495').list()});
   if(url.pathname==='/api/models')return json(res,{models:await models(store.value.sharedSettings||store.value.settings)});
   if(url.pathname==='/api/assets')return json(res,await assetSummary(input.folder||''));
   if(url.pathname==='/api/connect'&&manager)return json(res,await manager.connect(store.value.settings));
   if(url.pathname==='/api/connect'){
    idleOnly();return json(res,await exclusive('kiểm tra kết nối',async()=>{
     await connect();const threads=(await browser.query()).filter(t=>t.url.startsWith('https://www.threads.com/'));
     if(!threads.length)return {ok:true,ready:false,message:'Đã kết nối GPM. Hãy tự mở Threads và đăng nhập trước khi Start.'};
     const health=await browser.evaluate(threads[0].id,autoPage,['check']);return {ok:true,ready:!!health.self,message:'Đã kết nối Threads · @'+health.self};
    }));
   }
   if(url.pathname==='/api/profile-open'&&manager){const saved=input.profileId?(await manager.profileStore(input.profileId)).value.settings:store.value.settings;if(!saved)throw Error('Profile chưa có cấu hình.');const configured=input.useCurrentProxy?await manager.currentSettings(saved):validateSettings({...saved,proxy:input.proxy},saved);await store.set({settings:configured});return json(res,await manager.open(configured));}
   if(url.pathname==='/api/profile-open'){
    const openEpoch=startEpoch;
    idleOnly();return json(res,await exclusive('cấu hình mạng và mở profile',async()=>{
     const settings=store.value.settings;if(!settings.profileId)throw Error('Chọn profile và lưu cài đặt trước.');
     if(browser.browser?.isConnected()&&browser.profileId!==settings.profileId)throw Error('Tool đang kết nối profile khác hoặc CDP thủ công. Khởi động lại tool trước khi đổi profile.');
     if(input.useCurrentProxy){const selected=await new GpmApi(settings.gpmApi||'http://localhost:9495').call('/profiles/'+encodeURIComponent(settings.profileId));if(selected?.id!==settings.profileId)throw Error('Profile không khớp ID.');input.proxy=selected.raw_proxy||'';}
     if(typeof input.proxy!=='string')throw Error('Proxy cần là chuỗi; để trống để mở không proxy.');
     const raw=input.proxy.trim();
     const configured=validateSettings({...settings,proxy:raw},settings);
     await store.set({settings:configured});
     const engine=input.engine==='extension'?'extension':'direct',staged=engine==='extension'?await stageManagedExtension(dataDir):null;
     if(openEpoch!==startEpoch||shuttingDown)throw Error('Đã hủy mở profile do Dừng.');
     let result=await new GpmApi(settings.gpmApi||'http://localhost:9495').applyAndOpen(settings.profileId,raw,staged?{additionArgs:extensionArguments(staged.directory)}:{});
     if(openEpoch!==startEpoch||shuttingDown)throw Error('Đã hủy mở profile do Dừng.');
     if(browser.browser?.isConnected()&&browser.address!==new URL(result.cdp).href){const deadline=Date.now()+10000;while(browser.browser?.isConnected()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));if(browser.browser?.isConnected())throw Error('Profile cũ chưa đóng. Đóng profile rồi bấm Mở profile lại.');}
     await store.set({settings:{...configured,cdp:result.cdp,profileName:result.profileName},proxyAppliedAt:new Date().toISOString()});
     if(engine==='extension')result=await enableExtension(configured,result,openEpoch,staged);
     else{extensionBridge?.close();extensionBridge=null;browser.extensionBridge=null;await connect();await store.set({executionMode:'direct'});}
     browser.profileId=result.profileId;
     return {ok:true,...result,hasProxy:!!raw,engine};
    }));
   }
   if(isWorker&&url.pathname==='/api/extension-reconnect'){
    if(store.value.executionMode!=='extension'||!extensionBridge||extensionBridge.closed||runner.state.status!=='running')throw Error('Phiên extension đã dừng · bấm Dừng & đóng profile rồi Chạy bằng extension lại.');
    const bridge=extensionBridge,epoch=startEpoch;
    return json(res,await exclusive('thay extension bằng bản hiện tại',()=>runner.withBrowserMaintenance(async()=>{
     if(epoch!==startEpoch||shuttingDown||bridge.closed||!runner.active())throw Error('Đã hủy nạp extension do Dừng.');
     try{
      await enableExtension(store.value.settings,{cdp:store.value.settings.cdp,profileId:store.value.settings.profileId,profileName:store.value.settings.profileName},epoch);
     }catch(e){if(runner.active())await runner.finish('attention','Không nạp lại được extension: '+e.message);throw e;}
     return {ok:true,alreadyRunning:true,reconnected:true};
    })));
   }
   if(url.pathname==='/api/start'&&manager)return json(res,await manager.start(store.value.settings.profileId,store.value.settings));
   if(url.pathname==='/api/start'){
    idleOnly();const epoch=++startEpoch;
    return json(res,await exclusive('bắt đầu phiên',async()=>{
     const config=autoConfig(store.value.settings.runConfig||AUTO_DEFAULTS);
     await runner.start(config);
     await runner.progress(store.value.executionMode==='extension'?'Bộ chạy extension · dùng cài đặt chung và lịch sử trong app':'Bộ chạy trực tiếp');
     // Stop remains independent of the pending Start request and wins even during connection setup.
     if(startEpoch!==epoch){await runner.stop();return {ok:true,cancelled:true};}
     return {ok:true};
    }));
   }
   return json(res,{error:'Not found'},404);
  }
  const files={'/':'index.html','/app.js':'app.js','/profile-list.js':'profile-list.js','/updates.js':'updates.js','/style.css':'style.css'};
  if(req.method==='GET'&&files[url.pathname]){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'"});return res.end(await fs.readFile(path.join(root,'public',files[url.pathname])));}
  json(res,{error:'Not found'},404);
 }catch(e){json(res,{error:redact(e.message,store.value.settings)},400);}finally{if(trackedPost)pendingPosts--;}
});
await runner.load();
if(!isWorker){manager=new ProfileManager(store,{onChange:broadcast});await manager.init();importer=new ProfileImporter(manager);manager.startSync();}
server.listen(port,'127.0.0.1',()=>{port=server.address().port;console.log(`GPM tool UI: http://127.0.0.1:${port}`);if(isWorker&&process.connected)process.send({type:'ready',port,token});});
server.on('error',async e=>{console.error(e.message);await fs.unlink(lockPath).catch(()=>{});process.exit(1);});
if(isWorker&&runner.state.status==='running'){
 operation='khôi phục lịch đã lưu';
 try{if(store.value.executionMode==='extension')await enableExtension(store.value.settings,{cdp:store.value.settings.cdp,profileId:store.value.settings.profileId,profileName:store.value.settings.profileName});else await connect();await runner.scheduleNext();}catch(e){await runner.finish('attention','Không kết nối lại được GPM: '+redact(e.message,store.value.settings));}finally{operation=null;broadcast();}
}else if(runner.state.status==='stopping')await runner.finish('stopped','Đã hoàn tất yêu cầu Stop từ lần trước.');
async function shutdown(exitCode=0){
 if(shuttingDown)return;shuttingDown=true;startEpoch++;extensionBridge?.close();runner.dispose();if(manager)await manager.close();for(const res of clients)res.end();server.close();
 // Preserve running status for restart; bound exit wait instead of killing an active Post midway when possible.
 const deadline=Date.now()+5000;while(runner.running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 await store.pending;await fs.unlink(lockPath).catch(()=>{});process.exit(exitCode);
}
if(isWorker){process.on('disconnect',()=>shutdown());process.on('message',message=>{if(message?.type==='shutdown')shutdown();});}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());

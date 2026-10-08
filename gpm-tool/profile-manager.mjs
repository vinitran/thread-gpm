import path from 'node:path';
import {fork} from 'node:child_process';
import {GpmApi} from './gpm-api.mjs';
import {Store} from './store.mjs';
import {dashboard} from './dashboard.mjs';
import {redact,sharedProfileSettings,validateSettings,assertLiveSettings} from './settings.mjs';
const valid=id=>typeof id==='string'&&/^[-\w]{1,100}$/.test(id);
const busy=view=>['running','stopping'].includes(view?.state?.status)||!!view?.operation;
export class ProfileWorker{
 constructor(dir,onView){this.dir=dir;this.onView=onView;}
 async boot(){
  if(this.ready)return this.ready;
  this.ready=new Promise((resolve,reject)=>{
   this.child=fork(new URL('./server.mjs',import.meta.url),[],{env:{...process.env,GPM_TOOL_WORKER:'1',GPM_PROFILE_ID:path.basename(this.dir),GPM_TOOL_DATA:this.dir,PORT:'0'},stdio:['ignore','ignore','ignore','ipc']});
   const timeout=setTimeout(()=>reject(Error('Bộ chạy profile chưa khởi động sau 30 giây.')),30000);
   this.child.on('message',message=>{if(message.type==='ready'){clearTimeout(timeout);this.base='http://127.0.0.1:'+message.port;this.token=message.token;resolve(this);}if(message.type==='view')this.onView(message.view);});
   this.child.once('exit',()=>{clearTimeout(timeout);this.ready=null;this.base=null;this.onView({connected:false,operation:null,state:{status:'attention',activity:{message:'Bộ chạy profile đã thoát · bấm chạy lại để khôi phục.'}}});reject(Error('Bộ chạy profile đã thoát.'));});
  });return this.ready;
 }
 async call(route,input,timeoutMs=90000){await this.boot();const r=await fetch(this.base+'/api/'+route,{...(input===undefined?{}:{method:'POST',headers:{Origin:this.base,'X-Tool-Token':this.token,'Content-Type':'application/json'},body:JSON.stringify(input)}),signal:AbortSignal.timeout(timeoutMs)});const result=await r.json();if(!r.ok)throw Error(result.error||'Bộ chạy profile báo lỗi.');if(route==='state'){const {token,settings,assets,defaults,...view}=result;return view;}return result;}
 async close({force=false}={}){if(!this.child||this.child.exitCode!==null)return;const child=this.child;await new Promise(resolve=>{let killTimer;const timer=setTimeout(()=>{if(force){child.kill('SIGKILL');killTimer=setTimeout(resolve,1000);}else resolve();},force?5000:10000);child.once('exit',()=>{clearTimeout(timer);clearTimeout(killTimer);resolve();});child.kill('SIGTERM');});}
}
export class ProfileManager{
 constructor(store,{workerFactory=(dir,onView)=>new ProfileWorker(dir,onView),onChange=()=>{},gpmFactory=base=>new GpmApi(base)}={}){this.gpmFactory=gpmFactory;this.store=store;this.workerFactory=workerFactory;this.onChange=onChange;this.workers=new Map();this.views=new Map();this.locks=new Map();this.cancelled=new Map();this.closing=false;this.live=new Map();this.syncing=null;this.endpoints=new Map();this.stoppingProfiles=new Map();}
 rows(){return Object.values(this.store.value.profileRegistry||{}).map(({view:discarded,...row})=>({...row,...(this.live.get(row.id)?.metadata||{}),gpm:this.live.get(row.id)?{...this.live.get(row.id),metadata:undefined}:{status:'unknown',fresh:false},view:this.views.get(row.id)||{state:{status:'idle',events:[]},counts:{today:0,total:0,session:0,unverified:0,sessions:0},recent:[],connected:false}})).sort((a,b)=>(b.lastUsedAt||'').localeCompare(a.lastUsedAt||''));}
 startSync(intervalMs=3000){if(this.syncTimer)return;const tick=()=>this.syncLive().catch(()=>{});tick();this.syncTimer=setInterval(tick,intervalMs);this.syncTimer.unref();}
 async syncLive(){
  if(this.syncing)return this.syncing;
  this.syncing=this.refreshLive().finally(()=>{this.syncing=null;});return this.syncing;
 }
 async refreshLive(){
  const groups=new Map();
  for(const row of this.rows()){const data=await this.profileStore(row.id);const base=data.value.settings?.gpmApi||this.store.value.settings?.gpmApi||'http://localhost:9495';if(!groups.has(base))groups.set(base,[]);groups.get(base).push(row.id);}
  await Promise.all([...groups].map(async([base,ids])=>{
   try{const profiles=await this.gpmFactory(base).list({metadata:true}),now=new Date().toISOString();
    for(const id of ids){if(!this.store.value.profileRegistry?.[id])continue;const profile=profiles.find(p=>p.id===id),previous=this.live.get(id);
     this.live.set(id,{metadata:profile||previous?.metadata,fresh:true,checkedAt:now,status:profile?'present':'missing',error:profile?null:'Profile không còn trong danh sách GPM'});
    }
   }catch(e){for(const id of ids){if(this.store.value.profileRegistry?.[id])this.live.set(id,{...this.live.get(id),fresh:false,status:'unavailable',error:redact(e.message,this.store.value.settings)});}}
  }));
  await Promise.all([...this.workers].map(async([id,worker])=>{if(!worker.base)return;try{const view=await worker.call('state',undefined,5000);if(this.workers.get(id)!==worker)return;this.views.set(id,{...this.views.get(id),...view});}catch{const view=this.views.get(id);if(view)this.views.set(id,{...view,connected:false});}}));
  if(!this.closing)this.onChange();
 }
 async currentSettings(settings){const profile=await this.gpmFactory(settings.gpmApi||'http://localhost:9495').call('/profiles/'+encodeURIComponent(settings.profileId));if(profile?.id!==settings.profileId)throw Error('Profile không khớp ID.');return {...settings,profileName:profile.name,proxy:profile.raw_proxy||''};}
 async register(settings,action){
  if(!valid(settings.profileId))throw Error('Chọn profile và lưu cài đặt trước.');const id=settings.profileId,registry=this.store.value.profileRegistry||{},old=registry[id];
  const log=action||(!old||old.proxy!==(settings.proxy||'')?'lưu cấu hình':null);
  this.endpoints.set(id,settings.gpmApi||this.store.value.settings?.gpmApi||'http://localhost:9495');
  registry[id]={...old,gpmApi:this.endpoints.get(id),runLog:log?[...(old?.runLog||[]),{time:new Date().toISOString(),action:log,proxy:settings.proxy||''}].slice(-100):old?.runLog||[],id,name:settings.profileName||old?.name||id,proxy:settings.proxy||'',lastUsedAt:new Date().toISOString()};await this.store.set({profileRegistry:registry});await this.profileStore(id,settings);return registry[id];
 }
 async init(){
  const s=this.store.value.settings;
  if(valid(s?.profileId)&&!this.store.value.profileMigrationDone){
   await this.register(s);const target=await this.profileStore(s.profileId,s);
   const patch={};for(const key of ['autoRun','replyReceipts','aiResults','browserTargets','tabLifecycle'])if(this.store.value[key]!==undefined)patch[key]=this.store.value[key];
   if(patch.autoRun?.status==='running')patch.autoRun={...patch.autoRun,status:'stopped',activity:{message:'Đã chuyển dữ liệu sang profile riêng · bấm Start để tiếp tục.'}};
   if(!target.value.autoRun&&!target.value.replyReceipts)await target.set(patch);
  }
  if(!this.store.value.profileMigrationDone)await this.store.set({profileMigrationDone:true});
  const registry=this.store.value.profileRegistry||{};let cleaned=false;for(const row of Object.values(registry)){if('view' in row){delete row.view;cleaned=true;}}if(cleaned)await this.store.set({profileRegistry:registry});
  for(const row of this.rows()){
   const data=await this.profileStore(row.id);if(this.store.value.sharedSettings&&data.value.settings){const settings=sharedProfileSettings(this.store.value.sharedSettings,data.value.settings);await data.set({settings,...(data.value.autoRun?.config?{autoRun:{...data.value.autoRun,config:settings.runConfig}}:{})});}this.endpoints.set(row.id,data.value.settings?.gpmApi||row.gpmApi||this.store.value.settings?.gpmApi||'http://localhost:9495');const view=dashboard(data.value,false);this.views.set(row.id,view);
   if(data.value.autoRun?.status==='running')this.worker(row.id).boot().catch(e=>this.fail(row.id,e));
  }
 }
 async profileStore(id,settings){if(!valid(id))throw Error('Profile ID không hợp lệ.');const data=await new Store(path.join(this.store.dir,'profiles',id)).load();if(!data.value.settings&&settings)await data.set({settings:{...settings,profileId:id}});return data;}
 worker(id){if(!this.workers.has(id)){const worker=this.workerFactory(path.join(this.store.dir,'profiles',id),view=>{
   const merged={...this.views.get(id),...view,error:null,state:{...this.views.get(id)?.state,...view.state}};this.views.set(id,merged);
   this.onChange();
  });this.workers.set(id,worker);}return this.workers.get(id);}
 async locked(id,fn){if(this.locks.has(id))throw Error('Profile đang xử lý thao tác khác.');this.locks.set(id,true);this.onChange();try{return await fn();}catch(e){await this.fail(id,e);throw e;}finally{this.locks.delete(id);this.onChange();}}
 async fail(id,error){const data=await this.profileStore(id);const message=redact(error.message,data.value.settings);const previous=this.views.get(id);this.views.set(id,{...previous,error:message});this.onChange();}
 async updateSettings(settings){
  const id=settings.profileId,worker=this.workers.get(id);if(this.stoppingProfiles.has(id))throw Error('Profile đang dừng · thử lưu lại sau khi dừng xong.');
  if(worker)await worker.call('settings',settings);
  else{const data=await this.profileStore(id,settings);await data.set({settings});this.views.set(id,dashboard(data.value,false));}
  await this.register(settings);this.onChange();
 }
 async applySharedSettings(shared){
  const targets=[];
  for(const row of this.rows()){const data=await this.profileStore(row.id);if(!data.value.settings)throw Error('Profile '+row.name+' chưa có cấu hình.');const merged=sharedProfileSettings(shared,data.value.settings);const validated=validateSettings(merged,data.value.settings);assertLiveSettings(validated,data.value.settings,busy(this.views.get(row.id)));if(this.locks.has(row.id)&&validated.gpmApi!==data.value.settings.gpmApi)throw Error('Profile '+row.name+' đang xử lý · đợi hoàn tất trước khi đổi GPM Local API.');targets.push({id:row.id,name:row.name,settings:{...merged,gpmApi:validated.gpmApi,runConfig:validated.runConfig}});}
  await this.store.set({sharedSettings:shared});
  const results=[];
  for(const target of targets){try{await this.locked(target.id,()=>this.updateSettings(target.settings));results.push({id:target.id,name:target.name,ok:true});}catch(e){results.push({id:target.id,name:target.name,ok:false,error:redact(e.message,target.settings)});}}
  return results;
 }
 async configure(settings){const id=settings.profileId;if(busy(this.views.get(id)))throw Error('Dừng profile này trước khi đổi cấu hình.');await this.register(settings);await this.profileStore(id,settings);return this.worker(id).call('settings',settings);}
 gpmStop(id){const base=this.endpoints.get(id)||this.store.value.profileRegistry?.[id]?.gpmApi||this.store.value.settings?.gpmApi||'http://localhost:9495';return this.gpmFactory(base).call('/profiles/stop/'+encodeURIComponent(id));}
 async open(settings){const id=settings.profileId,epoch=this.cancelled.get(id)||0;if(this.stoppingProfiles.has(id))throw Error('Profile đang dừng.');return this.locked(id,async()=>{
  await this.configure(settings);if((this.cancelled.get(id)||0)!==epoch)return {ok:true,cancelled:true};
  const result=await this.worker(id).call('profile-open',{proxy:settings.proxy||''});
  if((this.cancelled.get(id)||0)!==epoch){await this.gpmStop(id);return {ok:true,cancelled:true};}
  await this.register({...settings,profileName:result.profileName},'mở profile');return result;
 });}
 async dryRun(id){
  if(!valid(id)||!this.store.value.profileRegistry?.[id])throw Error('Chọn profile đã thêm vào tool.');
  if(busy(this.views.get(id)))throw Error('Dừng bộ chạy trước khi chạy thử.');
  const settings=await this.currentSettings((await this.profileStore(id)).value.settings),epoch=this.cancelled.get(id)||0;
  return this.locked(id,async()=>{await this.configure(settings);await this.worker(id).call('profile-open',{useCurrentProxy:true});if((this.cancelled.get(id)||0)!==epoch)throw Error('Đã hủy chạy thử do Dừng.');return this.worker(id).call('dry-run',{},240000);});
 }
 async connect(settings){return this.locked(settings.profileId,async()=>{await this.configure(settings);return this.worker(settings.profileId).call('connect',{});});}
 async start(id,settings){
  if(!valid(id))throw Error('Profile ID không hợp lệ.');if(this.closing)throw Error('Tool đang tắt.');if(this.stoppingProfiles.has(id))throw Error('Profile đang dừng.');
  if(this.views.get(id)?.state?.status==='running')return {ok:true,alreadyRunning:true};const epoch=(this.cancelled.get(id)||0);
  return this.locked(id,async()=>{
   if(settings){await this.configure(settings);}else if(!this.store.value.profileRegistry?.[id])throw Error('Profile chưa có cấu hình đã lưu.');
   if(this.closing||(this.cancelled.get(id)||0)!==epoch)return {ok:true,cancelled:true};
   const worker=this.worker(id);const current=await worker.call('state');
   if(current.state.status==='running')return {ok:true,alreadyRunning:true};
   const data=await this.profileStore(id);if(this.closing||(this.cancelled.get(id)||0)!==epoch)return {ok:true,cancelled:true};await worker.call('profile-open',{useCurrentProxy:true});
   if(this.closing||(this.cancelled.get(id)||0)!==epoch){if(!this.closing)await this.gpmStop(id);return {ok:true,cancelled:true};}
   const result=await worker.call('start',{});
   if(this.closing||(this.cancelled.get(id)||0)!==epoch){await worker.call('stop',{}).catch(()=>{});if(!this.closing)await this.gpmStop(id);return {ok:true,cancelled:true};}
   const refreshed=await this.profileStore(id);await this.register(refreshed.value.settings,'bắt đầu phiên');return result;
  });
 }
 async edit(id,input){return this.locked(id,async()=>{
  if(!this.store.value.profileRegistry?.[id])throw Error('Profile chưa có trong bảng.');
  if(busy(this.views.get(id)))throw Error('Dừng profile trước khi sửa.');
  const worker=this.workers.get(id);if(worker){await worker.close();this.workers.delete(id);}
  const data=await this.profileStore(id),old=data.value.settings;
  const result=await new GpmApi(old.gpmApi).edit(id,{name:input.name,rawProxy:input.proxy});
  const settings={...old,profileName:result.name,proxy:result.proxy};await data.set({settings});
  await this.register(settings,'sửa tên/proxy');this.views.set(id,dashboard(data.value,false));
  if(this.store.value.settings.profileId===id)await this.store.set({settings});this.onChange();return {ok:true,profile:result};
 });}
 async remove(id){return this.locked(id,async()=>{
  if(!this.store.value.profileRegistry?.[id])throw Error('Profile chưa có trong bảng.');
  if(busy(this.views.get(id)))throw Error('Dừng profile trước khi xoá.');
  const worker=this.workers.get(id);if(worker){await worker.close();this.workers.delete(id);}
  const data=await this.profileStore(id);await new GpmApi(data.value.settings.gpmApi).remove(id);
  await data.set({deletedAt:new Date().toISOString()});const registry=this.store.value.profileRegistry;delete registry[id];await this.store.set({profileRegistry:registry});this.views.delete(id);
  if(this.store.value.settings.profileId===id)await this.store.set({settings:{...this.store.value.settings,profileId:'',profileName:'',proxy:''}});
  this.onChange();return {ok:true};
 });}
 async stop(id){if(!valid(id))throw Error('Profile ID không hợp lệ.');this.cancelled.set(id,(this.cancelled.get(id)||0)+1);const worker=this.workers.get(id);if(worker){await worker.call('stop',{});this.views.set(id,await worker.call('state'));}else {const data=await this.profileStore(id);if(data.value.autoRun){await data.set({autoRun:{...data.value.autoRun,status:'stopped',nextAt:null}});this.views.set(id,dashboard(data.value,false));}}this.onChange();return {ok:true};}
 async closeProfile(id){
  if(!valid(id))throw Error('Profile ID không hợp lệ.');
  this.cancelled.set(id,(this.cancelled.get(id)||0)+1);this.stoppingProfiles.set(id,(this.stoppingProfiles.get(id)||0)+1);
  // Dispatch GPM stop first: no registry existence check, disk read, lock or worker RPC precedes it.
  let gpmError,gpmRequest;try{gpmRequest=Promise.resolve(this.gpmStop(id)).catch(e=>{gpmError=e;});}catch(e){gpmError=e;gpmRequest=Promise.resolve();}
  const worker=this.workers.get(id),previous=this.views.get(id);let warning;
  if(previous)this.views.set(id,{...previous,state:{...previous.state,status:'stopping',nextAt:null,activity:{message:'Đang gửi lệnh dừng tới GPM'}}});this.onChange();
  const cleanup=(async()=>{
   if(worker){const stopping=worker.call('stop',{}).catch(()=>{});try{await worker.close({force:true});await Promise.race([stopping,new Promise(resolve=>setTimeout(resolve,250))]);}catch{warning='GPM đã nhận lệnh dừng; chưa kết thúc được worker.';}if(this.workers.get(id)===worker)this.workers.delete(id);}
  })();
  try{
   await Promise.all([gpmRequest,cleanup]);
   try{const data=await this.profileStore(id);await data.set({autoRun:{...data.value.autoRun,status:'stopped',nextAt:null,nextIdleAt:null,activity:{message:gpmError?'Đã hủy lịch tool; GPM báo lỗi dừng profile':'Đã dừng phiên và đóng profile GPM'}}});this.views.set(id,dashboard(data.value,false));
    const registry=this.store.value.profileRegistry;if(registry?.[id]){registry[id]={...registry[id],runLog:[...(registry[id].runLog||[]),{time:new Date().toISOString(),action:gpmError?'lỗi dừng GPM':'dừng profile GPM',proxy:registry[id].proxy||''}].slice(-100)};await this.store.set({profileRegistry:registry});}
   }catch{warning='Đã xử lý lệnh dừng GPM; chưa lưu được trạng thái vào dữ liệu tool.';this.views.set(id,{...previous,connected:false,operation:null,state:{...previous?.state,status:'stopped',nextAt:null,activity:{message:warning}}});}
   if(gpmError){this.views.set(id,{...this.views.get(id),error:gpmError.message});throw gpmError;}
   return {ok:true,...(warning?{warning}:{})};
  }finally{const remaining=(this.stoppingProfiles.get(id)||1)-1;if(remaining)this.stoppingProfiles.set(id,remaining);else this.stoppingProfiles.delete(id);this.onChange();}
 }
 async batch(action,ids){if(!['start','stop','close'].includes(action)||!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>!valid(id)))throw Error('Chọn 1–50 profile hợp lệ.');const unique=[...new Set(ids)];return {results:await Promise.all(unique.map(async id=>{try{const result=await (action==='start'?this.start(id):action==='close'?this.closeProfile(id):this.stop(id));return {id,ok:true,...(result?.warning?{warning:result.warning}:{}),...(result?.cancelled?{cancelled:true}:{})};}catch(e){let settings=this.store.value.settings||{};try{settings=(await this.profileStore(id)).value.settings||settings;}catch{}return {id,ok:false,error:redact(e.message,settings)};}}))};}
 async history(id){if(!valid(id))throw Error('Profile ID không hợp lệ.');const data=await this.profileStore(id);return {profileId:id,exportedAt:new Date().toISOString(),state:data.value.autoRun,receipts:data.value.replyReceipts||{},tabLifecycle:data.value.tabLifecycle||{}};}
 async close(){this.closing=true;clearInterval(this.syncTimer);await this.syncing;await Promise.all([...this.workers.values()].map(worker=>worker.close()));}
}

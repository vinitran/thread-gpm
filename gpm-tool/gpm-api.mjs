import {endpoint} from './browser.mjs';
export function localApi(value){if(typeof value==='string'){value=value.trim();if(/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/api\/v[13])?\/?$/.test(value))value='http://'+value;}const u=new URL(endpoint(value));if(!['http:','https:'].includes(u.protocol)||!['/','/api/v1','/api/v1/','/api/v3','/api/v3/'].includes(u.pathname)||u.search||u.hash)throw Error('Local API phải là http://127.0.0.1:PORT, có thể kèm /api/v1 hoặc /api/v3.');return u.origin+(u.pathname.startsWith('/api/')?u.pathname.replace(/\/$/,''):'');}
function proxyUrl(raw){
 const scheme=raw.match(/^([a-z][a-z0-9+.-]*):\/\//i),protocol=scheme?scheme[1].toLowerCase():'http';
 if(!['http','https','socks5'].includes(protocol))throw Error();
 const address=scheme?raw.slice(scheme[0].length):raw;
 // GPM also stores scheme://host:port:user:password, which is not a URL.
 if(!address.includes('@')&&!address.startsWith('[')){
  const match=address.match(/^([^:/?#\s]+):(\d+)(?::([^:/?#\s]+):(.*))?$/);
  if(match){const [,host,port,user,password]=match;if(+port<1||+port>65535)throw Error();return new URL(protocol+'://'+(user?encodeURIComponent(user)+':'+encodeURIComponent(password)+'@':'')+host+':'+port);}
 }
 if(!scheme&&!/^\[[^\]]+\]:\d+$/.test(raw))throw Error();
 const url=new URL(scheme?raw:'http://'+raw);
 if(!url.hostname||url.pathname!=='/'&&url.pathname!==''||url.search||url.hash)throw Error();
 return url;
}
export function proxy(value){
 if(typeof value!=='string'||value.length>2000)throw Error('Proxy không hợp lệ.');
 const trim=raw=>raw.replace(/^[\s\u200b\u2060]+|[\s\u200b\u2060]+$/g,'');
 let raw=trim(value);
 const pairs={'"':'"',"'":"'",'“':'”','‘':'’'};
 if(pairs[raw[0]]&&raw.at(-1)===pairs[raw[0]])raw=trim(raw.slice(1,-1));
 if(!raw||/[\r\n]/.test(raw))throw Error('Proxy không hợp lệ. Dán một proxy trên một dòng.');
 try{proxyUrl(raw);}catch{throw Error('Proxy cần IP:port:user:pass, scheme://IP:port:user:pass hoặc URL http/socks5.');}
 return raw;
}
export function parseProxy(value){
 const raw=proxy(value),url=proxyUrl(raw);
 const auth=url.username?':'+decodeURIComponent(url.username)+':'+decodeURIComponent(url.password):'';
 const port=url.port||(url.protocol==='https:'?'443':url.protocol==='http:'?'80':'');
 if(!port)throw Error('Proxy cần có port.');
 const normalized=(url.protocol==='http:'?'':url.protocol+'//')+url.hostname+':'+port+auth;
 return {proxy:/[@\s/?#]/.test(auth)?url.href.replace(/\/$/,''):normalized,label:url.protocol+'//'+url.hostname+':'+port,authenticated:!!url.username};
}
function gpmFailure(result){
 const error=typeof result.error==='object'?result.error?.message:result.error;
 return [result.message,error,result.code].filter(v=>typeof v==='string'||typeof v==='number').join(' · ').slice(0,1000)
  .replace(/([a-z]+:\/\/)[^\s/@]+@/gi,'$1[ẩn]@')
  .replace(/([^\s/:]+:\d+):[^\s:]+:[^\s]+/g,'$1:[ẩn]')
  .replace(/sk-[A-Za-z0-9_-]+/g,'[ẩn key]');
}
export function proxyLabel(raw){if(!raw)return '';try{const url=proxyUrl(raw.trim());return (raw.includes('://')?url.protocol+'//':'')+url.host;}catch{return 'Proxy không hợp lệ';}}
export class GpmApi{
 constructor(base,request=fetch){const u=new URL(localApi(base));this.version=(u.pathname.includes('/v3')||!u.pathname.includes('/v1')&&u.port==='19995')?'v3':'v1';this.base=u.origin;this.request=request;}
 async call(route,body){
  let mapped=route,payload=body;
  if(this.version==='v3'){
   mapped=route.replace('/profiles/stop/','/profiles/close/').replace('mode=soft','mode=1');
   if(body){payload={...body};if(payload.name!==undefined){payload.profile_name=payload.name;delete payload.name;}
    if(route==='/profiles/create'){payload={profile_name:body.name,browser_core:'chromium',browser_name:'Chrome',...(body.browser_version?{browser_version:body.browser_version,is_random_browser_version:false}:{}),raw_proxy:body.raw_proxy||''};}
   }
  }
  const options={method:payload?'POST':'GET',...(payload?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)};
  let r;try{r=await this.request(this.base+'/api/'+this.version+mapped,options);
   if(this.version==='v3'&&r.status===404&&/^\/profiles\/[-\w]+$/.test(route))r=await this.request(this.base+'/api/v3'+mapped.replace('/profiles/','/profile/'),options);
  }catch(e){const code=/timeout/i.test(e.name)?'TIMEOUT':e.cause?.code||e.code||'NETWORK';throw Object.assign(Error('Không kết nối được GPM Local API tại '+this.base+' ('+this.version+' · '+code+'). Mở GPM và kiểm tra cổng Local API; GPMLogin v4 thường dùng 19995/API v3, Global dùng API v1.'),{code});}
  if(!r.ok)throw Error('GPM Local API '+this.version+' tại '+this.base+' trả HTTP '+r.status+'. Kiểm tra phiên bản API và cổng.');
  const result=await r.json();
  if(this.version==='v3'&&result.success===true){
   if(Array.isArray(result.data))result.data={data:result.data,last_page:result.pagination?.total_page||1};
   else if(result.data&&typeof result.data==='object'){
    const d=result.data;if(!d.browser&&d.browser_version)d.browser={name:/firefox/i.test(d.browser_type||'')?'firefox':'chrome',version:d.browser_version};
    if(d.remote_debugging_address){const u=new URL(endpoint(d.remote_debugging_address.includes('://')?d.remote_debugging_address:'http://'+d.remote_debugging_address));d.remote_debugging_port=Number(u.port);}
   }
  }
  const inUse=/^\/profiles\/start\/[-\w]+$/.test(route)&&result.message==='ProfileInUse'&&result.data?.profile_id===decodeURIComponent(route.split('/').at(-1))&&Number.isInteger(Number(result.data.remote_debugging_port))&&Number(result.data.remote_debugging_port)>0&&Number(result.data.remote_debugging_port)<=65535;
  const alreadyStopped=/^\/profiles\/stop\/[-\w]+$/.test(route)&&(result.message==='ProfileNotRunning'||result.message==='OK'&&result.data===null);
  if(result.success!==true&&!inUse&&!alreadyStopped)throw Error('GPM từ chối thao tác '+route.split('/')[2]+': '+(gpmFailure(result)||'GPM không trả nguyên nhân chi tiết. Kiểm tra thông báo trong GPM.'));return result.data;
 }
 async list({metadata=false,search='',groupId='',limit=Infinity}={}){const profiles=[];const query=String(search).normalize('NFC').toLocaleLowerCase();for(let page=1;page<=100;page++){const data=await this.call('/profiles?page='+page+'&page_size=100&per_page=100');const rows=Array.isArray(data)?data:data?.data;if(!Array.isArray(rows))throw Error('GPM trả danh sách profile không hợp lệ.');profiles.push(...rows.filter(p=>(!groupId||String(p.group_id??'')===String(groupId))&&(!query||[p.name,p.id].some(value=>String(value??'').normalize('NFC').toLocaleLowerCase().includes(query)))).map(p=>metadata?{id:p.id,name:p.name,proxy:p.raw_proxy??'',groupId:p.group_id??null,browser:p.browser||(p.browser_version?{name:/firefox/i.test(p.browser_type||'')?'firefox':'chrome',version:p.browser_version}:undefined),os:p.os,updatedAt:p.updated_at,tags:p.tags}:({id:p.id,name:p.name})));if(profiles.length>=limit||Array.isArray(data)||page>=(data.last_page||1))break;}return profiles.slice(0,limit);}
 async groups(){const groups=[];for(let page=1;page<=100;page++){const data=await this.call('/groups?page='+page+'&page_size=100&per_page=100');const rows=Array.isArray(data)?data:data?.data;if(!Array.isArray(rows))throw Error('GPM trả danh sách nhóm không hợp lệ.');groups.push(...rows.map(g=>({id:String(g.id),name:String(g.name??g.id)})));if(Array.isArray(data)||page>=(data.last_page||1))break;}return groups;}
 async create({name,rawProxy='',browserVersion='',sourceProfileId='',osType=process.platform==='darwin'?(process.arch==='arm64'?3:2):process.platform==='win32'?1:4}){
  if(typeof name!=='string'||!name.trim()||name.trim().length>100||/[\x00-\x1f]/.test(name))throw Error('Tên profile cần 1–100 ký tự.');
  if(typeof rawProxy!=='string')throw Error('Proxy không hợp lệ.');const raw=rawProxy.trim()?proxy(rawProxy):'';
  if(typeof browserVersion!=='string'||!Number.isInteger(osType)||![1,2,3,4,5].includes(osType))throw Error('Cấu hình trình duyệt không hợp lệ.');
  let version=browserVersion.trim();
  const validVersion=v=>typeof v==='string'&&/^\d+\.\d+\.\d+\.\d+$/.test(v);
  const chromeVersion=p=>!(/firefox/i.test(p?.browser?.name||p?.browser_type||''))&&(p?.browser?.version||p?.browser_version);
  if(version&&!validVersion(version))throw Error('Phiên bản Chrome không hợp lệ; để trống để GPM tự chọn hoặc nhập đủ dạng 152.0.7977.140.');
  if(!version&&sourceProfileId){
   if(!/^[-\w]{1,100}$/.test(sourceProfileId))throw Error('Profile tham chiếu không hợp lệ.');
   try{const candidate=chromeVersion(await this.call('/profiles/'+encodeURIComponent(sourceProfileId)));if(validVersion(candidate))version=candidate;}catch{}
  }
  if(!version){
   const rows=await this.list({metadata:true});
   version=rows.map(chromeVersion).find(validVersion)||'';
  }
  if(!version&&this.version==='v1'){
   try{const versions=await this.call('/browsers/versions');version=(versions?.chromium||[]).find(validVersion)||'';}catch{}
  }
  // Both adapters allow GPM to choose its default when no explicit version is available.
  const created=await this.call('/profiles/create',{name:name.trim(),group_id:null,raw_proxy:raw,browser_type:1,...(version?{browser_version:version}:{}),os_type:osType});
  if(typeof created?.id!=='string'||!/^[-\w]{1,100}$/.test(created.id))throw Error('GPM chưa trả ID profile mới hợp lệ; kiểm tra danh sách trước khi tạo lại.');
  return {id:created.id,name:created.name||name.trim(),proxy:raw,browserVersion:version};
 }
 async edit(id,{name,rawProxy=''}){
  if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))throw Error('Profile ID không hợp lệ.');
  if(typeof name!=='string'||!name.trim()||name.trim().length>100||/[\x00-\x1f]/.test(name))throw Error('Tên profile cần 1–100 ký tự.');
  if(typeof rawProxy!=='string')throw Error('Proxy không hợp lệ.');const raw=rawProxy.trim()?proxy(rawProxy):'';
  const old=await this.call('/profiles/'+encodeURIComponent(id));if(old?.id!==id)throw Error('Profile không khớp ID.');
  if((old.raw_proxy||'')!==raw)await this.call('/profiles/stop/'+encodeURIComponent(id));
  await this.call('/profiles/update/'+encodeURIComponent(id),{name:name.trim(),raw_proxy:raw});
  const updated=await this.call('/profiles/'+encodeURIComponent(id));
  if(updated?.id!==id||updated.name!==name.trim()||(updated.raw_proxy||'')!==raw)throw Error('GPM chưa lưu đúng tên/proxy; kiểm tra lại trước khi mở.');
  return {id,name:updated.name,proxy:raw};
 }
 async remove(id){
  if(this.version==='v3')throw Error('GPMLogin v4 chưa hỗ trợ chuyển vào thùng rác từ tool. Hãy quản lý xoá profile trong app GPM.');
  if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))throw Error('Profile ID không hợp lệ.');
  await this.call('/profiles/stop/'+encodeURIComponent(id));
  await this.call('/profiles/delete/'+encodeURIComponent(id)+'?mode=soft');
 }
 async open(id){
  if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))throw Error('Chọn đúng Profile ID trước.');
  const selected=await this.call('/profiles/'+encodeURIComponent(id));if(selected?.id!==id)throw Error('GPM trả profile không khớp ID đã chọn.');
  const started=await this.call('/profiles/start/'+encodeURIComponent(id));
  if(started.profile_id!==id)throw Error('GPM mở profile không khớp ID đã chọn.');
  const port=Number(started.remote_debugging_port);if(!Number.isInteger(port)||port<1||port>65535)throw Error('GPM chưa trả CDP port hợp lệ.');
  return {cdp:'http://127.0.0.1:'+port,profileId:id,profileName:selected.name};
 }
 async applyAndOpen(id,raw){
  if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))throw Error('Chọn đúng Profile ID trước.');if(raw)raw=proxy(raw);
  const selected=await this.call('/profiles/'+encodeURIComponent(id));if(selected?.id!==id)throw Error('GPM trả profile không khớp ID đã chọn.');
  if((selected.raw_proxy||'')===raw)return this.open(id);
  // Explicit UI action: apply proxy and restart exactly this profile, not other profiles.
  await this.call('/profiles/stop/'+encodeURIComponent(id));
  await this.call('/profiles/update/'+encodeURIComponent(id),{raw_proxy:raw});
  const updated=await this.call('/profiles/'+encodeURIComponent(id));if(updated.raw_proxy!==raw)throw Error('GPM chưa lưu đúng proxy; chưa mở profile.');
  const started=await this.call('/profiles/start/'+encodeURIComponent(id));
  if(started.profile_id!==id)throw Error('GPM mở profile không khớp ID đã chọn.');
  const port=Number(started.remote_debugging_port);if(!Number.isInteger(port)||port<1||port>65535)throw Error('GPM chưa trả CDP port hợp lệ.');
  return {cdp:'http://127.0.0.1:'+port,profileId:id,profileName:selected.name};
 }
}

// Read-only probes. Discovery is shown in the settings draft, never silently saved.
export async function checkGpmConnection(base,{request=fetch}={}){
 const configured=localApi(base),initial=new GpmApi(configured),candidates=[configured,initial.base+'/api/'+(initial.version==='v1'?'v3':'v1'),'http://127.0.0.1:9495/api/v1','http://127.0.0.1:19995/api/v3'];
 const failures=[],unreachable=new Set();
 for(const address of [...new Set(candidates)]){
  const api=new GpmApi(address,(url,options)=>request(url,{...options,signal:AbortSignal.timeout(3000)}));
  if(unreachable.has(api.base))continue;
  try{await api.list({limit:1});return {ok:true,gpmApi:address,version:api.version,discovered:address!==configured,message:'Đã kết nối GPM '+api.version+' tại '+address+'. '+(address!==configured?'Bấm Lưu để áp dụng địa chỉ này cho tất cả profile.':'')};}
  catch(e){failures.push(e.message);if(['ECONNREFUSED','ENOTFOUND','EHOSTUNREACH','TIMEOUT'].includes(e.code))unreachable.add(api.base);}
 }
 throw Error(failures.join('\n'));
}

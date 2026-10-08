import {randomBytes} from 'node:crypto';
import {GpmApi} from './gpm-api.mjs';
import {ProfileTransfer,TRANSFER_FORMAT} from './profile-transfer.mjs';
import {dashboard} from './dashboard.mjs';
const validId=id=>typeof id==='string'&&/^[-\w]{1,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const own=(object,key)=>Object.hasOwn(object||{},key);
const header=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
const idFields=new Set(['id','profileid','uuid','profileuuid']),nameFields=new Set(['name','profilename','ten','tenprofile']);
function csv(text){
 const first=text.split(/\r?\n/,1)[0];const delim=['\t',';',','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=[];let row=[],value='',quoted=false,ended=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;ended=true;}}else value+=c;continue;}
  if(c==='"'){if(value||ended)throw Error('CSV có dấu nháy không hợp lệ.');quoted=true;}else if(c===delim){row.push(value);value='';ended=false;}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(v=>v.trim()))rows.push(row);row=[];value='';ended=false;}else{if(ended&&!/\s/.test(c))throw Error('CSV có dữ liệu sau dấu nháy đóng.');if(!ended)value+=c;}
 }
 if(quoted)throw Error('CSV thiếu dấu nháy đóng.');row.push(value);if(row.some(v=>v.trim()))rows.push(row);
 const keys=(rows.shift()||[]).map(header),id=keys.findIndex(k=>idFields.has(k)),name=keys.findIndex(k=>nameFields.has(k));if(id<0&&name<0)throw Error('CSV cần cột id/profile_id hoặc name/profile_name.');
 return rows.map((r,i)=>{if(r.length!==keys.length)throw Error('CSV sai số cột ở dòng dữ liệu '+(i+1)+'.');return {id:id<0?'':r[id].trim(),name:name<0?'':r[name].trim()};});
}
export function parseProfileList(text,filename=''){
 if(typeof text!=='string'||Buffer.byteLength(text)>5*1024*1024)throw Error('Danh sách tối đa 5 MB.');text=text.replace(/^\uFEFF/,'').trim();if(!text)throw Error('Danh sách đang trống.');
 let rows,native=false;
 if(/\.(zip|gpm|xlsx|xls)$/i.test(filename))throw Error('Chọn danh sách JSON/CSV/TXT hoặc dùng Lấy danh sách từ GPM. File backup/Excel chưa được hỗ trợ.');
 if(/^[\[{]/.test(text)||/\.json$/i.test(filename)){
  let parsed;try{parsed=JSON.parse(text);}catch{throw Error('JSON không hợp lệ.');}
  native=parsed?.format==='hoanxu-profile-list';if(native&&parsed.version!==1)throw Error('Phiên bản file xuất chưa được hỗ trợ.');
  rows=Array.isArray(parsed)?parsed:Array.isArray(parsed?.profiles)?parsed.profiles:Array.isArray(parsed?.data)?parsed.data:parsed?.data?.data;
  if(!Array.isArray(rows))throw Error('JSON cần một mảng profile, profiles[], data[] hoặc data.data[].');
  rows=rows.map(p=>{if(typeof p==='string')return {lookup:p.trim()};if(!p||typeof p!=='object'||Array.isArray(p))return {invalid:true};const fields=Object.entries(p);const id=fields.find(([k])=>idFields.has(header(k)))?.[1],name=fields.find(([k])=>nameFields.has(header(k)))?.[1];return {id:typeof id==='string'?id.trim():id==null?'':String(id),name:typeof name==='string'?name.trim():''};});
 }else if(/\.csv$/i.test(filename)||/[\t;,]/.test(text.split(/\r?\n/,1)[0]))rows=csv(text);
 else rows=text.split(/\r?\n/).filter(s=>s.trim()).map(s=>({lookup:s.trim()}));
 if(!native&&Buffer.byteLength(text)>1024*1024)throw Error('Danh sách thông thường tối đa 1 MB.');
 const max=native?10000:500;if(!rows.length||rows.length>max)throw Error('Mỗi lần nhập cần 1–'+max+' profile.');return rows;
}
export function resolveProfileList(rows,profiles,registry={}){
 const seen=new Set();return rows.map((source,index)=>{
  let p,reason;if(source.invalid)reason='Dòng không hợp lệ';else if(source.id){if(!validId(source.id))reason='ID không hợp lệ';else p=profiles.find(p=>p.id===source.id);}else if(source.lookup)p=profiles.find(p=>p.id===source.lookup);
  if(!reason&&!p&&!source.id){const name=(source.name||source.lookup||'').normalize('NFC').toLowerCase();const matches=profiles.filter(p=>p.name?.normalize('NFC').toLowerCase()===name);if(matches.length>1)reason='Tên trùng trong GPM · cần ID';else p=matches[0];}
  if(!reason&&!p)reason='Không tìm thấy trong GPM';if(p&&!validId(p.id)){p=null;reason='ID GPM không hợp lệ';}
  let status=reason?'invalid':'ready';if(p){if(seen.has(p.id)){status='duplicate';reason='Trùng trong danh sách';}else if(own(registry,p.id)){status='existing';reason='Đã có trong tool';}seen.add(p.id);}
  return {index,id:p?.id||source.id||'',name:p?.name||source.name||source.lookup||'',proxy:p?.proxy||'',status,message:reason||'Có thể nhập'};
 });
}
export class ProfileImporter{
 constructor(manager,{apiFactory=base=>new GpmApi(base),now=Date.now}={}){this.manager=manager;this.apiFactory=apiFactory;this.now=now;this.previews=new Map();this.committing=false;this.transfer=new ProfileTransfer(manager,{apiFactory});}
 async preview({text,filename,fromGpm=false,query='',groupId='',browserVersion=''}={}){
  for(const [token,p] of this.previews)if(p.expiresAt<this.now())this.previews.delete(token);
  if(typeof query!=='string'||query.length>200)throw Error('Từ khóa tìm kiếm tối đa 200 ký tự.');
  if(typeof groupId!=='string'||groupId.length>100||groupId&&!/^[-\w]+$/.test(groupId))throw Error('Nhóm GPM không hợp lệ.');
  const base=(this.manager.store.value.sharedSettings||this.manager.store.value.settings).gpmApi||'http://localhost:9495',api=this.apiFactory(base);
  if(!fromGpm&&typeof text==='string'){let data;try{data=JSON.parse(text);}catch{}if(data?.format===TRANSFER_FORMAT){const result=await this.transfer.preview(text,base,browserVersion),token=randomBytes(24).toString('hex');if(this.previews.size>=20)this.previews.delete(this.previews.keys().next().value);this.previews.set(token,{...result,base,expiresAt:this.now()+300000});const {transferData,...safe}=result;return {...safe,token,expiresAt:this.now()+300000};}}
  let groupsWarning='';const [profiles,groups]=await Promise.all([api.list({metadata:true,...(fromGpm?{search:query.trim(),groupId,limit:501}:{})}),fromGpm&&typeof api.groups==='function'?api.groups().catch(()=>{groupsWarning='Không tải được danh sách nhóm · thử Tải lại danh sách GPM.';return [];}):[]]);
  const limited=fromGpm&&profiles.length>500;
  const source=fromGpm?profiles.slice(0,500).map(p=>({id:p.id})):parseProfileList(text,filename);
  const rows=resolveProfileList(source,profiles,this.manager.store.value.profileRegistry),token=randomBytes(24).toString('hex');
  if(this.previews.size>=20)this.previews.delete(this.previews.keys().next().value);
  this.previews.set(token,{base,rows,expiresAt:this.now()+300000});return {token,rows,limited,groups,groupsWarning,expiresAt:this.now()+300000};
 }
 async commit({token,ids}={}){
  const preview=this.previews.get(token);if(!preview||preview.expiresAt<this.now())throw Error('Bản xem trước hết hạn · xem trước lại.');
  if(preview.base!==((this.manager.store.value.sharedSettings||this.manager.store.value.settings).gpmApi||'http://localhost:9495'))throw Error('Địa chỉ GPM đã thay đổi · xem trước lại trước khi nhập.');
  if(this.committing)throw Error('Đang nhập danh sách khác.');
  const allowed=new Set(preview.rows.filter(r=>r.status==='ready').map(r=>r.id));if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>!allowed.has(id)))throw Error('Chọn profile hợp lệ từ bản xem trước.');
  this.committing=true;try{
   if(preview.transfer)return await this.transfer.commit(preview,ids);
   const profiles=await this.apiFactory(preview.base).list({metadata:true}),results=[];
   for(const id of new Set(ids)){
    if(own(this.manager.store.value.profileRegistry,id)){results.push({id,status:'existing',message:'Đã có trong tool · giữ nguyên dữ liệu'});continue;}
    const p=profiles.find(p=>p.id===id);if(!p){results.push({id,status:'invalid',message:'Profile không còn trong GPM'});continue;}
    try{const settings={...structuredClone(this.manager.store.value.sharedSettings||this.manager.store.value.settings),gpmApi:preview.base,profileId:id,profileName:p.name,proxy:p.proxy||'',cdp:'http://127.0.0.1:9222/'};await this.manager.register(settings,'nhập profile có sẵn từ GPM');const data=await this.manager.profileStore(id);this.manager.views.set(id,dashboard(data.value,false));this.manager.live.set(id,{metadata:p,fresh:true,checkedAt:new Date(this.now()).toISOString(),status:'present',error:null});results.push({id,name:p.name,status:'imported',message:'Đã thêm vào tool'});}catch{results.push({id,status:'error',message:'Không lưu được profile · xem trước lại trước khi thử lại'});}
   }
   this.manager.onChange();return {results};
  }finally{this.committing=false;}
 }
}

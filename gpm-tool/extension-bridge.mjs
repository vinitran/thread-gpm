import {randomBytes} from 'node:crypto';
export class ExtensionBridge{
 constructor(status){this.status=status;this.token=randomBytes(32).toString('hex');this.pending=new Map();this.queue=[];this.lastSeen=0;this.waiters=new Set();}
 authorize(headers,id){return !this.closed&&headers['x-extension-token']===this.token&&(!headers.origin||headers.origin==='chrome-extension://'+id);}
 touch(){this.lastSeen=Date.now();}
 call(method,args={},timeoutMs=45000){
  if(this.closed)return Promise.reject(Error('Đã đóng kết nối extension.'));
  const id=randomBytes(12).toString('hex');return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);this.queue=this.queue.filter(j=>j.id!==id);reject(Error('Extension không phản hồi lệnh '+method+'. Kiểm tra profile GPM.'));},timeoutMs);
   this.pending.set(id,{resolve,reject,timer});this.queue.push({id,method,args});for(const wake of [...this.waiters])wake();
  });
 }
 async poll(signal){
  if(this.closed||signal?.aborted)return {job:null,status:this.status().status};
  this.touch();
  if(!this.queue.length)await new Promise(resolve=>{
   const wake=()=>{clearTimeout(timer);this.waiters.delete(wake);signal?.removeEventListener('abort',wake);resolve();};
   const timer=setTimeout(wake,18000);this.waiters.add(wake);signal?.addEventListener('abort',wake,{once:true});
   if(this.closed||signal?.aborted)wake();
  });
  if(this.closed||signal?.aborted)return {job:null,status:this.status().status};
  this.touch();return {job:this.queue.shift()||null,status:this.status().status};
 }
 result({id,result,error}){this.touch();const p=this.pending.get(id);if(!p)return false;this.pending.delete(id);clearTimeout(p.timer);if(error)p.reject(Error('Extension: '+error));else p.resolve(result);return true;}
 async ready(timeoutMs=20000){const deadline=Date.now()+timeoutMs;while(!this.lastSeen){if(this.closed)throw Error('Đã đóng kết nối extension.');if(Date.now()>deadline)throw Error('Extension chưa kết nối với app. Kiểm tra phiên bản Chrome trong GPM.');await new Promise(r=>setTimeout(r,100));}}
 close(){this.closed=true;for(const wake of [...this.waiters])wake();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Đã đóng kết nối extension.'));}this.pending.clear();this.queue=[];}
}

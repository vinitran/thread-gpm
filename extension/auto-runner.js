const LEGACY_TOPICS='mua sắm, mua đồ, mua quà, shopping, shopee, săn sale, đồ ăn, ăn gì, đặt đồ ăn, quán ăn, nhà hàng, trà sữa, thời trang, quần áo, outfit, phối đồ, váy, giày, túi xách';
export const AUTO_DEFAULTS={minRestSeconds:120,maxRestSeconds:180,searchDelaySeconds:30,stepSeconds:2,idleScroll:true,tagHoanxu:false,typingDelayMs:60,keywords:'mua sắm online, hỏi mua đồ, xin review, đánh giá sản phẩm, so sánh sản phẩm, săn sale, mã giảm giá, voucher, freeship, giỏ hàng, chốt đơn, shopee, sàn S, tiktok shop, tíc tóc, lazada, mua quà, đồ gia dụng, đồ dùng học tập, phụ kiện điện thoại, mỹ phẩm, skincare, quần áo, thời trang, outfit, váy, giày, túi xách, đồ ăn đặt online'};
export function autoConfig(input={}){
 const c={...AUTO_DEFAULTS,...input};if(c.keywords===LEGACY_TOPICS)c.keywords=AUTO_DEFAULTS.keywords;delete c.maxComments;delete c.minMinutes;delete c.maxMinutes;
 const average=input.restAverageSeconds;
 if(average!==undefined){if(!Number.isFinite(average)||average<0||!Number.isFinite(average*1.2))throw Error('Thời gian nghỉ trung bình cần là số không âm hợp lệ.');c.minRestSeconds=Math.round(average*.8);c.maxRestSeconds=Math.round(average*1.2);}
 if(average===undefined&&Number.isFinite(c.minRestSeconds)&&Number.isFinite(c.maxRestSeconds)&&c.minRestSeconds>=40&&c.minRestSeconds<=c.maxRestSeconds&&c.maxRestSeconds<=60){c.minRestSeconds=120;c.maxRestSeconds=180;}
 for(const [key,min,max] of [['minRestSeconds',120,180],['maxRestSeconds',120,180],['searchDelaySeconds',1,180],['stepSeconds',.5,10],['typingDelayMs',0,500]])if(!(['minRestSeconds','maxRestSeconds'].includes(key)&&average!==undefined)&&(!Number.isFinite(c[key])||c[key]<min||c[key]>max))throw Error('Cấu hình tự động không hợp lệ: '+key);
 if(typeof c.tagHoanxu!=='boolean')throw Error('Tùy chọn tag không hợp lệ.');
 if(typeof c.idleScroll!=='boolean')throw Error('Chế độ cuộn khi nghỉ không hợp lệ.');
 if(c.idleEngagement!==undefined&&typeof c.idleEngagement!=='boolean')throw Error('Chế độ Thả tim khi nghỉ không hợp lệ.');
 if(c.maxRestSeconds<c.minRestSeconds||typeof c.keywords!=='string'||!c.keywords.trim()||c.keywords.length>1000)throw Error('Kiểm tra khoảng nghỉ và từ khóa.');
 return c;
}
export function eligible(post,config,self,history,receipts){
 return !!post.url&&!!post.author&&post.author!==self&&!history[post.url]&&!receipts[post.url];
}
export function searchWaitMs(seconds,random=Math.random){return Math.round(Math.max(1,Math.min(180,seconds*(.7+random()*.6)))*1000);}
export const SESSION_LIMIT=10;
export const sessionSendCount=stats=>(stats?.posted||0)+Math.max(stats?.sent||0,stats?.unknown||0);
export class AutoRunner{
 constructor(deps){this.d=deps;this.state=null;this.running=false;this.starting=false;}
 async load(){if(!this.state){this.loading??=this.d.read();this.state=await this.loading||{status:'idle',history:{},events:[]};if(this.state.config){this.state.config=autoConfig(this.state.config);if(this.state.activity?.phase==='resting'&&this.state.nextAt)this.state.nextAt=Math.min(this.state.nextAt,this.d.now()+this.state.config.maxRestSeconds*1000);}}return this.state;}
 async save(){
  this.state.history=Object.fromEntries(Object.entries(this.state.history||{}).slice(-5000));
  const snapshot=structuredClone(this.state);
  this.saving=(this.saving||Promise.resolve()).catch(()=>{}).then(()=>this.d.write(snapshot));await this.saving;
 }
 event(message){this.state.events=[{time:new Date(this.d.now()).toISOString(),message},...(this.state.events||[])].slice(0,200);}
 async activity(phase,message){
  if(this.state.activity?.phase===phase&&this.state.activity?.message===message)return;
  this.state.activity={phase,message,since:this.d.now()};this.event(message);await this.save();
 }
 async progress(message){
  if(!this.state?.current)return;
  this.state.current.step=message;await this.activity(/xác minh|URL comment/.test(message)?'verifying':'commenting',message);
 }
 active(){return this.state.status==='running';}
 canIdleEngage(){const s=this.state;return !!this.d.idleCandidates&&!!this.d.idleEngage&&s.config.idleEngagement!==false&&!s.current&&!s.sessionRest&&['waiting','resting'].includes(s.activity?.phase)&&s.nextAt>this.d.now()+5000;}
 engagementDelay(){return 20000+Math.floor(this.d.random()*25001);}
 async scheduleNext(){
  const s=this.state;if(!this.active())return;
  if(s.sessionRest){await this.d.schedule(s.sessionRest.until);return;}
  s.nextIdleAt??=this.d.now()+15000;
  const times=[s.nextAt];if(s.config.idleScroll&&s.current?.phase!=='posting')times.push(s.nextIdleAt);
  if(this.canIdleEngage()){
   if(s.engagementWait?.until!==s.nextAt){s.engagementWait={until:s.nextAt,attempts:0,limit:2+Math.min(3,Math.floor(this.d.random()*4)),nextAt:this.d.now()+this.engagementDelay()};await this.save();}
   if(!Number.isInteger(s.engagementWait.limit)){s.engagementWait.limit=2+Math.min(3,Math.floor(this.d.random()*4));await this.save();}
   if(s.engagementWait.attempts<s.engagementWait.limit&&s.engagementWait.nextAt<s.nextAt-5000)times.push(s.engagementWait.nextAt);
  }
  await this.d.schedule(Math.min(...times));
 }
 async engageIdle(){
  const s=this.state,window=s.engagementWait;
  if(!this.canIdleEngage()||!window||window.until!==s.nextAt||window.attempts>=window.limit||window.nextAt>this.d.now())return;
  const history=s.idleEngagementHistory??={};
  try{
   const result=await this.d.idleCandidates(s.source);
   if(!this.active()||!this.canIdleEngage())return;
   const candidates=(result.posts||[]).filter(p=>p.url&&!history[p.url]);
   if(!candidates.length){window.attempts=window.limit;this.event('Thả tim khi nghỉ · '+(result.skipped||'không còn bài mới khả dụng'));await this.save();return;}
   const post=candidates[Math.min(candidates.length-1,Math.floor(this.d.random()*candidates.length))];
   window.attempts++;history[post.url]={state:'attempting',created_at:new Date(this.d.now()).toISOString()};await this.save();
   if(!this.active()||!this.canIdleEngage())return;
   const outcome=await this.d.idleEngage(s.source,post.url,window.until-1000);
   history[post.url]={...history[post.url],state:'attempted',...outcome};
   this.event('Thả tim khi nghỉ · bài '+window.attempts+'/'+window.limit+' · '+post.url+' · Like: '+(outcome.like||'skipped'));
  }catch(e){
   window.attempts=window.limit;
   this.event('Thả tim khi nghỉ chưa hoàn tất: '+e.message);
   if(/đăng nhập|kiểm tra hoặc giới hạn/.test(e.message)){await this.finish('attention',e.message);return;}
  }
  window.nextAt=this.d.now()+this.engagementDelay();await this.save();
 }
 async idle(){
  if(this.state.current?.phase==='posting'||(!this.state.config.idleScroll&&!this.canIdleEngage()))return;
  this.running=true;
  try{await this.engageIdle();if(this.active()&&this.state.config.idleScroll&&(this.state.nextIdleAt||0)<=this.d.now()){
    await this.d.idleScroll(this.state.source);
    this.event('Đang nghỉ · đã cuộn nhẹ lên/xuống và trở về vị trí quét');
    this.state.nextIdleAt=this.d.now()+20000+Math.floor(this.d.random()*25001);await this.save();
  }}catch(e){this.event('Cuộn khi nghỉ chưa thực hiện: '+e.message);this.state.nextIdleAt=this.d.now()+60000;await this.save();}
  finally{this.running=false;if(this.state.status==='stopping')await this.finish('stopped','Đã dừng');}
 }
 async start(input){
  await this.load();if(this.starting||this.running||['running','stopping'].includes(this.state.status))throw Error('Phiên tự động đang chạy.');
  const config=autoConfig(input);this.starting=true;try{await this.d.prepare();const source=await this.d.source();
  this.state={imageRepliesSinceTag:this.state.imageRepliesSinceTag||0,status:'running',config,source,current:null,queue:[],selectionBatch:null,needsScroll:false,idleEngagementHistory:this.state.idleEngagementHistory||{},history:Object.fromEntries(Object.entries(this.state.history||{}).filter(([,v])=>v.state!=='queued')),events:[],stats:{scanned:0,selected:0,posted:0,failed:0,unknown:0},authors:[],emptyScans:0,nextAt:this.d.now()+15000,startedAt:new Date(this.d.now()).toISOString()};
  this.event('Bắt đầu phiên tự động');await this.activity('waiting','Đang chờ trang chủ Threads tải xong');await this.scheduleNext();return this.state;}finally{this.starting=false;}
 }
 async stop(){await this.load();this.state.status=this.running?'stopping':'stopped';await this.activity(this.running?'stopping':'stopped',this.running?'Đã yêu cầu dừng · đang kết thúc thao tác hiện tại':'Đã dừng');await this.d.clear();return this.state;}
 async finish(status,message){this.state.status=status;this.state.nextAt=null;await this.activity(status,message);await this.d.clear();}
 async restBetweenSessions(){
  const s=this.state;if(!this.active())return this.finish('stopped','Đã dừng');
  if(!s.sessionRest){
   s.sessionRest={until:this.d.now()+3*60*60*1000,oldTabId:s.source,closed:false};s.nextAt=s.sessionRest.until;
   s.sessionHistory=[...(s.sessionHistory||[]),{startedAt:s.startedAt,endedAt:new Date(this.d.now()).toISOString(),stats:{...s.stats}}].slice(-100);
   await this.activity('session-rest','Đã đạt 10 lần gửi · nghỉ 3 giờ, sau đó tự mở tab mới và chạy tiếp');
   await this.scheduleNext();
  }
  if(!s.sessionRest.closed){
   try{await this.d.closeSource(s.sessionRest.oldTabId);s.sessionRest.closed=true;s.source=null;this.event('Đã đóng tab Threads của phiên · chờ đến '+new Date(s.sessionRest.until).toLocaleTimeString('vi-VN'));await this.save();}
   catch(e){this.event('Chưa đóng được tab phiên cũ: '+e.message);await this.save();}
  }
  if(!this.active())return;
  if(this.d.now()<s.sessionRest.until){await this.scheduleNext();return;}
  if(!s.sessionRest.closed){await this.d.schedule(this.d.now()+60000);return;}
  const source=await this.d.newSource();s.source=source;
  if(!this.active()){await this.d.closeSource(source);return this.finish('stopped','Đã dừng · hủy phiên tiếp theo');}
  s.sessionRest=null;s.current=null;s.queue=[];s.selectionBatch=null;s.recovery=null;s.recoveryAttempts=0;s.browserRetries=0;s.nextImageAt=null;s.needsScroll=false;s.emptyScans=0;s.authors=[];
  s.history=Object.fromEntries(Object.entries(s.history).filter(([,v])=>v.state!=='queued'));
  s.stats={scanned:0,selected:0,posted:0,sent:0,failed:0,unknown:0};s.startedAt=new Date(this.d.now()).toISOString();s.nextAt=this.d.now()+15000;s.nextIdleAt=s.nextAt+15000;
  await this.activity('waiting','Đã nghỉ đủ 3 giờ · mở tab mới, chờ 15 giây rồi bắt đầu phiên 10 comment tiếp theo');await this.scheduleNext();
 }
 async recover(reason){
  const s=this.state;
  if(!this.active())return this.finish('stopped','Đã dừng · không mở tab khôi phục');
  if(!s.recovery){
   s.recoveryAttempts=(s.recoveryAttempts||0)+1;
   if(s.recoveryAttempts>3)return this.finish('attention','Khôi phục tab 3 lần liên tiếp vẫn lỗi: '+reason);
   if(s.current&&(!s.history[s.current.post.url]||s.history[s.current.post.url].state==='queued'))s.history[s.current.post.url]={state:'error',error:reason};
   s.recovery={reason,oldTabId:s.source,newTabId:null};
   await this.activity('recovering','Thử lại chưa thành công · đang mở trang chủ trong tab mới: '+reason);
  }
  try{
   const source=await this.d.replaceSource(s.recovery.oldTabId,{
    newTabId:s.recovery.newTabId,shouldContinue:()=>this.active(),
    onCreated:async id=>{s.source=id;s.recovery.newTabId=id;await this.save();},
    onProgress:message=>this.activity('recovering',message).catch(console.error)
   });
   s.source=source;
   for(const post of s.queue||[])if(s.history[post.url]?.state==='queued')delete s.history[post.url];
   s.current=null;s.queue=[];s.selectionBatch=null;s.needsScroll=false;s.emptyScans=0;s.browserRetries=0;s.recovery=null;
   if(!this.active())return this.finish('stopped','Đã dừng trong lúc khôi phục tab');
   s.nextAt=this.d.now()+15000;s.nextIdleAt=s.nextAt+15000;
   await this.activity('waiting','Đã khôi phục tab · chờ trang chủ tải 15 giây rồi tìm bài mới');await this.scheduleNext();
  }catch(e){await this.finish(this.active()?'attention':'stopped','Không khôi phục được tab: '+e.message);}
 }
 async settle(receipt){
  const s=this.state,item=s.current;
  if(!item.tagCycleCounted&&['posted','sent_unverified'].includes(receipt.state)){
   if(item.tagHoanxu)s.imageRepliesSinceTag=0;
   else if(item.withImages&&s.config.tagHoanxu)s.imageRepliesSinceTag=Math.min(4,(s.imageRepliesSinceTag||0)+1);
   item.tagCycleCounted=true;
  }
  if(item.withImages&&item.imageGapMs&&['posted','sent_unverified'].includes(receipt.state)){
   const clicked=Date.parse(receipt.clicked_at||receipt.created_at||'');
   if(!item.imageScheduled){s.nextImageAt=Math.max(s.nextImageAt||0,(Number.isFinite(clicked)?clicked:this.d.now())+item.imageGapMs);item.imageScheduled=true;this.event('Lượt ảnh tiếp theo sau khoảng '+Math.round((s.nextImageAt-this.d.now())/60000)+' phút · các lượt giữa dùng chữ');}
  }
  if(receipt.state==='posted'&&receipt.comment_url){if(item.rechecks||item.receiptCounted)s.stats.unknown=Math.max(0,s.stats.unknown-1);s.stats.posted++;s.authors.push(item.post.author);s.history[item.post.url]={state:'posted',comment_url:receipt.comment_url,time:receipt.verified_at};this.event('Đã đăng: '+receipt.comment_url);}
  else if(receipt.state==='sent_unverified'){s.stats.sent=(s.stats.sent||0)+1;if(!item.receiptCounted&&!item.rechecks)s.stats.unknown++;s.history[item.post.url]={state:'sent_unverified',time:receipt.clicked_at};this.event('Đã bấm Post · chưa xác minh: '+item.post.url);}
  else{
   if(!item.rechecks&&!item.receiptCounted)s.stats.unknown++;
   item.rechecks=(item.rechecks||0)+1;s.history[item.post.url]={state:'unknown'};
   if(this.active()&&item.rechecks<=2){this.event('Chờ kiểm tra lại URL comment (không gửi lại): '+item.post.url);s.nextAt=this.d.now()+60000;await this.activity('resting','Đang nghỉ 1 phút trước khi kiểm tra lại URL comment');await this.scheduleNext();return;}
   this.event('Chưa xác minh được: '+item.post.url);
  }
  s.current=null;if(!s.queue.length)s.needsScroll=true;
  if(sessionSendCount(s.stats)>=SESSION_LIMIT)return this.restBetweenSessions();
  if(receipt.navigation_error)return this.recover('Chưa quay lại trang chủ: '+receipt.navigation_error);
  if(!['posted','sent_unverified'].includes(receipt.state))return this.recover('Chưa xác minh được lần gửi · bỏ qua bài này, không gửi lại');
  s.recoveryAttempts=0;s.browserRetries=0;
  if(!this.active())return this.finish('stopped','Đã dừng sau lần gửi đang xử lý');
  for(const post of s.queue){if(s.history[post.url]?.state==='queued')delete s.history[post.url];}s.queue=[];s.needsScroll=false;
  const restSeconds=Math.floor(s.config.minRestSeconds+this.d.random()*(s.config.maxRestSeconds-s.config.minRestSeconds+1));
  s.nextAt=this.d.now()+Math.min(restSeconds,s.config.maxRestSeconds)*1000;
  if(s.nextImageAt)s.nextAt=Math.min(s.nextAt,Math.max(this.d.now()+15000,s.nextImageAt));await this.activity('resting','Đã về trang chủ · Đang nghỉ '+Math.ceil((s.nextAt-this.d.now())/1000)+' giây trước khi tìm bài mới');await this.scheduleNext();
 }
 async tick(){
  await this.load();if(this.running||!this.active())return;
  if(this.state.sessionRest||sessionSendCount(this.state.stats)>=SESSION_LIMIT){
   this.running=true;try{await this.restBetweenSessions();}catch(e){await this.finish(this.active()?'attention':'stopped','Chưa mở được phiên mới: '+e.message);}finally{this.running=false;if(this.state.status==='stopping')await this.finish('stopped','Đã dừng · hủy lần chạy tiếp');}return;
  }
  if(this.state.nextAt>this.d.now()){await this.idle();await this.scheduleNext();return;}
  this.running=true;const keep=this.d.keepAlive();
  try{
   const s=this.state;s.nextAt=null;
   if(s.recovery)return await this.recover(s.recovery.reason);
   const receipts=await this.d.receipts();
   // A persisted submitting job is reconciled, never automatically resubmitted.
   if(s.current?.phase==='posting'){
    if(!receipts[s.current.post.url])return await this.recover('Phiên bị gián đoạn trước khi ghi nhận lần gửi · bỏ qua bài đang xử lý');
    await this.activity('verifying','Đang kiểm tra lại URL comment: '+s.current.post.url);
    return await this.settle(await this.d.check(s.current.post.url));
   }
   if(!s.current){
    if(!s.queue.length){
     if(s.needsScroll){
      await this.activity('searching','Đã xử lý hết nhóm bài · đang cuộn tìm nhóm mới');await this.d.scroll(s.source);s.needsScroll=false;s.nextAt=this.d.now()+searchWaitMs(s.config.searchDelaySeconds,this.d.random);
      await this.activity('waiting','Đang chờ các bài mới tải sau khi cuộn');await this.scheduleNext();return;
     }
     let pending=s.selectionBatch;
     if(!pending){
      await this.activity('searching','Đang lấy đầy đủ nội dung các bài mới…');
      const excludeURLs=[...new Set([...Object.keys(s.history),...Object.keys(receipts)])];
      const batch=await this.d.capture(s.source,excludeURLs);
      const unique=[...new Map(batch.posts.map(p=>[p.url,p])).values()];
      const posts=unique.filter(p=>eligible(p,s.config,batch.self,s.history,receipts));
      for(const p of unique)if(!posts.includes(p)&&!s.history[p.url])s.history[p.url]={state:'skipped'};
      s.stats.scanned+=posts.length;
      pending=s.selectionBatch={posts,batch,retries:0};await this.d.savePosts(batch);await this.save();
     }
     if(!this.active())return;
     let selected=[];
     if(pending.posts.length){
      await this.activity('filtering',`Đang gọi AI lọc ${pending.posts.length} bài mới theo chủ đề`);
      const urls=await this.d.classify(pending.posts,s.config.keywords);
      const allowed=new Set(pending.posts.map(p=>p.url));
      if(!Array.isArray(urls)||urls.some(url=>!allowed.has(url)))throw Error('AI lọc bài trả URL không thuộc nhóm đang xét.');
      const chosen=new Set(urls),byURL=new Map(pending.posts.map(p=>[p.url,p]));selected=[...chosen].map(url=>byURL.get(url));
      for(const p of pending.posts)s.history[p.url]={state:chosen.has(p.url)?'queued':'ai-skipped'};
     }
     s.queue=selected;s.stats.selected+=s.queue.length;this.event(`AI đã xét ${pending.posts.length} bài · chọn ${s.queue.length} bài phù hợp`);
     s.selectionBatch=null;s.emptyScans=s.queue.length?0:s.emptyScans+1;await this.save();
     if(!this.active())return;
     if(!s.queue.length){
      if(s.emptyScans>=15&&!pending.posts.length){
       await this.activity('searching','Chưa có bài mới phù hợp · đang làm mới bảng tin');
       await this.d.refresh(s.source);s.emptyScans=0;s.nextAt=this.d.now()+searchWaitMs(s.config.searchDelaySeconds,this.d.random);await this.activity('waiting','Đang chờ bài mới sau khi làm mới bảng tin');await this.scheduleNext();return;
      }
      await this.activity('searching','Đang cuộn để tìm thêm bài');await this.d.scroll(s.source);s.nextAt=this.d.now()+searchWaitMs(s.config.searchDelaySeconds,this.d.random);await this.activity('waiting','Đang chờ bài mới tải sau khi cuộn');await this.scheduleNext();return;
     }
    }
    const post=s.queue.shift();
    if(receipts[post.url]){s.nextAt=this.d.now()+searchWaitMs(s.config.searchDelaySeconds,this.d.random);await this.activity('waiting','Bỏ qua bài đã gửi · chờ lượt tiếp theo');await this.scheduleNext();return;}
    s.current={post,phase:'generating',withImages:!s.nextImageAt||this.d.now()>=s.nextImageAt};await this.save();
   }
   const post=s.current.post;
   await this.activity('ai','Đang gọi AI lấy response cho @'+post.author);
   s.current.withImages??=!s.nextImageAt||this.d.now()>=s.nextImageAt;
   s.current.tagHoanxu=s.config.tagHoanxu===true&&(s.imageRepliesSinceTag||0)>=4;
   if(s.current.tagHoanxu)s.current.withImages=false;
   await this.d.generate(post,s.current.withImages,s.current.tagHoanxu);this.event('Đã nhận response AI cho @'+post.author);
   if(!this.active())return;
   s.current.phase='posting';
   if(s.current.withImages){s.current.imageGapMs=360000+Math.floor(this.d.random()*120001);s.nextImageAt=this.d.now()+s.current.imageGapMs;}
   await this.activity('commenting',(s.current.withImages?'Đang chuẩn bị comment + 3 ảnh: ':s.current.tagHoanxu?'Đang chuẩn bị comment chữ + @hoanxu.app: ':'Đang chuẩn bị comment chữ: ')+post.url);
   if(!this.active())return;
   const result=await this.d.post(post.url,s.config.stepSeconds*1000,()=>this.active(),s.config.typingDelayMs,s.current.withImages);
   await this.settle(result);
  }catch(e){
   const s=this.state;
   const aiJob=s.selectionBatch||(s.current?.phase==='generating'?s.current:null),aiPolicy=this.d.aiRetryPolicy;
   const retryableAI=aiPolicy?.retryAllErrors||(/fetch|network|timeout|timed out|HTTP 50[234]/i.test(e.message)&&!/quota|429|giới hạn/i.test(e.message));
   if(this.active()&&aiJob&&retryableAI){
    const maxRetries=aiPolicy?.maxRetries??2;
    if((aiJob.retries||0)<maxRetries){
     aiJob.retries=(aiJob.retries||0)+1;const delayMs=aiPolicy?.delayMs??60000*aiJob.retries;s.nextAt=this.d.now()+delayMs;
     this.event('AI lỗi: '+e.message);await this.activity('resting','Đang nghỉ '+delayMs/1000+' giây trước khi thử gọi AI lại · lần '+aiJob.retries+'/'+maxRetries);await this.scheduleNext();return;
    }
    if(aiPolicy?.retryAllErrors){
     s.stats.failed++;if(s.current)s.history[s.current.post.url]={state:'error',error:e.message};
     await this.finish('attention','AI vẫn lỗi sau '+maxRetries+' lần gọi lại: '+e.message);return;
    }
   }
   if(this.active()&&!/quota|429|đăng nhập|HTTP 40[13]/i.test(e.message)&&(s.current?.phase==='posting'||/Bước |Tab nguồn|No tab|tab.*(closed|removed|not found)|Tabs cannot be edited|Cannot access|Receiving end does not exist|Không nhận được kết quả DOM|Không đọc được dữ liệu|frame.*removed|debugger|target.*closed/i.test(e.message))){
    s.browserRetries=(s.browserRetries||0)+1;this.event('Lỗi thao tác Threads: '+e.message);
    const receipts=await this.d.receipts();
    if(s.current&&receipts[s.current.post.url]&&!s.current.receiptCounted&&!s.current.rechecks){s.stats.unknown++;s.current.receiptCounted=true;}
    if(sessionSendCount(s.stats)>=SESSION_LIMIT)return await this.restBetweenSessions();
    if(s.browserRetries<=2&&(!s.current||s.current.phase!=='posting'||receipts[s.current.post.url])){
     s.nextAt=this.d.now()+30000;await this.activity('waiting','Đang chờ 30 giây trước khi thử lại thao tác · lần '+s.browserRetries+' (không bấm gửi lại)');await this.scheduleNext();return;
    }
    s.stats.failed++;return await this.recover(e.message);
   }
   s.stats.failed++;if(s.current)s.history[s.current.post.url]={state:'error',error:e.message};
   await this.finish(this.active()?'attention':'stopped',e.message);
  }finally{this.d.endKeepAlive(keep);this.running=false;if(this.state.status==='stopping')await this.finish('stopped','Đã dừng');}
 }
}

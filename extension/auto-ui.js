import {AUTO_DEFAULTS,sessionSendCount} from './auto-runner.js';
export function initAutoUI({send,beforeStart=()=>{},onState=()=>{},onError=()=>{}}){
 const $=id=>document.getElementById(id);let snapshot,loadedConfig=false;
 $('auto-keywords').value=AUTO_DEFAULTS.keywords;
 const statusNames={idle:'Chưa chạy',running:'Đang chạy',stopping:'Đang dừng',stopped:'Đã dừng',attention:'Cần kiểm tra',completed:'Hoàn tất phiên'};
 function renderActivity(){
  const state=snapshot?.state;if(!state)return;
  $('auto-current').textContent=state.activity?.message||statusNames[state.status]||'Chưa chạy';
  const seconds=state.activity?.since?Math.max(0,Math.floor((Date.now()-state.activity.since)/1000)):0;
  $('auto-elapsed').textContent=['running','stopping'].includes(state.status)?`Bước hiện tại: ${Math.floor(seconds/60)} phút ${seconds%60} giây`:'';
  if(state.status==='running'&&state.nextAt){const remaining=Math.max(0,Math.ceil((state.nextAt-Date.now())/1000));$('auto-next').textContent=remaining?`Tiếp tục sau ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'Đang chờ Chrome kích hoạt lượt tiếp theo…';}
  if(state.status==='running'&&!state.sessionRest&&state.nextImageAt)$('auto-next').textContent+=' · Lượt có ảnh: '+new Date(state.nextImageAt).toLocaleTimeString('vi-VN');
  if(!(state.status==='running'&&state.nextAt))$('auto-next').textContent=state.current?`Bài đang xử lý: @${state.current.post.author}`:'';
 }
 function render(state,receipts,tabLifecycle=[]){
  snapshot={state,receipts,tabLifecycle};
  if(!loadedConfig&&state.config){$('auto-search-delay').value=state.config.searchDelaySeconds??AUTO_DEFAULTS.searchDelaySeconds;$('auto-keywords').value=state.config.keywords;$('auto-min-rest').value=state.config.minRestSeconds??120;$('auto-max-rest').value=state.config.maxRestSeconds??180;$('auto-idle-scroll').checked=state.config.idleScroll??true;$('auto-typing-delay').value=state.config.typingDelayMs??60;loadedConfig=true;}
  const active=['running','stopping'].includes(state.status);
  $('auto-begin').disabled=active;$('auto-end').disabled=!active;
  for(const id of ['auto-keywords','auto-min-rest','auto-max-rest','auto-idle-scroll','auto-typing-delay','auto-search-delay'])$(id).disabled=active;
  $('auto-run-status').textContent=state.sessionRest&&active?'Nghỉ giữa phiên · 3 giờ':statusNames[state.status]||state.status;
  renderActivity();
  const all=Object.values(receipts),posted=all.filter(r=>(r.state==='posted'&&r.comment_url)||r.state==='sent_unverified'),today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
  const daily=posted.filter(r=>new Date(r.verified_at||r.created_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'})===today);
  $('auto-today').textContent=daily.length;$('auto-total').textContent=posted.length;$('auto-session').textContent=sessionSendCount(state.stats)+' / 10';$('auto-unknown').textContent=all.filter(r=>r.state!=='posted').length;
  $('auto-log').textContent=(state.events||[]).map(e=>`${new Date(e.time).toLocaleTimeString('vi-VN')} · ${e.message}`).join('\n')||'Bắt đầu để tự quét trang chủ Threads theo từ khóa.';
  const list=$('auto-history');list.replaceChildren();
  for(const r of all.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,30)){
   const row=document.createElement('div'),link=document.createElement('a');link.href=r.comment_url||r.post_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=r.comment_url?'Xem comment đã đăng':'Xem bài · chưa xác minh';row.append(link,document.createTextNode(' · '+new Date(r.created_at).toLocaleString('vi-VN')));list.append(row);
  }
  onState(state);
 }
 async function refresh(){const r=await send({type:'auto-state'});render(r.state,r.receipts,r.tabLifecycle);}
 $('auto-begin').onclick=async()=>{try{beforeStart();$('auto-begin').disabled=true;await send({type:'auto-start',config:{searchDelaySeconds:Number($('auto-search-delay').value),idleScroll:$('auto-idle-scroll').checked,typingDelayMs:Number($('auto-typing-delay').value),minRestSeconds:Number($('auto-min-rest').value),maxRestSeconds:Number($('auto-max-rest').value),stepSeconds:Number($('comment-delay').value),keywords:$('auto-keywords').value}});await refresh();}catch(e){onError(e);$('auto-begin').disabled=false;}};
 $('auto-end').onclick=async()=>{try{await send({type:'auto-stop'});await refresh();}catch(e){onError(e);}};
 $('auto-stats-refresh').onclick=()=>refresh().catch(onError);
 $('auto-export').onclick=()=>{if(!snapshot)return;const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='threads-comment-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const timer=setInterval(()=>refresh().catch(()=>{}),5000),clock=setInterval(renderActivity,1000);
 const update=(changes,area)=>{if(area==='local'&&(changes.autoRun||changes.replyReceipts))refresh().catch(()=>{});};
 chrome.storage.onChanged.addListener(update);
 window.addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(clock);chrome.storage.onChanged.removeListener(update);});
 refresh().catch(onError);
}

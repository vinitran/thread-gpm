// DOM only: no Threads network endpoints or session internals.
export async function autoPage(action,options={}){
 const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const text=document.body.innerText;
 if(/try again later|temporarily blocked|account suspended|confirm you are human|thử lại sau|tạm thời bị chặn|xác minh bạn là con người/i.test(text))throw Error('Threads đang yêu cầu kiểm tra hoặc giới hạn thao tác.');
 const profile=[...document.querySelectorAll('a[href]')].find(a=>/^(Profile|Trang cá nhân)$/.test(a.getAttribute('aria-label')||a.querySelector('svg title')?.textContent||''));
 if(!profile)throw Error('Không xác nhận được đăng nhập Threads.');
 if([...document.querySelectorAll('[role="dialog"]')].some(visible))throw Error('Tab nguồn đang có hộp thoại.');
 if(action==='scroll'||action==='idle-scroll'){
  const candidates=[...document.querySelectorAll('div,main')].filter(e=>visible(e)&&e.clientHeight>200&&e.scrollHeight>e.clientHeight+100&&/auto|scroll/.test(getComputedStyle(e).overflowY));
  const scroller=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0]||document.scrollingElement;
  if(options.__nativeInput){
   const token='hx'+crypto.randomUUID().replace(/-/g,'');scroller.setAttribute('data-hoanxu-pointer',token);
   const self=new URL(profile.href).pathname.split('/')[1]?.slice(1),initial=scroller.scrollTop;
   if(action==='idle-scroll'){
    const distance=Math.min(280,scroller.clientHeight*(.12+Math.random()*.2)),direction=initial>distance&&Math.random()<.7?-1:1;
    return {__input:[{kind:'wheel',token,deltaY:direction*distance,pauseMs:650+Math.random()*951},{kind:'wheel',token,top:initial,pauseMs:650+Math.random()*951}],result:{self}};
   }
   const distance=Math.max(300,scroller.clientHeight*(.55+Math.random()*.55)),first=.45+Math.random()*.25;
   return {__input:[{kind:'wheel',token,deltaY:distance*first,pauseMs:400+Math.random()*501},{kind:'wheel',token,deltaY:distance*(1-first)}],result:{self}};
  }
  if(action==='idle-scroll'){
   const initial=scroller.scrollTop;
   const distance=Math.min(280,scroller.clientHeight*(.12+Math.random()*.2));
   const direction=initial>distance&&Math.random()<.7?-1:1;
   scroller.scrollBy({top:direction*distance,behavior:'smooth'});
   await new Promise(resolve=>setTimeout(resolve,650+Math.floor(Math.random()*951)));
   const {autoRun}=await chrome.storage.local.get('autoRun');
   if(autoRun&&autoRun.status!=='running')return {stopped:true};
   scroller.scrollTo({top:initial,behavior:'smooth'});
   await new Promise(resolve=>setTimeout(resolve,650+Math.floor(Math.random()*951)));
  }else{
   const distance=Math.max(300,scroller.clientHeight*(.55+Math.random()*.55));
   const first=.45+Math.random()*.25;
   scroller.scrollBy({top:distance*first,behavior:'smooth'});
   await new Promise(resolve=>setTimeout(resolve,400+Math.floor(Math.random()*501)));
   const {autoRun}=await chrome.storage.local.get('autoRun');
   if(autoRun&&autoRun.status!=='running')return {stopped:true};
   scroller.scrollBy({top:distance*(1-first),behavior:'smooth'});
  }
 }
 return {self:new URL(profile.href).pathname.split('/')[1]?.slice(1)};
}

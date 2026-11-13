// DOM only: no Threads network endpoints or session internals.
export async function autoPage(action,options={}){
 const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const text=document.body.innerText;
 if(/try again later|temporarily blocked|account suspended|confirm you are human|thử lại sau|tạm thời bị chặn|xác minh bạn là con người/i.test(text))throw Error('Threads đang yêu cầu kiểm tra hoặc giới hạn thao tác.');
 const profile=[...document.querySelectorAll('a[href]')].find(a=>/^(Profile|Trang cá nhân)$/.test(a.getAttribute('aria-label')||a.querySelector('svg title')?.textContent||''));
 if(!profile)throw Error('Không xác nhận được đăng nhập Threads.');
 if([...document.querySelectorAll('[role="dialog"]')].some(visible))throw Error('Tab nguồn đang có hộp thoại.');
 if(action==='scroll'||action==='idle-scroll'){
  const self=new URL(profile.href).pathname.split('/')[1]?.slice(1);
  const root=document.scrollingElement,landmarks='main,[role="main"],[role="feed"]',peripheral='aside,nav,[role="complementary"],[role="navigation"],[hidden],[aria-hidden="true"],[inert]';
  const scrollable=e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+1&&(e===root||/^(auto|scroll|overlay)$/.test(getComputedStyle(e).overflowY));
  const scrollHost=e=>{for(let n=e;n&&n!==root;n=n.parentElement)if(scrollable(n))return n;return root;};
  const bounds=e=>e===root?{left:0,right:innerWidth,top:0,bottom:innerHeight}:e.getBoundingClientRect();
  const candidates=new Map();
  const consider=(e,post=false)=>{
   if(!visible(e)||e.closest(peripheral))return;
   const scroller=scrollHost(e);if(!scroller||!scrollable(scroller)||scroller.closest(peripheral))return;
   const region=scroller===root?(e.closest(landmarks)||root):scroller;
   const r=bounds(region),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),middle=innerWidth/2;
   // A separate side pane can have posts too. Require its visible column to be central.
   if(right-left<Math.min(140,innerWidth*.35)||r.bottom<=0||r.top>=innerHeight||left>middle+innerWidth*.06||right<middle-innerWidth*.06)return;
   const offset=Math.abs((left+right)/2-middle);if(offset>innerWidth*.22)return;
   const score=(e.closest(landmarks)?2:0)-offset/innerWidth;
   const old=candidates.get(scroller);
   if(!old||score>old.score||score===old.score&&post&&!old.post)candidates.set(scroller,{scroller,region,score,post});
  };
  for(const anchor of document.querySelectorAll('a[href*="/post/"]'))if(anchor.querySelector('time'))consider(anchor,true);
  // While posts are loading, only a recognizable central feed landmark is a safe fallback.
  for(const landmark of document.querySelectorAll(landmarks))consider(landmark);
  const selected=[...candidates.values()].sort((a,b)=>Number(b.post)-Number(a.post)||b.score-a.score)[0];
  if(!selected)return {self,scrolled:false,reason:'Chưa xác định được bảng tin ở giữa trang.'};
  const {scroller,region}=selected;
  if(options.__nativeInput){
   const token='hx'+crypto.randomUUID().replace(/-/g,'');scroller.setAttribute('data-hoanxu-pointer',token);
   region.setAttribute('data-hoanxu-scroll-region',token);
   const initial=scroller.scrollTop;
   const wheel={kind:'wheel',token,exactScroller:true};
   if(action==='idle-scroll'){
    const distance=Math.min(280,scroller.clientHeight*(.12+Math.random()*.2)),direction=initial>distance&&Math.random()<.7?-1:1;
    return {__input:[{...wheel,deltaY:direction*distance,pauseMs:650+Math.random()*951},{...wheel,top:initial,pauseMs:650+Math.random()*951}],result:{self}};
   }
   const distance=Math.max(300,scroller.clientHeight*(.55+Math.random()*.55)),first=.45+Math.random()*.25;
   return {__input:[{...wheel,deltaY:distance*first,pauseMs:400+Math.random()*501},{...wheel,deltaY:distance*(1-first)}],result:{self}};
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

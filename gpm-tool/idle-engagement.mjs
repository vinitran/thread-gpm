// Runs in the Threads page through the GPM browser adapter.
export async function engagementPage({action,url,until=Infinity,stepDelayMs=2000,__nativeInput=false}={}){
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const label=e=>(e.getAttribute('aria-label')||e.querySelector('svg title')?.textContent||e.querySelector('svg')?.getAttribute('aria-label')||e.innerText||'').trim();
 const overlays=()=>[...document.querySelectorAll('[role="dialog"],[role="menu"],[aria-modal="true"]')].filter(e=>visible(e)&&((e.innerText||'').trim()||[...e.querySelectorAll('button,[role="button"],[role="menuitem"],input,textarea,[contenteditable="true"]')].some(c=>visible(c)&&(label(c)||c.matches('input,textarea,[contenteditable="true"]')))));
 const buttons=root=>[...root.querySelectorAll('button,[role="button"]')].filter(visible);
 const path=value=>new URL(value,location.href).pathname.replace(/\/$/,'')||'/';
 if(location.origin!=='https://www.threads.com'||path(location.href)!=='/')return {posts:[],skipped:'Tab không ở trang chủ'};
 if(/try again later|temporarily blocked|account suspended|confirm you are human|thử lại sau|tạm thời bị chặn|xác minh bạn là con người/i.test(document.body.innerText))throw Error('Threads đang yêu cầu kiểm tra hoặc giới hạn thao tác.');
 const profile=[...document.querySelectorAll('a[href]')].find(a=>/^(Profile|Trang cá nhân)$/.test(label(a)));
 if(!profile)throw Error('Không xác nhận được đăng nhập Threads.');
 if(overlays().length||[...document.querySelectorAll('[contenteditable="true"],textarea')].some(e=>visible(e)&&(e.innerText||e.value||'').trim()))return {posts:[],skipped:'Tab có hộp thoại hoặc bản nháp'};
 const self=path(profile.href),cards=new Map();
 for(const anchor of document.querySelectorAll('a[href*="/post/"]')){
  if(!visible(anchor)||!anchor.querySelector('time'))continue;
  const postPath=path(anchor.href);if(!/^\/@[\w.]+\/post\/[-\w]+$/.test(postPath)||postPath.split('/').slice(0,2).join('/')===self||cards.has(postPath))continue;
  for(let root=anchor.parentElement;root&&root!==document.body;root=root.parentElement){
   if(buttons(root).some(b=>/^(Reply|Trả lời)$/i.test(label(b)))){cards.set(postPath,root);break;}
  }
 }
 const available=(root,pattern)=>buttons(root).find(b=>pattern.test(label(b))&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&b.getAttribute('aria-pressed')!=='true');
 if(action==='candidates')return {posts:[...cards].filter(([,root])=>available(root,/^(Like|Thích)$/i)).map(([p])=>({url:'https://www.threads.com'+p}))};
 if(action!=='engage')throw Error('Thao tác tương tác không hợp lệ.');
 const root=cards.get(path(url));if(!root)return {skipped:'Bài không còn trong DOM'};
 const running=async()=>Date.now()<until&&(await chrome.storage.local.get('autoRun')).autoRun?.status==='running';
 const result={url,like:'skipped'};
 const delayBase=Math.max(1500,Math.min(10000,Number(stepDelayMs)||2000));
 const pause=async()=>{const duration=delayBase+Math.floor(Math.random()*1501),end=Date.now()+duration;if(end>=until)return false;while(Date.now()<end){if(!await running())return false;await new Promise(resolve=>setTimeout(resolve,Math.min(100,end-Date.now())));}return running();};
 // Leave room for a paced Like click.
 if(Date.now()+Math.max(5000,delayBase+1500+500)>=until)return {...result,skipped:'Không đủ thời gian nghỉ để tương tác chậm'};
 if(!await running())return {...result,stopped:true};
 const like=available(root,/^(Like|Thích)$/i);
 if(like){if(!await pause())return {...result,stopped:true};const current=available(root,/^(Like|Thích)$/i);if(current&&root.isConnected&&!overlays().length){if(__nativeInput){const token='hx'+crypto.randomUUID().replace(/-/g,'');current.setAttribute('data-hoanxu-pointer',token);return {__input:{kind:'click',token},result:{...result,like:'clicked'}};}current.click();result.like='clicked';}}
 if(!await running())return {...result,stopped:true};
 return result;
}

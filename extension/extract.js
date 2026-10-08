// Reads only rendered DOM. No requests, clicks, scrolling, cookies or page internals.
export function extractPosts({limit=20,mode='feed',excludeURLs=[]}={}) {
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const path=u=>{try{return new URL(u,location.href).pathname.replace(/\/$/,'');}catch{return '';}};
  const label=e=>e.getAttribute('aria-label')||e.querySelector('svg title')?.textContent||e.querySelector('svg')?.getAttribute('title')||'';
  const buttons=root=>[...root.querySelectorAll('button,[role="button"]')].filter(visible);
  const rootFor=a=>{for(let n=a.parentElement;n&&n!==document.body;n=n.parentElement)if(buttons(n).some(b=>/^(Reply|Trả lời)$/.test(label(b).trim())))return n;return null;};
  const anchors=[...document.querySelectorAll('a[href*="/post/"]')].filter(a=>a.querySelector('time')&&visible(a));
  const posts=[],seen=new Set(),warnings=[],excluded=new Set(excludeURLs.map(path));
  for(const a of anchors){
    const p=path(a.href);if(excluded.has(p)||seen.has(p)||(mode==='post'&&p!==path(location.href)))continue;seen.add(p);
    const root=rootFor(a);if(!root){warnings.push('Không xác định được vùng bài '+p);continue;}
    const nodes=[...root.querySelectorAll('[dir="auto"]')].filter(e=>visible(e)&&!e.closest('a,time,[contenteditable],button,[role="button"]')&&!e.querySelector('[contenteditable],time'));
    const outer=nodes.filter(e=>!nodes.some(n=>n!==e&&n.contains(e)));
    const text=outer.map(e=>(e.innerText||e.textContent||'').replace(/\s*(Translate|See translation|Dịch|Xem bản dịch)\s*$/,'').trim()).filter(t=>t&&!/^(No replies yet|Reply to .+|Chưa có câu trả lời)$/.test(t)).join('\n');
    const author=p.split('/')[1]?.slice(1)||null;
    const imageSeen=new Set();
    const images=[...root.querySelectorAll('img')].filter(im=>visible(im)&&!/profile picture|ảnh đại diện/i.test(im.alt)&&im.width>70&&im.height>70).map(im=>({src:im.currentSrc||im.src,srcset:im.getAttribute('srcset')||null,alt:im.alt||'',width:im.naturalWidth||im.width,height:im.naturalHeight||im.height})).filter(im=>{if(imageSeen.has(im.src))return false;imageSeen.add(im.src);return true;});
    const counts={likes:null,replies:null,reposts:null,shares:null};
    const keys={Like:'likes',Unlike:'likes',Reply:'replies',Repost:'reposts',Share:'shares','Thích':'likes','Bỏ thích':'likes','Trả lời':'replies','Đăng lại':'reposts','Chia sẻ':'shares'};
    for(const b of buttons(root)){const k=keys[label(b).trim()];if(k)counts[k]=(b.innerText||'').trim()||null;}
    const links=[...root.querySelectorAll('a[href]')].filter(link=>!link.querySelector('time')&&path(link.href)!=='/@'+author&&!/\/post\//.test(path(link.href))).map(link=>({text:link.innerText||'',url:link.href}));
    const videos=[...root.querySelectorAll('video')].filter(visible).map(v=>({src:v.currentSrc||v.src||null,poster:v.poster||null}));
    posts.push({id:p.split('/').at(-1),url:'https://www.threads.com'+p,author,profile_url:'https://www.threads.com/@'+author,published_at:a.querySelector('time')?.getAttribute('datetime')||null,text,images,videos,counts,links});
    if(posts.length>=limit)break;
  }
  return {source_url:location.href,captured_at:new Date().toISOString(),mode,count:posts.length,posts,warnings,scope:'Chỉ DOM đã tải; không tự cuộn, mở carousel hoặc lấy toàn bộ bình luận.'};
}

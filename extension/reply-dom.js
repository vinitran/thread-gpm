export function replyAction(action,args,captureErrors=false){
 try{
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const label=e=>e.getAttribute('aria-label')||e.querySelector('svg title')?.textContent||e.querySelector('svg')?.getAttribute?.('aria-label')||e.querySelector('svg')?.getAttribute?.('title')||e.innerText||'';
  const buttons=root=>[...root.querySelectorAll('button,[role="button"]')].filter(visible);
  const anchors=()=>[...document.querySelectorAll('a[href*="/post/"]')].filter(a=>a.querySelector('time')&&visible(a));
  const rootFor=a=>{for(let n=a?.parentElement;n&&n!==document.body;n=n.parentElement)if(buttons(n).some(b=>/^(Reply|Trả lời)$/.test(label(b).trim())))return n;throw Error('Chưa xác định được bài/nút trả lời.');};
  const path=u=>new URL(u,location.href).pathname.replace(/\/$/,'')||'/';
  const root=()=>rootFor(anchors().find(a=>path(a.href)===path(args.url)));
  const normalize=s=>(s||'').normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();
  const area=()=>{
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    if(dialogs.length)return dialogs.at(-1);
    return root();
  };
  const editor=()=>{const e=[...area().querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible);if(e.length!==1)throw Error('Ô trả lời không duy nhất.');return e[0];};
  const media=()=>[...area().querySelectorAll('img')].filter(visible).map(im=>im.currentSrc||im.src);
  if(action==='feed-ready')return {ready:path(location.href)==='/'&&![...document.querySelectorAll('[role="dialog"]')].some(visible)};
  if(action==='back-to-feed'){
    if([...document.querySelectorAll('[role="dialog"]')].some(visible))return {blocked:true,reason:'Hộp trả lời chưa đóng sau khi đăng.'};
    const logos=[...document.querySelectorAll('a[href]')].filter(a=>visible(a)&&path(a.href)==='/'&&/threads/i.test(label(a)));
    if(logos.length===1){logos[0].click();return {clicked:true};}
    const homeLinks=[...document.querySelectorAll('a[href]')].filter(a=>visible(a)&&path(a.href)==='/'&&/^(Home|Trang chủ)$/i.test(label(a).trim()));
    if(homeLinks.length===1){homeLinks[0].click();return {clicked:true};}
    return {clicked:false};
  }
  if(action==='locate'){let target;try{target=root();}catch{return {found:false};}target.scrollIntoView({block:'center',behavior:'smooth'});return {found:true};}
  if(action==='ready'){root();return true;}
  if(action==='prepare'){
    const target=root(),author=path(args.url).split('/')[1];
    const nodes=[...target.querySelectorAll('[dir="auto"]')].filter(e=>visible(e)&&!e.closest('a,time,[contenteditable],button,[role="button"]')&&!e.querySelector('[contenteditable],time'));
    const target_texts=nodes.filter(e=>!nodes.some(n=>n!==e&&n.contains(e))).map(e=>(e.innerText||'').replace(/\s*(Translate|Dịch)\s*$/,'').trim()).filter(Boolean).map(normalize);
    const target_text=target_texts[0]||'';
    const context={target_text,target_texts,target_author:'/'+author,before:anchors().map(a=>path(a.href))};
    const reply=buttons(target).find(b=>/^(Reply|Trả lời)$/.test(label(b).trim()));reply.click();return context;
  }
  if(action==='composer'){
    if(args.attachment_count===0){try{if(editor())return {ready:true};}catch{}}
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    if(dialogs.length)return {ready:true};
    const scope=area();
    const inputs=[...scope.querySelectorAll('input[type="file"]')].filter(e=>/image\/|\.(png|jpe?g|webp)/i.test(e.accept));
    if(inputs.length===1)return {ready:true};
    const candidates=buttons(scope).filter(b=>/expand|mở rộng|full.?screen|toàn màn hình/i.test(label(b)));
    if(candidates.length!==1)throw Error('Ô trả lời nhỏ chưa hỗ trợ ảnh; không xác định được nút mở rộng. Các nút: '+buttons(scope).map(label).join(' | '));
    if(!args.expand_requested){candidates[0].click();return {ready:false,expanded:true};}
    return {ready:false};
  }
  if(action==='focus'){
    const e=editor();if(e.innerText.trim())throw Error('Tab comment đang có bản nháp. Đóng tab comment đó và thử lại.');
    const profile=[...document.querySelectorAll('a[href]')].find(a=>/^(Profile|Trang cá nhân)$/.test(a.getAttribute('aria-label')||a.querySelector('svg title')?.textContent||''));
    e.focus();if(document.activeElement&&document.activeElement!==e&&!e.contains?.(document.activeElement))throw Error('Ô trả lời chưa nhận focus; đang chờ Threads cập nhật.');return {before:args.before||anchors().map(a=>path(a.href)),original_media:media(),self_profile:profile?path(profile.href):null};
  }
  if(action==='upload'){
    const inputs=[...document.querySelectorAll('input[type="file"]')].filter(e=>/image\//.test(e.accept));if(inputs.length!==1)throw Error('Không xác định được input nhận ảnh: '+inputs.length);
    if(!Array.isArray(args.files)||args.files.length!==3)throw Error('Cần 3 ảnh riêng lẻ.');
    if(!inputs[0].multiple)throw Error('Ô upload không cho phép nhiều ảnh.');
    const transfer=new DataTransfer();
    for(const im of args.files){
      const binary=atob(im.data_url.split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      transfer.items.add(new File([bytes],im.name,{type:im.type}));
    }
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'files').set;
    setter.call(inputs[0],transfer.files);
    inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[0].dispatchEvent(new Event('change',{bubbles:true}));return {files:inputs[0].files.length};
  }
  if(action==='draft'||action==='submit'){
    const uploadError=[...document.querySelectorAll('[role="alert"],[role="dialog"]')].filter(visible).some(e=>/Failed to upload attachment|không thể tải.*(ảnh|tệp)|tải.*(ảnh|tệp).*thất bại/i.test(e.innerText||''));
    if(uploadError)throw Error('Threads tải ảnh thất bại: Failed to upload attachment. Chưa bấm Post.');
    const e=editor();if(e.innerText.trim()!==args.text.trim())throw Error('Nội dung trong ô comment không khớp response.');
    const scope=area();
    const enabled=b=>b.getAttribute('aria-disabled')!=='true'&&!b.disabled;
    const isSubmit=b=>/^(Post|Reply|Send|Send reply|Post reply|Submit|Đăng|Trả lời|Gửi|Gửi trả lời|Gửi phản hồi|Đăng trả lời)$/i.test(label(b).trim())||b.getAttribute('type')==='submit';
    let submitScope=scope;
    // Inline composers use an icon button; prefer its own container over the post action row.
    if(args.attachment_count===0){
      for(let n=e.parentElement;n&&n!==document.body;n=n.parentElement){
        const fields=[...n.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible);
        if(fields.length!==1)break;
        if(buttons(n).some(isSubmit)){submitScope=n;break;}
        if(n===scope)break;
      }
    }
    const submit=buttons(submitScope).filter(b=>isSubmit(b)&&enabled(b));
    const attachment=[...scope.querySelectorAll('img')].filter(im=>!args.original_media.includes(im.currentSrc||im.src)&&im.complete&&im.naturalWidth>0&&im.naturalHeight>0&&!/profile picture|ảnh đại diện/i.test(im.alt||''));
    const loaded=new Set(attachment.map(im=>im.currentSrc||im.src)).size;
    const ready=submit.length===1&&loaded>=args.attachment_count;
    if(action==='draft')return {ready,loaded,expected:args.attachment_count,post_buttons:submit.length,...(!submit.length?{reason:'Các nút trong ô trả lời: '+buttons(submitScope).map(b=>(label(b).trim()||'(không nhãn)')+(enabled(b)?'':' [disabled]')).join(' | ')}:{})};
    if(!ready)throw Error(`Chưa sẵn sàng: ${loaded}/${args.attachment_count} ảnh, ${submit.length} nút đăng khả dụng.`);
    submit[0].scrollIntoView({block:'center',behavior:'instant'});const rect=submit[0].getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)throw Error('Nút đăng chưa có vị trí khả dụng.');
    const point={x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    const hit=document.elementFromPoint?.(point.x,point.y);
    if(hit&&hit!==submit[0]&&!submit[0].contains(hit))throw Error('Nút Post đang bị che, chưa thể bấm.');
    return point;

  }
  if(action==='submission-state'){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const draft=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible).some(e=>normalize(e.innerText)===normalize(args.text));
    const alerts=[...document.querySelectorAll('[role="alert"]')].filter(visible).map(e=>normalize(e.innerText)).filter(Boolean);
    return {dialog_open:dialogs.length>0,draft_present:draft,alerts};
  }
  if(action==='recent-replies'){
    if(path(location.href)!==path(args.url)||[...document.querySelectorAll('[role="dialog"]')].some(visible))return {changed:false};
    const menus=[...document.querySelectorAll('[role="menu"]')].filter(visible);
    const recent=menus.flatMap(menu=>[...menu.querySelectorAll('[role="menuitem"],button,[role="button"]')]).filter(visible).find(e=>/^(Recent|Newest|Newest first|Most recent|Gần đây|Mới nhất)$/i.test(label(e).trim()));
    if(recent){recent.click();return {changed:true,sorted:true};}
    const top=buttons(document).filter(e=>/^(Top|Top replies|Hàng đầu)$/i.test(label(e).trim()));
    if(top.length===1&&!args.sort_requested){top[0].click();return {changed:true,requested:true};}
    return {changed:false};
  }
  if(action==='reveal-reply'){
    if([...document.querySelectorAll('[role="dialog"]')].some(visible))return {scrolled:false,reason:'Hộp trả lời còn mở'};
    const expected=normalize(args.text);
    const caption=[...document.querySelectorAll('[dir="auto"]')].find(e=>!e.closest('[contenteditable]')&&normalize(e.innerText)===expected);
    if(caption){caption.scrollIntoView({block:'center',behavior:'smooth'});return {scrolled:true};}
    const candidates=[...document.querySelectorAll('div,main')].filter(e=>visible(e)&&e.clientHeight>200&&e.scrollHeight>e.clientHeight+100&&/auto|scroll/.test(getComputedStyle(e).overflowY));
    const scroller=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0]||document.scrollingElement;
    scroller?.scrollBy({top:Math.max(350,(scroller.clientHeight||500)*.7),behavior:'smooth'});
    return {scrolled:!!scroller};
  }
  if(action==='verify'){
    const profile=[...document.querySelectorAll('a[href]')].find(a=>/^(Profile|Trang cá nhân)$/.test(label(a)));
    const self=(args.self_profile||(profile?path(profile.href):'')).split('/')[1]?.toLowerCase();
    if(!self)throw Error('Không xác định được tài khoản đăng nhập.');
    let matchingText=false,ownLinks=0;
    const expected=normalize(args.text);
    const candidates=[...document.querySelectorAll('a[href*="/post/"]')].filter(visible);
    for(const a of candidates){
      const p=path(a.href);if(!/^\/@[\w.]+\/post\/[-\w]+$/.test(p)||(args.before||[]).includes(p)||p===path(args.url)||p.split('/')[1].toLowerCase()!==self)continue;
      ownLinks++;
      // Walk local ancestors: the timestamp may be in a header smaller than the
      // actual reply card, or the card may omit the Reply button altogether.
      for(let r=a.parentElement,depth=0;r&&r!==document.body&&depth<12;r=r.parentElement,depth++){
        const otherPosts=[...r.querySelectorAll('a[href*="/post/"]')].some(link=>path(link.href)!==p);
        if(otherPosts)break;
        const nodes=[...r.querySelectorAll('[dir="auto"]')].filter(e=>visible(e)&&!e.closest('a,time,[contenteditable],button,[role="button"]')&&!e.querySelector('[contenteditable],time'));
        const parts=nodes.filter(e=>!nodes.some(n=>n!==e&&n.contains(e))).map(e=>normalize((e.innerText||'').replace(/\s*(Translate|See translation|Dịch|Xem bản dịch)\s*$/,''))).filter(Boolean);
        if(!parts.some(t=>t===expected)&&normalize(parts.join(' '))!==expected)continue;
        matchingText=true;
        const images=[...r.querySelectorAll('img')].filter(im=>visible(im)&&(im.width||im.naturalWidth)>70&&(im.height||im.naturalHeight)>70&&!/profile picture|ảnh đại diện/i.test(im.alt||''));
        if(images.length||args.attachment_count===0)return {verified:true,url:'https://www.threads.com'+p,visible_images:new Set(images.map(im=>im.currentSrc||im.src)).size};
      }
    }
    return {verified:false,reason:matchingText?'Tìm thấy chữ nhưng ảnh comment chưa tải.':`Chưa thấy comment khớp nội dung · ${ownLinks} URL mới của ${self} / ${candidates.length} link bài trong DOM`};
  }

  throw Error('Unknown reply action');
 }catch(e){if(captureErrors)return {__reply_error:e?.message||String(e)};throw e;}
}

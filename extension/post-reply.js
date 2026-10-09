import {replyAction} from './reply-dom.js';
import {retryTabEdit,activateTab,closeTabPreservingWindow} from './tab-actions.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function dom(tabId,action,args){
 try{
  const results=await chrome.scripting.executeScript({target:{tabId},func:replyAction,args:[action,args,true],...(action==='upload'?{world:'MAIN'}:{})});
  const frame=results.find(r=>r.frameId===0)||results[0];
  if(frame?.error)throw Error(frame.error.message||String(frame.error));
  if(frame?.result?.__reply_error)throw Error(frame.result.__reply_error);
  if(frame?.result===undefined||frame.result===null)throw Error('Không nhận được kết quả DOM; trang có thể đang tải lại.');
  return frame.result;
 }catch(e){throw Error('Bước '+action+': '+e.message);}
}
export async function waitBeforeHome(receipt,onProgress=()=>{},options={}){
  if(!options.waitBeforeHome||receipt.returned_home_at)return true;
  const now=options.now||Date.now,wait=options.wait||pause;
  if(!receipt.home_after_at){
    const seconds=30+Math.floor((options.random||Math.random)()*11);
    receipt.home_after_at=now()+seconds*1000;
    const {replyReceipts={}}=await chrome.storage.local.get('replyReceipts');
    replyReceipts[receipt.post_url]=receipt;await chrome.storage.local.set({replyReceipts});
  }
  let last;
  while(now()<receipt.home_after_at){
    if(options.shouldContinue&&!options.shouldContinue()){onProgress('Đã dừng · giữ tab tại bài vừa gửi');return false;}
    const seconds=Math.ceil((receipt.home_after_at-now())/1000);
    if(last===undefined||last-seconds>=10){onProgress('Đã bấm Post · chờ '+seconds+' giây trước khi về trang chủ');last=seconds;}
    await wait(Math.min(1000,receipt.home_after_at-now()));
  }
  return !options.shouldContinue||options.shouldContinue();
}
export async function returnToFeed(receipt,onProgress=()=>{},options={}){
  if(!receipt.shared_tab||!((receipt.state==='posted'&&receipt.comment_url)||receipt.state==='sent_unverified'))return receipt;
  if(!await waitBeforeHome(receipt,onProgress,options))return receipt;
  onProgress((receipt.comment_url?'Đã lưu URL comment':'Đã ghi nhận lần bấm Post')+' · đang bấm logo Threads về trang chủ…');
  try{
    let state;
    const dialogDeadline=Date.now()+(options.dialogCloseTimeoutMs??5000);
    do{
      try{state=await dom(receipt.tab_id,'back-to-feed',{});}catch(e){onProgress('Chưa bấm được logo · '+e.message);state={clicked:false};break;}
      if(!state.blocked)break;
      onProgress('Đã bấm Post · đang chờ hộp trả lời đóng…');
      if(Date.now()>=dialogDeadline)break;
      await pause(options.homeIntervalMs??250);
    }while(true);
    if(state.blocked)onProgress('Hộp trả lời còn mở · chuyển về trang chủ trong cùng tab');
    if(!state.home){
      if(!state.clicked)await retryTabEdit(()=>chrome.tabs.update(receipt.tab_id,{url:'https://www.threads.com/',active:true}),{onProgress});
      const timeout=options.homeTimeoutMs??15000,interval=options.homeIntervalMs??250;
      let home=false;
      for(let attempt=0;attempt<2&&!home;attempt++){
        const deadline=Date.now()+timeout;
        do{
          const tab=await chrome.tabs.get(receipt.tab_id);
          if(new URL(tab.url).pathname==='/'&&tab.status!=='loading'){
            let feed;try{feed=await dom(receipt.tab_id,'feed-ready',{});}catch{}
            if(feed===true||feed?.ready){home=true;break;}
          }
          await pause(interval);
        }while(Date.now()<deadline);
        if(!home&&attempt===0)await retryTabEdit(()=>chrome.tabs.update(receipt.tab_id,{url:'https://www.threads.com/',active:true}),{onProgress});
      }
      if(!home)throw Error('Trang chủ Threads chưa tải xong.');
    }
    receipt.returned_home_at=new Date().toISOString();delete receipt.navigation_error;
    onProgress('Đã trở về trang chủ · tiếp tục cuộn tìm bài sau khoảng nghỉ');
  }catch(e){receipt.navigation_error=e.message;onProgress('Đã bấm Post nhưng chưa quay lại trang chủ: '+e.message);}
  const {replyReceipts={}}=await chrome.storage.local.get('replyReceipts');replyReceipts[receipt.post_url]=receipt;await chrome.storage.local.set({replyReceipts});
  return receipt;
}
async function verifyReceipt(receipt,onProgress=()=>{},options={}){
  const args={url:receipt.post_url,text:receipt.text,before:receipt.before||[],self_profile:receipt.self_profile,attachment_count:receipt.images?.length??3};
  const timeoutMs=options.verifyTimeoutMs??60000,intervalMs=options.verifyIntervalMs??1000;
  const deadline=Date.now()+timeoutMs;let result,lastError,reads=0;
  do{
    try{result=await dom(receipt.tab_id,'verify',args);lastError=null;if(result?.verified&&result.url)break;}catch(e){lastError=e.message;}
    if(!reads||reads%8===0){
      try{const state=await dom(receipt.tab_id,'submission-state',args);
        if(state&&typeof state.draft_present==='boolean'){
          receipt.submission_ui=state;
          if(state.draft_present)onProgress('Chữ vẫn còn trong ô trả lời · chưa xác nhận Threads đã nhận lần bấm Post (không bấm lại)');
          else onProgress('Ô nhập không còn response · đang tìm URL comment đã gửi');
          if(state.alerts?.length)onProgress('Thông báo Threads: '+state.alerts.join(' | '));
        }
      }catch{}
    }
    onProgress('Đang chờ URL comment · '+(lastError||result?.reason||'Threads đang cập nhật…'));
    if(Date.now()>=deadline)break;
    if(++reads%8===0){try{if(!args.replies_sorted){const sorting=await dom(receipt.tab_id,'recent-replies',args);if(sorting?.requested)args.sort_requested=true;if(sorting?.sorted){args.replies_sorted=true;onProgress('Đã chọn phản hồi mới nhất để tìm comment vừa gửi');}if(sorting?.changed){await pause(intervalMs);continue;}}await dom(receipt.tab_id,'reveal-reply',args);onProgress('Đang cuộn tìm comment đã gửi để lấy URL (không gửi lại)');}catch{}}
    await pause(intervalMs);
  }while(Date.now()<deadline);
  receipt.checked_at=new Date().toISOString();
  receipt.state=result?.verified?'posted':'unknown';
  if(result?.verified){receipt.comment_url=result.url;receipt.verified_at=receipt.checked_at;receipt.visible_images=result.visible_images;delete receipt.verification_error;}
  else receipt.verification_error=lastError||result?.reason||'Chưa tìm thấy comment sau khi chờ 60 giây.';
  const {replyReceipts={}}=await chrome.storage.local.get('replyReceipts');replyReceipts[receipt.post_url]=receipt;
  await chrome.storage.local.set({replyReceipts});return receipt;
}
export async function checkReply(url,onProgress=()=>{},options={}){
  const {replyReceipts={}}=await chrome.storage.local.get('replyReceipts'),receipt=replyReceipts[url];
  if(!receipt)throw Error('Chưa có lần gửi comment để kiểm tra.');
  if(receipt.state==='posted'&&receipt.comment_url)return returnToFeed(receipt,onProgress,options);
  let existing;try{if(receipt.tab_id)existing=await chrome.tabs.get(receipt.tab_id);}catch{}
  if(!existing||(!receipt.shared_tab&&new URL(existing.url).pathname!==new URL(url).pathname)){const tab=await retryTabEdit(()=>chrome.tabs.create({url,active:true}),{onProgress});receipt.tab_id=tab.id;}
  if(existing&&receipt.shared_tab){
    let state;try{state=await dom(receipt.tab_id,'submission-state',{text:receipt.text});}catch{}
    if(!state?.dialog_open&&!state?.draft_present){
      onProgress('Đang tải lại bài để kiểm tra comment đã gửi bằng DOM (không gửi lại)');
      if(new URL(existing.url).pathname!==new URL(url).pathname)await retryTabEdit(()=>chrome.tabs.update(receipt.tab_id,{url,active:true}),{onProgress});
      else await retryTabEdit(()=>chrome.tabs.reload(receipt.tab_id),{onProgress});
    }
  }
  await verifyReceipt(receipt,onProgress,options);return returnToFeed(receipt,onProgress,options);
}
export async function typeReplyText(text,insert,{delayMs=60,shouldContinue=()=>true,onProgress=()=>{},random=Math.random,wait=pause}={}){
  if(!Number.isFinite(delayMs)||delayMs<0||delayMs>500)throw Error('Tốc độ nhập không hợp lệ.');
  const parts=[...new Intl.Segmenter('vi',{granularity:'grapheme'}).segment(text)].map(p=>p.segment);
  for(let i=0;i<parts.length;i++){
    if(!shouldContinue())throw Error('Đã dừng trong lúc điền chữ.');
    await insert(parts[i]);
    if(i===0||(i+1)%30===0||i===parts.length-1)onProgress(`Đang điền lần lượt: ${i+1}/${parts.length} ký tự`);
    if(delayMs&&i<parts.length-1){
      const base=delayMs*(.6+random()*.8);
      const extra=/[.!?…,:;\n]/u.test(parts[i])?120+random()*280:(parts[i]===' '&&random()<.15?80+random()*170:0);
      await wait(Math.round(Math.min(900,base+extra)));
    }
  }
}
export async function selectFollowForReply(url,random=Math.random){
  const {replyFollowDecisions={}}=await chrome.storage.local.get('replyFollowDecisions');
  if(typeof replyFollowDecisions[url]?.selected==='boolean')return replyFollowDecisions[url].selected;
  const selected=random()<0.6;
  replyFollowDecisions[url]={selected,createdAt:new Date().toISOString()};
  await chrome.storage.local.set({replyFollowDecisions:Object.fromEntries(Object.entries(replyFollowDecisions).slice(-500))});
  return selected;
}
export async function followAuthorBeforeReply(tabId,url,onProgress=()=>{},options={}){
  const wait=options.wait||pause,delay=Math.max(1500,options.stepDelayMs??2000);
  const ensureRunning=()=>{if(options.shouldContinue&&!options.shouldContinue())throw Error('Đã dừng trước khi follow/comment.');};
  const step=async message=>{ensureRunning();onProgress(message);await wait(delay);ensureRunning();};
  let inline;
  for(let i=0;i<40;i++){
    ensureRunning();try{inline=await dom(tabId,'inline-follow-state',{url});}catch{break;}
    if(inline?.state!=='loading')break;
    await wait(250);
  }
  if(inline?.available){
    if(inline.state==='not-following'){
      await step('Đang follow bằng nút + ở avatar người đăng…');
      const clicked=await dom(tabId,'inline-follow-author',{url});
      if(clicked?.state!=='clicked')throw Error('Không bấm được follow ở avatar; chưa gửi bình luận.');
      await step('Đang chờ xác nhận follow…');
      let confirmed=false,confirmationClicked=false;
      for(let i=0;i<40;i++){
        ensureRunning();inline=await dom(tabId,'inline-follow-state',{url,inlineClicked:true});
        if(['following','requested'].includes(inline?.state)){confirmed=true;break;}
        if(inline?.state==='confirm'&&!confirmationClicked){
          await step('Đang xác nhận follow người đăng trong popup…');
          const confirmation=await dom(tabId,'inline-follow-author',{url,inlineClicked:true});
          if(confirmation?.state!=='clicked')throw Error('Không xác nhận được popup follow.');
          confirmationClicked=true;
        }
        if(inline?.state==='blocked')throw Error('Popup follow chưa xác định đúng người đăng; chưa gửi bình luận.');
        await wait(250);
      }
      if(!confirmed)throw Error('Chưa xác nhận được follow ở avatar; chưa gửi bình luận.');
      await waitAfterFollow(inline.state,onProgress,options);
    }
    await step('Đã kiểm tra follow tại bài · chuẩn bị comment…');
    return;
  }
  if(inline?.state==='blocked')throw Error('Trang đang có popup; chưa follow hoặc gửi bình luận.');
  onProgress('Không có nút follow khả dụng ở avatar · bỏ qua follow, tiếp tục comment tại bài.');
  return {skipped:true};
}
async function waitAfterFollow(state,onProgress,options){
    const wait=options.wait||pause;
    const ensureRunning=()=>{if(options.shouldContinue&&!options.shouldContinue())throw Error('Đã dừng trước khi follow/comment.');};
    const seconds=210+Math.floor((options.random||Math.random)()*61);
    for(let remaining=seconds;remaining>0;remaining--){
      ensureRunning();
      if(remaining===seconds||remaining%15===0)onProgress(`${state==='requested'?'Đã gửi yêu cầu follow':'Đã follow'} · còn ${remaining} giây trước khi comment…`);
      await wait(1000);
      ensureRunning();
    }
}
export async function postReply(url,text,image,onProgress=()=>{},options={}){
  const stepDelayMs=options.stepDelayMs===undefined?2000:options.stepDelayMs;
  if(!Number.isFinite(stepDelayMs)||stepDelayMs<0||stepDelayMs>10000)throw Error("Thời gian chờ không hợp lệ.");
  const ensureRunning=()=>{if(options.shouldContinue&&!options.shouldContinue())throw Error('Đã dừng trước khi đăng.');};
  const step=async(message)=>{ensureRunning();onProgress(message);await pause(stepDelayMs);ensureRunning();};
  if(!/^https:\/\/www\.threads\.com\/@[\w.]+\/post\/[-\w]+$/.test(url)||typeof text!=='string'||!text.trim()||[...text].length>500||!Array.isArray(image.files)||![0,3].includes(image.files.length)||image.files.some(f=>!/^data:image\/(png|jpeg|webp);base64,/.test(f.data_url)||!f.name))throw Error('Comment cần response 1–500 ký tự và 0 hoặc 3 ảnh riêng lẻ.');
  const {replyReceipts={}}=await chrome.storage.local.get('replyReceipts');const old=replyReceipts[url];
  if(old)return {...old,reused:true};
  onProgress(options.tabId?'Đang cuộn đến bài đích trong tab hiện tại…':'Đang mở bài đích…');
  const shared=Number.isInteger(options.tabId);
  const tab=shared?await chrome.tabs.get(options.tabId):await retryTabEdit(()=>chrome.tabs.create({url,active:true}),{onProgress});
  const args={url,text,attachment_count:image.files.length};let attached=false;
  try{
    if(shared){
      await activateTab(tab.id,{onProgress,shouldContinue:options.shouldContinue});
      let located;try{located=await dom(tab.id,'locate',args);}catch{}
      if(!located?.found){
        onProgress('Bài không còn trong DOM · mở bài trong cùng tab…');
        await retryTabEdit(()=>chrome.tabs.update(tab.id,{url}),{onProgress,shouldContinue:options.shouldContinue});
      }else await pause(stepDelayMs);
    }
    if(options.followAuthor){
      if(await selectFollowForReply(url,options.followRandom||Math.random)){
        onProgress('Bài này được chọn follow · xác suất 60%.');
        await followAuthorBeforeReply(tab.id,url,onProgress,options);
      }else onProgress('Bài này bỏ qua follow · xác suất 40%, tiếp tục comment.');
    }
    let ready=false;for(let i=0;i<40;i++){ensureRunning();try{ready=await dom(tab.id,'ready',args);if(ready)break;}catch{}await pause(250);}
    if(!ready)throw Error('Không mở được bài để comment.');
    await step('Đang mở ô trả lời…');
    Object.assign(args,await dom(tab.id,'prepare',args));
    await step('Đang mở rộng ô trả lời để thêm ảnh…');
    let composerReady=false,lastComposerError;
    for(let i=0;i<80;i++){
      ensureRunning();
      try{const state=await dom(tab.id,'composer',args);if(state.expanded)args.expand_requested=true;if(state.ready){composerReady=true;break;}}catch(e){lastComposerError=e;}
      await pause(250);
    }
    if(!composerReady)throw lastComposerError||Error('Hộp trả lời đầy đủ chưa mở sau 20 giây.');
    let focused=false,lastFocus,lastFocusMessage;
    for(let i=0;i<120;i++){ensureRunning();try{Object.assign(args,await dom(tab.id,'focus',args));focused=true;break;}catch(e){lastFocus=e;if(e.message!==lastFocusMessage){onProgress('Đang chờ ô trả lời · '+e.message);lastFocusMessage=e.message;}if(/bản nháp|không khớp/.test(e.message))throw e;}await pause(250);}
    if(!focused)throw lastFocus||Error('Không mở được ô trả lời.');
    await step('Đang điền response…');
    await chrome.debugger.attach({tabId:tab.id},'1.3');attached=true;
    await typeReplyText(text,part=>chrome.debugger.sendCommand({tabId:tab.id},'Input.insertText',{text:part}),{delayMs:options.typingDelayMs??60,shouldContinue:options.shouldContinue||(()=>true),onProgress});
    if(image.files.length){
    await step('Đang gắn 3 ảnh riêng lẻ…');
    // Threads mounts the image input with the composer. Set all three original files without
    // clicking Attach media, which may open a native chooser that DOM cannot close.
    let uploaded=false,lastUploadError;
    for(let i=0;i<40;i++){
      ensureRunning();
      try{await dom(tab.id,'upload',{...args,files:image.files});uploaded=true;break;}
      catch(e){lastUploadError=e;if(!/input nhận ảnh: 0/.test(e.message))throw e;}
      await pause(250);
    }
    if(!uploaded)throw lastUploadError||Error('Không mở được ô nhận ảnh.');
    onProgress('Đã chọn 3 ảnh riêng · tổng '+Math.round(image.files.reduce((sum,f)=>sum+(f.size||0),0)/1024)+' KB · đang chờ Threads tải ảnh xem trước…');
    }else onProgress('Comment chữ · không đính kèm ảnh');
    ready=false;let lastDraft,lastState='',lastDraftError,stableReads=0;
    for(let i=0;i<120;i++){
      try{
        lastDraft=await dom(tab.id,'draft',args);
        if(typeof lastDraft!=='object'||typeof lastDraft.ready!=='boolean')throw Error('Bước draft: trạng thái ô trả lời chưa hợp lệ.');
        lastDraftError=null;
      }catch(e){if(/Threads tải ảnh thất bại/.test(e.message))throw e;stableReads=0;lastDraftError=e;const state='Đang đọc lại ô trả lời: '+e.message;if(state!==lastState){onProgress(state);lastState=state;}await pause(250);continue;}
      stableReads=lastDraft.ready?stableReads+1:0;
      if(stableReads>=3){ready=true;break;}
      const state=`Đang chờ: ${lastDraft.loaded??0}/${args.attachment_count} ảnh tải xong · ${lastDraft.post_buttons??0} nút đăng khả dụng${lastDraft.reason?' · '+lastDraft.reason:''}`;
      if(state!==lastState){onProgress(state);lastState=state;}await pause(250);
    }
    if(!ready&&lastDraftError)throw lastDraftError;
    if(!ready)throw Error(`Sau 30 giây: ${lastDraft?.loaded??0}/${args.attachment_count} ảnh tải xong, ${lastDraft?.post_buttons??0} nút đăng khả dụng.`);
    await step('Sẵn sàng đăng…');
    let point,lastSubmitError;
    const submitDeadline=Date.now()+(options.submitReadyTimeoutMs??30000);
    do{
      ensureRunning();
      try{
        point=await dom(tab.id,'submit',args);
        if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))throw Error('Không đọc được vị trí nút đăng.');
        break;
      }catch(e){
        if(!/Chưa sẵn sàng:|đang bị che|chưa có vị trí/.test(e.message))throw e;
        lastSubmitError=e;onProgress('Chưa bấm Post · chờ ảnh/nút đăng ổn định: '+e.message);
        if(Date.now()>=submitDeadline)throw lastSubmitError;
        await pause(options.submitReadyIntervalMs??250);
      }
    }while(true);
    ensureRunning();
    const receipt={state:'submitting' ,post_url:url,text,images:image.names,tab_id:tab.id,created_at:new Date().toISOString(),before:args.before,self_profile:args.self_profile,shared_tab:shared};
    replyReceipts[url]=receipt;await chrome.storage.local.set({replyReceipts});
    onProgress('Đang bấm đăng…');
    try{
      ensureRunning();
      ensureRunning();
      await chrome.debugger.sendCommand({tabId:tab.id},'Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await chrome.debugger.sendCommand({tabId:tab.id},'Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    }catch(e){receipt.state='unknown';await chrome.storage.local.set({replyReceipts});throw e;}
    if(options.skipVerification){receipt.state='sent_unverified';receipt.clicked_at=new Date().toISOString();onProgress('Đã bấm Post · bỏ qua xác minh URL theo cấu hình');await chrome.storage.local.set({replyReceipts});}
    else{onProgress('Đang xác minh comment đã đăng…');await verifyReceipt(receipt,onProgress,options);}
    if(['posted','sent_unverified'].includes(receipt.state)){if(shared){await returnToFeed(receipt,onProgress,options);}else{try{await closeTabPreservingWindow(tab.id,'kết thúc tab comment riêng');attached=false;receipt.tab_id=null;}catch{}}}
    replyReceipts[url]=receipt;await chrome.storage.local.set({replyReceipts});return receipt;
  }catch(e){throw Error(e.message+' · Kiểm tra tab comment vừa mở trên Chrome.');}
  finally{if(attached)try{await chrome.debugger.detach({tabId:tab.id});}catch{}}
}

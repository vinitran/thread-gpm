const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function retryTabEdit(operation,{onProgress=()=>{},shouldContinue=()=>true,wait=pause,maxAttempts=12}={}){
 for(let attempt=0;attempt<maxAttempts;attempt++){
  if(!shouldContinue())throw Error('Đã dừng trước khi thao tác tab.');
  try{return await operation();}catch(e){
   if(!/Tabs cannot be edited right now|user may be dragging a tab/i.test(e.message)||attempt===maxAttempts-1)throw e;
   onProgress('Chrome đang bận chỉnh tab · chờ và thử lại '+(attempt+1)+'/'+(maxAttempts-1));
   await wait(Math.min(250*(attempt+1),1000));
  }
 }
}
export async function activateTab(tabId,options={}){
 const tab=await chrome.tabs.get(tabId);
 return tab.active?tab:retryTabEdit(()=>chrome.tabs.update(tabId,{active:true}),options);
}

export async function replaceSourceTab(oldTabId,{newTabId,onCreated=async()=>{},onProgress=()=>{},shouldContinue=()=>true,...retryOptions}={}){
 const options={...retryOptions,onProgress,shouldContinue};
 if(!shouldContinue())throw Error('Đã dừng trước khi mở tab khôi phục.');
 let fresh;
 if(newTabId)fresh=await chrome.tabs.get(newTabId);
 else{
  fresh=await retryTabEdit(()=>chrome.tabs.create({url:'https://www.threads.com/',active:true}),options);
  // Persist the new source before closing anything; recovery can resume after a worker restart.
  await onCreated(fresh.id);
 }
 if(!shouldContinue())return fresh.id;
 if(oldTabId&&oldTabId!==fresh.id){
  let old;try{old=await chrome.tabs.get(oldTabId);}catch{}
  if(old&&new URL(old.url).origin==='https://www.threads.com'){
   try{await closeTabPreservingWindow(oldTabId,'thay tab khôi phục');onProgress('Đã đóng tab Threads cũ của phiên');}
   catch(e){if(!shouldContinue())return fresh.id;onProgress('Chưa đóng được tab cũ · tiếp tục trên tab mới: '+e.message);}
  }
 }
 return fresh.id;
}

// Some profile browsers end the profile when its last window closes.
export async function closeTabPreservingWindow(tabId,reason='đóng tab phiên'){
 const all=await chrome.tabs.query({}),target=all.find(t=>t.id===tabId);
 if(target&&all.filter(t=>t.windowId===target.windowId).length===1){
  await retryTabEdit(()=>chrome.tabs.create({url:'about:blank',windowId:target.windowId,active:false}));
 }
 await retryTabEdit(()=>chrome.tabs.remove(tabId));
 try{const {tabLifecycle=[]}=await chrome.storage.local.get('tabLifecycle');await chrome.storage.local.set({tabLifecycle:[...tabLifecycle,{time:new Date().toISOString(),tab_id:tabId,window_id:target?.windowId,reason,kept_window:!!target}].slice(-100)});}catch{}
}

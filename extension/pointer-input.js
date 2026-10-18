// Pure DOM inspection, shared by CDP and the managed Chrome extension.
export function pointerTarget(token){
 const e=document.querySelector('[data-hoanxu-pointer="'+token+'"]');if(!e||!e.isConnected)throw Error('Mục tiêu chuột không còn trên trang.');
 const r=e.getBoundingClientRect(),style=getComputedStyle(e);
 if(!r.width||!r.height||style.visibility==='hidden'||style.display==='none')throw Error('Mục tiêu chuột đang ẩn.');
 const viewport={width:innerWidth,height:innerHeight},center={x:(r.left+r.right)/2,y:(r.top+r.bottom)/2};
 let scroll=e;while(scroll&&scroll!==document.body){const s=getComputedStyle(scroll);if(scroll.clientHeight>100&&scroll.scrollHeight>scroll.clientHeight+20&&/auto|scroll/.test(s.overflowY))break;scroll=scroll.parentElement;}
 scroll=scroll&&scroll!==document.body?scroll:document.scrollingElement;
 const sr=scroll===document.scrollingElement?{left:0,top:0,right:innerWidth,bottom:innerHeight}:scroll.getBoundingClientRect();
 const box={left:Math.max(0,sr.left),top:Math.max(0,sr.top),right:Math.min(innerWidth,sr.right),bottom:Math.min(innerHeight,sr.bottom)};
 const inView=center.x>Math.max(0,box.left)&&center.x<Math.min(innerWidth,box.right)&&center.y>Math.max(0,box.top)&&center.y<Math.min(innerHeight,box.bottom);
 const hit=inView?document.elementFromPoint(center.x,center.y):null;
 return {center,viewport,inView,covered:!!hit&&hit!==e&&!e.contains(hit),disabled:e.disabled||e.getAttribute('aria-disabled')==='true',scrollTop:scroll?.scrollTop||0,scrollPoint:{x:(box.left+box.right)/2,y:(box.top+box.bottom)/2},scrollCenterY:(box.top+box.bottom)/2};
}
export function installNativePointer(api,{shouldContinue=()=>true,random=Math.random,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const execute=api.scripting.executeScript.bind(api.scripting),attach=api.debugger.attach.bind(api.debugger),detach=api.debugger.detach.bind(api.debugger),attached=new Set(),positions=new Map();
 api.debugger.attach=async target=>{if(!attached.has(target.tabId)){await attach(target,'1.3');attached.add(target.tabId);}};
 api.debugger.detach=async target=>{try{return await detach(target);}finally{attached.delete(target.tabId);}};
 api.debugger.onDetach?.addListener(target=>attached.delete(target.tabId));
 const active=()=>{if(!shouldContinue())throw Error('Đã dừng · hủy thao tác chuột.');};
 const send=async(id,params)=>{active();await api.debugger.attach({tabId:id});active();await api.debugger.sendCommand({tabId:id},'Input.dispatchMouseEvent',params);};
 const pause=async ms=>{let left=ms;while(left>0){active();const part=Math.min(100,left);await wait(part);left-=part;}active();};
 const read=async(id,token)=>{active();const result=(await execute({target:{tabId:id},func:pointerTarget,args:[token]}))[0]?.result;if(!result)throw Error('Không đọc được vị trí mục tiêu chuột.');return result;};
 async function move(id,point){
  const start=positions.get(id)||{x:Math.max(1,point.x-90),y:Math.max(1,point.y-65)},duration=450+random()*350,steps=10;
  for(let i=1;i<=steps;i++){const t=i/steps,ease=t*t*(3-2*t);await send(id,{type:'mouseMoved',x:start.x+(point.x-start.x)*ease,y:start.y+(point.y-start.y)*ease});await pause(duration/steps);}
  positions.set(id,point);
 }
 async function wheel(id,point,deltaY){
  await move(id,point);let remaining=deltaY;
  while(Math.abs(remaining)>0.5){const delta=Math.sign(remaining)*Math.min(Math.abs(remaining),90+random()*70);await send(id,{type:'mouseWheel',...point,deltaX:0,deltaY:delta});remaining-=delta;await pause(140+random()*140);}
 }
 async function reveal(id,token){
  for(let i=0;i<12;i++){const target=await read(id,token);if(target.inView)return target;
   const delta=Math.max(-400,Math.min(400,target.center.y-target.scrollCenterY));if(Math.abs(delta)<1)throw Error('Mục tiêu nằm ngoài vùng chuột có thể thao tác.');
   await wheel(id,target.scrollPoint,delta);await pause(180);
  }
  throw Error('Chưa cuộn được đến mục tiêu chuột.');
 }
 async function click(id,point){
  let target=point.token?await reveal(id,point.token):null;await move(id,target?.center||point);await pause(220+random()*220);
  if(point.token){target=await read(id,point.token);if(!target.inView||target.covered||target.disabled)throw Error('Mục tiêu chuột đã thay đổi, bị che hoặc chưa khả dụng.');const previous=positions.get(id);if(previous&&Math.hypot(previous.x-target.center.x,previous.y-target.center.y)>4){await move(id,target.center);await pause(150);const fresh=await read(id,point.token);if(!fresh.inView||fresh.covered||fresh.disabled||Math.hypot(fresh.center.x-target.center.x,fresh.center.y-target.center.y)>4)throw Error('Mục tiêu chuột chưa ổn định.');target=fresh;}await send(id,{type:'mouseMoved',...target.center});}
  const location=target?.center||point;await send(id,{type:'mousePressed',...location,button:'left',clickCount:1});
  // Complete mouse-up even when Stop arrives after mouse-down; never leave a button held.
  await wait(80+random()*80);await api.debugger.sendCommand({tabId:id},'Input.dispatchMouseEvent',{type:'mouseReleased',...location,button:'left',clickCount:1});await pause(200+random()*200);
 }
 async function perform(id,input){
  for(const step of Array.isArray(input)?input:[input]){
   active();if(step.kind==='click')await click(id,{token:step.token});else if(step.kind==='reveal')await reveal(id,step.token);
   else if(step.kind==='wheel'){const t=await read(id,step.token);await wheel(id,t.scrollPoint,step.top===undefined?step.deltaY:step.top-t.scrollTop);}
   else throw Error('Thao tác chuột không hợp lệ.');
   if(step.pauseMs)await pause(step.pauseMs);
  }
 }
 api.scripting.executeScript=async options=>{
  const args=[...(options.args||[])],name=options.func.name;
  if(name==='replyAction')args[1]={...args[1],__nativeInput:true};
  if(name==='autoPage')args[1]={...args[1],__nativeInput:true};
  if(name==='engagementPage')args[0]={...args[0],__nativeInput:true};
  for(let attempt=0;attempt<3;attempt++){
   const frames=await execute({...options,args}),frame=frames.find(f=>f.frameId===0)||frames[0],value=frame?.result;
   if(!value?.__input)return frames;
   await perform(options.target.tabId,value.__input);
   if(value.__rerun){if(name==='replyAction')args[1].__pointerReady=true;continue;}frame.result=value.result;return frames;
  }
  throw Error('Mục tiêu chuột vẫn chưa ổn định.');
 };
 api.pointer={click:(target,point)=>click(target.tabId,point)};return api;
}

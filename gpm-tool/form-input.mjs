// Runs inside the page. The overlay only visualizes browser input; it never captures clicks.
export function formPointer({key,action}){
 if(action==='dispose'){window[key]?.dispose();return;}
 if(window[key])return;
 const host=document.createElement('div');host.setAttribute('data-hoanxu-form-pointer','');host.setAttribute('aria-hidden','true');
 host.style.cssText='all:initial;position:fixed;left:0;top:0;width:24px;height:30px;z-index:2147483647;pointer-events:none;visibility:hidden;transition:transform 25ms linear;';
 const shadow=host.attachShadow({mode:'closed'}),arrow=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
 arrow.setAttribute('width','24');arrow.setAttribute('height','30');arrow.setAttribute('viewBox','0 0 24 30');arrow.style.cssText='display:block;pointer-events:none;filter:drop-shadow(0 1px 2px #0007);transform-origin:2px 2px;transition:transform 80ms;';
 for(const [name,value] of Object.entries({d:'M2 2L2 23L8 18L12 27L16 25L12 16L21 16Z',fill:'#2563eb',stroke:'white','stroke-width':'1.8','stroke-linejoin':'round'}))path.setAttribute(name,value);
 path.style.pointerEvents='none';arrow.append(path);shadow.append(arrow);
 const move=event=>{host.style.visibility='visible';host.style.transform=`translate3d(${event.clientX-2}px,${event.clientY-2}px,0)`;};
 const down=event=>{move(event);arrow.style.transform='scale(.85)';};
 const up=()=>{arrow.style.transform='scale(1)';};
 document.documentElement.append(host);
 document.addEventListener('mousemove',move,true);document.addEventListener('mousedown',down,true);document.addEventListener('mouseup',up,true);
 Object.defineProperty(window,key,{configurable:true,value:{dispose(){document.removeEventListener('mousemove',move,true);document.removeEventListener('mousedown',down,true);document.removeEventListener('mouseup',up,true);host.remove();delete window[key];}}});
}

// Form typing has its own pace so changing it does not change Threads comment typing.
export async function typeFormText(text,insert,{delayMs=60,shouldContinue=()=>true,random=Math.random,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!Number.isFinite(delayMs)||delayMs<0||delayMs>500)throw Error('Tốc độ nhập không hợp lệ.');
 const check=()=>{if(!shouldContinue())throw Error('Đã dừng trong lúc điền chữ.');};
 const pause=async ms=>{for(let left=ms;left>0;){check();const part=Math.min(100,left);await wait(part);left-=part;}check();};
 const parts=Array.from(new Intl.Segmenter('vi',{granularity:'grapheme'}).segment(text),part=>part.segment);
 // Choose a pace for each field, then vary individual keystrokes and short reading pauses.
 const pace=Math.max(90,delayMs)*(1+random()*.4);let nextPause=5+Math.floor(random()*5);
 for(let i=0;i<parts.length;i++){
  check();await insert(parts[i]);check();
  if(i===parts.length-1)break;
  let delay=pace*(.65+random()*.95);
  if(i+1===nextPause||/[\s@.!?…,:;]/u.test(parts[i])){
   delay+=180+random()*320;nextPause=i+1+5+Math.floor(random()*5);
  }
  await pause(Math.round(delay));
 }
}

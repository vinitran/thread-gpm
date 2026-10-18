import test from 'node:test';import assert from 'node:assert/strict';import {installNativePointer} from '../extension/pointer-input.js';
function fixture(){let active=true;const events=[],waits=[],target={center:{x:130,y:180},scrollPoint:{x:200,y:200},inView:true,disabled:false,covered:false,scrollTop:0};const api={debugger:{async attach(){},async detach(){},async sendCommand(t,m,p){events.push(p);}},scripting:{async executeScript({func}){return [{frameId:0,result:func.name==='pointerTarget'?structuredClone(target):{__input:{kind:'click',token:'fixture'},result:{clicked:true}}}];}}};
 installNativePointer(api,{shouldContinue:()=>active,random:()=>0,wait:async ms=>waits.push(ms)});return {api,events,waits,target,stop(){active=false;}};
}
test('click moves through intermediate coordinates before press/release and returns result only after clicking',async()=>{
 const f=fixture();function replyAction(){};const result=await f.api.scripting.executeScript({target:{tabId:1},func:replyAction,args:['prepare',{}]});assert.equal(result[0].result.clicked,true);
 assert.ok(f.events.slice(0,10).every(e=>e.type==='mouseMoved'));assert.deepEqual(f.events.filter(e=>e.type!=='mouseMoved').map(e=>e.type),['mousePressed','mouseReleased']);assert.ok(f.waits.reduce((a,b)=>a+b,0)>=950);
});
test('blocked, disabled or stopped targets never receive mouse-down',async()=>{
 for(const mode of ['covered','disabled','stopped']){const f=fixture();if(mode==='stopped')f.stop();else f.target[mode]=true;await assert.rejects(()=>f.api.pointer.click({tabId:1},{token:'fixture'}));assert.equal(f.events.some(e=>e.type==='mousePressed'),false);}
});
test('Stop during movement prevents clicking, while Stop after down still releases the button',async()=>{
 let active=true;const events=[];const api={debugger:{async attach(){},async detach(){},async sendCommand(t,m,e){events.push(e.type);if(e.type==='mousePressed')active=false;}},scripting:{async executeScript(){return [{result:{center:{x:20,y:20},inView:true}}];}}};
 installNativePointer(api,{shouldContinue:()=>active,random:()=>0,wait:async()=>{}});await assert.rejects(()=>api.pointer.click({tabId:1},{x:20,y:20}),/Đã dừng/);assert.deepEqual(events.slice(-2),['mousePressed','mouseReleased']);
});

test('Stop in the middle of moving the pointer cancels before mouse-down',async()=>{
 let active=true;const events=[];const api={debugger:{async attach(){},async detach(){},async sendCommand(t,m,e){events.push(e.type);}},scripting:{async executeScript(){return [];}}};
 installNativePointer(api,{shouldContinue:()=>active,wait:async()=>{active=false;}});await assert.rejects(()=>api.pointer.click({tabId:1},{x:20,y:20}),/Đã dừng/);assert.deepEqual(events,['mouseMoved']);
});

test('scroll emits paced mouse-wheel events and mouse movement instead of changing DOM scroll positions',async()=>{
 const events=[];const api={debugger:{async attach(){},async detach(){},async sendCommand(t,m,e){events.push(e);}},scripting:{async executeScript({func}){return [{frameId:0,result:func.name==='pointerTarget'?{scrollPoint:{x:100,y:200},scrollTop:0}:{__input:{kind:'wheel',token:'fixture',deltaY:360},result:{scrolled:true}}}];}}};
 installNativePointer(api,{random:()=>0,wait:async()=>{}});function autoPage(){};assert.equal((await api.scripting.executeScript({target:{tabId:1},func:autoPage,args:['scroll']}))[0].result.scrolled,true);
 assert.ok(events.slice(0,10).every(e=>e.type==='mouseMoved'));const wheel=events.filter(e=>e.type==='mouseWheel');assert.equal(wheel.length,4);assert.equal(wheel.reduce((sum,e)=>sum+e.deltaY,0),360);assert.ok(wheel.every(e=>e.deltaX===0));
});

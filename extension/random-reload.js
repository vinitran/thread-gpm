export function randomDelay(min,max,random=Math.random){
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<5||max>3600||min>max)throw Error('Khoảng reload cần từ 5–3600 giây và min ≤ max.');
  return (min+Math.floor(random()*(max-min+1)))*1000;
}
export class RandomReload {
  constructor({timer=(...args)=>globalThis.setTimeout(...args),clear=id=>globalThis.clearTimeout(id),now=()=>Date.now(),onState=()=>{}}={}){Object.assign(this,{timer,clear,now,onState});this.active=false;this.generation=0;}
  start(min,max,task){randomDelay(min,max);this.stop();this.active=true;const generation=this.generation;const schedule=()=>{
    if(!this.active||generation!==this.generation)return;
    const delay=randomDelay(min,max);this.nextAt=this.now()+delay;this.onState({active:true,nextAt:this.nextAt});
    this.id=this.timer(async()=>{
      if(!this.active||generation!==this.generation)return;
      this.nextAt=null;this.onState({active:true,running:true});
      try{await task();}catch(e){if(generation===this.generation){this.stop();this.onState({active:false,error:e.message});}return;}
      schedule();
    },delay);
  };schedule();}
  stop(){this.active=false;this.generation++;this.clear(this.id);this.nextAt=null;this.onState({active:false});}
}

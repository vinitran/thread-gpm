import {sessionSendCount} from '../extension/auto-runner.js';
const day=date=>new Date(date).toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
export function dashboard(value,connected,now=Date.now()){
 const state=value.autoRun||{status:'idle',events:[]},all=Object.values(value.replyReceipts||{}),sent=all.filter(r=>r.state==='sent_unverified'||r.state==='posted');
 const today=day(now);
 return {connected,engine:value.executionMode||'direct',state:{status:state.status,activity:state.activity,current:state.current?{author:state.current.post.author,url:state.current.post.url,phase:state.current.phase}:null,nextAt:state.nextAt,nextImageAt:state.nextImageAt,sessionRest:state.sessionRest,events:state.events||[],stats:state.stats,startedAt:state.startedAt},counts:{today:sent.filter(r=>day(r.clicked_at||r.verified_at||r.created_at)===today).length,total:sent.length,session:sessionSendCount(state.stats),unverified:all.filter(r=>r.state!=='posted').length,sessions:(state.sessionHistory||[]).length},recent:all.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,50),lastSession:(state.sessionHistory||[]).at(-1)||null};
}

export function profileLogs(profile,view){
 const entries=[...(profile.runLog||[]).map(e=>({time:e.time,message:e.action})),...(view.state?.events||[])];
 const activity=view.state?.activity;if(activity?.message)entries.push({time:activity.since?new Date(activity.since).toISOString():'',message:activity.message});
 if(view.error)entries.push({time:'',message:'Lỗi: '+view.error});
 return [...new Map(entries.map(e=>[e.time+'|'+e.message,e])).values()].sort((a,b)=>(b.time||'').localeCompare(a.time||'')).slice(0,300);
}

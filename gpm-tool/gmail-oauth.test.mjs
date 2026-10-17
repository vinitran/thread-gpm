import test from 'node:test';import https from 'node:https';import {EventEmitter} from 'node:events';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {validateGmailOAuthConfig,loadGmailOAuthConfig,GmailOAuthClient,instagramCodeFromMessage,googleRequest} from './gmail-oauth.mjs';
const account='fixture@gmail.com',recipient='fixture+1244@gmail.com',code='012345',secrets=['fixture-access-token','fixture-refresh-token','fixture-client-secret','new-access-token'];
const token=(now=Date.now())=>({token:secrets[0],refresh_token:secrets[1],client_id:'fixture-client',client_secret:secrets[2],expiry:new Date(now+3600000).toISOString(),scopes:['https://www.googleapis.com/auth/gmail.readonly']});
const response=data=>({status:200,data});
const message=(now=Date.now(),extra={})=>({internalDate:String(now),payload:{headers:[{name:'From',value:'Instagram <no-reply@mail.instagram.com>'},{name:'To',value:recipient},{name:'Subject',value:code+' is your Instagram code'}]},...extra});
const safe=e=>{for(const value of [...secrets,code])assert.ok(!e.message.includes(value));return true;};
async function fixture(value=token()){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hx-gmail-oauth-')),tokenFile=path.join(dir,'token.json');await fs.writeFile(tokenFile,JSON.stringify(value),{mode:0o600});return {dir,config:{enabled:true,account,tokenFile},close:()=>fs.rm(dir,{recursive:true,force:true})};
}
test('OAuth config uses private files, is optional and never accepts a remote token or API endpoint',async()=>{
 const f=await fixture();try{assert.equal(await loadGmailOAuthConfig(path.join(f.dir,'missing.json')),null);assert.equal(validateGmailOAuthConfig({enabled:false}),null);assert.throws(()=>validateGmailOAuthConfig({account:'wrong@example.com',tokenFile:'x'}));
  const file=path.join(f.dir,'gmail-oauth.json');await fs.writeFile(file,JSON.stringify({account,tokenFile:'token.json',credentialsFile:'credentials.json'}));assert.deepEqual(await loadGmailOAuthConfig(file),{account,tokenFile:f.config.tokenFile,credentialsFile:path.join(f.dir,'credentials.json')});
  await assert.rejects(()=>googleRequest('http://127.0.0.1:8787/code'),safe);await assert.rejects(()=>googleRequest('https://untrusted.example/token'),safe);
 }finally{await f.close();}
});
test('direct Gmail refreshes OAuth, verifies the mailbox, reads only headers, and chooses the newest matching code',async()=>{
 const now=Date.now(),after=Math.floor(now/1000)-2,f=await fixture({...token(now),expiry:'2000-01-01T00:00:00Z'}),calls=[];
 try{const request=async(url,options)=>{calls.push({url,options});const u=new URL(url);assert.ok(['oauth2.googleapis.com','gmail.googleapis.com'].includes(u.hostname));
   if(u.hostname==='oauth2.googleapis.com'){assert.equal(options.method,'POST');const body=new URLSearchParams(options.body);assert.equal(body.get('refresh_token'),secrets[1]);assert.equal(body.get('grant_type'),'refresh_token');return response({access_token:secrets[3],expires_in:3600});}
   assert.equal(options.headers.Authorization,'Bearer '+secrets[3]);if(u.pathname.endsWith('/profile'))return response({emailAddress:account});
   if(u.pathname.endsWith('/messages')){assert.equal(u.searchParams.get('q'),`from:no-reply@mail.instagram.com to:${recipient} after:${after}`);assert.ok(url.includes('%2B'));assert.equal(u.searchParams.get('maxResults'),'50');return response({messages:[{id:'old'},{id:'new'},{id:'stale'},{id:'other'}]});}
   assert.equal(u.searchParams.get('format'),'metadata');assert.deepEqual(u.searchParams.getAll('metadataHeaders'),['Subject','To','From']);
   if(u.pathname.endsWith('/old'))return response(message(now-500,{payload:{headers:[{name:'From',value:'no-reply@mail.instagram.com'},{name:'To',value:recipient},{name:'Subject',value:'654321 is your Instagram code'}]}}));
   if(u.pathname.endsWith('/stale'))return response(message((after-1)*1000));
   if(u.pathname.endsWith('/other'))return response(message(now,{payload:{headers:[{name:'From',value:'no-reply@mail.instagram.com'},{name:'To',value:'fixture+other@gmail.com'},{name:'Subject',value:code+' is your Instagram code'}]}}));
   return response(message(now));
  };
  const result=await new GmailOAuthClient(f.config,{request}).pollCode({recipient,after});assert.deepEqual(result,{code});const saved=JSON.parse(await fs.readFile(f.config.tokenFile,'utf8'));assert.equal(saved.token,secrets[3]);assert.equal(saved.refresh_token,secrets[1]);assert.ok(!JSON.stringify(saved).includes(code));assert.equal((await fs.stat(f.config.tokenFile)).mode&0o777,0o600);assert.equal(calls.filter(c=>new URL(c.url).hostname==='oauth2.googleapis.com').length,1);
 }finally{await f.close();}
});
test('metadata matching rejects forged sender display names, wrong recipients, stale and invalid subjects',()=>{
 const now=Date.now(),after=Math.floor(now/1000)-1;
 assert.equal(instagramCodeFromMessage(message(now),{recipient,after,now}).code,code);
 for(const [header,value] of [['From','"no-reply@mail.instagram.com" <attacker@example.com>'],['To','fixture+other@gmail.com'],['Subject','123 is your Instagram code']]){const item=message(now);item.payload.headers.find(h=>h.name===header).value=value;assert.equal(instagramCodeFromMessage(item,{recipient,after,now}),null);}
 assert.equal(instagramCodeFromMessage(message((after-1)*1000),{recipient,after,now}),null);assert.equal(instagramCodeFromMessage(message(now+120000),{recipient,after,now}),null);
});
test('polling is every 3 seconds for at most 60 seconds and Stop interrupts a wait',async()=>{
 let clock=Math.floor(Date.now()/1000)*1000,lists=0,ready=false,active=true;const f=await fixture(token(clock)),times=[],progress=[];
 const request=async url=>{const u=new URL(url);if(u.pathname.endsWith('/profile'))return response({emailAddress:account});if(u.pathname.endsWith('/messages')){lists++;times.push(clock);return response({messages:ready&&lists===3?[{id:'mail'}]:[]});}return response(message(clock));};
 try{const client=new GmailOAuthClient(f.config,{request,now:()=>clock,wait:async ms=>{clock+=ms;}}),start=clock;await assert.rejects(()=>client.pollCode({recipient,after:Math.floor(clock/1000)-2,onProgress:m=>progress.push(m)}),e=>/60 giây/.test(e.message)&&safe(e));assert.equal(lists,18);assert.equal(times[0]-start,8000);assert.equal(times.at(-1)-times[0],51000);assert.equal(clock-start,60000);assert.ok(progress.every(m=>!m.includes(code)&&secrets.every(s=>!m.includes(s))));
  lists=0;times.length=0;ready=true;assert.deepEqual(await client.pollCode({recipient,after:Math.floor(clock/1000)-2}),{code});assert.deepEqual(times.map(t=>t-times[0]),[0,3000,6000]);
  ready=false;const stopped=new GmailOAuthClient(f.config,{request,wait:async()=>{active=false;}});await assert.rejects(()=>stopped.pollCode({recipient,after:Math.floor(clock/1000)-2,shouldContinue:()=>active}),/Đã dừng/);
 }finally{await f.close();}
});

test('Google transport retries malformed success bodies and preserves non-JSON HTTP errors without leaking their contents',async()=>{
 const original=https.request;
 try{for(const [status,body,retry] of [[200,'',true],[200,'<html>'+secrets[0]+'</html>',true],[200,'null',true],[200,'[]',true],[503,'<html>Unavailable</html>',false],[429,'',false],[401,'Unauthorized',false],[403,'Forbidden',false],[200,'{"emailAddress":"fixture@gmail.com"}',false]]){
  https.request=(url,options,respond)=>{assert.equal(options.headers.Accept,'application/json');const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;respond(res);res.emit('data',Buffer.from(body));res.emit('end');});return req;};
  if(retry)await assert.rejects(()=>googleRequest('https://gmail.googleapis.com/gmail/v1/users/me/profile'),e=>e.transient===true&&safe(e));else{const result=await googleRequest('https://gmail.googleapis.com/gmail/v1/users/me/profile');assert.equal(result.status,status);assert.deepEqual(result.data,status===200?{emailAddress:account}:null);}
 }}finally{https.request=original;}
});

test('after requesting a code the app waits, survives bad JSON and an HTML outage, and receives delayed mail within 10–30 seconds',async()=>{
 let clock=Math.floor(Date.now()/1000)*1000;const start=clock,after=start/1000,f=await fixture(token(clock)),original=https.request,times=[],progress=[];let profiles=0,lists=0;
 https.request=(url,options,respond)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
  const route=new URL(url).pathname;let status=200,body;
  if(route.endsWith('/profile'))body=++profiles===1?'':JSON.stringify({emailAddress:account});
  else if(route.endsWith('/messages')){times.push(clock-start);lists++;if(lists===1){status=503;body='<html>Temporary outage</html>';}else body=JSON.stringify(clock-start>=25000?{messages:[{id:'delayed-mail'}]}:{});}
  else body=JSON.stringify(message(clock));
  const res=new EventEmitter();res.statusCode=status;respond(res);res.emit('data',Buffer.from(body));res.emit('end');
 });return req;};
 try{const result=await new GmailOAuthClient(f.config,{now:()=>clock,wait:async ms=>{clock+=ms;}}).pollCode({recipient,after,onProgress:m=>progress.push(m)});assert.deepEqual(result,{code});assert.equal(profiles,2);assert.deepEqual(times,[13000,16000,19000,22000,25000]);assert.equal(clock-start,25000);assert.match(progress[0],/10 giây/);assert.ok(progress.every(m=>!m.includes(code)&&secrets.every(s=>!m.includes(s))));}
 finally{https.request=original;await f.close();}
});
test('concurrent workers share one refresh, 401 refreshes once, and OAuth errors reveal no tokens',async()=>{
 const f=await fixture({...token(),expiry:'2000-01-01T00:00:00Z'});let refreshes=0;
 const request=async url=>{if(new URL(url).hostname==='oauth2.googleapis.com'){refreshes++;await new Promise(r=>setTimeout(r,25));return response({access_token:secrets[3],expires_in:3600});}return response({emailAddress:account});};
 try{await Promise.all([new GmailOAuthClient(f.config,{request}).checkConnection(),new GmailOAuthClient(f.config,{request}).checkConnection()]);assert.equal(refreshes,1);
  let gets=0;refreshes=0;await new GmailOAuthClient(f.config,{request:async(url,options)=>new URL(url).hostname==='oauth2.googleapis.com'?(refreshes++,response({access_token:'another-access-token',expires_in:3600})):(gets++,gets===1?{status:401,data:{error:secrets[0]}}:response({emailAddress:account}))}).checkConnection();assert.equal(refreshes,1);assert.equal(gets,2);
  await fs.writeFile(f.config.tokenFile,JSON.stringify({...token(),expiry:'2000-01-01T00:00:00Z'}));await assert.rejects(()=>new GmailOAuthClient(f.config,{request:async()=>({status:400,data:{error:secrets[2]+' '+code}})}).checkConnection(),safe);
  await assert.rejects(()=>new GmailOAuthClient(f.config,{request}).pollCode({recipient:'other@gmail.com',after:1}),safe);
 }finally{await f.close();}
});

test('direct Google requests abort promptly on Stop or timeout without exposing authorization',async()=>{
 const original=https.request;let destroyed=false,active=true;
 https.request=()=>{const request=new EventEmitter();request.end=()=>{};request.destroy=()=>{destroyed=true;};return request;};
 try{const operation=googleRequest('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+secrets[0]},shouldContinue:()=>active});setTimeout(()=>{active=false;},10);await assert.rejects(()=>operation,e=>/Đã dừng/.test(e.message)&&safe(e));assert.equal(destroyed,true);destroyed=false;await assert.rejects(()=>googleRequest('https://gmail.googleapis.com/gmail/v1/users/me/profile',{timeoutMs:10}),safe);assert.equal(destroyed,true);}
 finally{https.request=original;}
});

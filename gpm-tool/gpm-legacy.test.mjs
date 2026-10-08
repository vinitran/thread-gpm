import test from 'node:test';import assert from 'node:assert/strict';
import {GpmApi,localApi} from './gpm-api.mjs';
test('GPMLogin v4 paginates API v3, normalizes metadata/CDP and maps create/update/close',async()=>{
 const calls=[];let profile={id:'a',name:'A',raw_proxy:'',browser_type:'Chrome',browser_version:'137.0.7151.41'};
 const api=new GpmApi('http://127.0.0.1:19995/api/v3',async(url,options)=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;calls.push({path:u.pathname,body});let data;
  if(u.pathname==='/api/v3/profiles'){data=[{...profile,id:u.searchParams.get('page')==='2'?'b':'a'}];return new Response(JSON.stringify({success:true,data,pagination:{total_page:2}}));}
  if(u.pathname.includes('/update/'))profile={...profile,name:body.profile_name??profile.name,raw_proxy:body.raw_proxy??profile.raw_proxy};
  data=u.pathname.includes('/start/')?{profile_id:'a',remote_debugging_address:'127.0.0.1:54321'}:u.pathname.includes('/create')?{id:'new',name:body.profile_name}:u.pathname.includes('/close/')?undefined:profile;
  return new Response(JSON.stringify({success:true,data,message:'OK'}));
 });
 assert.equal(localApi('http://127.0.0.1:19995/api/v3/'),'http://127.0.0.1:19995/api/v3');
 assert.equal(new GpmApi('http://127.0.0.1:19995/api/v1').version,'v1');
 const list=await api.list({metadata:true});assert.equal(list.length,2);assert.equal(list[0].browser.name,'chrome');
 const opened=await api.open('a');assert.equal(opened.cdp,'http://127.0.0.1:54321');
 await api.edit('a',{name:'Renamed',rawProxy:'proxy.test:80'});assert(calls.some(c=>c.path==='/api/v3/profiles/close/a'));assert.equal(profile.name,'Renamed');
 const created=await api.create({name:'New',browserVersion:'137.0.7151.41'});assert.equal(created.id,'new');const payload=calls.find(c=>c.path.endsWith('/create')).body;assert.equal(payload.profile_name,'New');assert.equal(payload.browser_core,'chromium');assert(!('name' in payload));
 const before=calls.length;await assert.rejects(()=>api.remove('a'),/thùng rác/);assert.equal(calls.length,before);
});
test('API errors identify address/code and reject non-local CDP returned by v4',async()=>{
 const failed=new GpmApi('http://127.0.0.1:19995',async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNREFUSED'}});});await assert.rejects(()=>failed.list(),/19995.*ECONNREFUSED/);
 const remote=new GpmApi('http://127.0.0.1:19995',async()=>new Response(JSON.stringify({success:true,data:{profile_id:'a',remote_debugging_address:'remote.example:54321'}})));await assert.rejects(()=>remote.call('/profiles/start/a'),/localhost/);
 const paths=[];const singular=new GpmApi('http://127.0.0.1:19995',async url=>{paths.push(new URL(url).pathname);return paths.length===1?new Response('',{status:404}):new Response(JSON.stringify({success:true,data:{id:'a',name:'A'}}));});assert.equal((await singular.call('/profiles/a')).id,'a');assert.deepEqual(paths,['/api/v3/profiles/a','/api/v3/profile/a']);
});

test('profile search matches partial names and IDs across pages, and bounds results',async()=>{
 let calls=0;
 const api=new GpmApi('http://127.0.0.1:19995',async url=>{
  calls++;const page=Number(new URL(url).searchParams.get('page'));
  return new Response(JSON.stringify({success:true,data:[{id:'id-'+page,name:page===2?'Target Account':'Other',group_id:page===2?2:1}],pagination:{total_page:3}}));
 });
 assert.deepEqual((await api.list({search:'TARGET'})).map(p=>p.id),['id-2']);assert.equal(calls,3);
 calls=0;assert.deepEqual((await api.list({search:'id-3'})).map(p=>p.id),['id-3']);assert.equal(calls,3);
 assert.deepEqual((await api.list({groupId:'2',search:'target'})).map(p=>p.id),['id-2']);assert.deepEqual(await api.list({groupId:'1',search:'target'}),[]);
 calls=0;assert.equal((await api.list({limit:1})).length,1);assert.equal(calls,1);
});

test('groups handles v4 arrays and Global paginated envelopes without mutations',async()=>{
 for(const base of ['http://127.0.0.1:19995','http://127.0.0.1:9495']){
  const routes=[];const api=new GpmApi(base,async(url,options)=>{assert.equal(options.method,'GET');const u=new URL(url);routes.push(u.pathname);const data=[{id:1,name:'QA'}];return new Response(JSON.stringify({success:true,data:base.includes('19995')?data:{data,last_page:1}}));});
  assert.deepEqual(await api.groups(),[{id:'1',name:'QA'}]);assert.match(routes[0],/\/groups$/);
 }
});

test('GPM colon-auth SOCKS5 proxies validate without changing stored values or exposing credentials',async()=>{
 const {proxy,proxyLabel}=await import('./gpm-api.mjs');
 for(const scheme of ['socks5','http','https']){const raw=scheme+'://127.0.0.1:4320:testuser:testpass';assert.equal(proxy(raw),raw);assert.equal(proxyLabel(raw),scheme+'://127.0.0.1:4320');}
 assert.equal(proxy('socks5://testuser:testpass@127.0.0.1:4320'),'socks5://testuser:testpass@127.0.0.1:4320');
 assert.equal(proxyLabel('socks5://testuser:testpass@127.0.0.1:4320'),'socks5://127.0.0.1:4320');
 for(const bad of ['socks5://host:99999:u:p','socks5://host:0:u:p','socks5://host:80:u','ftp://host:80:u:p','socks5://host:80:u:p\n'])assert.throws(()=>proxy(bad));
 assert.equal(proxyLabel('socks5://host:bad:u:p'),'Proxy không hợp lệ');
 const raw='socks5://127.0.0.1:4320:testuser:testpass',calls=[];const api=new GpmApi('http://127.0.0.1:19995',async url=>{calls.push(url);return new Response(JSON.stringify({success:true,data:url.includes('/start/')?{profile_id:'a',remote_debugging_address:'127.0.0.1:54321'}:{id:'a',name:'A',raw_proxy:raw}}));});
 assert.equal((await api.applyAndOpen('a',raw)).profileId,'a');assert.equal(calls.some(url=>url.includes('/update/')),false);
});

test('connection check probes only GET and reports discovery without saving',async()=>{
 const {checkGpmConnection}=await import('./gpm-api.mjs');const calls=[];
 const result=await checkGpmConnection('http://127.0.0.1:19995/api/v3',{request:async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');if(url.includes(':19995'))throw Object.assign(Error('offline'),{cause:{code:'ECONNREFUSED'}});return new Response(JSON.stringify({success:true,data:{data:[],last_page:1}}));}});
 assert.equal(result.gpmApi,'http://127.0.0.1:9495/api/v1');assert.equal(result.discovered,true);assert.equal(calls.length,2);
 const custom=await checkGpmConnection('http://127.0.0.1:23456/api/v1',{request:async()=>new Response(JSON.stringify({success:true,data:[]}))});assert.equal(custom.discovered,false);assert.equal(custom.gpmApi,'http://127.0.0.1:23456/api/v1');
 await assert.rejects(()=>checkGpmConnection('http://remote.example:9495'),/localhost/);
});

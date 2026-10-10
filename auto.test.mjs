import {collectFreshPosts} from './extension/feed-collector.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoRunner,AUTO_DEFAULTS,eligible,autoConfig,searchWaitMs} from './extension/auto-runner.js';
const p={url:'https://www.threads.com/@shopper/post/abc',author:'shopper',text:'Mua sắm quần áo mới ở đâu đẹp các bạn?',images:[]};
function fixture(){
 let saved,time=1000,receipts={},posts=0,checks=0;
 const deps={now:()=>time,random:()=>0,read:async()=>structuredClone(saved),write:async s=>{saved=structuredClone(s);},prepare:async()=>{},source:async()=>1,closeSource:async()=>{},newSource:async()=>9,replaceSource:async(old,options)=>{await options.onCreated(2);return 2;},schedule:async()=>{},clear:async()=>{},keepAlive:()=>1,endKeepAlive:()=>{},receipts:async()=>structuredClone(receipts),capture:async()=>({posts:[p,p],self:'me'}),scroll:async()=>{},idleScroll:async()=>{},refresh:async()=>{},savePosts:async()=>{},classify:async posts=>posts.map(p=>p.url),generate:async()=>({text:'response'}),post:async url=>{posts++;return receipts[url]={state:'posted',comment_url:'https://www.threads.com/@me/post/reply',verified_at:'2026-10-06T00:00:00Z'};},check:async url=>{checks++;return receipts[url];}};
 return {deps,runner:new AutoRunner(deps),advance(ms=600000){time+=ms;},saved:()=>saved,setSaved:s=>{saved=s;},receipts,posts:()=>posts,checks:()=>checks};
}
test('filters three requested groups, own posts and every prior receipt',()=>{
 assert.equal(eligible(p,AUTO_DEFAULTS,'me',{},{}),true);
 assert.equal(eligible({...p,text:'Nay ăn gì, tìm quán ăn ngon'},AUTO_DEFAULTS,'me',{},{}),true);
 assert.equal(eligible({...p,text:'Phối đồ thời trang công sở sao cho đẹp'},AUTO_DEFAULTS,'me',{},{}),true);
 assert.equal(eligible({...p,text:'Hôm nay tâm trạng không vui chút nào'},AUTO_DEFAULTS,'me',{},{}),true); // relevance is decided by AI
 assert.equal(eligible(p,AUTO_DEFAULTS,'shopper',{},{}),false);
 for(const state of ['posted','unknown','submitting'])assert.equal(eligible(p,AUTO_DEFAULTS,'me',{}, {[p.url]:{state}}),false);
 assert.equal(autoConfig({maxComments:10}).maxComments,undefined);assert.throws(()=>autoConfig({minRestSeconds:180,maxRestSeconds:120}));
});
test('one URL is selected once and runner keeps running after success',async()=>{
 const f=fixture();await f.runner.start({maxComments:1});await f.runner.tick();assert.equal(f.posts(),0);
 f.advance();await f.runner.tick();assert.equal(f.posts(),1);assert.equal(f.saved().status,'running');
 assert.equal(f.saved().history[p.url].comment_url,'https://www.threads.com/@me/post/reply');await f.runner.tick();assert.equal(f.posts(),1);
});
test('stop during AI prevents posting',async()=>{
 const f=fixture();f.deps.generate=async()=>{await f.runner.stop();};await f.runner.start();f.advance();await f.runner.tick();assert.equal(f.posts(),0);assert.equal(f.saved().status,'stopped');
});
test('worker restart reconciles posting job without posting again',async()=>{
 const f=fixture();await f.runner.start();const state=f.saved();state.current={post:p,phase:'posting'};state.nextAt=0;f.setSaved(state);
 f.receipts[p.url]={state:'posted',comment_url:'https://www.threads.com/@me/post/existing'};
 const resumed=new AutoRunner(f.deps);await resumed.tick();assert.equal(f.posts(),0);assert.equal(f.checks(),1);assert.equal(f.saved().stats.posted,1);
});
test('unknown receipt is rechecked twice, then replaces source without reposting',async()=>{
 const f=fixture();f.deps.post=async url=>f.receipts[url]={state:'unknown'};await f.runner.start();f.advance();await f.runner.tick();assert.equal(f.saved().status,'running');
 f.advance();await f.runner.tick();f.advance();await f.runner.tick();assert.equal(f.checks(),2);assert.equal(f.saved().status,'running');assert.equal(f.saved().source,2);assert.equal(f.saved().current,null);assert.equal(f.saved().stats.unknown,1);f.advance();await f.runner.tick();assert.equal(f.checks(),2);
});
test('duplicate alarm cannot run two jobs concurrently',async()=>{
 const f=fixture();let release;f.deps.generate=()=>new Promise(r=>{release=r;});await f.runner.start({maxComments:1});f.advance();const run=f.runner.tick();
 while(!release)await new Promise(r=>setTimeout(r,0));await f.runner.tick();release();await run;assert.equal(f.posts(),1);
});
test('API error stops scheduling and records reason without posting',async()=>{
 const f=fixture();f.deps.generate=async()=>{throw Error('quota 429');};await f.runner.start();f.advance();await f.runner.tick();assert.equal(f.posts(),0);assert.equal(f.saved().status,'attention');assert.match(f.saved().events[0].message,/quota/);
});

test('temporary AI failure backs off and retries before any submission',async()=>{
 const f=fixture();let calls=0;f.deps.generate=async()=>{if(++calls===1)throw Error('HTTP 503 service unavailable');};
 await f.runner.start({maxComments:1});f.advance();await f.runner.tick();assert.equal(f.saved().status,'running');assert.equal(f.posts(),0);
 f.advance();await f.runner.tick();assert.equal(f.posts(),1);assert.equal(f.saved().status,'running');
});

test('session caps ten sends and Stop cancels continuation',async()=>{
 const f=fixture();let index=0;f.deps.capture=async()=>({posts:[{...p,url:p.url+(index++)}],self:'me'});
 await f.runner.start({maxComments:10});
 for(let i=0;i<24&&f.posts()<12;i++){f.advance();await f.runner.tick();}
 assert.equal(f.posts(),10);assert.equal(f.saved().status,'running');
 await f.runner.stop();f.advance();await f.runner.tick();assert.equal(f.posts(),10);assert.equal(f.saved().status,'stopped');
});
test('empty feed refreshes and schedules another scan instead of completing',async()=>{
 const f=fixture();let refreshes=0;f.deps.capture=async()=>({posts:[],self:'me'});f.deps.refresh=async()=>{refreshes++;};
 await f.runner.start();for(let i=0;i<16;i++){f.advance();await f.runner.tick();}
 assert.equal(refreshes,1);assert.equal(f.saved().status,'running');assert.ok(f.saved().nextAt>0);assert.equal(f.posts(),0);
});

test('activity log records search, AI, upload and rest with timestamps',async()=>{
 const f=fixture();
 f.deps.generate=async()=>{assert.equal(f.saved().activity.phase,'ai');};
 const post=f.deps.post;f.deps.post=async url=>{await f.runner.progress('Đang gắn 3 ảnh riêng lẻ…');assert.equal(f.saved().activity.message,'Đang gắn 3 ảnh riêng lẻ…');return post(url);};
 await f.runner.start();f.advance();await f.runner.tick();
 const state=f.saved();assert.equal(state.activity.phase,'resting');assert.ok(state.nextAt>state.activity.since);
 const messages=state.events.map(e=>e.message).join('\n');
 for(const phrase of ['Đang lấy đầy đủ','Đang gọi AI','Đã nhận response','Đang gắn 3 ảnh','Đang nghỉ'])assert.ok(messages.includes(phrase));
 assert.ok(state.events.every(e=>Number.isFinite(Date.parse(e.time))));
});
test('repeated progress is deduplicated and logs survive reopening runner',async()=>{
 const f=fixture();await f.runner.start();f.runner.state.current={post:p,phase:'posting'};
 await f.runner.progress('Đang xác minh comment đã đăng…');await f.runner.progress('Đang xác minh comment đã đăng…');
 assert.equal(f.saved().events.filter(e=>e.message==='Đang xác minh comment đã đăng…').length,1);
 const reopened=new AutoRunner(f.deps);assert.equal((await reopened.load()).activity.phase,'verifying');
});

test('AI receives full new posts without keyword matching, fresh search after each comment',async()=>{
 const f=fixture();let calls=0,scrolls=0;
 const second={...p,url:p.url+'two',text:'Bộ này mặc đi làm có hợp k? '+ 'nội dung đầy đủ '.repeat(100)};
 const rejected={...p,url:p.url+'three',text:'Hôm nay ngắm trời rồi về ngủ.'};
 f.deps.capture=async()=>({posts:[p,second,rejected],self:'me'});
 f.deps.classify=async(posts,topics)=>{calls++;if(calls===1){assert.equal(posts.length,3);assert.equal(posts[1].text,second.text);}else{assert.equal(posts.length,1);assert.equal(posts[0].url,second.url);}assert.equal(topics,AUTO_DEFAULTS.keywords);return calls===1?[p.url,second.url]:[second.url];};
 f.deps.scroll=async()=>{scrolls++;};
 await f.runner.start();f.advance();await f.runner.tick();assert.equal(f.posts(),1);assert.equal(scrolls,0);
 f.advance();await f.runner.tick();assert.equal(f.posts(),2);assert.equal(calls,2);assert.equal(scrolls,0);
 assert.equal(f.saved().history[rejected.url].state,'ai-skipped');
 f.deps.capture=async()=>({posts:[],self:'me'});f.advance();await f.runner.tick();assert.equal(scrolls,1);assert.equal(calls,2);assert.equal(f.posts(),2);
});
test('stop while AI filters prevents generation and posting',async()=>{
 const f=fixture();let generations=0;f.deps.generate=async()=>{generations++;};f.deps.classify=async()=>{await f.runner.stop();return [p.url];};
 await f.runner.start();f.advance();await f.runner.tick();assert.equal(generations,0);assert.equal(f.posts(),0);assert.equal(f.saved().status,'stopped');
});

test('idle scrolling runs during cooldown without AI or posting',async()=>{
 const f=fixture();let scrolls=0;f.deps.idleScroll=async()=>{scrolls++;};
 await f.runner.start();f.advance();await f.runner.tick();const posts=f.posts();
 const state=f.runner.state;state.nextAt=f.deps.now()+300000;state.nextIdleAt=0;
 await f.runner.tick();assert.equal(scrolls,1);assert.equal(f.posts(),posts);assert.equal(f.saved().activity.phase,'resting');
 await f.runner.stop();await f.runner.tick();assert.equal(scrolls,1);
});
test('idle actions can be disabled independently of automatic posting',async()=>{
 const f=fixture();let scrolls=0;f.deps.idleScroll=async()=>{scrolls++;};
 await f.runner.start({idleScroll:false});await f.runner.tick();assert.equal(scrolls,0);
 f.advance();await f.runner.tick();assert.equal(f.posts(),1);
});

test('rest defaults and legacy settings migrate to two-three minutes',async()=>{
 assert.equal(AUTO_DEFAULTS.minRestSeconds,120);assert.equal(AUTO_DEFAULTS.maxRestSeconds,180);
 assert.equal(autoConfig({minMinutes:3,maxMinutes:5}).maxRestSeconds,180);
 const f=fixture();await f.runner.start();f.deps.random=()=>1;f.advance();await f.runner.tick();
 assert.equal(f.runner.state.nextAt-f.deps.now(),180000);
 const state=f.saved();state.config={...state.config,minMinutes:3,maxMinutes:5};state.nextAt=f.deps.now()+300000;f.setSaved(state);
 const resumed=new AutoRunner(f.deps);await resumed.load();assert.equal(resumed.state.config.maxRestSeconds,180);assert.equal(resumed.state.nextAt-f.deps.now(),180000);
});

test('search wait uses configured seconds after empty batch and exhausted queue',async()=>{
 assert.equal(autoConfig().searchDelaySeconds,30);
 for(const invalid of [0,181,NaN])assert.throws(()=>autoConfig({searchDelaySeconds:invalid}));
 const f=fixture();f.deps.classify=async()=>[];await f.runner.start({searchDelaySeconds:12});f.advance();await f.runner.tick();
 assert.equal(f.runner.state.nextAt-f.deps.now(),8400);
 f.runner.state.needsScroll=true;f.advance();await f.runner.tick();assert.equal(f.runner.state.nextAt-f.deps.now(),8400);
 f.runner.state.emptyScans=14;f.advance();await f.runner.tick();assert.equal(f.runner.state.nextAt-f.deps.now(),8400);
 assert.equal(f.runner.state.emptyScans,0);
});

test('collector scrolls until enough fresh posts and retains posts removed from DOM',async()=>{
 let reads=0,scrolls=0;const batches=[[{...p,url:p.url+'1'}],[{...p,url:p.url+'2'}],[{...p,url:p.url+'3'}]];
 const result=await collectFreshPosts({read:async()=>({posts:batches[reads++],self:'me'}),scroll:async()=>{scrolls++;},wait:async()=>{},targetCount:3});
 assert.equal(result.posts.length,3);assert.equal(scrolls,2);assert.equal(reads,3);
});
test('collector bounds sparse-feed scrolling, deduplicates and honors Stop',async()=>{
 let scrolls=0;const read=async()=>({posts:[p,p,{...p,url:p.url+'self',author:'me'}],self:'me'});
 const batch=await collectFreshPosts({read,scroll:async()=>{scrolls++;},wait:async()=>{},maxScrolls:3});assert.equal(scrolls,3);assert.equal(batch.posts.length,1);
 let running=true;scrolls=0;const stopped=await collectFreshPosts({read,scroll:async()=>{scrolls++;running=false;},wait:async()=>{},shouldContinue:()=>running});assert.equal(scrolls,1);assert.equal(stopped.posts.length,1);
});

test('unknown submission cooldown never scrolls source as idle activity',async()=>{
 const f=fixture();let idleCalls=0;f.deps.idleScroll=async()=>{idleCalls++;};f.deps.post=async()=>({state:'unknown'});
 await f.runner.start();f.advance();await f.runner.tick();assert.equal(f.runner.state.current.phase,'posting');f.runner.state.nextIdleAt=0;
 await f.runner.tick();assert.equal(idleCalls,0);
});

test('old forty-sixty second settings migrate to two-three minutes',()=>{
 const c=autoConfig({minRestSeconds:40,maxRestSeconds:60});assert.equal(c.minRestSeconds,120);assert.equal(c.maxRestSeconds,180);
});

 test('unverified Post click continues cooldown and excludes that URL on next search',async()=>{
 const f=fixture();let sends=0;f.deps.post=async url=>{sends++;return f.receipts[url]={state:'sent_unverified',clicked_at:'2026-10-06T00:00:00Z'};};
 await f.runner.start();f.advance();await f.runner.tick();
 assert.equal(f.saved().status,'running');assert.equal(f.saved().stats.sent,1);assert.equal(f.saved().stats.posted,0);assert.equal(f.saved().history[p.url].state,'sent_unverified');
 f.advance();await f.runner.tick();assert.equal(sends,1);assert.equal(f.checks(),0);
 });

test('browser read failures retry twice then replace source preserving history',async()=>{
 const f=fixture();let replacements=0,reads=0;f.deps.capture=async()=>{reads++;throw Error('Không nhận được kết quả DOM');};
 f.deps.replaceSource=async(old,options)=>{replacements++;assert.equal(old,1);await options.onCreated(9);return 9;};
 await f.runner.start();f.runner.state.history.old={state:'posted',comment_url:'saved'};
 for(let i=0;i<3;i++){f.advance();await f.runner.tick();}
 assert.equal(reads,3);assert.equal(replacements,1);assert.equal(f.saved().status,'running');assert.equal(f.saved().source,9);assert.equal(f.saved().history.old.comment_url,'saved');assert.equal(f.saved().nextAt,f.deps.now()+15000);
});
test('interrupted post without receipt is skipped on fresh tab and never resent',async()=>{
 const f=fixture();await f.runner.start();f.runner.state.current={post:p,phase:'posting'};f.runner.state.history[p.url]={state:'queued'};await f.runner.save();
 f.advance();await f.runner.tick();assert.equal(f.saved().source,2);assert.equal(f.saved().history[p.url].state,'error');
 f.advance();await f.runner.tick();assert.equal(f.posts(),0);assert.equal(f.checks(),0);
});
test('home navigation failure recovers tab but keeps sent receipt and counts',async()=>{
 const f=fixture();f.deps.post=async url=>f.receipts[url]={state:'sent_unverified',navigation_error:'Bước back-to-feed: timeout',clicked_at:'2026-10-06T00:00:00Z'};
 await f.runner.start();f.advance();await f.runner.tick();assert.equal(f.saved().status,'running');assert.equal(f.saved().source,2);assert.equal(f.saved().stats.sent,1);assert.equal(f.saved().history[p.url].state,'sent_unverified');
});
test('Stop during tab replacement prevents scheduling another search',async()=>{
 const f=fixture();f.deps.replaceSource=async(old,options)=>{await options.onCreated(2);await f.runner.stop();return 2;};
 await f.runner.start();f.runner.state.current={post:p,phase:'posting'};f.advance();await f.runner.tick();assert.equal(f.saved().status,'stopped');assert.equal(f.saved().nextAt,null);assert.equal(f.posts(),0);
});
test('three consecutive failed recoveries are bounded until a successful send',async()=>{
 const f=fixture();await f.runner.start();for(let i=0;i<4;i++)await f.runner.recover('DOM failed');
 assert.equal(f.saved().status,'attention');assert.match(f.saved().activity.message,/3 lần/);
});
test('restart continues persisted recovery using the already created new tab',async()=>{
 const f=fixture();await f.runner.start();const state=f.saved();state.recovery={reason:'DOM failed',oldTabId:1,newTabId:9};state.source=9;state.nextAt=0;state.recoveryAttempts=1;f.setSaved(state);
 f.deps.replaceSource=async(old,options)=>{assert.equal(old,1);assert.equal(options.newTabId,9);return 9;};
 const resumed=new AutoRunner(f.deps);await resumed.tick();assert.equal(f.saved().recovery,null);assert.equal(f.saved().recoveryAttempts,1);assert.equal(f.saved().source,9);assert.equal(f.posts(),0);
});

test('post-stage exception with a receipt retries read-only and then replaces tab',async()=>{
 const f=fixture();let clicks=0,checks=0;
 f.deps.post=async url=>{clicks++;f.receipts[url]={state:'unknown'};throw Error('Internal protocol error');};
 f.deps.check=async()=>{checks++;throw Error('Internal protocol error');};
 await f.runner.start();for(let i=0;i<3;i++){f.advance();await f.runner.tick();}
 assert.equal(clicks,1);assert.equal(checks,2);assert.equal(f.saved().source,2);assert.equal(f.saved().status,'running');assert.equal(f.saved().history[p.url].state,'error');
 f.advance();await f.runner.tick();assert.equal(clicks,1);
});

test('AI-ranked shopping post is processed before a lower-ranked earlier feed post',async()=>{
 const f=fixture(),shopping={...p,url:p.url+'shopping',text:'Xin review máy hút bụi trước khi mua'};
 f.deps.capture=async()=>({posts:[p,shopping],self:'me'});f.deps.classify=async()=>[shopping.url,p.url];
 let target;const post=f.deps.post;f.deps.post=async url=>{target=url;return post(url);};
 await f.runner.start();f.advance();await f.runner.tick();assert.equal(target,shopping.url);
});
test('legacy default topics migrate to shopping focus while custom keywords are kept',()=>{
 const old='mua sắm, mua đồ, mua quà, shopping, shopee, săn sale, đồ ăn, ăn gì, đặt đồ ăn, quán ăn, nhà hàng, trà sữa, thời trang, quần áo, outfit, phối đồ, váy, giày, túi xách';
 assert.equal(autoConfig({keywords:old}).keywords,AUTO_DEFAULTS.keywords);assert.equal(autoConfig({keywords:'mua sách, văn phòng phẩm'}).keywords,'mua sách, văn phòng phẩm');
});

test('random search interval varies around setting with bounded extremes',()=>{
 assert.equal(searchWaitMs(30,()=>0),21000);assert.equal(searchWaitMs(30,()=>1),39000);
 assert.equal(searchWaitMs(1,()=>0),1000);assert.equal(searchWaitMs(180,()=>1),180000);
});

test('10 sends closes source, waits three hours and starts fresh while preserving history',async()=>{
 const f=fixture();let index=0,closed=[],opened=0;f.deps.capture=async()=>({posts:[{...p,url:p.url+(index++)}],self:'me'});f.deps.closeSource=async id=>closed.push(id);f.deps.newSource=async()=>{opened++;return 9;};
 await f.runner.start();for(let i=0;i<10;i++){f.advance();await f.runner.tick();}
 assert.equal(f.posts(),10);assert.equal(f.saved().status,'running');assert.deepEqual(closed,[1]);assert.equal(f.saved().source,null);assert.equal(f.saved().nextAt-f.deps.now(),10800000);
 const history=Object.keys(f.saved().history);f.advance(10799999);await f.runner.tick();assert.equal(opened,0);assert.equal(f.posts(),10);
 f.advance(1);await f.runner.tick();assert.equal(opened,1);assert.equal(f.saved().source,9);assert.equal(f.saved().stats.posted,0);assert.equal(f.saved().sessionRest,null);assert.ok(history.every(url=>f.saved().history[url]));
 f.advance(15000);await f.runner.tick();assert.equal(f.posts(),11);
});
test('unverified 10th send enters rest even if returning home failed',async()=>{
 const f=fixture();f.deps.post=async url=>f.receipts[url]={state:'sent_unverified',navigation_error:'timeout'};
 await f.runner.start();f.runner.state.stats.sent=9;f.runner.state.stats.unknown=9;
 f.advance();await f.runner.tick();assert.equal(f.saved().status,'running');assert.equal(f.saved().source,null);assert.equal(f.saved().stats.sent,10);assert.ok(f.saved().sessionRest);
});
test('worker reload preserves three-hour deadline and performs no idle scrolling',async()=>{
 const f=fixture();let idle=0;f.deps.idleScroll=async()=>idle++;await f.runner.start();f.runner.state.stats.posted=10;f.advance();await f.runner.tick();const until=f.saved().sessionRest.until;
 const resumed=new AutoRunner(f.deps);f.advance(60000);await resumed.tick();assert.equal(f.saved().sessionRest.until,until);assert.equal(f.saved().nextAt,until);assert.equal(idle,0);assert.equal(f.posts(),0);
});
test('Stop during three-hour rest cancels automatic reopening',async()=>{
 const f=fixture();let opened=0;f.deps.newSource=async()=>{opened++;return 9;};await f.runner.start();f.runner.state.stats.posted=10;f.advance();await f.runner.tick();await f.runner.stop();f.advance(10800000);await f.runner.tick();assert.equal(opened,0);assert.equal(f.saved().status,'stopped');
});

test('image posts spaced six minutes apart with text-only posts between and persisted deadline',async()=>{
 const f=fixture(),modes=[],generationModes=[];let index=0;
 f.deps.capture=async()=>({posts:[{...p,url:p.url+(index++)}],self:'me'});
 f.deps.generate=async(post,mode)=>{generationModes.push(mode);};
 f.deps.post=async(url,step,cont,typing,mode)=>{modes.push(mode);return f.receipts[url]={state:'sent_unverified',clicked_at:new Date(f.deps.now()).toISOString()};};
 await f.runner.start();f.advance(15000);await f.runner.tick();const deadline=f.saved().nextImageAt;assert.equal(deadline,f.deps.now()+360000);
 for(let i=0;i<3;i++){f.advance(120000);await f.runner.tick();}
 assert.deepEqual(modes,[true,false,false,true]);assert.deepEqual(generationModes,modes);assert.equal(f.saved().stats.sent,4);
 assert.ok(f.saved().nextImageAt>deadline);const resumed=new AutoRunner(f.deps);assert.equal((await resumed.load()).nextImageAt,f.saved().nextImageAt);
});

test('optional tag defaults off and cycles after four image sends across restarts',async()=>{
 assert.equal(autoConfig().tagHoanxu,false);assert.throws(()=>autoConfig({tagHoanxu:'true'}));
 const f=fixture(),modes=[];let index=0;
 f.deps.capture=async()=>({posts:[{...p,url:p.url+(index++)}],self:'me'});
 f.deps.generate=async(post,images,tag)=>{modes.push({images,tag});};
 await f.runner.start({tagHoanxu:true});
 for(let i=0;i<4;i++){f.advance();await f.runner.tick();}
 assert.equal(f.saved().imageRepliesSinceTag,4);
 await f.runner.stop();f.runner=new AutoRunner(f.deps);await f.runner.start({tagHoanxu:true});
 f.advance();await f.runner.tick();assert.deepEqual(modes[4],{images:false,tag:true});assert.equal(f.saved().imageRepliesSinceTag,0);
 for(let i=0;i<5;i++){f.advance();await f.runner.tick();}
 assert.deepEqual(modes.map(m=>m.tag),[false,false,false,false,true,false,false,false,false,true]);
 f.runner.state.config.tagHoanxu=false;f.runner.state.imageRepliesSinceTag=4;f.advance();await f.runner.tick();assert.equal(modes.at(-1).tag,false);
});

test('failed image send does not advance optional tag counter',async()=>{
 const f=fixture();f.deps.post=async()=>{throw Error('HTTP 403');};
 await f.runner.start({tagHoanxu:true});f.advance();await f.runner.tick();assert.equal(f.saved().imageRepliesSinceTag,0);
});

test('failed after-Post verification continues normal cadence without rechecking, recovering or resubmitting',async()=>{
 const f=fixture();let recoveries=0;
 f.deps.post=async url=>f.receipts[url]={state:'sent_unverified',checked_at:'2026-10-09T00:00:00Z',verification_error:'No matching comment',clicked_at:'2026-10-09T00:00:00Z'};
 f.deps.replaceSource=async()=>{recoveries++;return 2;};await f.runner.start();f.advance();await f.runner.tick();
 assert.equal(f.saved().status,'running');assert.equal(f.saved().current,null);assert.equal(f.saved().source,1);assert.equal(f.checks(),0);assert.equal(recoveries,0);assert.equal(f.saved().stats.sent,1);
 assert.equal(f.saved().nextAt-f.deps.now(),120000);assert.equal(f.saved().history[p.url].state,'sent_unverified');
});

test('follow before comment is opt-in and rejects non-boolean settings',()=>{
 assert.equal(autoConfig({}).followBeforeComment,false);assert.equal(autoConfig({followBeforeComment:true}).followBeforeComment,true);assert.equal(autoConfig({followBeforeComment:false}).followBeforeComment,false);assert.throws(()=>autoConfig({followBeforeComment:'true'}),/theo dõi/);
});

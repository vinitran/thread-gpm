import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {attachments,assetSummary} from './assets.mjs';
import {signature} from '../extension/ai.js';
import {AutoRunner} from '../extension/auto-runner.js';
import {autoPage} from '../extension/auto-dom.js';
import {extractPosts} from '../extension/extract.js';
import {collectFreshPosts} from '../extension/feed-collector.js';
import {postReply,checkReply,returnToFeed,verifyAfterPost} from '../extension/post-reply.js';
import {replaceSourceTab,closeTabPreservingWindow} from '../extension/tab-actions.js';
import {generate,selectPosts} from './ai.mjs';
import {engagementPage} from './idle-engagement.mjs';
export const root=path.dirname(fileURLToPath(import.meta.url));
export {attachments} from './assets.mjs';
export function createRunner(store,browser){
 let timer;
 const settings=async()=>{const {settings}=await store.get('settings');return settings;};
 const home=async()=>{const tabs=(await browser.query()).filter(t=>t.url.startsWith('https://www.threads.com/'));const t=tabs.find(t=>new URL(t.url).pathname==='/')||tabs[0];if(!t)return (await browser.create({url:'https://www.threads.com/',active:true})).id;await browser.update(t.id,{url:'https://www.threads.com/',active:true});return t.id;};
 const runner=new AutoRunner({now:Date.now,random:Math.random,read:async()=> (await store.get('autoRun')).autoRun,write:autoRun=>store.set({autoRun}),
 aiRetryPolicy:{maxRetries:3,delayMs:120000,retryAllErrors:true},
 idleCandidates:id=>browser.evaluate(id,engagementPage,[{action:'candidates'}]),idleEngage:(id,url,until)=>browser.evaluate(id,engagementPage,[{action:'engage',url,until,stepDelayMs:(runner.state.config.stepSeconds||2)*1000}]),
 schedule:async when=>{clearTimeout(timer);timer=setTimeout(()=>runner.tick().catch(async e=>{await runner.finish('attention',e.message);}),Math.max(1000,when-Date.now()));},clear:async()=>clearTimeout(timer),keepAlive:()=>null,endKeepAlive:()=>{},
 prepare:async()=>{const s=await settings();if(!s.apiKey)throw Error('Nhập API key trong cài đặt.');await browser.connect(s.cdp);browser.installChrome();await assetSummary(s.imagesFolder);await attachments(s.imagesFolder);},source:home,
 closeSource:async id=>{if((await browser.query()).some(t=>t.id===id&&t.url.startsWith('https://www.threads.com/')))await closeTabPreservingWindow(id,'nghỉ phiên GPM');},
 newSource:async()=> (await browser.create({url:'https://www.threads.com/'},{shouldContinue:()=>runner.active()})).id,
 replaceSource:async(id,options)=>{await browser.ensureConnected(options.shouldContinue);if(options.newTabId){try{await browser.describe(options.newTabId);}catch{options={...options,newTabId:null};}}return replaceSourceTab(id,options);},
 receipts:async()=> (await store.get('replyReceipts')).replyReceipts||{},
 capture:async(id,excludeURLs)=>{const tab=await browser.describe(id);if(tab.url!=='https://www.threads.com/')throw Error('Tab nguồn không ở trang chủ');const health=await browser.evaluate(id,autoPage,['check']);return collectFreshPosts({read:async()=>({...await browser.evaluate(id,extractPosts,[{limit:50,mode:'feed',excludeURLs}]),self:health.self}),scroll:()=>browser.evaluate(id,autoPage,['scroll']),shouldContinue:()=>runner.active(),onProgress:m=>runner.activity('searching',m)});},
 scroll:id=>browser.evaluate(id,autoPage,['scroll']),idleScroll:id=>browser.evaluate(id,autoPage,['idle-scroll']),refresh:id=>browser.reload(id),savePosts:async batch=>store.set({lastCapture:batch}),
 classify:async(posts,topics)=>{const configured=await settings();await runner.progress('AI lọc bài · model '+configured.model);return selectPosts(posts,configured,topics,async diagnostics=>{const {aiRatingDiagnostics=[]}=await store.get('aiRatingDiagnostics');await store.set({aiRatingDiagnostics:[diagnostics,...aiRatingDiagnostics].slice(0,10)});});},
 generate:async(post,withImages,tagHoanxu=false)=>{
  const s=await settings(),cacheId=await signature(post,{...s,prompt:s.prompt+'|images:'+withImages+'|tag:'+tagHoanxu+'|tagEnabled:'+(s.runConfig?.tagHoanxu===true)});
  const {aiResults={}}=await store.get('aiResults');if(aiResults[post.url]?.cache_id===cacheId)return aiResults[post.url];
  await runner.progress('AI tạo bình luận · model '+s.model);
  const response={...await generate(post,s,withImages,tagHoanxu),cache_id:cacheId};delete aiResults[post.url];aiResults[post.url]=response;
  await store.set({aiResults:Object.fromEntries(Object.entries(aiResults).slice(-200))});return response;
 },
 post:async(url,stepDelayMs,shouldContinue,typingDelayMs,withImages)=>{
  const response=(await store.get('aiResults')).aiResults?.[url];if(!response)throw Error('Chưa có response AI');
  const image=withImages?await attachments((await settings()).imagesFolder):{files:[],names:[]};
  return postReply(url,response.text,image,m=>runner.progress(m).catch(()=>{}),{followAuthor:true,stepDelayMs,typingDelayMs,tabId:runner.state.source,shouldContinue,skipVerification:true,verifyAfterPost:true,waitBeforeHome:true});
 },
 check:async url=>{const {replyReceipts={}}=await store.get('replyReceipts'),receipt=replyReceipts[url],progress=m=>runner.progress(m),options={waitBeforeHome:true,shouldContinue:()=>runner.active()};if(receipt?.state==='sent_unverified'){await verifyAfterPost(receipt,progress,options);return returnToFeed(receipt,progress,options);}return checkReply(url,progress);}
 });
 runner.dispose=()=>clearTimeout(timer);
 return runner;
}

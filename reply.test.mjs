import {retryTabEdit,activateTab,replaceSourceTab,closeTabPreservingWindow} from './extension/tab-actions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectReplyAssets,makeReplyAttachments,uploadImage} from './extension/reply-assets.js';
import {replyAction} from './extension/reply-dom.js';
import {postReply,checkReply,typeReplyText,returnToFeed,waitBeforeHome} from './extension/post-reply.js';
const attachmentFixture=()=>({files:['a.png','app_store.PNG','b.png'].map(name=>({name,type:'image/png',data_url:'data:image/png;base64,VGVzdA=='})),names:['a','app_store.PNG','b']});
const images=['one.png','app_store.PNG','two.png','three.png'].map(name=>({name,path:'folder/'+name,blob:new Blob(['fixture'])}));
test('select exactly two distinct random images with case-insensitive app_store in center',()=>{
  for(let i=0;i<50;i++){
    const picked=selectReplyAssets(images);assert.equal(picked.length,3);assert.equal(picked[1].name,'app_store.PNG');assert.notEqual(picked[0].path,picked[2].path);assert.notEqual(picked[0].name,picked[1].name);
  }
  assert.throws(()=>selectReplyAssets(images.filter(im=>im.name!=='app_store.PNG')));
  assert.throws(()=>selectReplyAssets(images.slice(0,2)));
});
test('comment attachments preserve three separate original files in selected order',async()=>{
 const selected=selectReplyAssets(images,()=>0),result=await makeReplyAttachments(selected);
 assert.equal(result.files.length,3);assert.equal(result.files[1].name,'app_store.PNG');
 assert.deepEqual(result.names,selected.map(im=>im.path));
 for(let i=0;i<3;i++){
  assert.equal(result.files[i].name,selected[i].name);
  assert.deepEqual(Buffer.from(result.files[i].data_url.split(',')[1],'base64'),Buffer.from(await selected[i].blob.arrayBuffer()));
 }
});
test('bundled default folder contains center asset and at least two other images',async()=>{
  const names=JSON.parse(await readFile(new URL('./extension/default-assets/index.json',import.meta.url)));
  assert.equal(names.filter(n=>n.toLowerCase()==='app_store.png').length,1);assert.ok(names.length>=3);
});
test('existing submission is reused without opening another tab',async()=>{
  const original=globalThis.chrome;let opened=0;
  globalThis.chrome={storage:{local:{async get(){return {replyReceipts:{'https://www.threads.com/@demo/post/abc':{state:'unknown'}}};}}},tabs:{async query(){return [];},async create(){opened++;}}};
  try{const r=await postReply('https://www.threads.com/@demo/post/abc','comment',attachmentFixture());assert.equal(r.state,'unknown');assert.equal(r.reused,true);assert.equal(opened,0);}finally{globalThis.chrome=original;}
});
test('response beyond Threads length is rejected before browser operation',async()=>{
  await assert.rejects(()=>postReply('https://www.threads.com/@demo/post/abc','x'.repeat(501),attachmentFixture()),/1–500/);
});
test('posting waits for image stability and retries pre-click readiness before recording submission',async()=>{
  const original=globalThis.chrome;const store={replyReceipts:{}};const steps=[];const url='https://www.threads.com/@demo/post/mock';let uploaded=false,draftReads=0,focusReads=0,submitReads=0;
  globalThis.chrome={
    storage:{local:{async get(){return structuredClone(store);},async set(s){Object.assign(store,structuredClone(s));}}},
    tabs:{async query(){return [];},async create(){return {id:44};},async remove(){steps.push('close');}},
    debugger:{async attach(){steps.push('attach-debugger');},async detach(){steps.push('detach-debugger');},async sendCommand(target,method){if(method==='Input.dispatchMouseEvent')assert.equal(store.replyReceipts[url].state,'submitting');steps.push(method);}},
    scripting:{async executeScript({args:[action,args],world}){
      steps.push(action);let result=true;
      if(action==='back-to-feed')result={home:true};
      if(action==='composer')result={ready:true};
      if(action==='focus'){focusReads++;result=focusReads===1?{__reply_error:'Ô trả lời không duy nhất.'}:{before:['/@demo/post/mock'],original_media:['old']};}
      if(action==='upload'){assert.equal(world,'MAIN');assert.equal(args.files.length,3);assert.equal(args.files[1].name,'app_store.PNG');uploaded=true;}
      if(action==='draft'){draftReads++;result=draftReads===1?null:{ready:uploaded};}
      if(action==='submit'){assert.equal(store.replyReceipts[url],undefined);assert.equal(uploaded,true);submitReads++;if(submitReads===1)return [{result:{__reply_error:'Chưa sẵn sàng: 2/3 ảnh, 1 nút đăng khả dụng.'}}];result={x:100,y:200};}
      if(action==='verify')result={verified:true,url:'https://www.threads.com/@self/post/comment1'};
      return [{result}];
    }}
  };
  try{
    const r=await postReply(url,'response text',attachmentFixture(),()=>{},{stepDelayMs:0,typingDelayMs:0});
    assert.equal(r.state,'posted');assert.equal(focusReads,2);assert.equal(draftReads,4);assert.equal(submitReads,2);assert.equal(store.replyReceipts[url].comment_url,'https://www.threads.com/@self/post/comment1');
    assert.ok(steps.indexOf('upload')<steps.indexOf('submit'));assert.equal(steps.filter(s=>s==='Input.dispatchMouseEvent').length,2);assert.ok(steps.includes('close'));
    assert.ok(!steps.includes('attach'));assert.ok(!steps.includes('Page.setInterceptFileChooserDialog'));
    const again=await postReply(url,'response text',attachmentFixture());assert.equal(again.reused,true);
    assert.equal(steps.filter(s=>s==='submit').length,2);
  }finally{globalThis.chrome=original;}
});

test('reply modal works without checking source author or quoted text',()=>{
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};let focused=false;
 const editor={...visible,innerText:'',focus(){focused=true;}};
 const dialog={...visible,innerText:'Reply demo Original post text self Post',querySelectorAll(selector){
   if(selector==='a[href]')return [{href:'https://www.threads.com/@demo'}];
   if(selector.includes('contenteditable'))return [editor];return [];
 }};
 globalThis.document={querySelectorAll(selector){return selector==='[role="dialog"]'?[dialog]:[];}};
 globalThis.location={href:'https://www.threads.com/@demo/post/abc'};
 globalThis.getComputedStyle=()=>({visibility:'visible'});
 const args={url:location.href,target_author:'/@demo',target_text:'Original post text',before:['/@demo/post/abc']};
 try{
   assert.deepEqual(replyAction('focus',args),{before:args.before,original_media:[],self_profile:null});assert.equal(focused,true);
   assert.ok(replyAction('focus',{...args,target_text:'Other post'}));
   assert.ok(replyAction('focus',{...args,target_author:'/@other'}));
 }finally{Object.assign(globalThis,previous);}
});

test('upload selects image input, invokes native setter and dispatches both application events',()=>{
 const previous={document:globalThis.document,location:globalThis.location,HTMLInputElement:globalThis.HTMLInputElement,DataTransfer:globalThis.DataTransfer,File:globalThis.File};
 const events=[];
 class Input{constructor(accept){this.accept=accept;this.multiple=true;}set files(value){this.selected=value;}get files(){return this.selected;}dispatchEvent(e){events.push(e.type);}}
 const input=new Input('image/jpeg,image/png'),other=new Input('application/pdf');
 globalThis.HTMLInputElement=Input;
 globalThis.File=class{constructor(parts,name,options){this.name=name;this.type=options.type;}};
 globalThis.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
 globalThis.document={querySelectorAll:()=>[other,input]};globalThis.location={href:'https://www.threads.com/@demo/post/abc'};
 try{
  assert.deepEqual(replyAction('upload',attachmentFixture()),{files:3});
  assert.deepEqual(events,['input','change']);assert.equal(input.files[0].name,'a.png');assert.equal(input.files[1].name,'app_store.PNG');assert.equal(input.files[2].name,'b.png');assert.equal(other.files,undefined);
 }finally{Object.assign(globalThis,previous);}
});

test('submit locates enabled Post with icon and deduplicates carousel thumbnails',()=>{
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};let scrolled=false;
 const editor={...visible,innerText:'response'};
 const button={...visible,innerText:'Post',disabled:false,getAttribute:()=>null,querySelector:()=>({}),scrollIntoView(){scrolled=true;},getBoundingClientRect:()=>({left:10,top:20,width:80,height:40})};
 const imgs=['a','a','b','c'].map(src=>({...visible,src,currentSrc:src,complete:true,naturalWidth:50,naturalHeight:50,alt:''}));
 const dialog={...visible,querySelectorAll(selector){
  if(selector==='a[href]')return [{href:'https://www.threads.com/@demo/post/abc'}];
  if(selector.includes('contenteditable'))return [editor];
  if(selector==='button,[role="button"]')return [button];
  if(selector==='img')return imgs;return [];
 }};
 globalThis.document={querySelectorAll:s=>s==='[role="dialog"]'?[dialog]:[]};
 globalThis.location={href:'https://www.threads.com/@demo/post/abc'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const args={url:location.href,text:'response',original_media:[],attachment_count:3};
 try{
  assert.deepEqual(replyAction('draft',args),{ready:true,loaded:3,expected:3,post_buttons:1});
  assert.deepEqual(replyAction('submit',args),{x:50,y:40});assert.equal(scrolled,true);
  button.disabled=true;assert.equal(replyAction('draft',args).ready,false);
  assert.throws(()=>replyAction('submit',args),/0 nút đăng/);
 }finally{Object.assign(globalThis,previous);}
});

test('rechecking unknown receipt waits for URL, persists it and never submits again',async()=>{
 const original=globalThis.chrome,url='https://www.threads.com/@demo/post/abc';let checks=0;
 const store={replyReceipts:{[url]:{state:'unknown',tab_id:44,post_url:url,text:'response',before:[],self_profile:'/@self'}}};
 globalThis.chrome={storage:{local:{async get(){return structuredClone(store);},async set(v){Object.assign(store,structuredClone(v));}}},tabs:{async query(){return [];},async get(){return {id:44,url};},async create(){throw Error('Must reuse tab');}},scripting:{async executeScript({args:[action]}){
  assert.equal(action,'verify');checks++;return [{result:checks===1?{verified:false,reason:'loading'}:{verified:true,url:'https://www.threads.com/@self/post/comment1',visible_images:1}}];
 }}};
 try{
  const receipt=await checkReply(url,()=>{},{verifyTimeoutMs:100,verifyIntervalMs:1});
  assert.equal(checks,2);assert.equal(receipt.state,'posted');assert.equal(store.replyReceipts[url].comment_url,'https://www.threads.com/@self/post/comment1');assert.ok(receipt.verified_at);
  await checkReply(url);assert.equal(checks,2);
 }finally{globalThis.chrome=original;}
});
test('verification recognizes own permalink and exact caption when carousel shows one of three images',()=>{
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};
 const reply={...visible,getAttribute:()=>null,querySelector:s=>s==='svg title'?{textContent:'Reply'}:null};
 const caption={...visible,innerText:'response text',closest:()=>null,querySelector:()=>null,contains:()=>false};
 const image={...visible,width:200,height:200,alt:'',src:'image'};
 const root={querySelectorAll(s){if(s==='button,[role="button"]')return [reply];if(s==='[dir="auto"]')return [caption];if(s==='img')return [image];return [];}};
 const anchor={...visible,href:'https://www.threads.com/@self/post/newreply',parentElement:root};
 globalThis.document={body:{},querySelectorAll(s){return s==='a[href*="/post/"]'?[anchor]:[];}};
 globalThis.location={href:'https://www.threads.com/@demo/post/abc'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 try{
  const result=replyAction('verify',{url:location.href,text:'response text',before:[],self_profile:'/@self',attachment_count:3});
  assert.equal(result.verified,true);assert.equal(result.url,anchor.href);assert.equal(result.visible_images,1);
  assert.equal(replyAction('verify',{url:location.href,text:'different',before:[],self_profile:'/@self'}).verified,false);
 }finally{Object.assign(globalThis,previous);}
});

test('progressive typing preserves Vietnamese, emojis and line breaks',async()=>{
 const text='xiền 🐟 👨‍👩‍👧\nnha',parts=[],progress=[];
 await typeReplyText(text,async part=>{parts.push(part);},{delayMs:0,onProgress:message=>progress.push(message)});
 assert.equal(parts.join(''),text);assert.ok(parts.includes('🐟'));assert.ok(parts.includes('👨‍👩‍👧'));assert.ok(progress.at(-1).includes(parts.length+'/'+parts.length));
});
test('Stop cancels progressive typing before the next character',async()=>{
 let active=true;const parts=[];
 await assert.rejects(typeReplyText('abc',async part=>{parts.push(part);active=false;},{delayMs:0,shouldContinue:()=>active}),/Đã dừng/);
 assert.deepEqual(parts,['a']);
});

test('injected DOM failures return their actual cause instead of an empty result',()=>{
 const old=globalThis.document;
 globalThis.document={querySelectorAll(){throw Error('fixture composer not mounted');}};
 try{
  assert.deepEqual(replyAction('focus',{url:'https://www.threads.com/@demo/post/abc'},true),{__reply_error:'fixture composer not mounted'});
  assert.throws(()=>replyAction('focus',{url:'https://www.threads.com/@demo/post/abc'}),/fixture composer not mounted/);
 }finally{globalThis.document=old;}
});

test('focus matches exact source and addressed author even when quote is truncated',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};
 const editor={...visible,innerText:'',focus(){},getAttribute:()=> 'Reply to demo'};
 const dialog={...visible,innerText:'shortened quote',querySelectorAll(s){if(s==='a[href]')return [{href:'https://www.threads.com/@demo'}];if(s.includes('contenteditable'))return [editor];return [];}};
 globalThis.document={querySelectorAll:s=>s==='[role="dialog"]'?[dialog]:[]};globalThis.location={href:'https://www.threads.com/@demo/post/abc'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const args={url:location.href,target_author:'/@demo',target_text:'Full quote missing from modal'};
 try{assert.ok(replyAction('focus',args));editor.getAttribute=()=> 'Reply to other';assert.ok(replyAction('focus',args));}finally{Object.assign(globalThis,old);}
});

test('screenshot case: addressed username accepts ellipsis, without profile anchor, without checking quoted author',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};let hint='Reply to zanis0here...';
 const editor={...visible,innerText:'',focus(){},getAttribute:()=>hint};
 const dialog={...visible,innerText:'zanis0here Đăng tranh thì kh ai ngó, đăng đồ ăn cái viral',querySelectorAll(s){if(s.includes('contenteditable'))return [editor];return [];}};
 globalThis.document={querySelectorAll:s=>s==='[role="dialog"]'?[dialog]:[]};globalThis.location={href:'https://www.threads.com/@zanis0here/post/abc'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const args={url:location.href,target_author:'/@zanis0here',target_text:'unavailable caption'};
 try{
  assert.ok(replyAction('focus',args));hint='Reply to ZANIS0HERE…';assert.ok(replyAction('focus',args));
  hint='Reply to zanis0here.other...';assert.ok(replyAction('focus',args));
  hint='Reply to zanis0here...';location.href='https://www.threads.com/@zanis0here/post/other';assert.ok(replyAction('focus',args));
 }finally{Object.assign(globalThis,old);}
});

test('focus works without recipient placeholder or quoted post metadata',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};let focused=false;
 const editor={...visible,innerText:'',focus(){focused=true;}};
 const dialog={...visible,querySelectorAll(s){return s.includes('contenteditable')?[editor]:[];}};
 globalThis.document={querySelectorAll:s=>s==='[role="dialog"]'?[dialog]:[]};globalThis.location={href:'https://www.threads.com/@everlncore/post/abc'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 try{
  assert.ok(replyAction('focus',{url:location.href}));assert.equal(focused,true);
  editor.innerText='existing draft';assert.throws(()=>replyAction('focus',{url:location.href}),/bản nháp/);
 }finally{Object.assign(globalThis,old);}
});

test('same-tab commenting scrolls to loaded post and never opens or closes a tab',async()=>{
 const old=globalThis.chrome;const url='https://www.threads.com/@demo/post/abc',store={replyReceipts:{}};let locateCalls=0,found=true,backCalls=0;
 globalThis.chrome={
  storage:{local:{async get(){return structuredClone(store);},async set(v){Object.assign(store,structuredClone(v));}}},
  tabs:{async query(){return [];},async get(){return {id:7,url:'https://www.threads.com/'};},async update(id,change){assert.equal(id,7);assert.ok(change.active===true||change.url===url);},async goBack(id){assert.equal(id,7);backCalls++;},async create(){throw Error('No new tabs');},async remove(){throw Error('Must retain source');}},
  debugger:{async attach(){},async detach(){},async sendCommand(){}},
  scripting:{async executeScript({args:[action]}){
   let result=true;if(action==='locate'){locateCalls++;result={found};}
   if(action==='back-to-feed')result={home:true};
      if(action==='composer')result={ready:true};
      if(action==='focus')result={before:[],original_media:[],self_profile:'/@self'};
   if(action==='draft')result={ready:true};if(action==='submit')result={x:10,y:20};
   if(action==='verify')result={verified:true,url:'https://www.threads.com/@self/post/reply'};
   return [{result}];
  }}
 };
 try{const r=await postReply(url,'reply',attachmentFixture(),()=>{},{tabId:7,stepDelayMs:0,typingDelayMs:0});assert.equal(r.state,'posted');assert.equal(r.shared_tab,true);assert.equal(r.tab_id,7);assert.equal(locateCalls,1);assert.equal(backCalls,0);delete store.replyReceipts[url];found=false;const second=await postReply(url,'reply',attachmentFixture(),()=>{},{tabId:7,stepDelayMs:0,typingDelayMs:0});assert.equal(second.state,'posted');assert.equal(backCalls,0);assert.ok(second.returned_home_at);}finally{globalThis.chrome=old;}
});

test('inline reply opens Expand before typing or uploading, and waits for modal',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};let clicks=0,modal=false;
 const reply={...visible,getAttribute:()=> 'Reply'};
 const expand={...visible,getAttribute:()=> 'Expand',click(){clicks++;}};
 const target={querySelectorAll:s=>s==='button,[role="button"]'?[reply,expand]:[]};
 const anchor={...visible,href:'https://www.threads.com/@demo/post/abc',querySelector:()=>({}),parentElement:target};
 globalThis.document={body:{},querySelectorAll(s){if(s==='[role="dialog"]')return modal?[visible]:[];if(s==='a[href*="/post/"]')return [anchor];return [];}};
 globalThis.location={href:anchor.href};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const args={url:anchor.href};
 try{
  assert.deepEqual(replyAction('composer',args),{ready:false,expanded:true});assert.equal(clicks,1);
  args.expand_requested=true;assert.deepEqual(replyAction('composer',args),{ready:false});assert.equal(clicks,1);
  modal=true;assert.deepEqual(replyAction('composer',args),{ready:true});
 }finally{Object.assign(globalThis,old);}
});

test('after verified comment, Back returns same tab home and persists comment URL',async()=>{
 const old=globalThis.chrome;let url='https://www.threads.com/@demo/post/abc',clicked=0;
 const receipt={post_url:url,tab_id:7,shared_tab:true,state:'posted',comment_url:'https://www.threads.com/@self/post/reply'};const store={replyReceipts:{}};
 globalThis.chrome={storage:{local:{async get(){return structuredClone(store);},async set(v){Object.assign(store,structuredClone(v));}}},tabs:{async query(){return [];},async get(){return {id:7,url,status:'complete'};},async update(){throw Error('Back already returns home');}},scripting:{async executeScript({args:[action]}){if(action==='feed-ready')return [{result:{ready:true}}];assert.equal(action,'back-to-feed');clicked++;url='https://www.threads.com/';return [{result:{clicked:true}}];}}};
 try{await returnToFeed(receipt);assert.equal(clicked,1);assert.ok(receipt.returned_home_at);assert.equal(store.replyReceipts[receipt.post_url].comment_url,receipt.comment_url);}finally{globalThis.chrome=old;}
});
test('missing Back navigates same tab home without reposting',async()=>{
 const old=globalThis.chrome;let url='https://www.threads.com/@demo/post/abc',updates=0;
 const receipt={post_url:url,tab_id:7,shared_tab:true,state:'posted',comment_url:'https://www.threads.com/@self/post/reply'};
 globalThis.chrome={storage:{local:{async get(){return {replyReceipts:{}};},async set(){}}},tabs:{async query(){return [];},async get(){return {id:7,url,status:'complete'};},async update(id,change){assert.equal(id,7);url=change.url;updates++;}},scripting:{async executeScript({args:[action]}){return [{result:action==='feed-ready'?{ready:true}:{clicked:false}}];}}};
 try{await returnToFeed(receipt);assert.equal(updates,1);assert.equal(url,'https://www.threads.com/');assert.ok(receipt.returned_home_at);}finally{globalThis.chrome=old;}
});

test('return-to-feed clicks Threads logo instead of Back even on home',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};let clicks=0;
 const logo={href:'https://www.threads.com/',getClientRects:()=>[{}],getAttribute:()=>null,querySelector:s=>s==='svg title'?{textContent:'Threads'}:null,click(){clicks++;}};
 globalThis.document={querySelectorAll:s=>s==='a[href]'?[logo]:[]};globalThis.location={href:'https://www.threads.com/'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 try{assert.deepEqual(replyAction('back-to-feed',{}),{clicked:true});assert.equal(clicks,1);}finally{Object.assign(globalThis,old);}
});

test('temporary Chrome tab lock retries only the rejected tab operation',async()=>{
 let attempts=0;const waits=[],logs=[];
 const result=await retryTabEdit(async()=>{attempts++;if(attempts<3)throw Error('Tabs cannot be edited right now (user may be dragging a tab).');return 7;},{wait:async ms=>waits.push(ms),onProgress:m=>logs.push(m)});
 assert.equal(result,7);assert.equal(attempts,3);assert.equal(waits.length,2);assert.equal(logs.length,2);
 let failed=0;await assert.rejects(()=>retryTabEdit(async()=>{failed++;throw Error('No tab with id');},{wait:async()=>{}}),/No tab/);assert.equal(failed,1);
});
test('active tab skips Chrome tab editing and Stop cancels a pending retry',async()=>{
 const old=globalThis.chrome;
 globalThis.chrome={tabs:{async query(){return [];},async get(){return {id:7,active:true};},async update(){throw Error('Should not edit selected tab');}}};
 try{assert.equal((await activateTab(7)).id,7);}finally{globalThis.chrome=old;}
 let running=true,attempts=0;
 await assert.rejects(()=>retryTabEdit(async()=>{attempts++;throw Error('Tabs cannot be edited right now');},{shouldContinue:()=>running,wait:async()=>{running=false;}}),/Đã dừng/);assert.equal(attempts,1);
});

test('posted reply with persistent modal falls back to home without clicking Post again',async()=>{
 const old=globalThis.chrome;let url='https://www.threads.com/@demo/post/abc',updates=0,navReads=0;const logs=[];
 const receipt={post_url:url,tab_id:7,shared_tab:true,state:'posted',comment_url:'https://www.threads.com/@self/post/ok'};
 globalThis.chrome={storage:{local:{async get(){return {replyReceipts:{}};},async set(){}}},tabs:{async query(){return [];},async get(){return {id:7,url,status:'complete'};},async update(id,change){assert.equal(id,7);url=change.url;updates++;}},scripting:{async executeScript({args:[action]}){assert.ok(['back-to-feed','feed-ready'].includes(action));if(action==='back-to-feed'){navReads++;return [{result:{blocked:true}}];}return [{result:{ready:true}}];}}};
 try{await returnToFeed(receipt,m=>logs.push(m),{dialogCloseTimeoutMs:0,homeTimeoutMs:50,homeIntervalMs:1});assert.equal(updates,1);assert.equal(navReads,1);assert.equal(receipt.state,'posted');assert.ok(receipt.returned_home_at);assert.equal(receipt.navigation_error,undefined);}finally{globalThis.chrome=old;}
});

test('verification finds reply card without Reply button and normalizes Unicode caption',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};
 const caption={...visible,innerText:'xiền\u200b nha'.normalize('NFD'),closest:()=>null,querySelector:()=>null,contains:()=>false};
 const image={...visible,width:220,height:220,alt:'',src:'image'};
 const card={querySelectorAll(s){if(s==='[dir="auto"]')return [caption];if(s==='img')return [image];return [];}};
 const header={parentElement:card,querySelectorAll:()=>[]};const anchor={...visible,href:'https://www.threads.com/@self/post/new',parentElement:header};
 globalThis.document={body:{},querySelectorAll:s=>s==='a[href*="/post/"]'?[anchor]:[]};globalThis.location={href:'https://www.threads.com/@demo/post/abc'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 try{const r=replyAction('verify',{url:location.href,text:'xiền nha',self_profile:'/@self',before:[]});assert.equal(r.verified,true);assert.equal(r.url,anchor.href);assert.equal(replyAction('verify',{url:location.href,text:'unrelated',self_profile:'/@self',before:[]}).verified,false);}finally{Object.assign(globalThis,old);}
});

test('verification status distinguishes unsubmitted draft from closed composer',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};let open=true;
 const visible={getClientRects:()=>[{}]};const editor={...visible,innerText:'response'};
 globalThis.document={querySelectorAll(s){if(s==='[role="dialog"]')return open?[visible]:[];if(s.includes('contenteditable'))return open?[editor]:[];return [];}};globalThis.getComputedStyle=()=>({visibility:'visible'});
 try{assert.deepEqual(replyAction('submission-state',{text:'response'}),{dialog_open:true,draft_present:true,alerts:[]});open=false;assert.deepEqual(replyAction('submission-state',{text:'response'}),{dialog_open:false,draft_present:false,alerts:[]});}finally{Object.assign(globalThis,old);}
});

test('large upload images are reduced individually while keeping source bytes intact',async()=>{
 const old={createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};let closed=0,draws=0;
 const im={name:'app_store.PNG',blob:new Blob([new Uint8Array(800*1024)],{type:'image/png'})};
 globalThis.createImageBitmap=async()=>({width:2000,height:3000,close(){closed++;}});
 globalThis.OffscreenCanvas=class{constructor(w,h){assert.equal(h,1600);assert.ok(w<1600);}getContext(){return {fillRect(){},drawImage(){draws++;}};}async convertToBlob(options){assert.equal(options.type,'image/jpeg');return new Blob(['jpeg'],{type:'image/jpeg'});}};
 try{const r=await uploadImage(im);assert.equal(r.name,'app_store.jpg');assert.equal(r.blob.type,'image/jpeg');assert.equal(im.blob.size,800*1024);assert.equal(draws,1);assert.equal(closed,1);}finally{Object.assign(globalThis,old);}
});
test('Threads attachment failure is surfaced before reading Post readiness',()=>{
 const old={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle};
 globalThis.document={querySelectorAll:()=>[{getClientRects:()=>[{}],innerText:'Failed to upload attachment. Please try again.'}]};globalThis.getComputedStyle=()=>({visibility:'visible'});
 try{assert.throws(()=>replyAction('draft',{text:'response'}),/Threads tải ảnh thất bại/);}finally{Object.assign(globalThis,old);}
});

test('skip verification records click without DOM URL lookup and never resends',async()=>{
 const original=globalThis.chrome,store={replyReceipts:{}},actions=[];let clicks=0;const url='https://www.threads.com/@demo/post/skip';
 globalThis.chrome={
 storage:{local:{async get(){return structuredClone(store);},async set(v){Object.assign(store,structuredClone(v));}}},
 tabs:{async query(){return [];},async create(){return {id:42};},async remove(){}},
 debugger:{async attach(){},async detach(){},async sendCommand(t,m){if(m==='Input.dispatchMouseEvent')clicks++;}},
 scripting:{async executeScript({args:[action]}){actions.push(action);let result=true;
 if(action==='composer'||action==='draft')result={ready:true};
 if(action==='focus')result={before:[],original_media:[]};
 if(action==='submit')result={x:10,y:20};
 if(action==='verify')throw Error('Unexpected verification');
 return [{result}];}}};
 try{const r=await postReply(url,'response',attachmentFixture(),()=>{},{skipVerification:true,stepDelayMs:0,typingDelayMs:0});
 assert.equal(r.state,'sent_unverified');assert.ok(r.clicked_at);assert.equal(r.comment_url,undefined);assert.equal(actions.includes('verify'),false);assert.equal(clicks,2);
 const again=await postReply(url,'response',attachmentFixture());assert.equal(again.reused,true);assert.equal(clicks,2);
 }finally{globalThis.chrome=original;}
});

test('post-home delay is 30–40 seconds, persisted and interruptible without resending',async()=>{
 const old=globalThis.chrome;
 try{for(const random of [0,0.99999]){
 let time=1000,saved,elapsed=0;const receipt={post_url:'test',state:'sent_unverified'};
 globalThis.chrome={storage:{local:{async get(){return {replyReceipts:{}};},async set(v){saved=structuredClone(v);}}}};
 assert.equal(await waitBeforeHome(receipt,()=>{},{waitBeforeHome:true,random:()=>random,now:()=>time,wait:async ms=>{time+=ms;elapsed+=ms;}}),true);
 assert.equal(elapsed,random===0?30000:40000);assert.equal(saved.replyReceipts.test.home_after_at,1000+elapsed);
 const restarted=structuredClone(saved.replyReceipts.test);let calls=0;
 assert.equal(await waitBeforeHome(restarted,()=>{},{waitBeforeHome:true,now:()=>time,wait:async()=>{calls++;}}),true);assert.equal(calls,0);
 }
 let active=true,time=0;const receipt={post_url:'stop',home_after_at:60000};
 assert.equal(await waitBeforeHome(receipt,()=>{},{waitBeforeHome:true,now:()=>time,shouldContinue:()=>active,wait:async ms=>{time+=ms;active=false;}}),false);assert.equal(time,1000);
 }finally{globalThis.chrome=old;}
});

test('replacement persists fresh home tab before closing only the old Threads source',async()=>{
 const old=globalThis.chrome,steps=[];
 globalThis.chrome={tabs:{async query(){return [];},async create(options){assert.equal(options.url,'https://www.threads.com/');steps.push('create');return {id:9};},async get(id){return {id,url:'https://www.threads.com/@demo/post/test'};},async remove(id){assert.equal(id,1);steps.push('close');}}};
 try{assert.equal(await replaceSourceTab(1,{onCreated:async id=>{assert.equal(id,9);steps.push('persist');}}),9);assert.deepEqual(steps,['create','persist','close']);}finally{globalThis.chrome=old;}
});
test('replacement never closes unrelated source or closes old tab if new creation failed',async()=>{
 const old=globalThis.chrome;let closes=0;
 globalThis.chrome={tabs:{async query(){return [];},async create(){return {id:9};},async get(){return {url:'https://example.com/'};},async remove(){closes++;}}};
 try{await replaceSourceTab(1);assert.equal(closes,0);globalThis.chrome.tabs.create=async()=>{throw Error('Cannot create');};await assert.rejects(()=>replaceSourceTab(1),/Cannot create/);assert.equal(closes,0);}finally{globalThis.chrome=old;}
});

test('variable typing preserves Unicode and pauses at punctuation without delaying zero mode',async()=>{
 const inserted=[],waits=[];
 await typeReplyText('á.😎',async c=>inserted.push(c),{delayMs:60,random:()=>0,wait:async ms=>waits.push(ms)});
 assert.equal(inserted.join(''),'á.😎');assert.deepEqual(waits,[36,156]);
 await typeReplyText('abc',async()=>{},{delayMs:0,wait:async()=>{throw Error('Unexpected wait');}});
 let active=true,count=0;
 await assert.rejects(()=>typeReplyText('abc',async()=>{count++;},{delayMs:60,shouldContinue:()=>active,wait:async()=>{active=false;}}),/Đã dừng/);assert.equal(count,1);
});

test('text-only comment skips image upload and submits with zero expected attachments',async()=>{
 const old=globalThis.chrome,store={replyReceipts:{}},actions=[];let clicks=0;
 globalThis.chrome={storage:{local:{async get(){return structuredClone(store);},async set(v){Object.assign(store,structuredClone(v));}}},tabs:{async query(){return [];},async create(){return {id:42};},async remove(){}},debugger:{async attach(){},async detach(){},async sendCommand(t,m){if(m==='Input.dispatchMouseEvent')clicks++;}},scripting:{async executeScript({args:[action,args]}){actions.push(action);let result=true;if(action==='composer'||action==='draft'){assert.equal(args.attachment_count,0);result={ready:true};}if(action==='focus')result={before:[],original_media:[]};if(action==='submit')result={x:1,y:2};return [{result}];}}};
 try{const receipt=await postReply('https://www.threads.com/@demo/post/textonly','Nội dung @hoanxu.app',{files:[],names:[]},()=>{},{skipVerification:true,stepDelayMs:0,typingDelayMs:0});assert.equal(receipt.state,'sent_unverified');assert.deepEqual(receipt.images,[]);assert.equal(actions.includes('upload'),false);assert.equal(clicks,2);}finally{globalThis.chrome=old;}
});

test('text composer targets its SVG Send button instead of the outer Reply action',()=>{
 const old={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 const visible={getClientRects:()=>[{}]};let svgLabel='Send';
 const send={...visible,innerText:'',getAttribute:()=>null,querySelector:s=>s==='svg title'?{textContent:svgLabel}:null,scrollIntoView(){},getBoundingClientRect:()=>({left:20,top:30,width:40,height:40})};
 const reply={...visible,innerText:'Reply',getAttribute:()=>null,querySelector:()=>null};
 const editor={...visible,innerText:'hello @hoanxu.app'};
 const local={querySelectorAll:s=>s.includes('contenteditable')?[editor]:s==='button,[role="button"]'?[send]:[]};editor.parentElement=local;
 const dialog={...visible,querySelectorAll:s=>s.includes('contenteditable')?[editor]:s==='button,[role="button"]'?[reply,send]:[]};local.parentElement=dialog;
 globalThis.document={body:{},querySelectorAll:s=>s==='[role="dialog"]'?[dialog]:[],elementFromPoint:()=>send};globalThis.location={href:'https://www.threads.com/@demo/post/test'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const args={url:location.href,text:editor.innerText,attachment_count:0,original_media:[]};
 try{
  for(const name of ['Send','Gửi','Send reply','Post']){svgLabel=name;assert.equal(replyAction('draft',args).ready,true);assert.deepEqual(replyAction('submit',args),{x:40,y:50});}
  send.disabled=true;const draft=replyAction('draft',args);assert.equal(draft.ready,false);assert.match(draft.reason,/disabled/);assert.throws(()=>replyAction('submit',args),/0 nút đăng/);
 }finally{Object.assign(globalThis,old);}
});

test('closing the final profile tab creates a blank tab in the same window first',async()=>{
 const previous=globalThis.chrome,steps=[];
 globalThis.chrome={tabs:{async query(){return [{id:7,windowId:4}];},async create(options){assert.equal(options.windowId,4);assert.equal(options.url,'about:blank');steps.push('blank');},async remove(id){assert.equal(id,7);steps.push('close');}}};
 try{await closeTabPreservingWindow(7);assert.deepEqual(steps,['blank','close']);}finally{globalThis.chrome=previous;}
});
test('failed blank-tab creation keeps the final profile tab open',async()=>{
 const previous=globalThis.chrome;let closed=false;
 globalThis.chrome={tabs:{async query(){return [{id:7,windowId:4}];},async create(){throw Error('create failed');},async remove(){closed=true;}}};
 try{await assert.rejects(()=>closeTabPreservingWindow(7),/create failed/);assert.equal(closed,false);}finally{globalThis.chrome=previous;}
});

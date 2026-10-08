import test from 'node:test';
import assert from 'node:assert/strict';
import {imageSources,collageLayout,allowedImage,requestBody,generate,signature,API_BASE,selectionBody,parseSelection,selectPosts} from './extension/ai.js';
const settings={apiKey:'test-secret',prompt:'Prompt exactly as supplied',model:'cx/gpt-5.6-luna'};
const post={url:'https://www.threads.com/@demo/post/abc',text:'Bài test',images:[]};
test('only first three unique images and approved Threads CDN hosts are used',()=>{
  assert.deepEqual(imageSources({images:[{src:'a'},{src:'a'},{src:'b'},{src:'c'},{src:'d'}]}),['a','b','c']);
  assert.equal(allowedImage('https://scontent.cdninstagram.com/a.jpg'),true);
  assert.equal(allowedImage('https://cdninstagram.com.evil.test/a.jpg'),false);
  assert.equal(allowedImage('http://scontent.fbcdn.net/a.jpg'),false);
});
test('horizontal collage preserves aspect ratios and contains up to three images',()=>{
  const r=collageLayout([{width:600,height:1200},{width:1200,height:600},{width:600,height:600}]);
  assert.ok(r.width<=1536);assert.ok(r.height<=512);assert.equal(r.cells[0].x,0);
  for(let i=1;i<3;i++)assert.equal(r.cells[i].x,r.cells[i-1].x+r.cells[i-1].width+8);
  assert.equal(r.cells[1].width,r.height*2);assert.equal(r.cells[2].width,r.height);
  assert.throws(()=>collageLayout([]));assert.throws(()=>collageLayout(Array(4).fill({width:1,height:1})));
});
test('one request carries exact prompt, post text and a single merged image, never the API key in body',()=>{
  const b=requestBody(post,settings,{data_url:'data:image/jpeg;base64,TEST',image_count:3});
  assert.equal(b.messages[0].content,settings.prompt);
  assert.ok(b.messages[1].content[0].text.includes(post.text));
  assert.equal(b.messages[1].content.filter(c=>c.type==='image_url').length,1);
  assert.ok(!JSON.stringify(b).includes(settings.apiKey));
  assert.equal(requestBody(post,settings,null).messages[1].content.length,1);
});
test('text-only post reaches exact endpoint with authorization and extracts response',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,API_BASE+'/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-secret');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({choices:[{message:{content:'response test'}}],model:'model-test'})};};
  try{const r=await generate(post,settings);assert.equal(calls,1);assert.equal(r.text,'response test');assert.equal(r.collage,null);}finally{globalThis.fetch=original;}
});
test('three bitmap draws become one image sent to AI; resources close after merge',async()=>{
  const originals={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};
  let imageCalls=0,closed=0,request;const draws=[];
  globalThis.fetch=async(url,options)=>{
    if(url===API_BASE+'/chat/completions'){request=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'with image'}}]})};}
    imageCalls++;return new Response(new Blob(['image fixture'],{type:'image/png'}));
  };
  globalThis.createImageBitmap=async()=>({width:600,height:600,close(){closed++;}});
  globalThis.OffscreenCanvas=class{getContext(){return {fillRect(){},drawImage(...args){draws.push(args);}};}async convertToBlob(){return new Blob(['JPEG fixture'],{type:'image/jpeg'});}};
  try{
    const r=await generate({...post,images:[1,2,3,4].map(i=>({src:`https://scontent.cdninstagram.com/${i}.png`}))},settings);
    assert.equal(imageCalls,3);assert.equal(draws.length,3);assert.equal(closed,3);assert.equal(r.image_count,3);
    assert.equal(request.messages[1].content.filter(c=>c.type==='image_url').length,1);assert.ok(r.collage.data_url.startsWith('data:image/jpeg;base64,'));
  }finally{Object.assign(globalThis,originals);}
});
test('cache changes for prompt/content changes but ignores rotating image signatures',async()=>{
  const p={...post,images:[{src:'https://scontent.fbcdn.net/a.png?token=1'}]};
  const first=await signature(p,settings);
  assert.equal(first,await signature({...p,images:[{src:'https://scontent.fbcdn.net/a.png?token=2'}]},settings));
  assert.notEqual(first,await signature(p,{...settings,prompt:'changed'}));
  assert.notEqual(first,await signature({...p,text:'changed'},settings));
});

test('503 wrapper surfaces upstream quota/reset and redacts credentials',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({error:{message:'[429]: The usage limit has been reached (reset after 29m 20s) test-secret sk-private-token'}})});
 try{await assert.rejects(generate(post,settings),e=>{
   assert.match(e.message,/Model đã chạm giới hạn/);assert.match(e.message,/reset after 29m 20s/);
   assert.ok(!e.message.includes(settings.apiKey));assert.ok(!e.message.includes('sk-private-token'));return true;
 });}finally{globalThis.fetch=original;}
});
test('non-JSON server failure reports service error without blaming key',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:false,status:503,json:async()=>{throw Error('HTML');}});
 try{await assert.rejects(generate(post,settings),/Dịch vụ AI đang gặp lỗi/);}finally{globalThis.fetch=original;}
});

test('selection payload includes full post text and all metadata without key',()=>{
 const full={...post,text:'text '.repeat(1000),images:[{src:'https://scontent.fbcdn.net/a.png',alt:'outfit'}]};
 const body=selectionBody([full],settings,'mua sắm, ăn uống, thời trang');
 assert.deepEqual(JSON.parse(body.messages[1].content).posts,[full]);assert.ok(!JSON.stringify(body).includes(settings.apiKey));
 assert.deepEqual(parseSelection(JSON.stringify({ratings:[{url:full.url,language:'other',eligible:true,score:99}]}),[full]),[]);
 assert.throws(()=>parseSelection(JSON.stringify({ratings:[{url:'https://evil.example/',language:'vi',eligible:true,score:80}]}),[full]),/ngoài nhóm/);
});
test('AI filter selects only returned in-batch URLs and deduplicates results',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert.equal(url,API_BASE+'/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-secret');return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({ratings:[{url:post.url,language:'vi',eligible:true,score:80}]})}}]})};};
 try{assert.deepEqual(await selectPosts([post],settings,'topics'),[post.url]);}finally{globalThis.fetch=original;}
});

test('large AI filter batches are split without truncating or dropping posts',async()=>{
 const original=globalThis.fetch,received=[];
 const posts=Array.from({length:12},(_,i)=>({...post,url:post.url+i,text:'full text '.repeat(100)+i}));
 globalThis.fetch=async(url,options)=>{const batch=JSON.parse(JSON.parse(options.body).messages[1].content).posts;received.push(...batch);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({ratings:batch.map(p=>({url:p.url,language:'vi',eligible:true,score:80}))})}}]})};};
 try{assert.deepEqual(await selectPosts(posts,settings,'topics'),posts.map(p=>p.url));assert.deepEqual(received,posts);}finally{globalThis.fetch=original;}
});

test('Vietnamese scores exclude foreign posts and select the best low-score eligible post',()=>{
 const posts=[0,1,2].map(i=>({...post,url:post.url+i}));
 const ratings=[{url:posts[0].url,language:'other',eligible:true,score:100},{url:posts[1].url,language:'vi',eligible:true,score:20},{url:posts[2].url,language:'vi',eligible:true,score:40}];
 assert.deepEqual(parseSelection(JSON.stringify({ratings}),posts),[posts[2].url]);
 ratings[2].eligible=false;assert.deepEqual(parseSelection(JSON.stringify({ratings}),posts),[posts[1].url]);
 ratings[1].language='unknown';assert.deepEqual(parseSelection(JSON.stringify({ratings}),posts),[]);
 assert.throws(()=>parseSelection(JSON.stringify({ratings:ratings.slice(1)}),posts),/đầy đủ/);
});

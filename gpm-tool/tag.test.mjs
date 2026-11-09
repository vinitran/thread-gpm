import test from 'node:test';
import assert from 'node:assert/strict';
import {generate} from './ai.mjs';

test('AI tag is opt-in and only appears once on the scheduled tag turn',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:'Nội dung @HOANXU.APP @hoanxu.app'}}]})};};
 const post={url:'https://www.threads.com/@test/post/abc',author:'test',text:'Test',images:[]},settings={model:'test',apiKey:'test',prompt:'Luôn thêm @hoanxu.app'};
 try{
  assert.equal((await generate(post,settings,false)).text,'Nội dung');
  assert.equal((await generate(post,settings,true,true)).text,'Nội dung');
  const enabled={...settings,runConfig:{tagHoanxu:true}};
  assert.equal((await generate(post,enabled,true,false)).text,'Nội dung');
  assert.equal((await generate(post,enabled,false,true)).text,'Nội dung @hoanxu.app');
  assert.match(JSON.stringify(requests[0]),/không được nhắc hay tag/);
 }finally{globalThis.fetch=original;}
});


test('regular replies use only their own prompt, retain the article context and never inherit promotion or tags',async()=>{
 const original=globalThis.fetch,requests=[];let response='Món này nhìn hấp dẫn quá!';
 globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:response}}]})};};
 const post={url:'https://www.threads.com/@test/post/abc',text:'Bữa tối mình nấu có món canh chua.',images:[]},settings={model:'fixture',apiKey:'fixture',prompt:'SAVED-PROMOTION-PROMPT: tải Hoàn Xu ngay',runConfig:{tagHoanxu:true}};
 try{
  assert.equal((await generate(post,settings,false,true,'regular')).text,response);
  const body=requests[0];assert.ok(!body.messages[0].content.includes('SAVED-PROMOTION-PROMPT'));assert.ok(JSON.stringify(body.messages[1]).includes(post.text));assert.match(body.messages[0].content,/không quảng bá/);
  response='Tải Hoàn Xu nè';await assert.rejects(()=>generate(post,settings,false,false,'regular'),/quảng bá/);
  response='Nội dung quảng bá gốc';assert.equal((await generate(post,settings,true,false,'promotion')).text,response);assert.ok(requests.at(-1).messages[0].content.startsWith(settings.prompt));assert.equal(settings.prompt,'SAVED-PROMOTION-PROMPT: tải Hoàn Xu ngay');
 }finally{globalThis.fetch=original;}
});


test('runner cache separates promotional and ordinary replies for the same article',async()=>{
 const {createRunner}=await import('./runner.mjs'),original=globalThis.fetch;let calls=0;
 const value={settings:{model:'fixture',apiKey:'fixture',prompt:'PROMO',runConfig:{}},aiResults:{}};
 const store={value,async get(key){return {[key]:value[key]};},async set(patch){Object.assign(value,patch);}};
 const runner=createRunner(store,{}),post={url:'https://www.threads.com/@test/post/abc',text:'Bữa tối nấu canh chua',images:[]};
 globalThis.fetch=async(url,options)=>{calls++;const prompt=JSON.parse(options.body).messages[0].content;return {ok:true,json:async()=>({choices:[{message:{content:prompt.startsWith('PROMO')?'Nội dung giới thiệu':'Món canh nhìn hấp dẫn!'}}]})};};
 try{assert.equal((await runner.d.generate(post,true,false,'promotion')).text,'Nội dung giới thiệu');assert.equal((await runner.d.generate(post,false,false,'regular')).text,'Món canh nhìn hấp dẫn!');await runner.d.generate(post,false,false,'regular');assert.equal(calls,2);}finally{runner.dispose();globalThis.fetch=original;}
});

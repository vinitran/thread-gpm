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

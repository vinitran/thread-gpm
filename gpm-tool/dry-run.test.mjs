import test from 'node:test';import assert from 'node:assert/strict';
import {dryRunProfile} from './dry-run.mjs';
const post={url:'https://www.threads.com/@qa/post/test',author:'qa',text:'QA post'};
test('dry-run reads visible posts, calls AI and returns preview without clicks or posting',async()=>{
 const calls=[];const browser={query:async()=>[{id:1,url:'https://www.threads.com/'}],evaluate:async(id,fn,args)=>{calls.push(fn.name);if(fn.name==='autoPage'){assert.deepEqual(args,['check']);return {self:'tester'};}assert.equal(fn.name,'extractPosts');return {posts:[post,{...post,author:'tester'}]};}};
 const result=await dryRunProfile(browser,{apiKey:'fixture',model:'luna',runConfig:{keywords:'QA'}},{classify:async posts=>{assert.deepEqual(posts,[post]);return [post.url];},respond:async(p,s,images)=>{assert.equal(images,false);return {text:'Preview only'};}});
 assert.equal(result.dryRun,true);assert.equal(result.scanned,1);assert.equal(result.preview,'Preview only');assert.deepEqual(calls,['autoPage','extractPosts']);
});
test('dry-run with no visible posts does not call AI',async()=>{
 const browser={query:async()=>[{id:1,url:'https://www.threads.com/'}],evaluate:async(id,fn)=>fn.name==='autoPage'?{self:'tester'}:{posts:[]}};
 const result=await dryRunProfile(browser,{model:'luna',runConfig:{}},{classify:()=>assert.fail('AI must not run')});assert.equal(result.scanned,0);
});

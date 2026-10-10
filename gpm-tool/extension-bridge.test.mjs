import test from 'node:test';import assert from 'node:assert/strict';
import {ExtensionBridge} from './extension-bridge.mjs';
import {extensionArguments,MANAGED_EXTENSION_ID} from './managed-extension.mjs';
test('extension RPC authenticates its own token and origin independently from app API',()=>{
 const b=new ExtensionBridge(()=>({status:'running'}));
 assert.equal(b.authorize({'x-extension-token':b.token,origin:'chrome-extension://'+MANAGED_EXTENSION_ID},MANAGED_EXTENSION_ID),true);
 assert.equal(b.authorize({'x-extension-token':b.token},MANAGED_EXTENSION_ID),true);
 for(const headers of [{},{'x-extension-token':'wrong'},{'x-extension-token':b.token,origin:'https://untrusted.example'}])assert.equal(b.authorize(headers,MANAGED_EXTENSION_ID),false);
 b.close();
});
test('RPC delivers once, propagates errors and never repeats a lost acknowledgement',async()=>{
 const b=new ExtensionBridge(()=>({status:'running'}));
 const pending=b.call('tabs.create',{options:{url:'about:blank'}});const {job,status}=await b.poll();assert.equal(status,'running');assert.equal(job.method,'tabs.create');
 assert.equal(b.result({id:job.id,result:{id:3}}),true);assert.deepEqual(await pending,{id:3});assert.equal(b.result({id:job.id,result:{id:4}}),false);
 const failed=b.call('script');const failure=assert.rejects(failed,/Extension: fixture/);const j=(await b.poll()).job;b.result({id:j.id,error:'fixture'});await failure;
 const lost=b.call('debugger.send',{},30);const rejection=assert.rejects(lost,/không phản hồi/);const delivered=(await b.poll()).job;await rejection;
 assert.equal(b.queue.length,0);assert.equal(b.result({id:delivered.id,result:true}),false);b.close();
});
test('closing bridge aborts pending work, including queued browser operations',async()=>{
 const b=new ExtensionBridge(()=>({status:'stopped'}));const command=b.call('script');const rejection=assert.rejects(command,/Đã đóng/);b.close();await rejection;assert.equal(b.queue.length,0);
 assert.match(extensionArguments('C:\\App Data\\managed-extension'),/--load-extension="C:/);assert.match(extensionArguments('/tmp/extension'),/--proxy-bypass-list="localhost;127\.0\.0\.1;\[::1\]"/);assert.throws(()=>extensionArguments('bad\npath'));
});

test('a disconnected long poll cannot consume the next browser command',async()=>{
 const b=new ExtensionBridge(()=>({status:'running'})),controller=new AbortController();
 const disconnected=b.poll(controller.signal);controller.abort();
 const command=b.call('tabs.create',{options:{url:'about:blank'}},1000);command.catch(()=>{});
 try{
  assert.equal((await disconnected).job,null);
  const {job}=await b.poll();assert.equal(job.method,'tabs.create');b.result({id:job.id,result:{id:7}});assert.deepEqual(await command,{id:7});
 }finally{b.close();}
});
test('closing a bridge releases all waiting polls immediately',async()=>{
 const b=new ExtensionBridge(()=>({status:'stopped'}));const first=b.poll(),second=b.poll();b.close();
 const result=await Promise.race([Promise.all([first,second]),new Promise(r=>setTimeout(()=>r('timeout'),100))]);
 assert.notEqual(result,'timeout');assert.ok(result.every(r=>r.job===null));
});

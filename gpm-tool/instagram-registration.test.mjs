import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';
import {registrationDraft,registrationUsername,randomRegistrationBirthday,validateRegistration,prepareInstagramRegistration,INSTAGRAM_SIGNUP_URL} from './instagram-registration.mjs';import {Store} from './store.mjs';import {ProfileManager} from './profile-manager.mjs';import {AUTO_DEFAULTS} from '../extension/auto-runner.js';import {publicSettings} from './settings.mjs';
import {generateRegistrationIdentity} from './ai.mjs';import {API_BASE} from '../extension/ai.js';
const input={email:'fixture+1@gmail.com',fullName:'Trần Ngọc Linh',username:'fixture_1',birthday:'2004-02-29',password:'fixture-password'};
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const options=(values)=>values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
const fast={wait:async()=>{},random:()=>0,confirmationTimeoutMs:1000};
const assertBirthday=value=>{assert.ok(value>='2004-01-01'&&value<='2007-12-31');assert.equal(new Date(value+'T00:00:00Z').toISOString().slice(0,10),value);};
const markup=`<style>label{display:block;margin:28px 0;}input{padding:8px;}select{padding:6px;}</style><main><h1>Get started on Instagram</h1><label>Mobile number or email<input name="email"></label><label>Password<input type="password"></label><label>Full name<input name="full_name"></label><label>Username<input role="combobox" name="username"></label><label>Select Month<select><option value="">Month</option>${options(months.map((name,i)=>[i+1,name]))}</select></label><label>Select Day<select><option value="">Day</option>${options(Array.from({length:31},(_,i)=>[i+1,i+1]))}</select></label><label>Select Year<select><option value="">Year</option>${options([2004,2005,2006,2007].map(year=>[year,year]))}</select></label><label>Gender<select><option>Male</option><option value="female">Female</option></select></label><button id="submit" onclick="window.submissions++;this.disabled=true;document.getElementById('verification').hidden=false">Submit</button><section id="verification" hidden><label>Confirmation code<input name="email_confirmation_code" autocomplete="one-time-code"></label><button id="code-confirm" onclick="window.codeSubmissions++">Confirm</button></section></main><script>window.submissions=0;window.codeSubmissions=0;window.enters=0;window.entryEvents=[];window.mouseMoves=0;window.wheelEvents=0;document.addEventListener('mousemove',()=>window.mouseMoves++);document.addEventListener('wheel',()=>window.wheelEvents++);document.addEventListener('input',e=>window.entryEvents.push({name:e.target.name,length:e.target.value.length,trusted:e.isTrusted}));document.addEventListener('submit',e=>{e.preventDefault();window.submissions++;});document.addEventListener('keydown',e=>{if(e.key==='Enter'){window.submissions++;window.enters++;}});</script>`;
test('signup draft extracts exactly one Gmail from a profile and keeps personal names out of the draft and generates valid birthdays within 2004–2007',()=>{
 const draft=registrationDraft({id:'a',name:'fixture+1@gmail.com'});assert.equal(draft.email,input.email);assert.equal(draft.username,'');assert.equal(draft.fullName,'');assertBirthday(draft.birthday);assert.equal(registrationDraft({id:'a'},{birthday:input.birthday}).birthday,input.birthday);for(let i=0;i<1000;i++)assertBirthday(randomRegistrationBirthday());assertBirthday(validateRegistration({...input,birthday:''}).birthday);assert.equal(draft.gender,'female');assert.equal(registrationDraft({name:'Profile 4457'}).email,'');assert.equal(registrationDraft({name:'a@gmail.com b@gmail.com'}).email,'');
 assert.equal(validateRegistration(input).birthday,'2004-02-29');for(const changed of [{birthday:'2005-02-29'},{birthday:'2007-13-01'},{email:'x@other.com'},{username:'bad username'},{fullName:''},{password:'x'}])assert.throws(()=>validateRegistration({...input,...changed}));
});
test('real browser moves, scrolls, types incrementally with pauses, selects birthday, submits once, and hands off at the empty email code field',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{const context=await browser.newContext({viewport:{width:520,height:480}});await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body:markup}));
  const waits=[];const result=await prepareInstagramRegistration(context,input,{...fast,wait:async ms=>{waits.push(ms);}});assert.equal(result.ready,true);assert.equal(result.status,'awaiting_email_code');assert.equal(result.submitted,true);assert.equal(result.url,INSTAGRAM_SIGNUP_URL);assert.ok(!JSON.stringify(result).includes(input.password));
  const page=context.pages()[0];assert.equal(await page.locator('input[name="email"]').inputValue(),input.email);assert.equal(await page.locator('input[name="full_name"]').inputValue(),input.fullName);assert.equal(await page.locator('input[name="username"]').inputValue(),input.username);assert.equal(await page.locator('input[type="password"]').inputValue(),input.password);assert.deepEqual(await page.locator('select').evaluateAll(nodes=>nodes.map(e=>e.value)),['2','29','2004','female']);assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.enters),0);assert.equal(await page.evaluate(()=>window.codeSubmissions),0);assert.equal(await page.locator('input[name="email_confirmation_code"]').inputValue(),'');const events=await page.evaluate(()=>({entries:window.entryEvents,moves:window.mouseMoves,wheels:window.wheelEvents}));assert.deepEqual(events.entries.filter(e=>e.name==='email'&&e.length).map(e=>e.length),Array.from({length:input.email.length},(_,i)=>i+1));assert.ok(events.entries.filter(e=>e.name).every(e=>e.trusted));assert.ok(events.moves>=40);assert.ok(events.wheels>0);assert.ok(waits.reduce((sum,ms)=>sum+ms,0)>15000);assert.ok(waits.every(ms=>ms<=100));
  const manual=await prepareInstagramRegistration(context,{...input,birthday:'',password:''},fast);assert.equal(manual.warnings.length,1);assert.equal(manual.status,'form_incomplete');assert.equal(manual.submitted,false);const manualPage=context.pages()[1];assert.equal(await manualPage.locator('input[type="password"]').inputValue(),'');const [month,day,year]=await manualPage.locator('select').evaluateAll(nodes=>nodes.map(e=>e.value));assertBirthday(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`);assert.equal(await manualPage.evaluate(()=>window.submissions),0);
 }finally{await browser.close();}
});
test('logged-in redirect and challenges hand control to the user; missing/ambiguous fields never submit or expose passwords',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const redirected=await browser.newContext();await redirected.route('https://www.instagram.com/**',r=>r.request().url().includes('emailsignup')?r.fulfill({status:302,headers:{location:'/'}}):r.fulfill({body:'Logged in'}));assert.equal((await prepareInstagramRegistration(redirected,input,fast)).ready,false);
  for(const body of ['<div data-sitekey="fixture">Challenge</div>',markup.replace('<label>Full name<input name="full_name"></label>','')]){const context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body}));if(body.includes('data-sitekey'))assert.equal((await prepareInstagramRegistration(context,input,fast)).ready,false);else await assert.rejects(()=>prepareInstagramRegistration(context,input,fast),e=>!e.message.includes(input.password)&&e.message.includes('Chưa chuẩn bị xong'));await context.close();}
  const context=await browser.newContext();await assert.rejects(()=>prepareInstagramRegistration(context,input,{shouldContinue:()=>false}),/Đã hủy/);assert.equal(context.pages().length,0);
 }finally{await browser.close();}
});
test('profile manager opens only the selected idle profile, remembers a password only when requested, and never starts automation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hx-instagram-')),store=await new Store(dir).load(),calls=[];
 const identity={fullName:'Nguyễn Mai Anh',username:'maianh_63942'},identityCalls=[];
 const settings={profileId:'a',profileName:input.email,gpmApi:'http://localhost:9495',cdp:'http://localhost:9222',model:'fixture',apiKey:'',prompt:'Fixture',runConfig:AUTO_DEFAULTS};await store.set({settings});
 const manager=new ProfileManager(store,{identityGenerator:async configured=>{identityCalls.push(configured);return identity;},gpmFactory:()=>({call:async()=>({id:'a',name:input.email,raw_proxy:''})}),workerFactory:()=>({close:async()=>{},call:async(route,data)=>{calls.push({route,data});if(route==='state')return {state:{status:'idle'}};if(route==='instagram-prepare')return {ok:true,ready:true,message:'Prepared'};return {ok:true};}})});
 try{await manager.register(settings);const draft=await manager.instagramDraft('a');assert.equal(draft.email,input.email);assert.equal(draft.hasSavedPassword,false);assert.equal(draft.fullName,identity.fullName);assert.equal(draft.username,identity.username);assertBirthday(draft.birthday);assert.equal(calls.length,0);
  await store.set({sharedSettings:{...settings,model:'saved-model',apiKey:'fixture-latest-key'}});await manager.instagramDraft('a');assert.equal(identityCalls.at(-1).model,'saved-model');assert.equal(identityCalls.at(-1).apiKey,'fixture-latest-key');
  await manager.prepareInstagram('a',{...input,birthday:draft.birthday,rememberPassword:false});assert.equal(calls.filter(c=>c.route==='instagram-prepare').at(-1).data.birthday,draft.birthday);assert.equal(store.value.instagramSignupPassword,undefined);assert.ok(!calls.some(c=>c.route==='start'));assert.equal(calls.filter(c=>c.route==='profile-open').length,1);
  await manager.prepareInstagram('a',{...input,rememberPassword:true});assert.equal(store.value.instagramSignupPassword,input.password);assert.equal((await manager.instagramDraft('a')).hasSavedPassword,true);assert.ok(!JSON.stringify(await manager.instagramDraft('a')).includes(input.password));assert.ok(!JSON.stringify(publicSettings(store.value.settings)).includes(input.password));
  await manager.prepareInstagram('a',{...input,password:'',birthday:''});const prepared=calls.filter(c=>c.route==='instagram-prepare').at(-1).data;assert.equal(prepared.password,input.password);assertBirthday(prepared.birthday);
  manager.views.set('a',{state:{status:'running'}});const before=calls.length;await assert.rejects(()=>manager.prepareInstagram('a',input),/Dừng bộ chạy/);assert.equal(calls.length,before);await assert.rejects(()=>manager.instagramDraft('missing'),/Chọn một profile/);
 }finally{await manager.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('AI generates a Vietnamese alias with the saved model, sends no profile data, and reports invalid responses safely',async()=>{
 const settings={model:'fixture-model',apiKey:'fixture-secret',profileName:'personal@gmail.com',proxy:'private-proxy',password:'private-password',prompt:'Do not use this unrelated comment prompt.'},identity={fullName:'Trần Ngọc Linh',username:'ngoclinh_63829'},requests=[];
 const fetchImpl=async(url,options)=>{assert.equal(url,API_BASE+'/chat/completions');assert.equal(options.headers.Authorization,'Bearer '+settings.apiKey);assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);const body=JSON.parse(options.body);requests.push(body);assert.equal(body.model,settings.model);for(const secret of [settings.apiKey,settings.profileName,settings.proxy,settings.password,settings.prompt])assert.ok(!options.body.includes(secret));return {ok:true,json:async()=>({choices:[{message:{content:'```json\n'+JSON.stringify({fullName:identity.fullName})+'\n```'}}]})};};
 const generated=await generateRegistrationIdentity(settings,{fetchImpl});assert.equal(generated.fullName,identity.fullName);assert.match(generated.username,/^ngoc\.linh\.[1-9]\d{3}$/);await generateRegistrationIdentity(settings,{fetchImpl});assert.notEqual(requests[0].messages[1].content,requests[1].messages[1].content);
 let called=false;await assert.rejects(()=>generateRegistrationIdentity({...settings,apiKey:''},{fetchImpl:async()=>{called=true;}}),/Lưu API key/);assert.equal(called,false);await assert.rejects(()=>generateRegistrationIdentity({...settings,model:''},{fetchImpl}),/lưu model/);
 for(const content of ['not JSON','null',JSON.stringify({fullName:'Name',username:'valid_1234'}),JSON.stringify({fullName:123}),JSON.stringify({fullName:'Trần 123'})])await assert.rejects(()=>generateRegistrationIdentity(settings,{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content}}]})})}),/AI tạo tên/);
 await assert.rejects(()=>generateRegistrationIdentity(settings,{fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:settings.apiKey})})}),e=>e.message.includes('HTTP 401')&&!e.message.includes(settings.apiKey));
 await assert.rejects(()=>generateRegistrationIdentity(settings,{fetchImpl:async()=>{throw Object.assign(Error(settings.apiKey),{name:'TimeoutError'});}}),e=>e.message.includes('90 giây')&&!e.message.includes(settings.apiKey));
});

test('Stop while typing cancels remaining fields and never submits',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body:markup}));let active=true;
  await assert.rejects(()=>prepareInstagramRegistration(context,input,{...fast,shouldContinue:()=>active,wait:async()=>{const page=context.pages()[0];if(page&&await page.locator('input[name="email"]').inputValue().catch(()=>'')==='f')active=false;}}),/Đã hủy do Dừng/);
  const page=context.pages()[0];assert.equal(await page.locator('input[name="email"]').inputValue(),'f');assert.equal(await page.locator('input[name="full_name"]').inputValue(),'');assert.equal(await page.locator('input[type="password"]').inputValue(),'');assert.equal(await page.evaluate(()=>window.submissions),0);
 }finally{await browser.close();}
});

test('signup submits once on validation errors, CAPTCHA and unacknowledged responses without touching confirmation',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const original="window.submissions++;this.disabled=true;document.getElementById('verification').hidden=false";
 try{for(const [action,status] of [["window.submissions++;document.querySelector('main').innerHTML='<label>Confirmation code<input name=email_confirmation_code autocomplete=one-time-code></label>'",'awaiting_email_code'],["window.submissions++;document.body.insertAdjacentHTML('beforeend','<div role=alert>Username is not available</div>')",'validation_error'],["window.submissions++;document.body.insertAdjacentHTML('beforeend','<div data-sitekey=fixture>CAPTCHA</div>')",'challenge'],['window.submissions++','submitted_unverified']]){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body:markup.replace(original,action)}));const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,status);assert.equal(result.submitted,true);assert.ok(!JSON.stringify(result).includes(input.password));const page=context.pages()[0];assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),0);await context.close();
  }
 }finally{await browser.close();}
});
test('incomplete, disabled and ambiguous signup forms are handed off without submitting',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const [body,status] of [[markup.replace('<button id="submit"','<button disabled id="submit"'),'submit_unavailable'],[markup.replace('</main>','<button>Submit</button></main>'),'submit_unavailable'],[markup.replace('<label>Select Year<select>','<label>Unknown<select>'),'form_incomplete']]){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body}));const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,status);assert.equal(result.submissionAttempted,false);assert.equal(await context.pages()[0].evaluate(()=>window.submissions),0);await context.close();
  }
 }finally{await browser.close();}
});
test('Stop before confirmation cancels the click; Stop after it never retries signup',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const afterSubmit of [false,true]){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body:markup}));let active=true;
   const operation=()=>prepareInstagramRegistration(context,input,{...fast,shouldContinue:()=>active,wait:async()=>{const page=context.pages()[0];if(!page)return;const state=await page.evaluate(()=>({submitted:window.submissions,gender:document.querySelectorAll('select')[3]?.value}));if(afterSubmit?state.submitted===1:state.gender==='female')active=false;}});
   if(afterSubmit){const result=await operation();assert.equal(result.status,'submission_unknown');assert.equal(result.submissionAttempted,true);}else await assert.rejects(operation,/Đã hủy do Dừng/);
   assert.equal(await context.pages()[0].evaluate(()=>window.submissions),afterSubmit?1:0);assert.equal(await context.pages()[0].evaluate(()=>window.codeSubmissions),0);await context.close();
  }
 }finally{await browser.close();}
});

test('direct Gmail OAuth code is entered slowly and confirmed once; only safe metadata is saved or returned',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const code='012345',email='fixture+1244@gmail.com',snapshots=[],progress=[];let calls=0;
 const success=markup.replace('window.codeSubmissions++',"window.codeSubmissions++;document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a>');history.pushState({},'', '/?confirmation_code=012345')");
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body:success}));const start=Math.floor(Date.now()/1000);
  const result=await prepareInstagramRegistration(context,{...input,email},{...fast,onState:async patch=>snapshots.push(patch),onProgress:message=>progress.push(message),getEmailCode:async request=>{calls++;assert.equal(request.recipient,email);assert.ok(request.after>=start&&request.after<=Math.floor(Date.now()/1000));assert.equal(request.shouldContinue(),true);assert.equal(snapshots[0].requestedAt,request.after);return {code};}});
  assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(result.emailCodeSubmitted,true);const page=context.pages()[0];assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),1);assert.equal(await page.locator('input[name="email_confirmation_code"]').inputValue(),code);
  assert.ok(snapshots.some(patch=>patch.status==='awaiting_email_code'));assert.ok(snapshots.some(patch=>patch.status==='confirming_email_code'));for(const value of [result,snapshots,progress]){assert.ok(!JSON.stringify(value).includes(code));assert.ok(!JSON.stringify(value).includes(input.password));}
 }finally{await browser.close();}
});
test('Gmail OAuth failures hand off safely; rejected codes are never retried or resent',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const failedApi of [true,false]){const body=markup.replace('window.codeSubmissions++',"window.codeSubmissions++;document.body.insertAdjacentHTML('beforeend','<div role=alert>Invalid code</div>')"),context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body}));let calls=0;
   const result=await prepareInstagramRegistration(context,input,{...fast,getEmailCode:async()=>{calls++;if(failedApi)throw Error('private-api-key 012345');return {code:'012345'};}});assert.equal(calls,1);assert.equal(result.status,failedApi?'awaiting_email_code':'code_rejected');assert.ok(!JSON.stringify(result).includes('012345'));assert.ok(!JSON.stringify(result).includes('private-api-key'));const page=context.pages()[0];assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),failedApi?0:1);await context.close();
  }
 }finally{await browser.close();}
});

test('username uses exactly the last two name words without accents and four random digits',()=>{
 assert.equal(registrationUsername('Nguyen Minh An',7356),'minh.an.7356');assert.equal(registrationUsername('  NGUYỄN   Minh An  ',7356),'minh.an.7356');assert.equal(registrationUsername('Đặng Thị Ngọc Ánh',1000),'ngoc.anh.1000');assert.equal(registrationUsername('Đỗ Đan',9999),'do.dan.9999');for(let i=0;i<50;i++)assert.match(registrationUsername('Nguyễn Minh An'),/^minh\.an\.[1-9]\d{3}$/);assert.ok(registrationUsername('Nguyễn '+('a'.repeat(40))+' '+('b'.repeat(40))).length<=30);assert.throws(()=>registrationUsername('An'));
});
test('signup ignores informational alerts and unrelated invalid inputs, tolerates stale aria flags, and names genuine invalid fields',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const cases=[
  [markup.replace('<main>','<div role="alert">Use a strong password to protect your account.</div><input name="telemetry" type="email" required aria-hidden="true" style="position:absolute;left:-10000px"><main>'),'awaiting_email_code',1],
  [markup.replace('name="username"','name="username" aria-invalid="true"'),'awaiting_email_code',1],
  [markup.replace('name="username"','name="username" pattern="[a-z]+"'),'validation_error',0]
 ];
 try{for(const [body,status,submissions] of cases){const context=await browser.newContext();await context.route('https://www.instagram.com/**',r=>r.fulfill({contentType:'text/html',body}));const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,status);assert.equal(await context.pages()[0].evaluate(()=>window.submissions),submissions);if(status==='validation_error'){assert.match(result.message,/Username/);assert.match(result.message,/định dạng/);assert.ok(!result.message.includes(input.password));assert.ok(!result.message.includes(input.email));}await context.close();}}
 finally{await browser.close();}
});

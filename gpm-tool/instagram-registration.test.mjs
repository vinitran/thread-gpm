import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';
import {registrationDraft,registrationUsername,randomRegistrationBirthday,validateRegistration,prepareInstagramRegistration,INSTAGRAM_SIGNUP_URL,INSTAGRAM_HOME_URL} from './instagram-registration.mjs';import {Store} from './store.mjs';import {ProfileManager} from './profile-manager.mjs';import {AUTO_DEFAULTS} from '../extension/auto-runner.js';import {publicSettings} from './settings.mjs';
import {generateRegistrationIdentity} from './ai.mjs';import {API_BASE} from '../extension/ai.js';
const input={email:'fixture+1@gmail.com',fullName:'Trần Ngọc Linh',username:'fixture_1',birthday:'2004-02-29',password:'fixture-password'};
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const options=(values)=>values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
const fast={wait:async()=>{},random:()=>0,confirmationTimeoutMs:1000};
const homeMarkup=`<h1>Instagram</h1><a href="/accounts/emailsignup/" onclick="sessionStorage.setItem('signupClicks',String(Number(sessionStorage.getItem('signupClicks')||0)+1));sessionStorage.setItem('signupClickTrusted',String(event.isTrusted))">Sign up</a>`;
const serveSignup=body=>route=>route.fulfill({contentType:'text/html; charset=utf-8',body:new URL(route.request().url()).pathname==='/'?homeMarkup:body});
const assertBirthday=value=>{assert.ok(value>='2004-01-01'&&value<='2007-12-31');assert.equal(new Date(value+'T00:00:00Z').toISOString().slice(0,10),value);};
const markup=`<style>label{display:block;margin:28px 0;}input{padding:8px;}select{padding:6px;}</style><main><h1>Get started on Instagram</h1><label>Mobile number or email<input name="email"></label><label>Password<input type="password"></label><label>Full name<input name="full_name"></label><label>Username<input role="combobox" name="username"></label><label>Select Month<select><option value="">Month</option>${options(months.map((name,i)=>[i+1,name]))}</select></label><label>Select Day<select><option value="">Day</option>${options(Array.from({length:31},(_,i)=>[i+1,i+1]))}</select></label><label>Select Year<select><option value="">Year</option>${options([2004,2005,2006,2007].map(year=>[year,year]))}</select></label><label>Gender<select><option>Male</option><option value="female">Female</option></select></label><button id="submit" onclick="window.submissions++;this.disabled=true;document.getElementById('verification').hidden=false">Submit</button><section id="verification" hidden><label>Confirmation code<input name="email_confirmation_code" autocomplete="one-time-code"></label><button id="code-confirm" onclick="window.codeSubmissions++">Confirm</button></section></main><script>window.submissions=0;window.codeSubmissions=0;window.enters=0;window.entryEvents=[];window.mouseMoves=0;window.wheelEvents=0;document.addEventListener('mousemove',()=>window.mouseMoves++);document.addEventListener('wheel',()=>window.wheelEvents++);document.addEventListener('input',e=>window.entryEvents.push({name:e.target.name,length:e.target.value.length,trusted:e.isTrusted}));document.addEventListener('submit',e=>{e.preventDefault();window.submissions++;});document.addEventListener('keydown',e=>{if(e.key==='Enter'){window.submissions++;window.enters++;}});</script>`;
test('birthday native controls accept plain labels, Vietnamese zero-based month options, and lost focus after Escape on Mac',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const localized=`<script>
 const [month,day,year]=document.querySelectorAll('select');for(const [select,name] of [[month,'Month'],[day,'Day'],[year,'Year']])select.parentElement.firstChild.textContent=name;
 for(const [index,option] of [...month.options].slice(1).entries()){option.textContent='Tháng '+(index+1);option.value=String(index);}
 window.lostSelectFocus=0;document.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.target.tagName==='SELECT'){event.preventDefault();event.target.blur();window.lostSelectFocus++;}},true);
 </script>`;
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup+localized));const result=await prepareInstagramRegistration(context,input,fast),page=context.pages()[0];
  assert.equal(result.status,'awaiting_email_code',result.message);assert.deepEqual(await page.locator('select').evaluateAll(nodes=>nodes.slice(0,3).map(e=>e.value)),['1','29','2004']);assert.ok(await page.evaluate(()=>window.lostSelectFocus>=3));assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.enters),0);
 }finally{await browser.close();}
});
test('birthday custom dropdowns wait for their own delayed list and match captioned options without clicking unrelated duplicates',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const custom=`<script>
 window.birthdayClock=0;window.pendingBirthday=null;window.chosenBirthday={};window.decoyClicks=0;
 document.body.insertAdjacentHTML('beforeend','<div role=listbox><button role=option onclick="window.decoyClicks++">Year 2004</button></div>');
 for(const [index,select] of [...document.querySelectorAll('select')].slice(0,3).entries()){
  const caption=['Month','Day','Year'][index],values=[...select.options].slice(1).map(option=>caption==='Month'?monthsPlaceholder[Number(option.value)-1]:option.text),button=document.createElement('button');button.type='button';button.role='combobox';button.setAttribute('aria-label',caption);button.setAttribute('aria-controls','birthday-'+caption);button.textContent=caption;select.replaceWith(button);
  button.onclick=()=>{window.pendingBirthday={at:window.birthdayClock+2500,render:()=>{const list=document.createElement('div');list.role='listbox';list.id='birthday-'+caption;for(const value of values){const option=document.createElement('button');option.type='button';option.role='option';option.textContent=caption+' '+value;option.onclick=()=>{button.textContent=option.textContent;window.chosenBirthday[caption]=value;list.remove();button.focus();};list.append(option);}button.after(list);}};};
 }
 </script>`.replace('monthsPlaceholder',JSON.stringify(months));
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup+custom));const result=await prepareInstagramRegistration(context,input,{...fast,wait:async ms=>{const page=context.pages()[0];if(page)await page.evaluate(ms=>{if(typeof window.birthdayClock!=='number')return;window.birthdayClock+=ms;const pending=window.pendingBirthday;if(pending&&window.birthdayClock>=pending.at){window.pendingBirthday=null;pending.render();}},ms).catch(()=>{});}}),page=context.pages()[0];
  assert.equal(result.status,'awaiting_email_code',result.message);assert.deepEqual(await page.evaluate(()=>window.chosenBirthday),{Year:'2004',Month:'February',Day:'29'});assert.equal(await page.evaluate(()=>window.decoyClicks),0);assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.enters),0);
 }finally{await browser.close();}
});
test('birthday native day options can load asynchronously after the month changes',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const delayed=`<script>window.birthdayClock=0;window.dayOptionsAt=null;const [month,day]=document.querySelectorAll('select');window.savedDays=day.innerHTML;month.addEventListener('change',()=>{day.innerHTML='<option value="">Loading days</option>';window.dayOptionsAt=window.birthdayClock+3000;});</script>`;
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup+delayed));const result=await prepareInstagramRegistration(context,input,{...fast,wait:async ms=>{const page=context.pages()[0];if(page)await page.evaluate(ms=>{if(typeof window.birthdayClock!=='number')return;window.birthdayClock+=ms;if(window.dayOptionsAt&&window.birthdayClock>=window.dayOptionsAt){document.querySelectorAll('select')[1].innerHTML=window.savedDays;window.dayOptionsAt=null;}},ms).catch(()=>{});}}),page=context.pages()[0];assert.equal(result.status,'awaiting_email_code',result.message);assert.deepEqual(await page.locator('select').evaluateAll(nodes=>nodes.slice(0,3).map(e=>e.value)),['2','29','2004']);assert.equal(await page.evaluate(()=>window.submissions),1);
 }finally{await browser.close();}
});
test('registration starts at Instagram home and clicks the visible signup link or button before filling the form',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const buttonHome=`<button onclick="sessionStorage.setItem('signupClicks','1');sessionStorage.setItem('signupClickTrusted',String(event.isTrusted));location.assign('/accounts/emailsignup/')">Tạo tài khoản mới</button><div id="cookies" style="position:fixed;inset:0;background:white;z-index:999"><button onclick="sessionStorage.setItem('cookiesDeclined','true');document.getElementById('cookies').remove()">Decline optional cookies</button></div>`;
 try{for(const home of [homeMarkup,buttonHome]){const context=await browser.newContext(),requests=[],progress=[];await context.route('https://www.instagram.com/**',route=>{if(route.request().resourceType()==='document')requests.push(route.request().url());return route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url()===INSTAGRAM_HOME_URL?home:markup});});
  const result=await prepareInstagramRegistration(context,input,{...fast,onProgress:message=>progress.push(message)}),page=context.pages()[0];assert.equal(result.status,'awaiting_email_code',result.message);assert.deepEqual(requests,[INSTAGRAM_HOME_URL,INSTAGRAM_SIGNUP_URL]);assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('signupClicks'),sessionStorage.getItem('signupClickTrusted')]),['1','true']);if(home===buttonHome)assert.equal(await page.evaluate(()=>sessionStorage.getItem('cookiesDeclined')),'true');assert.equal(await page.locator('input[name=email]').inputValue(),input.email);assert.equal(await page.evaluate(()=>window.submissions),1);assert.match(progress[0],/trang chủ/);await context.close();
 }}finally{await browser.close();}
});
test('home entry never bypasses missing or ambiguous signup controls, an existing account, or a challenge',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const cases=[['<h1>Instagram</h1>','signup_entry_unavailable',0],['<a href="/accounts/emailsignup/">Sign up</a><button>Sign up</button>','signup_entry_unavailable',0],['<a href="/direct/inbox/">Inbox</a>','already_signed_in',0],['<div data-sitekey="fixture">Confirm you are human</div>','challenge',0],['<a href="https://example.com/">Sign up</a>','signup_entry_unavailable',0],['<button onclick="window.signupClicks++">Sign up</button>','signup_entry_unavailable',1]];
 try{for(const [home,status,clicks] of cases){const context=await browser.newContext(),requests=[];await context.route('https://www.instagram.com/**',route=>{requests.push(route.request().url());return route.fulfill({contentType:'text/html; charset=utf-8',body:home+'<script>window.signupClicks=0;</script>'});});
  const result=await prepareInstagramRegistration(context,input,fast),page=context.pages()[0];assert.equal(result.status,status);assert.equal(result.submissionAttempted,false);assert.equal(result.ready,false);assert.deepEqual(requests,[INSTAGRAM_HOME_URL]);assert.equal(await page.evaluate(()=>window.signupClicks),clicks);assert.equal(await page.locator('input').count(),0);await context.close();
 }}finally{await browser.close();}
});
test('Stop before the homepage signup click leaves the browser at home without filling or submitting',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{const context=await browser.newContext(),requests=[];await context.route('https://www.instagram.com/**',route=>{requests.push(route.request().url());return serveSignup(markup)(route);});let active=true;
  await assert.rejects(()=>prepareInstagramRegistration(context,input,{...fast,shouldContinue:()=>active,onProgress:message=>{if(message.includes('đang bấm Đăng ký'))active=false;}}),/Đã hủy do Dừng/);const page=context.pages()[0];assert.equal(page.url(),INSTAGRAM_HOME_URL);assert.deepEqual(requests,[INSTAGRAM_HOME_URL]);assert.equal(await page.evaluate(()=>sessionStorage.getItem('signupClicks')),null);
 }finally{await browser.close();}
});
test('signup draft extracts exactly one Gmail from a profile and keeps personal names out of the draft and generates valid birthdays within 2004–2007',()=>{
 const draft=registrationDraft({id:'a',name:'fixture+1@gmail.com'});assert.equal(draft.email,input.email);assert.equal(draft.username,'');assert.equal(draft.fullName,'');assertBirthday(draft.birthday);assert.equal(registrationDraft({id:'a'},{birthday:input.birthday}).birthday,input.birthday);for(let i=0;i<1000;i++)assertBirthday(randomRegistrationBirthday());assertBirthday(validateRegistration({...input,birthday:''}).birthday);assert.equal(draft.gender,'female');assert.equal(registrationDraft({name:'Profile 4457'}).email,'');assert.equal(registrationDraft({name:'a@gmail.com b@gmail.com'}).email,'');
 assert.equal(validateRegistration(input).birthday,'2004-02-29');for(const changed of [{birthday:'2005-02-29'},{birthday:'2007-13-01'},{email:'x@other.com'},{username:'bad username'},{fullName:''},{password:'x'}])assert.throws(()=>validateRegistration({...input,...changed}));
});
test('real browser moves, scrolls, types incrementally with pauses, selects birthday, submits once, and hands off at the empty email code field',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{const context=await browser.newContext({viewport:{width:520,height:480}});
  await context.addInitScript(()=>{window.fixtureInputClicks=[];let lastDown;document.addEventListener('mousedown',event=>{const rect=event.target.getBoundingClientRect();lastDown={target:event.target,trusted:event.isTrusted,inside:event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom};});document.addEventListener('input',event=>{if(event.target.tagName==='INPUT')window.fixtureInputClicks.push({name:event.target.name,type:event.target.type,clicked:lastDown?.target===event.target&&lastDown.trusted&&lastDown.inside,focused:document.activeElement===event.target});});});
  await context.addInitScript(()=>{window.fixturePointerSamples=[];document.addEventListener('input',event=>{if(event.target.tagName!=='INPUT')return;const pointers=document.querySelectorAll('[data-hoanxu-form-pointer]'),pointer=pointers[0];window.fixturePointerSamples.push({count:pointers.length,visible:pointer&&getComputedStyle(pointer).visibility==='visible',transparent:pointer&&getComputedStyle(pointer).pointerEvents==='none'});});});
  await context.route('https://www.instagram.com/**',serveSignup(markup.replace('margin:28px 0','margin:60px 0')));
  const waits=[];const result=await prepareInstagramRegistration(context,input,{...fast,wait:async ms=>{waits.push(ms);}});assert.equal(result.ready,true);assert.equal(result.status,'awaiting_email_code');assert.equal(result.submitted,true);assert.equal(result.url,INSTAGRAM_SIGNUP_URL);assert.ok(!JSON.stringify(result).includes(input.password));
  const page=context.pages()[0];assert.equal(await page.locator('input[name="email"]').inputValue(),input.email);assert.equal(await page.locator('input[name="full_name"]').inputValue(),input.fullName);assert.equal(await page.locator('input[name="username"]').inputValue(),input.username);assert.equal(await page.locator('input[type="password"]').inputValue(),input.password);assert.deepEqual(await page.locator('select').evaluateAll(nodes=>nodes.map(e=>e.value)),['2','29','2004','female']);assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.enters),0);assert.equal(await page.evaluate(()=>window.codeSubmissions),0);assert.equal(await page.locator('input[name="email_confirmation_code"]').inputValue(),'');const events=await page.evaluate(()=>({entries:window.entryEvents,moves:window.mouseMoves,wheels:window.wheelEvents}));assert.deepEqual(events.entries.filter(e=>e.name==='email'&&e.length).map(e=>e.length),Array.from({length:input.email.length},(_,i)=>i+1));assert.ok(events.entries.filter(e=>e.name).every(e=>e.trusted));assert.ok(events.moves>=40);assert.ok(events.wheels>0);assert.ok(waits.reduce((sum,ms)=>sum+ms,0)>15000);assert.ok(waits.every(ms=>ms<=100));
  const clicks=await page.evaluate(()=>window.fixtureInputClicks);assert.ok(clicks.length>0);assert.ok(clicks.every(event=>event.clicked&&event.focused));assert.deepEqual([...new Set(clicks.map(event=>event.type==='password'?'password':event.name))].sort(),['email','full_name','password','username']);
  const pointers=await page.evaluate(()=>window.fixturePointerSamples);assert.equal(pointers.length,clicks.length);assert.ok(pointers.every(pointer=>pointer.count===1&&pointer.visible&&pointer.transparent));assert.equal(await page.locator('[data-hoanxu-form-pointer]').count(),0);
  const manual=await prepareInstagramRegistration(context,{...input,birthday:'',password:''},fast);assert.equal(manual.warnings.length,1);assert.equal(manual.status,'form_incomplete');assert.equal(manual.submitted,false);const manualPage=context.pages()[1];assert.equal(await manualPage.locator('input[type="password"]').inputValue(),'');const [month,day,year]=await manualPage.locator('select').evaluateAll(nodes=>nodes.map(e=>e.value));assertBirthday(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`);assert.equal(await manualPage.evaluate(()=>window.submissions),0);
 }finally{await browser.close();}
});
test('logged-in redirect and challenges hand control to the user; missing/ambiguous fields never submit or expose passwords',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const redirected=await browser.newContext();await redirected.route('https://www.instagram.com/**',r=>new URL(r.request().url()).pathname==='/'?r.fulfill({status:302,headers:{location:'/accounts/edit/'}}):r.fulfill({body:'<a href="/direct/inbox/">Inbox</a>'}));assert.equal((await prepareInstagramRegistration(redirected,input,fast)).ready,false);
  for(const body of ['<div data-sitekey="fixture">Challenge</div>',markup.replace('<label>Full name<input name="full_name"></label>','')]){const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(body));if(body.includes('data-sitekey'))assert.equal((await prepareInstagramRegistration(context,input,fast)).ready,false);else await assert.rejects(()=>prepareInstagramRegistration(context,input,fast),e=>!e.message.includes(input.password)&&e.message.includes('Chưa chuẩn bị xong'));await context.close();}
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
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup));let active=true;
  await assert.rejects(()=>prepareInstagramRegistration(context,input,{...fast,shouldContinue:()=>active,wait:async()=>{const page=context.pages()[0];if(page&&await page.locator('input[name="email"]').count()&&await page.locator('input[name="email"]').inputValue().catch(()=>'')==='f')active=false;}}),/Đã hủy do Dừng/);
  const page=context.pages()[0];assert.equal(await page.locator('input[name="email"]').inputValue(),'f');assert.equal(await page.locator('input[name="full_name"]').inputValue(),'');assert.equal(await page.locator('input[type="password"]').inputValue(),'');assert.equal(await page.evaluate(()=>window.submissions),0);assert.equal(await page.locator('[data-hoanxu-form-pointer]').count(),0);
 }finally{await browser.close();}
});

test('signup submits once on validation errors, CAPTCHA and unacknowledged responses without touching confirmation',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const original="window.submissions++;this.disabled=true;document.getElementById('verification').hidden=false";
 try{for(const [action,status] of [["window.submissions++;document.querySelector('main').innerHTML='<label>Confirmation code<input name=email_confirmation_code autocomplete=one-time-code></label>'",'awaiting_email_code'],["window.submissions++;document.body.insertAdjacentHTML('beforeend','<div role=alert>Username is not available</div>')",'validation_error'],["window.submissions++;document.body.insertAdjacentHTML('beforeend','<div data-sitekey=fixture>CAPTCHA</div>')",'challenge'],['window.submissions++','submitted_unverified']]){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup.replace(original,action)));const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,status);assert.equal(result.submitted,true);assert.ok(!JSON.stringify(result).includes(input.password));const page=context.pages()[0];assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),0);await context.close();
  }
 }finally{await browser.close();}
});
test('incomplete, disabled and ambiguous signup forms are handed off without submitting',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const [body,status] of [[markup.replace('<button id="submit"','<button disabled id="submit"'),'submit_unavailable'],[markup.replace('</main>','<button>Submit</button></main>'),'submit_unavailable'],[markup.replace('<label>Select Year<select>','<label>Unknown<select>'),'form_incomplete']]){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(body));const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,status);assert.equal(result.submissionAttempted,false);assert.equal(await context.pages()[0].evaluate(()=>window.submissions),0);await context.close();
  }
 }finally{await browser.close();}
});
test('Stop before confirmation cancels the click; Stop after it never retries signup',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const afterSubmit of [false,true]){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup));let active=true;
   const operation=()=>prepareInstagramRegistration(context,input,{...fast,shouldContinue:()=>active,wait:async()=>{const page=context.pages()[0];if(!page)return;const state=await page.evaluate(()=>({submitted:window.submissions,gender:document.querySelectorAll('select')[3]?.value})).catch(()=>({}));if(afterSubmit?state.submitted===1:state.gender==='female')active=false;}});
   if(afterSubmit){const result=await operation();assert.equal(result.status,'submission_unknown');assert.equal(result.submissionAttempted,true);}else await assert.rejects(operation,/Đã hủy do Dừng/);
   assert.equal(await context.pages()[0].evaluate(()=>window.submissions),afterSubmit?1:0);assert.equal(await context.pages()[0].evaluate(()=>window.codeSubmissions),0);await context.close();
  }
 }finally{await browser.close();}
});

test('direct Gmail OAuth code is entered slowly and confirmed once; only safe metadata is saved or returned',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const code='012345',email='fixture+1244@gmail.com',snapshots=[],progress=[];let calls=0;
 const success=markup.replace('window.codeSubmissions++',"window.codeSubmissions++;document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a>');history.pushState({},'', '/?confirmation_code=012345')");
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(success));const start=Math.floor(Date.now()/1000);
  const result=await prepareInstagramRegistration(context,{...input,email},{...fast,onState:async patch=>snapshots.push(patch),onProgress:message=>progress.push(message),getEmailCode:async request=>{calls++;assert.equal(request.recipient,email);assert.ok(request.after>=start&&request.after<=Math.floor(Date.now()/1000));assert.equal(request.shouldContinue(),true);assert.equal(snapshots[0].requestedAt,request.after);return {code};}});
  assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(result.emailCodeSubmitted,true);const page=context.pages()[0];assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),1);assert.equal(await page.locator('input[name="email_confirmation_code"]').inputValue(),code);
  assert.ok(snapshots.some(patch=>patch.status==='awaiting_email_code'));assert.ok(snapshots.some(patch=>patch.status==='confirming_email_code'));for(const value of [result,snapshots,progress]){assert.ok(!JSON.stringify(value).includes(code));assert.ok(!JSON.stringify(value).includes(input.password));}
 }finally{await browser.close();}
});
test('Gmail OAuth failures hand off safely; rejected codes are never retried or resent',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const failedApi of [true,false]){const body=markup.replace('window.codeSubmissions++',"window.codeSubmissions++;document.body.insertAdjacentHTML('beforeend','<div role=alert>Invalid code</div>')"),context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(body));let calls=0;
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
  [markup.replace('<main>','<div role="alert">Input Username is valid.</div><main>'),'awaiting_email_code',1],
  [markup.replace('name="username"','name="username" pattern="[a-z]+"'),'validation_error',0]
 ];
 try{for(const [body,status,submissions] of cases){const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(body));const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,status);assert.equal(await context.pages()[0].evaluate(()=>window.submissions),submissions);if(status==='validation_error'){assert.match(result.message,/Username/);assert.match(result.message,/định dạng/);assert.ok(!result.message.includes(input.password));assert.ok(!result.message.includes(input.email));}await context.close();}}
 finally{await browser.close();}
});

test('birthday handles dependent day options and blur validation, and blocks submission if the selected date resets',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 // The current/default year is not a leap year. Month/year changes rebuild the days,
 // and the form clears its temporary year validation only after leaving that control.
 const dynamic=`<script>
 const [monthSelect,daySelect,yearSelect]=document.querySelectorAll('select');
 window.birthdayChanges=[];
 function updateDays(){
  const previous=daySelect.value,days=new Date(Number(yearSelect.value)||2026,Number(monthSelect.value)||1,0).getDate();
  daySelect.innerHTML='<option value="">Day</option>'+Array.from({length:days},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'</option>').join('');
  daySelect.value=Number(previous)<=days?previous:'';
 }
 for(const [name,field] of [['month',monthSelect],['day',daySelect],['year',yearSelect]])field.addEventListener('change',()=>window.birthdayChanges.push(name));
 monthSelect.addEventListener('change',updateDays);
 yearSelect.addEventListener('change',()=>{updateDays();yearSelect.setCustomValidity('Birthday is invalid');});
 yearSelect.addEventListener('blur',()=>yearSelect.setCustomValidity(''));
 </script>`;
 try{
  for(const birthday of ['2004-02-29','2007-04-13']){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup+dynamic));
   const result=await prepareInstagramRegistration(context,{...input,birthday},fast),page=context.pages()[0];assert.equal(result.status,'awaiting_email_code');assert.equal(result.submissionAttempted,true);
   const [year,month,day]=birthday.split('-').map(Number);assert.deepEqual(await page.locator('select').evaluateAll(nodes=>nodes.slice(0,3).map(e=>e.value)),[String(month),String(day),String(year)]);assert.deepEqual(await page.evaluate(()=>window.birthdayChanges),['year','month','day']);assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.enters),0);await context.close();
  }
  const context=await browser.newContext();const reset=dynamic.replace('</script>',"daySelect.addEventListener('change',()=>yearSelect.value='');</script>");await context.route('https://www.instagram.com/**',serveSignup(markup+reset));
  const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,'form_incomplete');assert.match(result.message,/Ngày sinh.*đã thay đổi/);assert.equal(result.submissionAttempted,false);assert.equal(await context.pages()[0].evaluate(()=>window.submissions),0);await context.close();
 }finally{await browser.close();}
});

test('birthday also verifies custom comboboxes whose captions and selected values share a line',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const custom=`<script>
 for(const select of [...document.querySelectorAll('select')].slice(0,3)){
  const caption=select.options[0].text,button=document.createElement('button');button.type='button';button.role='combobox';button.setAttribute('aria-label','Select '+caption);button.textContent=caption;
  select.replaceWith(button);
  button.onclick=()=>{const list=document.createElement('div');list.role='listbox';for(const option of [...select.options].slice(1)){
   const choice=document.createElement('button');choice.type='button';choice.role='option';choice.textContent=option.text;
   choice.onclick=()=>{button.textContent=caption+option.text;list.remove();button.focus();};list.append(choice);
  }button.after(list);};
 }
 </script>`;
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup+custom));const result=await prepareInstagramRegistration(context,input,fast);assert.equal(result.status,'awaiting_email_code');assert.equal(result.submitted,true);assert.equal(await context.pages()[0].evaluate(()=>window.submissions),1);await context.close();}
 finally{await browser.close();}
});

test('signup resolves the current fields after email blur inserts an unrelated input',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const dynamic=`<script>document.querySelector('input[name=email]').addEventListener('blur',()=>{if(document.querySelector('input[name=referral]'))return;document.querySelector('input[name=full_name]').closest('label').insertAdjacentHTML('beforebegin','<label>Optional referral code<input name=referral></label>');});</script>`;
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup+dynamic));
  const result=await prepareInstagramRegistration(context,input,fast),page=context.pages()[0];assert.equal(result.status,'awaiting_email_code');assert.equal(await page.locator('input[name=referral]').inputValue(),'');
  for(const [selector,value] of [['input[name=email]',input.email],['input[name=full_name]',input.fullName],['input[name=username]',input.username],['input[type=password]',input.password]])assert.equal(await page.locator(selector).inputValue(),value);
  assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.enters),0);
 }finally{await browser.close();}
});

test('signup follows the displayed form groups while keeping birthday dependencies intact',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const [layout,expected] of [['dom',['email','password','birthday','full_name','username']],['css',['email','full_name','birthday','username','password']]]){
   const arranged=`<script>
   const main=document.querySelector('main'),submit=document.getElementById('submit'),labels=[...main.children].filter(e=>e.tagName==='LABEL');
   const key=label=>label.querySelector('input')?.name||(label.querySelector('input[type=password]')?'password':label.textContent.startsWith('Select ')?'birthday':'gender');
   const order=${JSON.stringify(expected)};
   if(${JSON.stringify(layout)}==='dom'){for(const name of [...order,'gender'])for(const label of labels.filter(e=>key(e)===name))submit.before(label);}
   else{main.style.display='flex';main.style.flexDirection='column';main.querySelector('h1').style.order='-1';for(const label of labels)label.style.order=String(order.indexOf(key(label))<0?order.length:order.indexOf(key(label)));submit.style.order='10';document.getElementById('verification').style.order='11';}
   window.formGroups=[];window.birthdayChanges=[];
   const record=group=>{if(order.includes(group)&&!window.formGroups.includes(group))window.formGroups.push(group);};
   document.addEventListener('input',event=>{if(event.target.tagName==='INPUT'&&event.target.value)record(event.target.type==='password'?'password':event.target.name);});
   for(const select of document.querySelectorAll('select'))if(select.closest('label').textContent.startsWith('Select '))select.addEventListener('change',()=>{record('birthday');window.birthdayChanges.push(select.closest('label').textContent.match(/^Select (Month|Day|Year)/)[1].toLowerCase());});
   </script>`;
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(markup+arranged));
   const result=await prepareInstagramRegistration(context,input,fast),page=context.pages()[0];assert.equal(result.status,'awaiting_email_code');assert.deepEqual(await page.evaluate(()=>window.formGroups),expected);assert.deepEqual(await page.evaluate(()=>window.birthdayChanges),['year','month','day']);assert.equal(await page.evaluate(()=>window.submissions),1);await context.close();
  }
 }finally{await browser.close();}
});

test('OTP confirmation waits for blur and delayed readiness, and Stop cancels that wait without clicking',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const delayed=markup.replace('<button id="code-confirm"','<button disabled id="code-confirm"').replace('window.codeSubmissions++',"window.codeSubmissions++;document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a>')")+`<script>
 window.virtualNow=0;window.codeReadyAt=null;window.codeEnabledAt=null;
 document.querySelector('input[name=email_confirmation_code]').addEventListener('blur',event=>{if(/^\\d{6}$/.test(event.target.value))window.codeReadyAt=window.virtualNow+2500;});
 </script>`;
 try{for(const stopDuringWait of [false,true]){
   const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(delayed));let active=true,calls=0;
   const result=await prepareInstagramRegistration(context,input,{...fast,shouldContinue:()=>active,getEmailCode:async()=>{calls++;return {code:'012345'};},wait:async ms=>{
    const page=context.pages()[0];if(!page)return;const state=await page.evaluate(ms=>{window.virtualNow+=ms;if(window.codeReadyAt!==null&&window.virtualNow>=window.codeReadyAt){document.getElementById('code-confirm').disabled=false;window.codeEnabledAt=window.virtualNow;}return {readyAt:window.codeReadyAt,now:window.virtualNow};},ms).catch(()=>({readyAt:null,now:0}));
    if(stopDuringWait&&state.readyAt!==null&&state.now>=state.readyAt-1900)active=false;
   }}),page=context.pages()[0];
   assert.equal(calls,1);assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),stopDuringWait?0:1);assert.equal(result.emailCodeSubmitted,!stopDuringWait);
   if(stopDuringWait){assert.equal(result.emailCodeAttempted,false);assert.equal(await page.evaluate(()=>window.codeEnabledAt),null);}else{assert.equal(result.status,'completed');assert.ok(await page.evaluate(()=>window.codeEnabledAt>=window.codeReadyAt));}
   assert.equal(await page.evaluate(()=>window.enters),0);await context.close();
  }
 }finally{await browser.close();}
});

test('a challenge overlay takes precedence over an OTP field and never requests or enters a code',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const challenged=markup.replace("document.getElementById('verification').hidden=false","document.getElementById('verification').hidden=false;document.body.insertAdjacentHTML('beforeend','<div data-sitekey=fixture style=position:fixed;inset:0;background:white;z-index:999>Confirm you are human</div>')");
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(challenged));let calls=0;
  const result=await prepareInstagramRegistration(context,input,{...fast,getEmailCode:async()=>{calls++;return {code:'012345'};}}),page=context.pages()[0];assert.equal(result.status,'challenge');assert.equal(calls,0);assert.equal(await page.locator('input[name=email_confirmation_code]').inputValue(),'');assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),0);assert.equal(result.emailCodeAttempted,false);
 }finally{await browser.close();}
});

test('hidden and inert OTP duplicates do not block the active verification field',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const duplicates=`<div aria-hidden="true"><label>Security code<input name="hidden_code" autocomplete="one-time-code"></label></div><div inert><label>Verification code<input name="inert_code" autocomplete="one-time-code"></label></div><label>Security code<input name="transparent_code" autocomplete="one-time-code" style="opacity:0"></label>`;
 const body=markup.replace('window.codeSubmissions++',"window.codeSubmissions++;document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a>')")+duplicates;
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(body));let calls=0;
  const result=await prepareInstagramRegistration(context,input,{...fast,getEmailCode:async()=>{calls++;return {code:'012345'};}}),page=context.pages()[0];assert.equal(result.status,'completed');assert.equal(calls,1);assert.equal(await page.locator('input[name=email_confirmation_code]').inputValue(),'012345');for(const name of ['hidden_code','inert_code','transparent_code'])assert.equal(await page.locator('input[name='+name+']').inputValue(),'');assert.equal(await page.evaluate(()=>window.codeSubmissions),1);
 }finally{await browser.close();}
});

test('a visible OTP input can finish loading before Gmail is requested and confirmation proceeds once',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const body=markup.replace('name="email_confirmation_code"','disabled name="email_confirmation_code"').replace("document.getElementById('verification').hidden=false","document.getElementById('verification').hidden=false;window.codeEditableAt=window.virtualNow+1500").replace('window.codeSubmissions++',"window.codeSubmissions++;document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a>')")+'<script>window.virtualNow=0;window.codeEditableAt=null;</script>';
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(body));let calls=0;
  const result=await prepareInstagramRegistration(context,input,{...fast,getEmailCode:async()=>{calls++;const page=context.pages()[0];assert.equal(await page.locator('input[name=email_confirmation_code]').isEditable(),true);assert.ok(await page.evaluate(()=>window.virtualNow>=window.codeEditableAt));return {code:'012345'};},wait:async ms=>{const page=context.pages()[0];if(page)await page.evaluate(ms=>{window.virtualNow+=ms;if(window.codeEditableAt!==null&&window.virtualNow>=window.codeEditableAt)document.querySelector('input[name=email_confirmation_code]').disabled=false;},ms).catch(()=>{});}}),page=context.pages()[0];
  assert.equal(result.status,'completed');assert.equal(calls,1);assert.equal(result.emailCodeSubmitted,true);assert.equal(await page.locator('input[name=email_confirmation_code]').inputValue(),'012345');assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),1);assert.equal(await page.evaluate(()=>window.enters),0);for(const secret of ['012345',input.password])assert.ok(!JSON.stringify(result).includes(secret));
 }finally{await browser.close();}
});

const postCodeFixture=(action,timeline='')=>markup.replace('window.codeSubmissions++','window.codeSubmissions++;'+action)+`<script>window.postCodeElapsed=0;window.advancePostCode=()=>{${timeline}};</script>`;
const advancePostCode=async(context,ms)=>{const page=context.pages()[0];if(!page)return 0;return page.evaluate(ms=>{if(window.codeSubmissions===1){window.postCodeElapsed+=ms;window.advancePostCode();}return window.postCodeElapsed;},ms).catch(()=>0);};
test('after confirming OTP, a stable SPA success at the same URL still gets a deliberate page-loading wait',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const body=postCodeFixture("document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a>')"),progress=[];
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(body));let calls=0;
  const result=await prepareInstagramRegistration(context,input,{...fast,postCodeTimeoutMs:10000,onProgress:message=>progress.push(message),getEmailCode:async()=>{calls++;return {code:'012345'};},wait:ms=>advancePostCode(context,ms)}),page=context.pages()[0];
  assert.equal(result.status,'completed');assert.equal(result.emailCodeSubmitted,true);assert.equal(result.url,INSTAGRAM_SIGNUP_URL);assert.ok(await page.evaluate(()=>window.postCodeElapsed>=3000));assert.equal(calls,1);assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),1);assert.equal(await page.evaluate(()=>window.enters),0);assert.ok(progress.some(message=>/đang (?:chờ|đợi)|đang tải/i.test(message)));for(const secret of ['012345',input.password])assert.ok(!JSON.stringify([result,progress]).includes(secret));
 }finally{await browser.close();}
});

test('after OTP, busy indicators, document readiness and redirects must settle before the final account state is accepted',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const action="document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<div id=account-state><a href=/direct/inbox/>Inbox</a></div><div id=loading aria-busy=true>Loading Instagram</div>');window.fixtureReadyState='loading';Object.defineProperty(document,'readyState',{configurable:true,get:()=>window.fixtureReadyState})";
 const timeline=`
 if(window.postCodeElapsed>=1500)window.fixtureReadyState='complete';
 if(window.postCodeElapsed>=2000&&!window.onboardingShown){window.onboardingShown=true;document.getElementById('loading').setAttribute('aria-busy','false');document.getElementById('account-state').textContent='Save your login information';}
 if(window.postCodeElapsed>=3500&&!window.homeShown){window.homeShown=true;document.getElementById('account-state').innerHTML='<a href=/direct/inbox/>Inbox</a>';history.pushState({},'', '/?step=home');}
 if(window.postCodeElapsed>=4500&&!window.lastRedirect){window.lastRedirect=true;history.pushState({},'', '/?step=settled&confirmation_code=012345');}
 `;
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(postCodeFixture(action,timeline)));
  const result=await prepareInstagramRegistration(context,input,{...fast,postCodeTimeoutMs:12000,getEmailCode:async()=>({code:'012345'}),wait:ms=>advancePostCode(context,ms)}),page=context.pages()[0];
  assert.equal(result.status,'completed');assert.equal(result.url,'https://www.instagram.com/');assert.equal(await page.evaluate(()=>window.lastRedirect),true);assert.ok(await page.evaluate(()=>window.postCodeElapsed>=6500));assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),1);assert.ok(!JSON.stringify(result).includes('012345'));
  await context.close();
  const progressContext=await browser.newContext(),progressBody=postCodeFixture("document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a><div id=loading role=progressbar>Loading Instagram</div>')","if(window.postCodeElapsed>=3500)document.getElementById('loading')?.remove();");await progressContext.route('https://www.instagram.com/**',serveSignup(progressBody));
  const progressResult=await prepareInstagramRegistration(progressContext,input,{...fast,postCodeTimeoutMs:10000,getEmailCode:async()=>({code:'012345'}),wait:ms=>advancePostCode(progressContext,ms)}),progressPage=progressContext.pages()[0];
  assert.equal(progressResult.status,'completed');assert.ok(await progressPage.evaluate(()=>window.postCodeElapsed>=5500));assert.equal(await progressPage.evaluate(()=>window.codeSubmissions),1);
 }finally{await browser.close();}
});

test('post-OTP timeout keeps the profile available without retrying Gmail or confirming again',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const cases=[['OTP stays visible',''],['account is still busy',"document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a><div aria-busy=true>Loading Instagram</div>')"],['document is still loading',"document.getElementById('verification').hidden=true;document.body.insertAdjacentHTML('beforeend','<a href=/direct/inbox/>Inbox</a>');Object.defineProperty(document,'readyState',{configurable:true,get:()=> 'loading'})"]];
 try{for(const [name,action] of cases){const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(postCodeFixture(action)));let calls=0;
   const result=await prepareInstagramRegistration(context,input,{...fast,postCodeTimeoutMs:5000,getEmailCode:async()=>{calls++;return {code:'012345'};},wait:ms=>advancePostCode(context,ms)}),page=context.pages()[0];
   assert.equal(result.status,'code_submitted_unverified',name);assert.equal(result.emailCodeSubmitted,true,name);assert.ok(await page.evaluate(()=>window.postCodeElapsed>=5000),name);assert.equal(calls,1,name);assert.equal(await page.evaluate(()=>window.submissions),1,name);assert.equal(await page.evaluate(()=>window.codeSubmissions),1,name);assert.equal(page.isClosed(),false,name);assert.ok(!JSON.stringify(result).includes('012345'));await context.close();
  }
 }finally{await browser.close();}
});

test('Stop while Instagram loads after OTP ends the wait promptly and never clicks confirmation twice',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{const context=await browser.newContext();await context.route('https://www.instagram.com/**',serveSignup(postCodeFixture('')));let active=true,calls=0;
  const result=await prepareInstagramRegistration(context,input,{...fast,postCodeTimeoutMs:60000,shouldContinue:()=>active,getEmailCode:async()=>{calls++;return {code:'012345'};},wait:async ms=>{if(await advancePostCode(context,ms)>=700)active=false;}}),page=context.pages()[0];
  assert.equal(result.status,'code_submission_unknown');assert.equal(result.emailCodeSubmitted,true);assert.ok(await page.evaluate(()=>window.postCodeElapsed<1500));assert.equal(calls,1);assert.equal(await page.evaluate(()=>window.submissions),1);assert.equal(await page.evaluate(()=>window.codeSubmissions),1);assert.equal(page.isClosed(),false);assert.ok(!JSON.stringify(result).includes('012345'));
 }finally{await browser.close();}
});

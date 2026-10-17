import {randomInt,randomUUID} from 'node:crypto';
import {installNativePointer} from '../extension/pointer-input.js';
import {typeReplyText} from '../extension/post-reply.js';
export const INSTAGRAM_SIGNUP_URL='https://www.instagram.com/accounts/emailsignup/';
export function randomRegistrationBirthday(){
 const start=Date.UTC(2004,0,1),days=(Date.UTC(2008,0,1)-start)/86400000;
 return new Date(start+randomInt(days)*86400000).toISOString().slice(0,10);
}
export function registrationDraft(profile,{birthday=randomRegistrationBirthday()}={}){
 const names=String(profile.name||profile.profileName||'').trim(),emails=names.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:gmail|googlemail)\.com\b/gi)||[];
 const email=emails.length===1?emails[0]:'';
 return {profileId:profile.id||profile.profileId,email,fullName:'',username:'',birthday,gender:'female'};
}
export function validateRegistration(input){
 const email=String(input.email||'').trim(),fullName=String(input.fullName||'').trim(),username=String(input.username||'').trim();
 if(!/^[^\s@]+@(?:gmail|googlemail)\.com$/i.test(email)||email.length>254)throw Error('Nhập địa chỉ Gmail của profile.');
 if(!fullName||fullName.length>100||/[\x00-\x1f]/.test(fullName))throw Error('Tên hiển thị cần 1–100 ký tự.');
 if(!/^[a-z0-9._]{1,30}$/i.test(username)||username.startsWith('.')||username.endsWith('.')||username.includes('..'))throw Error('Username cần 1–30 chữ, số, dấu chấm hoặc gạch dưới.');
 const birthday=String(input.birthday||'').trim()||randomRegistrationBirthday();
 if(birthday){const date=new Date(birthday+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(birthday)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==birthday||birthday<'1900-01-01'||birthday>new Date().toISOString().slice(0,10))throw Error('Ngày sinh cần đúng YYYY-MM-DD và là ngày hợp lệ.');}
 const password=input.password||'';if(typeof password!=='string'||password.length>512||password&&password.length<6)throw Error('Mật khẩu cần ít nhất 6 ký tự, tối đa 512.');
 return {email,fullName,username,birthday,gender:'female',password};
}
export async function prepareInstagramRegistration(context,input,{shouldContinue=()=>true,stepDelayMs=2000,typingDelayMs=60,random=Math.random,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const data=validateRegistration(input),warnings=[];
 if(!Number.isFinite(stepDelayMs)||stepDelayMs<0||stepDelayMs>10000||!Number.isFinite(typingDelayMs)||typingDelayMs<0||typingDelayMs>500)throw Error('Nhịp điền form Instagram không hợp lệ.');
 const stepDelay=Math.max(500,stepDelayMs),typingDelay=Math.max(40,typingDelayMs);
 const check=()=>{if(!shouldContinue())throw Error('Đã hủy chuẩn bị đăng ký do Dừng.');};
 const pause=async ms=>{for(let left=ms;left>0;){check();const part=Math.min(100,left);await wait(part);left-=part;}check();};
 const step=()=>pause(Math.round(stepDelay*(.8+random()*.4)));
 check();const page=await context.newPage();let session;
 try{
  await page.goto(INSTAGRAM_SIGNUP_URL,{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();check();
  const current=new URL(page.url());
  if(current.origin!=='https://www.instagram.com'||!current.pathname.startsWith('/accounts/emailsignup'))return {ok:true,ready:false,url:page.url(),message:'Profile có thể đã đăng nhập hoặc Instagram chuyển trang. Kiểm tra trình duyệt; tool không đăng xuất tài khoản hiện có.'};
  const challenge=page.locator('iframe[src*="captcha"],iframe[title*="challenge" i],[data-sitekey]');
  if(await challenge.count())return {ok:true,ready:false,url:page.url(),message:'Instagram yêu cầu xác minh. Bạn tự xử lý trong trình duyệt rồi mở lại luồng.'};
  await page.locator('input:visible').first().waitFor({state:'visible',timeout:15000});check();
  session=await context.newCDPSession(page);
  const pointer=installNativePointer({scripting:{executeScript:async({func,args})=>[{frameId:0,result:await page.evaluate(func,args[0])}]},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(target,method,params)=>session.send(method,params)}},{shouldContinue,random,wait:pause});
  const click=async locator=>{
   check();const token='hx'+randomUUID().replace(/-/g,'');await locator.evaluate((e,token)=>e.setAttribute('data-hoanxu-pointer',token),token);
   try{await pointer.pointer.click({tabId:1},{token});check();}finally{await locator.evaluate((e,token)=>{if(e.getAttribute('data-hoanxu-pointer')===token)e.removeAttribute('data-hoanxu-pointer');},token).catch(()=>{});}
  };
  const focused=async locator=>{check();if(!await locator.evaluate(e=>document.activeElement===e))throw Error('Ô nhập đã mất focus.');};
  const type=async(locator,value)=>{
   await click(locator);await pause(250+random()*250);await focused(locator);await page.keyboard.press('ControlOrMeta+A');check();await page.keyboard.press('Backspace');
   await typeReplyText(value,async char=>{await focused(locator);await page.keyboard.insertText(char);},{delayMs:typingDelay,shouldContinue,random,wait:pause});
   check();if(await locator.inputValue()!==value)throw Error('Nội dung ô nhập chưa đầy đủ.');await step();
  };
  const select=async(locator,option)=>{
   await click(locator);await pause(250+random()*250);check();await page.keyboard.press('Escape');await focused(locator);
   // Native select menus are OS surfaces; choose the value without Enter, which could submit a form.
   await locator.selectOption(option.value);check();if(await locator.inputValue()!==option.value)throw Error('Chưa chọn đúng giá trị trên form.');await step();
  };
  const selectOptions=locator=>locator.locator('option').evaluateAll(nodes=>nodes.map(e=>({value:e.value,text:e.textContent.trim(),disabled:e.disabled||e.parentElement?.disabled===true})));
  await step();
  // Read only labels/attributes, never values or account/session internals.
  const fields=await page.locator('input').evaluateAll(nodes=>nodes.map((e,index)=>({index,visible:!!e.getClientRects().length,type:e.type,label:[e.name,e.placeholder,e.getAttribute('aria-label'),...(e.labels||[])].map(v=>typeof v==='string'?v:v?.innerText||'').join(' ')})));
  const target=(type,pattern)=>{const found=fields.filter(f=>f.visible&&(type?f.type===type:f.type!=='password')&&(!pattern||pattern.test(f.label)));if(found.length!==1)throw Error('Không xác định duy nhất ô '+(type==='password'?'mật khẩu':pattern)+'. Chưa gửi đăng ký.');return page.locator('input').nth(found[0].index);};
  for(const [value,pattern] of [[data.email,/email|mobile number|số điện thoại/i],[data.fullName,/full.?name|họ.*tên|tên đầy đủ|^name\b/i],[data.username,/username|user.?name|tên người dùng/i]]){await type(target(null,pattern),value);}
  if(data.password){await type(target('password'),data.password);}else warnings.push('Bạn tự nhập mật khẩu trong trình duyệt.');
  if(data.birthday){
   const [year,month,day]=data.birthday.split('-').map(Number),dateField=page.locator('input[type="date"]');
   if(await dateField.count()===1){await click(dateField);await step();check();await dateField.fill(data.birthday);await step();}
   else{
    const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    for(const [field,value] of [[/select month|tháng/i,months[month-1]],[/select day|ngày/i,String(day)],[/select year|năm/i,String(year)]]){
     check();const selector=page.getByRole('combobox',{name:field});
     if(await selector.count()!==1){warnings.push('Bạn chọn ngày sinh chính xác trên form.');break;}
     const tag=await selector.evaluate(e=>e.tagName);
     if(tag==='SELECT'){
      const options=await selectOptions(selector);
      const numeric=field.source.includes('month')?month:Number(value),available=options.filter(o=>!o.disabled),option=available.find(o=>o.text===value)||available.find(o=>o.text===String(numeric))||available.find(o=>o.value===String(numeric));
      if(!option){warnings.push('Bạn chọn ngày sinh chính xác trên form.');break;}await select(selector,option);
     }else{await click(selector);await step();const option=page.getByRole('option',{name:value,exact:true});if(await option.count()!==1){await page.keyboard.press('Escape');warnings.push('Bạn chọn ngày sinh chính xác trên form.');break;}await click(option);await step();}
    }
   }
  }
  check();const gender=page.getByRole('combobox',{name:/^gender$|^giới tính$/i});
  if(await gender.count()===1){const tag=await gender.evaluate(e=>e.tagName);if(tag==='SELECT'){const options=await selectOptions(gender);const female=options.find(o=>!o.disabled&&/^(female|nữ)$/i.test(o.text));if(female)await select(gender,female);}}
  check();
  // Handoff only: never submit, press Enter, solve a challenge, or send confirmation codes.
  return {ok:true,ready:true,url:page.url(),email:data.email,username:data.username,warnings,message:'Đã điền form. Kiểm tra thông tin và tự bấm Submit trong Instagram. '+warnings.join(' ')};
 }catch(e){throw Error('Chưa chuẩn bị xong form Instagram. '+(/Đã hủy|Đã dừng/i.test(e.message)?'Đã hủy do Dừng.':'Kiểm tra trang đăng ký đang mở và điền thủ công nếu giao diện đã thay đổi.'));}finally{await session?.detach().catch(()=>{});}
}

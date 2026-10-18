import {randomInt,randomUUID} from 'node:crypto';
import {installNativePointer} from '../extension/pointer-input.js';
import {typeFormText,formPointer} from './form-input.mjs';
export const INSTAGRAM_SIGNUP_URL='https://www.instagram.com/accounts/emailsignup/';
export const INSTAGRAM_HOME_URL='https://www.instagram.com/';
const birthdayFields={year:/\b(?:select\s+)?year\b|năm/i,month:/\b(?:select\s+)?month\b|tháng/i,day:/\b(?:select\s+)?day\b|ngày/i};
const birthdayTitles={year:'năm sinh',month:'tháng sinh',day:'ngày sinh'};
function birthdayValue(text,part){
 const value=String(text||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/^(?:select\s+)?(?:month|day|year|tháng|ngày|năm)\s*[:\-]?\s*/i,'');
 if(part==='month'){const months=['january','february','march','april','may','june','july','august','september','october','november','december'],index=months.findIndex(month=>value===month||value===month.slice(0,3));if(index>=0)return index+1;}
 return /^\d{1,4}$/.test(value)?Number(value):null;
}
export function randomRegistrationBirthday(){
 const start=Date.UTC(2004,0,1),days=(Date.UTC(2008,0,1)-start)/86400000;
 return new Date(start+randomInt(days)*86400000).toISOString().slice(0,10);
}
export function registrationUsername(fullName,digits=randomInt(1000,10000)){
 const words=String(fullName||'').normalize('NFD').replace(/\p{M}/gu,'').replace(/[đĐ]/g,'d').toLowerCase().trim().split(/\s+/).map(word=>word.replace(/[^a-z]/g,'')).filter(Boolean).slice(-2);
 if(words.length!==2||!Number.isInteger(digits)||digits<1000||digits>9999)throw Error('Tên cần ít nhất hai từ để tạo username.');
 return words.map(word=>word.slice(0,12)).join('.')+'.'+digits;
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
async function signupState(page,{ignoreAriaOnly=true,withPageState=false}={}){
 return page.evaluate(({ignoreAriaOnly,withPageState})=>{
  const visible=e=>{const rect=e.getBoundingClientRect(),style=getComputedStyle(e);return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&style.opacity!=='0'&&!e.closest('[aria-hidden="true"],[hidden],[inert]');};
  const state=(()=>{
  const text=document.body?.innerText||'',inputs=[...document.querySelectorAll('input')].filter(visible);
  const code=inputs.some(e=>e.autocomplete==='one-time-code'||/^(email_confirmation_code|confirmation_?code|verification_?code|security_?code|code)$/i.test(e.name)||/confirmation code|security code|verification code|mã xác nhận|mã xác minh|mã bảo mật/i.test([e.placeholder,e.getAttribute('aria-label'),...Array.from(e.labels||[],l=>l.innerText)].join(' ')));
  if([...document.querySelectorAll('iframe[src*="captcha"],iframe[title*="challenge" i],[data-sitekey]')].some(visible)||/confirm you(?: are|’re|'re) human|xác minh bạn là con người|captcha/i.test(text))return {status:'challenge',message:'Instagram yêu cầu CAPTCHA hoặc xác minh bổ sung. Bạn xử lý trực tiếp trong profile; tool đã dừng thao tác.'};
  if(/code.*(?:incorrect|invalid|expired)|(?:incorrect|invalid|expired).*code|check your code and try again|mã.*(?:không đúng|không hợp lệ|hết hạn)/i.test(text))return {status:'code_rejected',message:'Instagram báo mã xác minh không đúng hoặc hết hạn. Bạn xử lý thủ công; tool không tự gửi lại mã.'};
  if(code)return {status:'awaiting_email_code',message:'Đang chờ mã xác minh gửi về Gmail. Bạn mở Gmail và tự điền mã trong trình duyệt GPM; tool dừng thao tác tại đây.'};
  if(/username.*(?:not available|isn.t available|already taken|already in use)|tên người dùng.*(?:không khả dụng|đã được sử dụng|đã tồn tại)/i.test(text))return {status:'validation_error',message:'Instagram báo username đã được dùng hoặc không khả dụng. Bạn sửa trực tiếp trên form.'};
  if(/email.*(?:already in use|already associated|another account)|email.*(?:đã được sử dụng|đã tồn tại)/i.test(text))return {status:'validation_error',message:'Instagram báo email đã được dùng. Kiểm tra tài khoản hoặc email trên form.'};
  const field=label=>/username|user.?name|tên người dùng/i.test(label)?'Username':/password|mật khẩu/i.test(label)?'Mật khẩu':/email|e-mail|mobile number|số điện thoại/i.test(label)?'Email':/full.?name|họ.*tên|tên đầy đủ|^name\b/i.test(label)?'Tên hiển thị':/birthday|birth date|date of birth|select month|select day|select year|ngày sinh|tháng|năm/i.test(label)?'Ngày sinh':null;
  const label=e=>[e.name,e.placeholder,e.getAttribute('aria-label'),...Array.from(e.labels||[],l=>l.innerText)].join(' ');
  const negative=/\binvalid\b|\bincorrect\b|not valid|not available|isn.t available|already (?:taken|in use)|not allowed|cannot be used|can.t be used|không hợp lệ|không đúng|đã được sử dụng|đã tồn tại|chưa nhập|vui lòng nhập/i;
  const issues=[],pending=[];
  for(const e of [...document.querySelectorAll('input,select')].filter(visible)){
   const name=field(label(e));if(!name)continue;
   const v=e.validity;
   if(e.willValidate&&v&&!v.valid){const reason=v.valueMissing?'chưa có dữ liệu':v.typeMismatch?'sai định dạng':v.patternMismatch?'không khớp định dạng trang yêu cầu':v.tooShort?'chưa đủ độ dài':v.tooLong?'vượt độ dài cho phép':v.rangeUnderflow||v.rangeOverflow||v.badInput?'giá trị ngoài phạm vi hoặc chưa hoàn chỉnh':'ràng buộc do trang đặt ra';issues.push(name+': '+reason);continue;}
   if(e.getAttribute('aria-invalid')==='true'){
    const ids=[e.getAttribute('aria-errormessage'),e.getAttribute('aria-describedby')].filter(Boolean).join(' ').split(/\s+/),associated=ids.map(id=>document.getElementById(id)).filter(e=>e&&visible(e)).map(e=>e.innerText||'').join(' ');
    if(negative.test(associated))issues.push(name+': trang đang báo lỗi bên cạnh ô');else pending.push(name);
   }
  }
  for(const alert of [...document.querySelectorAll('[role="alert"]')].filter(visible)){const text=alert.innerText||'',name=field(text);if(name&&negative.test(text))issues.push(name+': trang đang báo lỗi bên cạnh ô');}
  if(issues.length)return {status:'validation_error',message:'Instagram báo ô chưa hợp lệ · '+[...new Set(issues)].join(' · ')+'.'};
  if(!ignoreAriaOnly&&pending.length)return {status:'validation_pending',message:'Instagram chưa cập nhật trạng thái ô '+[...new Set(pending)].join(', ')+'.'};
  if(/try again later|please wait a few minutes|something went wrong|we restrict|couldn.t create|unable to create|thử lại sau|đã xảy ra lỗi|không thể tạo tài khoản/i.test(text))return {status:'validation_error',message:'Instagram chưa chấp nhận đăng ký. Kiểm tra thông báo trên trang; tool không tự gửi lại.'};
  if([...document.querySelectorAll('a[href="/direct/inbox/"],a[href="/accounts/edit/"],nav a[aria-label="Profile"],svg[aria-label="Home"]')].some(visible))return {status:'completed',message:'Đã xác minh mã Gmail và nhận diện giao diện tài khoản Instagram đã đăng nhập.'};
  if(/save your login info|save your login information|find people to follow|lưu thông tin đăng nhập|tìm người để theo dõi/i.test(text))return {status:'onboarding',message:'Đã gửi mã xác minh. Instagram đang yêu cầu thiết lập tài khoản tiếp; bạn hoàn tất trong profile GPM.'};
  return null;
  })();
  if(!withPageState)return state;
  return {state,url:location.href,ready:document.readyState==='complete',busy:[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]:not([aria-valuenow])')].some(visible)};
 },{ignoreAriaOnly,withPageState});
}
async function codeInput(page){
 const indices=await page.locator('input').evaluateAll(nodes=>nodes.map((e,index)=>({e,index})).filter(({e})=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).opacity!=='0'&&!e.closest('[aria-hidden="true"],[hidden],[inert]')&&!e.disabled&&!e.readOnly&&(e.autocomplete==='one-time-code'||/^(email_confirmation_code|confirmation_?code|verification_?code|security_?code|code)$/i.test(e.name)||/confirmation code|security code|verification code|mã xác nhận|mã xác minh|mã bảo mật/i.test([e.placeholder,e.getAttribute('aria-label'),...Array.from(e.labels||[],l=>l.innerText)].join(' ')))).map(({index})=>index));
 return indices.length===1?page.locator('input').nth(indices[0]):null;
}
export async function prepareInstagramRegistration(context,input,{shouldContinue=()=>true,stepDelayMs=2000,typingDelayMs=60,confirmationTimeoutMs=30000,postCodeTimeoutMs=60000,getEmailCode,onState=async()=>{},onProgress=()=>{},random=Math.random,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const data=validateRegistration(input),warnings=[];
 if(!Number.isFinite(stepDelayMs)||stepDelayMs<0||stepDelayMs>10000||!Number.isFinite(typingDelayMs)||typingDelayMs<0||typingDelayMs>500||!Number.isFinite(confirmationTimeoutMs)||confirmationTimeoutMs<0||confirmationTimeoutMs>60000||!Number.isFinite(postCodeTimeoutMs)||postCodeTimeoutMs<0||postCodeTimeoutMs>120000)throw Error('Nhịp điền form Instagram không hợp lệ.');
 const stepDelay=Math.max(500,stepDelayMs),typingDelay=Math.max(40,typingDelayMs);
 const check=()=>{if(!shouldContinue())throw Error('Đã hủy chuẩn bị đăng ký do Dừng.');};
 const pause=async ms=>{for(let left=ms;left>0;){check();const part=Math.min(100,left);await wait(part);left-=part;}check();};
 const step=()=>pause(Math.round(stepDelay*(.8+random()*.4)));
 check();const page=await context.newPage(),pointerKey='__hxFormPointer'+randomUUID().replace(/-/g,'');let session,submissionAttempted=false,submitted=false,requestedAt=null,emailCodeAttempted=false,emailCodeSubmitted=false;
 const publicURL=()=>{const url=new URL(page.url());return url.origin+url.pathname.replace(/(?<!\d)\d{6}(?!\d)/g,'[redacted]');};
 const result=(status,message)=>({ok:true,ready:['awaiting_email_code','awaiting_manual_confirmation','completed','onboarding'].includes(status),status,submitted,submissionAttempted,requestedAt,emailCodeAttempted,emailCodeSubmitted,url:publicURL(),email:data.email,username:data.username,warnings,message});
 try{
  await onProgress('Đang mở trang chủ Instagram…');await page.goto(INSTAGRAM_HOME_URL,{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();check();
  if(new URL(page.url()).origin!==new URL(INSTAGRAM_HOME_URL).origin)return result('signup_entry_unavailable','Instagram đã chuyển sang trang khác. Bạn kiểm tra profile trước khi đăng ký.');
  session=await context.newCDPSession(page);
  const pointer=installNativePointer({scripting:{executeScript:async({func,args})=>[{frameId:0,result:await page.evaluate(func,args[0])}]},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(target,method,params)=>session.send(method,params)}},{shouldContinue,random,wait:pause});
  const click=async locator=>{
   check();const token='hx'+randomUUID().replace(/-/g,''),element=await locator.elementHandle();if(!element)throw Error('Mục tiêu không còn trên form.');await element.evaluate((e,token)=>e.setAttribute('data-hoanxu-pointer',token),token);
   try{await page.evaluate(formPointer,{key:pointerKey,action:'show'});await pointer.pointer.click({tabId:1},{token});check();}finally{await element.evaluate((e,token)=>{if(e.getAttribute('data-hoanxu-pointer')===token)e.removeAttribute('data-hoanxu-pointer');},token).catch(()=>{});await element.dispose().catch(()=>{});}
  };
  await step();
  const entryState=async()=>{
   const state=await signupState(page);
   if(state?.status==='challenge')return result(state.status,state.message);
   if(['completed','onboarding'].includes(state?.status))return result('already_signed_in','Profile đã đăng nhập Instagram. Tool giữ nguyên tài khoản hiện có, không đăng xuất để tạo tài khoản mới.');
   if(state?.status==='awaiting_email_code')return result('verification_in_progress','Profile đang có bước xác minh Instagram chưa hoàn tất. Bạn kiểm tra trực tiếp trong trình duyệt.');
  };
  const cookies=page.getByRole('button',{name:/^(Decline optional cookies|Only allow essential cookies|Allow essential cookies|Từ chối cookie không bắt buộc|Chỉ cho phép cookie cần thiết)$/i});
  if(await cookies.count()===1&&await cookies.isVisible()&&await cookies.isEnabled()){await click(cookies);await step();}
  const signupName=/^\s*(Sign up|Sign-up|Đăng ký|Create new account|Tạo tài khoản(?: mới)?)\s*$/i,entries=page.getByRole('link',{name:signupName}).or(page.getByRole('button',{name:signupName}));
  const signupEntries=async()=>{const visible=[];for(let i=0;i<await entries.count();i++){const entry=entries.nth(i);if(await entry.isVisible()&&await entry.isEnabled())visible.push(entry);}return visible;};
  let signup;
  for(let elapsed=0;elapsed<=15000;elapsed+=250){
   check();const state=await entryState();if(state)return state;
   const available=await signupEntries();if(available.length>1)return result('signup_entry_unavailable','Có nhiều nút đăng ký trên trang chủ. Bạn kiểm tra profile; tool chưa bấm nút nào.');
   if(available.length===1){signup=available[0];break;}if(elapsed<15000)await pause(250);
  }
  if(!signup)return result('signup_entry_unavailable','Chưa tìm thấy nút Đăng ký trên trang chủ Instagram. Bạn kiểm tra giao diện hoặc popup trong profile.');
  await onProgress('Đã mở trang chủ · đang bấm Đăng ký…');await step();check();const beforeEntry=await entryState();if(beforeEntry)return beforeEntry;
  if((await signupEntries()).length!==1)return result('signup_entry_unavailable','Nút đăng ký trên trang chủ đã thay đổi. Bạn kiểm tra profile.');
  const href=await signup.getAttribute('href');if(href){const destination=new URL(href,page.url());if(destination.origin!==new URL(INSTAGRAM_HOME_URL).origin||!destination.pathname.startsWith('/accounts/emailsignup'))return result('signup_entry_unavailable','Liên kết Đăng ký chưa dẫn tới form Instagram được hỗ trợ. Bạn kiểm tra profile.');}
  await click(signup);await onProgress('Đã bấm Đăng ký · đang chờ form Instagram tải…');
  let formReady=false;
  for(let elapsed=0;elapsed<=30000;elapsed+=250){
   check();let state;try{state=await entryState();}catch{}if(state)return state;
   const current=new URL(page.url());if(current.origin!==new URL(INSTAGRAM_HOME_URL).origin)return result('signup_entry_unavailable','Instagram đã chuyển sang trang khác. Bạn kiểm tra profile.');
   if(current.pathname.startsWith('/accounts/emailsignup')&&await page.locator('input:visible').first().isVisible()){formReady=true;break;}
   if(elapsed<30000)await pause(250);
  }
  if(!formReady)return result('signup_entry_unavailable','Đã bấm Đăng ký nhưng form chưa tải xong. Tool giữ profile mở và không bấm lại.');
  await step();
  const focused=async locator=>{check();if(!await locator.evaluate(e=>document.activeElement===e))throw Error('Ô nhập đã mất focus.');};
  const type=async(locator,value)=>{
   if(!await locator.isEditable())throw Error('Ô nhập chưa sẵn sàng.');await click(locator);await pause(250+random()*250);await focused(locator);
   if(await locator.inputValue()){await page.keyboard.press('ControlOrMeta+A');check();await page.keyboard.press('Backspace');}
   await typeFormText(value,async char=>{await focused(locator);await page.keyboard.insertText(char);},{delayMs:typingDelay,shouldContinue,random,wait:pause});
   check();if(await locator.inputValue()!==value)throw Error('Nội dung ô nhập chưa đầy đủ.');await step();
  };
  const select=async(locator,option)=>{
   await click(locator);await pause(250+random()*250);check();await page.keyboard.press('Escape');check();
   // Native select menus are OS surfaces; choose the value without Enter, which could submit a form.
   // Escape may move focus on macOS; selectOption targets the control itself, then Tab commits its blur.
   await locator.selectOption(option.value);check();if(await locator.inputValue()!==option.value)throw Error('Chưa chọn đúng giá trị trên form.');await locator.press('Tab');await step();
  };
  const receiveAndConfirmCode=async()=>{
   await onState({status:'awaiting_email_code',recipient:data.email,username:data.username,requestedAt,url:publicURL()});
   const initial=await signupState(page);if(initial?.status!=='awaiting_email_code')return result(initial?.status||'awaiting_email_code',initial?.message||'Trang nhập mã đã thay đổi. Bạn kiểm tra profile.');
   if(!getEmailCode||!requestedAt)return result('awaiting_email_code','Đang chờ mã Gmail. Bạn tự nhập mã trong profile GPM; chưa kết nối Gmail để lấy mã tự động.');
   let readyCodeField;
   for(let elapsed=0;elapsed<=10000;elapsed+=250){
    check();const state=await signupState(page);if(state&&state.status!=='awaiting_email_code')return result(state.status,state.message);
    readyCodeField=await codeInput(page);if(readyCodeField)break;if(elapsed<10000)await pause(250);
   }
   if(!readyCodeField)return result('awaiting_email_code','Ô nhập mã chưa sẵn sàng hoặc chưa xác định duy nhất. Bạn kiểm tra profile và tự nhập mã.');
   await onProgress('Đang lấy mã Instagram từ Gmail OAuth trong app · tối đa 60 giây.');
   let code;
   try{const response=await getEmailCode({recipient:data.email,after:requestedAt,shouldContinue,onProgress});check();code=response?.code;if(typeof code!=='string'||!/^\d{6}$/.test(code))throw Error();}
   catch(error){check();return result('awaiting_email_code',(error.gmailCodeError?error.message:'Không lấy được mã từ Gmail OAuth trong app. Bạn kiểm tra kết nối Gmail và nhập mã thủ công.')+' Profile được giữ mở để bạn tiếp tục.');}
   check();if(new URL(page.url()).origin!=='https://www.instagram.com')return result('awaiting_email_code','Trang Instagram đã thay đổi. Tool không điền mã; bạn kiểm tra profile.');
   let state=await signupState(page);if(state?.status!=='awaiting_email_code')return result(state?.status||'awaiting_email_code',state?.message||'Trang nhập mã đã thay đổi. Bạn kiểm tra profile.');
   const field=await codeInput(page);if(!field)return result('awaiting_email_code','Ô nhập mã đã thay đổi. Bạn kiểm tra profile và tự nhập mã.');
   await onProgress('Đã nhận mã từ Gmail OAuth trong app · đang nhập và xác nhận.');await type(field,code);await page.keyboard.press('Tab');await step();check();
   const form=field.locator('xpath=ancestor::form[1]'),panel=field.locator('xpath=ancestor::*[self::section or @role="dialog"][1]'),scope=await form.count()===1?form:await panel.count()===1?panel:page,candidates=scope.getByRole('button',{name:/^(Next|Continue|Confirm|Submit|Verify|Xác nhận|Tiếp|Tiếp tục|Gửi)$/i});let confirm;
   const enabledConfirmations=async()=>{const buttons=[];for(let i=0;i<await candidates.count();i++){const button=candidates.nth(i);if(await button.isVisible()&&await button.isEnabled())buttons.push(button);}return buttons;};
   await onProgress('Đã nhập mã · đang chờ nút xác nhận sẵn sàng.');
   for(let elapsed=0;elapsed<=10000;elapsed+=250){
    check();state=await signupState(page);if(state&&state.status!=='awaiting_email_code')return result(state.status,state.message);
    const available=await enabledConfirmations();if(available.length>1)break;if(available.length===1){confirm=available[0];break;}if(elapsed<10000)await pause(250);
   }
   if(!confirm)return result('awaiting_manual_confirmation','Đã điền mã Gmail nhưng nút xác nhận chưa sẵn sàng hoặc chưa xác định duy nhất. Bạn kiểm tra trong profile.');
   await step();check();state=await signupState(page);if(state&&state.status!=='awaiting_email_code')return result(state.status,state.message);
   const currentCode=await codeInput(page);if(!currentCode||await currentCode.inputValue()!==code||(await enabledConfirmations()).length!==1||!await confirm.isVisible()||!await confirm.isEnabled())return result('awaiting_manual_confirmation','Ô mã hoặc nút xác nhận đã thay đổi. Bạn kiểm tra trong profile.');
   emailCodeAttempted=true;await onState({status:'confirming_email_code'});await click(confirm);emailCodeSubmitted=true;
   await onState({status:'waiting_instagram_page'});await onProgress('Đã xác nhận mã · đang đợi Instagram xử lý và tải trang mới · tối đa '+Math.ceil(postCodeTimeoutMs/1000)+' giây.');
   let stableKey=null,stableSince=0;
   for(let elapsed=0;elapsed<=postCodeTimeoutMs;elapsed+=500){
    check();let snapshot;try{snapshot=await signupState(page,{withPageState:true});}catch{snapshot=null;}check();state=snapshot?.state;
    if(['challenge','code_rejected'].includes(state?.status))return result(state.status,state.message);
    if(state&&['completed','onboarding','validation_error'].includes(state.status)&&snapshot.ready&&!snapshot.busy){
     const key=state.status+' '+snapshot.url;
     if(stableKey!==key){stableKey=key;stableSince=elapsed;}
     // A transient success marker is not a finished navigation. Allow redirects/SPA updates to settle.
     if(elapsed>=3000&&elapsed-stableSince>=2000)return result(state.status,state.message);
    }else stableKey=null;
    if(elapsed>0&&elapsed%10000===0)await onProgress('Đang đợi Instagram tải trang sau xác minh · đã chờ '+elapsed/1000+' giây · không gửi lại mã.');
    if(elapsed<postCodeTimeoutMs)await pause(Math.min(500,postCodeTimeoutMs-elapsed));
   }
   return result('code_submitted_unverified','Đã xác nhận mã Gmail nhưng Instagram chưa tải xong hoặc chưa xác minh được trang tiếp theo sau '+Math.ceil(postCodeTimeoutMs/1000)+' giây. Profile được giữ mở để bạn tiếp tục; tool không gửi lại mã.');
  };
  const settledFormState=async()=>{
   let state;
   for(let elapsed=0;elapsed<=3000;elapsed+=250){state=await signupState(page,{ignoreAriaOnly:false});check();if(!['validation_error','validation_pending'].includes(state?.status))return state;if(elapsed<3000)await pause(250);}
   // A stale aria-invalid flag alone is not evidence that valid, filled fields must be blocked.
   return state?.status==='validation_pending'?signupState(page):state;
  };
  const selectOptions=locator=>locator.locator('option').evaluateAll(nodes=>nodes.map(e=>({value:e.value,text:e.textContent.trim(),disabled:e.disabled||e.parentElement?.disabled===true})));
  await step();
  // Resolve current labels every time: validation can insert or replace controls between steps.
  const target=async(type,pattern)=>{
   const fields=await page.locator('input').evaluateAll(nodes=>nodes.map((e,index)=>({index,visible:!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).opacity!=='0'&&!e.closest('[aria-hidden="true"],[hidden],[inert]'),type:e.type,name:e.name,selector:e.name?'input[name="'+CSS.escape(e.name)+'"]':null,label:[e.name,e.placeholder,e.getAttribute('aria-label'),...(e.labels||[])].map(v=>typeof v==='string'?v:v?.innerText||'').join(' ')})));
   const found=fields.filter(f=>f.visible&&(type?f.type===type:f.type!=='password')&&(!pattern||pattern.test(f.label)));if(found.length!==1)throw Error('Không xác định duy nhất ô '+(type==='password'?'mật khẩu':pattern)+'. Chưa gửi đăng ký.');
   if(type==='password')return page.locator('input[type="password"]:visible');
   const labelled=page.locator('input:visible').and(page.getByLabel(pattern).or(page.getByPlaceholder(pattern)));if(await labelled.count()===1)return labelled;
   if(found[0].selector){const named=page.locator(found[0].selector+':visible');if(await named.count()===1)return named;}
   return page.locator('input').nth(found[0].index);
  };
  const birthdayChecks=[];
  const fillBirthday=async()=>{
   const [year,month,day]=data.birthday.split('-').map(Number),dateField=page.locator('input[type="date"]');
   if(await dateField.count()===1){await click(dateField);await step();check();await dateField.fill(data.birthday);await page.keyboard.press('Tab');await step();birthdayChecks.push(async()=>await dateField.inputValue()===data.birthday);}
   else{
    // Year/month can rebuild or clamp the day options. Select the day last, then read all three back.
    for(const [part,numeric] of [['year',year],['month',month],['day',day]]){
     check();await onProgress('Đang chọn '+birthdayTitles[part]+'…');const selector=page.getByRole('combobox',{name:birthdayFields[part]});
     if(await selector.count()!==1){warnings.push('Chưa nhận diện duy nhất ô '+birthdayTitles[part]+'. Bạn kiểm tra dropdown trên form.');break;}
     const tag=await selector.evaluate(e=>e.tagName);
     if(tag==='SELECT'){
      let option;
      for(let elapsed=0;elapsed<=5000;elapsed+=250){
       check();const matches=(await selectOptions(selector)).filter(o=>!o.disabled&&birthdayValue(o.text,part)===numeric);
       if(matches.length>1)break;if(matches.length===1){option=matches[0];break;}if(elapsed<5000)await pause(250);
      }
      if(!option){warnings.push('Chưa tìm thấy một lựa chọn phù hợp cho ô '+birthdayTitles[part]+'. Bạn chọn trực tiếp trên form.');break;}await select(selector,option);
      birthdayChecks.push(async()=>await selector.count()===1&&await selector.inputValue()===option.value);
     }else{
      await click(selector);await step();let option;
      for(let elapsed=0;elapsed<=5000;elapsed+=250){
       check();const controlled=await selector.getAttribute('aria-controls')||await selector.getAttribute('aria-owns');let scope=controlled?null:page;
       if(controlled){const boxes=page.getByRole('listbox');for(let i=0;i<await boxes.count();i++){const box=boxes.nth(i);if(controlled.split(/\s+/).includes(await box.getAttribute('id'))&&await box.isVisible()){scope=box;break;}}}
       if(!scope){if(elapsed<5000)await pause(250);continue;}
       const candidates=scope.getByRole('option'),rows=await candidates.evaluateAll(nodes=>nodes.map((e,index)=>({index,text:e.getAttribute('aria-label')||e.innerText||e.textContent,visible:!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',disabled:e.getAttribute('aria-disabled')==='true'||e.disabled===true}))),matches=rows.filter(o=>o.visible&&!o.disabled&&birthdayValue(o.text,part)===numeric);
       if(matches.length>1)break;if(matches.length===1){option=candidates.nth(matches[0].index);break;}if(elapsed<5000)await pause(250);
      }
      if(!option){await page.keyboard.press('Escape');warnings.push('Dropdown '+birthdayTitles[part]+' chưa tải hoặc lựa chọn bị trùng. Bạn kiểm tra trực tiếp trên form.');break;}
      await click(option);await page.keyboard.press('Tab');await step();
      birthdayChecks.push(async()=>await selector.count()===1&&birthdayValue(await selector.evaluate(e=>e.tagName==='INPUT'?e.value:e.getAttribute('aria-valuetext')||e.innerText||''),part)===numeric);
     }
    }
   }
   for(const verify of birthdayChecks){check();if(!await verify()){warnings.push('Ngày sinh trên form đã thay đổi sau khi chọn. Bạn kiểm tra lại ngày, tháng và năm; chưa gửi đăng ký.');break;}}
   if(!warnings.length)await onProgress('Đã chọn đủ ngày sinh · đang kiểm tra dữ liệu form.');
  };
  const textFields=[{title:'email',value:data.email,pattern:/email|mobile number|số điện thoại/i},{title:'mật khẩu',value:data.password,type:'password'},{title:'tên hiển thị',value:data.fullName,pattern:/full.?name|họ.*tên|tên đầy đủ|^name\b/i},{title:'username',value:data.username,pattern:/username|user.?name|tên người dùng/i}],plan=[];
  const position=locator=>locator.evaluate(e=>{const r=e.getBoundingClientRect();return {top:r.top+scrollY,left:r.left+scrollX};});
  for(const field of textFields){if(!field.value){warnings.push('Bạn tự nhập mật khẩu trong trình duyệt.');continue;}const locator=await target(field.type,field.pattern);plan.push({...await position(locator),run:async()=>{await onProgress('Đang điền '+field.title+'…');await type(await target(field.type,field.pattern),field.value);}});}
  if(data.birthday){const date=page.locator('input[type="date"]:visible'),combos=page.getByRole('combobox',{name:/\b(?:month|day|year)\b|năm|tháng|ngày/i}),first=await date.count()===1?date:combos.first(),location=await first.count()?await position(first):{top:Infinity,left:0};plan.push({...location,run:async()=>{await onProgress('Đang chọn ngày sinh…');await fillBirthday();}});}
  plan.sort((a,b)=>Math.abs(a.top-b.top)>2?a.top-b.top:a.left-b.left);
  for(const action of plan){check();await action.run();}
  check();const gender=page.getByRole('combobox',{name:/^gender$|^giới tính$/i});
  if(await gender.count()===1){const tag=await gender.evaluate(e=>e.tagName);if(tag==='SELECT'){const options=await selectOptions(gender);const female=options.find(o=>!o.disabled&&/^(female|nữ)$/i.test(o.text));if(female)await select(gender,female);}}
  check();
  if(warnings.length)return result('form_incomplete','Đã điền các ô nhận diện được; chưa gửi đăng ký. '+warnings.join(' '));
  let state=await settledFormState();check();if(state)return result(state.status,state.message);
  const submit=page.getByRole('button',{name:/^(Sign up|Submit|Đăng ký|Tạo tài khoản|Create account|Create new account)$/i});
  if(await submit.count()!==1)return result('submit_unavailable','Chưa xác định duy nhất nút đăng ký. Bạn kiểm tra form và tự bấm xác nhận trong Instagram.');
  for(let i=0;i<20&&!await submit.isEnabled();i++){await pause(500);state=await signupState(page);if(state)return result(state.status,state.message);}
  if(!await submit.isEnabled()){const pending=await signupState(page,{ignoreAriaOnly:false});return result('submit_unavailable','Nút đăng ký chưa khả dụng. '+(pending?.message||'Kiểm tra các ô hoặc thông báo trên form.'));}
  await step();check();
  const currentURL=new URL(page.url());if(currentURL.origin!=='https://www.instagram.com'||!currentURL.pathname.startsWith('/accounts/emailsignup'))return result('submit_unavailable','Trang đăng ký đã thay đổi. Bạn tiếp tục trực tiếp trong trình duyệt.');
  for(const field of textFields)if(await(await target(field.type,field.pattern)).inputValue()!==field.value)return result('form_incomplete','Thông tin trên form đã thay đổi. Bạn kiểm tra trước khi gửi đăng ký.');
  for(const verify of birthdayChecks)if(!await verify())return result('form_incomplete','Ngày sinh trên form đã thay đổi. Bạn kiểm tra trước khi gửi đăng ký.');
  check();state=await settledFormState();check();if(state)return result(state.status,state.message);
  // One submission attempt only. Do not retry when navigation or acknowledgement is uncertain.
  requestedAt=Math.floor(Date.now()/1000);await onState({status:'submitting',recipient:data.email,username:data.username,requestedAt,url:publicURL()});check();submissionAttempted=true;await click(submit);submitted=true;
  for(let elapsed=0;elapsed<=confirmationTimeoutMs;elapsed+=500){
   check();try{state=await signupState(page);}catch{state=null;}check();if(state)return state.status==='awaiting_email_code'?await receiveAndConfirmCode():result(state.status,state.message);
   if(elapsed<confirmationTimeoutMs)await pause(Math.min(500,confirmationTimeoutMs-elapsed));
  }
  return result('submitted_unverified','Đã bấm đăng ký nhưng chưa nhận diện được bước nhập mã. Kiểm tra profile GPM; tool không tự bấm lại hoặc tự nhập mã.');
 }catch(e){
  if(emailCodeSubmitted&&/Đã hủy|Đã dừng/i.test(e.message))return result('code_submission_unknown','Đã dừng khi đang đợi Instagram tải trang sau xác minh. Profile được giữ mở; tool không gửi lại mã.');
  if(submissionAttempted)return result(emailCodeAttempted?'code_submission_unknown':'submission_unknown',emailCodeAttempted?'Đã bắt đầu xác nhận mã Gmail nhưng chưa rõ kết quả. Kiểm tra profile; tool không tự nhập hoặc gửi mã lại.':/Đã hủy|Đã dừng/i.test(e.message)?'Đã dừng sau khi bắt đầu đăng ký hoặc trong lúc chờ mã Gmail. Kiểm tra profile trước khi thử lại.':'Đã bắt đầu bấm đăng ký nhưng chưa xác minh được kết quả. Kiểm tra profile trước khi thử lại; tool không tự gửi lại.');throw Error('Chưa chuẩn bị xong form Instagram. '+(/Đã hủy|Đã dừng/i.test(e.message)?'Đã hủy do Dừng.':'Kiểm tra trang đăng ký đang mở và điền thủ công nếu giao diện đã thay đổi.'));
 }finally{await page.evaluate(formPointer,{key:pointerKey,action:'dispose'}).catch(()=>{});await session?.detach().catch(()=>{});}
}

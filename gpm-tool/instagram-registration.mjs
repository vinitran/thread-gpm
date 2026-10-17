import {randomInt} from 'node:crypto';
export const INSTAGRAM_SIGNUP_URL='https://www.instagram.com/accounts/emailsignup/';
export function randomRegistrationBirthday(){
 const start=Date.UTC(2004,0,1),days=(Date.UTC(2008,0,1)-start)/86400000;
 return new Date(start+randomInt(days)*86400000).toISOString().slice(0,10);
}
export function registrationDraft(profile){
 const names=String(profile.name||profile.profileName||'').trim(),emails=names.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:gmail|googlemail)\.com\b/gi)||[];
 const email=emails.length===1?emails[0]:'';
 return {profileId:profile.id||profile.profileId,email,fullName:'',username:'',gender:'female'};
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
export async function prepareInstagramRegistration(context,input,{shouldContinue=()=>true}={}){
 const data=validateRegistration(input),warnings=[];
 const check=()=>{if(!shouldContinue())throw Error('Đã hủy chuẩn bị đăng ký do Dừng.');};
 check();const page=await context.newPage();
 try{
  await page.goto(INSTAGRAM_SIGNUP_URL,{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();check();
  const current=new URL(page.url());
  if(current.origin!=='https://www.instagram.com'||!current.pathname.startsWith('/accounts/emailsignup'))return {ok:true,ready:false,url:page.url(),message:'Profile có thể đã đăng nhập hoặc Instagram chuyển trang. Kiểm tra trình duyệt; tool không đăng xuất tài khoản hiện có.'};
  const challenge=page.locator('iframe[src*="captcha"],iframe[title*="challenge" i],[data-sitekey]');
  if(await challenge.count())return {ok:true,ready:false,url:page.url(),message:'Instagram yêu cầu xác minh. Bạn tự xử lý trong trình duyệt rồi mở lại luồng.'};
  await page.locator('input:visible').first().waitFor({state:'visible',timeout:15000});check();
  // Read only labels/attributes, never values or account/session internals.
  const fields=await page.locator('input').evaluateAll(nodes=>nodes.map((e,index)=>({index,visible:!!e.getClientRects().length,type:e.type,label:[e.name,e.placeholder,e.getAttribute('aria-label'),...(e.labels||[])].map(v=>typeof v==='string'?v:v?.innerText||'').join(' ')})));
  const target=(type,pattern)=>{const found=fields.filter(f=>f.visible&&(type?f.type===type:f.type!=='password')&&(!pattern||pattern.test(f.label)));if(found.length!==1)throw Error('Không xác định duy nhất ô '+(type==='password'?'mật khẩu':pattern)+'. Chưa gửi đăng ký.');return page.locator('input').nth(found[0].index);};
  for(const [value,pattern] of [[data.email,/email|mobile number|số điện thoại/i],[data.fullName,/full.?name|họ.*tên|tên đầy đủ|^name\b/i],[data.username,/username|user.?name|tên người dùng/i]]){check();await target(null,pattern).fill(value);}
  if(data.password){check();await target('password').fill(data.password);}else warnings.push('Bạn tự nhập mật khẩu trong trình duyệt.');
  if(data.birthday){
   const [year,month,day]=data.birthday.split('-').map(Number),dateField=page.locator('input[type="date"]');
   if(await dateField.count()===1){check();await dateField.fill(data.birthday);}
   else{
    const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    for(const [field,value] of [[/select month|tháng/i,months[month-1]],[/select day|ngày/i,String(day)],[/select year|năm/i,String(year)]]){
     check();const selector=page.getByRole('combobox',{name:field});
     if(await selector.count()!==1){warnings.push('Bạn chọn ngày sinh chính xác trên form.');break;}
     const tag=await selector.evaluate(e=>e.tagName);
     if(tag==='SELECT'){
      const options=await selector.locator('option').evaluateAll(nodes=>nodes.map(e=>({value:e.value,text:e.textContent.trim()})));
      const numeric=field.source.includes('month')?month:Number(value),option=options.find(o=>o.text===value)||options.find(o=>o.text===String(numeric))||options.find(o=>o.value===String(numeric));
      if(!option){warnings.push('Bạn chọn ngày sinh chính xác trên form.');break;}await selector.selectOption(option.value);
     }else{await selector.click();const option=page.getByRole('option',{name:value,exact:true});if(await option.count()!==1){await page.keyboard.press('Escape');warnings.push('Bạn chọn ngày sinh chính xác trên form.');break;}await option.click();}
    }
   }
  }
  check();const gender=page.getByRole('combobox',{name:/^gender$|^giới tính$/i});
  if(await gender.count()===1){const tag=await gender.evaluate(e=>e.tagName);if(tag==='SELECT'){const options=await gender.locator('option').evaluateAll(nodes=>nodes.map(e=>({value:e.value,text:e.textContent.trim()})));const female=options.find(o=>/^(female|nữ)$/i.test(o.text));if(female)await gender.selectOption(female.value);}}
  // Handoff only: never submit, press Enter, solve a challenge, or send confirmation codes.
  return {ok:true,ready:true,url:page.url(),email:data.email,username:data.username,warnings,message:'Đã điền form. Kiểm tra thông tin và tự bấm Submit trong Instagram. '+warnings.join(' ')};
 }catch(e){throw Error('Chưa chuẩn bị xong form Instagram. '+(/Đã hủy/.test(e.message)?'Đã hủy do Dừng.':'Kiểm tra trang đăng ký đang mở và điền thủ công nếu giao diện đã thay đổi.'));}
}

// Màn hình mở khoá key AI đi kèm app: nhập mật khẩu 1 lần trên máy này.
let gate=null;
const el=(tag,props={},children=[])=>{const node=Object.assign(document.createElement(tag),props);node.append(...children);return node;};
async function state(){const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('Không tải được trạng thái tool.');return r.json();}
async function unlock(password,retry=true){
 const {token}=await state();
 const r=await fetch('/api/unlock-key',{method:'POST',headers:{'Content-Type':'application/json','X-Tool-Token':token},body:JSON.stringify({password})});
 const result=await r.json().catch(()=>({}));
 if(r.status===403&&retry&&result.error==='Invalid origin/token')return unlock(password,false);
 if(!r.ok)throw Error(result.error||'Không mở khoá được key AI.');
 return result;
}
function show(){
 if(gate)return;
 const input=el('input',{type:'password',id:'unlock-password',autocomplete:'current-password',maxLength:200,required:true});
 const message=el('p',{className:'unlock-message',role:'alert'});
 const submit=el('button',{type:'submit',textContent:'Mở khoá'});
 const form=el('form',{className:'unlock-card'},[
  el('h2',{textContent:'Nhập mật khẩu mở app'}),
  el('p',{textContent:'App có sẵn key AI đã mã hoá. Nhập mật khẩu 1 lần, key sẽ được lưu trên máy này.'}),
  el('label',{htmlFor:'unlock-password',textContent:'Mật khẩu'}),input,message,submit,
 ]);
 form.addEventListener('submit',async event=>{
  event.preventDefault();submit.disabled=true;message.textContent='Đang kiểm tra mật khẩu…';
  try{await unlock(input.value);location.reload();}
  catch(e){message.textContent=e.message;submit.disabled=false;input.select();}
 });
 gate=el('div',{className:'unlock-gate',role:'dialog'},[form]);gate.setAttribute('aria-modal','true');
 document.body.append(gate);input.focus();
}
async function check(){
 try{if((await state()).keyLocked)show();else{gate?.remove();gate=null;}}
 catch{setTimeout(check,2000);}
}
check();

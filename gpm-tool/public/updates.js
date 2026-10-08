const $=id=>document.getElementById(id);
let status,busy=false;
function render(){
 $('app-version').textContent='Phiên bản '+(status?.currentVersion||'');
 $('check-update').disabled=busy||!status?.repository;
 $('install-update').hidden=!status?.available||!status?.installSupported;
 $('install-update').disabled=busy;
 if(!busy)$('update-status').textContent=!status?.repository?'Bản chạy từ source. Các bản DMG/EXE phát hành qua CI có cập nhật trong app.':status.available?'Có bản '+status.latestVersion+'. Dừng các profile trước khi cài.':status.checkError?'Chưa xác định được bản mới nhất: '+status.checkError:status.checkedAt?'Bạn đang dùng bản mới nhất.':'Kiểm tra bản mới từ GitHub Releases.';
}
async function request(route,body){
 const state=body===undefined?null:await fetch('/api/state').then(r=>r.json());
 const r=await fetch('/api/'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Tool-Token':state.token},body:JSON.stringify(body)});
 const v=await r.json();if(!r.ok)throw Error(v.error||'Không kiểm tra được bản cập nhật.');return v;
}
async function check(quiet=false){
 busy=true;render();$('update-status').textContent='Đang kiểm tra bản cập nhật…';$('check-update').classList.add('is-loading');
 try{status=await request('update-check',{});busy=false;render();}
 catch(e){busy=false;render();$('update-status').textContent=quiet?'Chưa kiểm tra được bản mới. Bạn có thể thử lại.':e.message;}
 finally{$('check-update').classList.remove('is-loading');}
}
$('check-update').onclick=()=>check();
$('install-update').onclick=async()=>{
 try{
 const state=await request('state');
 if((state.profiles||[]).some(p=>['running','stopping'].includes(p.view?.state?.status)||p.view?.operation)||state.operation){$('update-status').textContent='Dừng các profile và đợi thao tác hoàn tất trước khi cài cập nhật.';return;}
 if(document.getElementById('dirty')?.dataset.state==='changed'){$('update-status').textContent='Lưu các cài đặt đang sửa trước khi cài cập nhật.';return;}
 busy=true;render();$('install-update').classList.add('is-loading');$('update-status').textContent='Đang tải và xác minh bản mới. Giữ app mở…';
 let polling=false;const progressTimer=setInterval(async()=>{if(polling)return;polling=true;try{const v=await request('update-status');if(v.download?.message)$('update-status').textContent=v.download.message;}catch{}finally{polling=false;}},500);
 try{await request('update-install',{});}finally{clearInterval(progressTimer);}$('update-status').textContent='Đang mở lại tool với bản mới…';
  let tries=0;const timer=setInterval(async()=>{try{const v=await request('update-status');if(v.currentVersion!==status.currentVersion){clearInterval(timer);location.reload();}}catch{}if(++tries>60){clearInterval(timer);busy=false;render();$('update-status').textContent='Hãy mở lại app và kiểm tra phiên bản. Nếu lỗi, xem update-error.txt trong thư mục dữ liệu.';}},2000);
 }catch(e){busy=false;render();$('update-status').textContent=e.message;}
 finally{$('install-update').classList.remove('is-loading');}
};
try{status=await request('update-status');render();if(status.installSupported&&status.repository)setTimeout(()=>check(true),3000);}catch{$('update-status').textContent='Không tải được thông tin phiên bản.';}

import {initAutoUI} from './auto-ui.js';
import {saveFolder,readFolder,selectReplyAssets} from './reply-assets.js';
const $=id=>document.getElementById(id);
const live=!!globalThis.chrome?.runtime?.id;
let savedPrompt='',saving=false,active=false,stepLoaded=false;
async function send(message){
 if(!live)throw Error('Cài extension vào Chrome để sử dụng.');
 const result=await chrome.runtime.sendMessage(message);
 if(!result?.ok)throw Error(result?.error||'Extension không trả lời');return result;
}
function error(e){$('error').hidden=false;$('error').textContent=e.message;}
function promptStatus(){ $('prompt-status').textContent=$('ai-prompt').value===savedPrompt?'Đang hiển thị prompt đã lưu, được dùng để tạo response.':'Có thay đổi chưa lưu · bấm Lưu prompt & cấu hình AI để áp dụng.'; }
function controls(){
 for(const id of ['save-ai','api-key','ai-model','choose-folder','comment-delay'])$(id).disabled=active||saving;
 $('ai-prompt').readOnly=active||saving;
 $('settings-status').textContent=active?'Phiên đang chạy · dừng phiên để chỉnh cài đặt.':'Cài đặt phiên áp dụng khi bấm Start. Prompt và cấu hình AI cần bấm Lưu.';
}
$('ai-prompt').addEventListener('input',promptStatus);
$('save-ai').onclick=async()=>{
 if(saving)return;saving=true;controls();$('error').hidden=true;
 try{await send({type:'save-ai-settings',apiKey:$('api-key').value,model:$('ai-model').value.trim(),prompt:$('ai-prompt').value});savedPrompt=$('ai-prompt').value;$('api-key').value='';$('ai-config-status').textContent='Đã lưu prompt và cấu hình AI.';promptStatus();}
 catch(e){error(e);}finally{saving=false;controls();}
};
$('load-models').onclick=async()=>{try{const r=await send({type:'ai-models'});$('model-list').replaceChildren(...r.models.map(id=>{const o=document.createElement('option');o.value=id;return o;}));$('ai-config-status').textContent=`Đã tải ${r.models.length} model.`;}catch(e){error(e);}};
$('choose-folder').onclick=()=>$('reply-folder').click();
$('reply-folder').onchange=async()=>{try{const r=await saveFolder([...$('reply-folder').files]);$('folder-status').textContent=`${r.folder} · ${r.count} ảnh · app_store.png ở giữa`;}catch(e){error(e);}finally{$('reply-folder').value='';}};
$('home').onclick=()=>send({type:'open-home'}).catch(error);
async function loadAI(){const r=await send({type:'get-ai-settings'});$('ai-model').value=r.settings.model;savedPrompt=r.settings.prompt||'';$('ai-prompt').value=savedPrompt;promptStatus();$('ai-config-status').textContent=r.settings.usingDefaultKey?'Đang dùng key mặc định.':r.settings.hasKey?'Đang dùng key đã lưu.':'Chưa có API key.';}
async function loadImages(){const files=await readFolder();selectReplyAssets(files);$('folder-status').textContent=`Đã có ${files.length} ảnh · app_store.png ở giữa`;}
if(live){
 initAutoUI({send,onError:error,onState:state=>{active=['running','stopping'].includes(state.status);controls();if(!stepLoaded){$('comment-delay').value=state.config?.stepSeconds??2;stepLoaded=true;}}});
 Promise.allSettled([loadAI(),loadImages()]).then(results=>{for(const result of results)if(result.status==='rejected')error(result.reason);});
}else{error(Error('Cài extension vào Chrome để sử dụng.'));for(const button of document.querySelectorAll('button'))button.disabled=true;}

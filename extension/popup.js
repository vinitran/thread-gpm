async function send(type){try{const r=await chrome.runtime.sendMessage({type});if(!r?.ok)throw Error(r?.error||'Extension không trả lời');}catch(e){document.querySelector('#status').textContent=e.message;}}
document.querySelector('#home').onclick=()=>send('open-home');
document.querySelector('#inspect').onclick=()=>send('open-inspector');

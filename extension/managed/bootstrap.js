(async()=>{try{
 const config=JSON.parse(decodeURIComponent(location.hash.slice(1)));history.replaceState(null,'',location.pathname);
 const result=await chrome.runtime.sendMessage({type:'configure-managed',config});if(!result.ok)throw Error(result.error);
 document.getElementById('status').textContent='Đã kết nối extension với app.';document.body.dataset.ready='true';
}catch(e){document.getElementById('status').textContent=e.message;document.body.dataset.error='true';}})();

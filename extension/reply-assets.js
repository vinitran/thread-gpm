const DB='threads-reply-assets';
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('images',{keyPath:'path'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveFolder(files){
  const images=files.filter(f=>/\.(png|jpe?g|webp)$/i.test(f.name)).map(f=>({path:f.webkitRelativePath||f.name,name:f.name,blob:f}));
  selectReplyAssets(images);
  if(images.length>200||images.reduce((sum,f)=>sum+f.blob.size,0)>200*1024*1024||images.some(f=>f.blob.size>10*1024*1024))throw Error('Folder tối đa 200 ảnh, tổng 200 MB, mỗi ảnh tối đa 10 MB.');
  const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite'),store=tx.objectStore('images');store.clear();images.forEach(im=>store.put(im));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Không lưu được folder.'));});}finally{db.close();}
  return {count:images.length,folder:images[0].path.split('/')[0]};
}
export async function readFolder(){
  const db=await database();let saved;
  try{saved=await new Promise((resolve,reject)=>{const r=db.transaction('images').objectStore('images').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
  if(saved.length){
    const name='hoan-xu-thong-bao-hoan-tien.png';
    if(!saved.some(im=>im.name.toLowerCase()===name)){
      const response=await fetch(chrome.runtime.getURL('default-assets/'+name));
      if(!response.ok)throw Error('Không đọc được ảnh bổ sung '+name);
      saved.push({name,path:'hoan xu image/'+name,blob:await response.blob()});
    }
    return saved;
  }
  const response=await fetch(chrome.runtime.getURL('default-assets/index.json'));
  if(!response.ok)throw Error('Không tìm thấy bộ ảnh mặc định.');
  const names=await response.json();const files=[];
  for(const name of names){const r=await fetch(chrome.runtime.getURL('default-assets/'+encodeURIComponent(name)));if(!r.ok)throw Error('Không đọc được ảnh mặc định '+name);files.push({name,path:'hoan xu image/'+name,blob:await r.blob()});}
  return files;
}
export function selectReplyAssets(images,random=Math.random){
  const app=images.filter(im=>im.name.toLowerCase()==='app_store.png');
  const root=app.filter(im=>im.path.split('/').length===2),center=root.length===1?root[0]:app.length===1?app[0]:null;
  if(!center)throw Error('Folder cần đúng một app_store.png ở thư mục gốc.');
  const others=images.filter(im=>im.name.toLowerCase()!=='app_store.png');
  if(others.length<2)throw Error('Folder cần ít nhất 2 ảnh khác ngoài app_store.png.');
  const pool=[...others];for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  return [pool[0],center,pool[1]];
}
export async function uploadImage(im){
  if(im.blob.size<700*1024)return {blob:im.blob,name:im.name};
  const bitmap=await createImageBitmap(im.blob);
  try{
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.88});
    return blob.size<im.blob.size?{blob,name:im.name.replace(/\.[^.]+$/,'.jpg')}:{blob:im.blob,name:im.name};
  }finally{bitmap.close();}
}
export async function makeReplyAttachments(images,{optimizeUpload=false}={}){
  if(images.length!==3)throw Error('Comment cần tổng 3 ảnh riêng lẻ.');
  const files=[];
  for(const im of images){
    const transport=optimizeUpload?await uploadImage(im):{blob:im.blob,name:im.name};
    const type=/\.png$/i.test(transport.name)?'image/png':/\.webp$/i.test(transport.name)?'image/webp':'image/jpeg';
    const bytes=new Uint8Array(await transport.blob.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    files.push({name:transport.name,type,size:transport.blob.size,data_url:'data:'+type+';base64,'+btoa(binary)});
  }
  return {files,names:images.map(im=>im.path)};
}

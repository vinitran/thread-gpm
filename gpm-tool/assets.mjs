import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {selectReplyAssets,makeReplyAttachments} from '../extension/reply-assets.js';
const bundled=fileURLToPath(new URL('../extension/default-assets/',import.meta.url)),cache=new Map();
export async function listAssets(folder=''){
 const dir=folder?path.resolve(folder):bundled;
 const names=folder?(await fs.readdir(dir,{withFileTypes:true})).filter(e=>e.isFile()&&/\.(png|jpe?g|webp)$/i.test(e.name)).map(e=>e.name):JSON.parse(await fs.readFile(path.join(dir,'index.json'),'utf8'));
 if(names.length>200)throw Error('Folder ảnh tối đa 200 file.');let total=0;const files=[];
 for(const name of names){const filename=path.join(dir,name),stat=await fs.stat(filename);if(stat.size>10*1024*1024)throw Error('Ảnh vượt 10 MB: '+name);total+=stat.size;files.push({name,path:'images/'+name,filename,size:stat.size,mtime:stat.mtimeMs});}
 if(total>200*1024*1024)throw Error('Folder ảnh vượt 200 MB.');selectReplyAssets(files);
 return {dir,files,total};
}
export async function assetSummary(folder=''){const r=await listAssets(folder);return {folder:r.dir,count:r.files.length,bytes:r.total,names:r.files.map(f=>f.name),source:folder?'custom':'bundled'};}
export async function attachments(folder=''){
 const {files}=await listAssets(folder);const picked=selectReplyAssets(files),images=[];
 for(const file of picked){const key=[file.filename,file.size,file.mtime].join('|');let transport=cache.get(key);
  if(!transport){let bytes=await fs.readFile(file.filename),name=file.name;
   // Decode all formats once to catch broken images before opening a reply.
   const image=sharp(bytes,{limitInputPixels:40000000});await image.metadata();
   if(bytes.length>=700*1024){const jpg=await image.resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();if(jpg.length<bytes.length){bytes=jpg;name=name.replace(/\.[^.]+$/,'.jpg');}}
   transport={name,blob:new Blob([bytes])};cache.set(key,transport);if(cache.size>12)cache.delete(cache.keys().next().value);
  }images.push({...file,...transport});
 }return makeReplyAttachments(images);
}

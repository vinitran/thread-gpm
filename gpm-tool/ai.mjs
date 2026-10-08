import sharp from 'sharp';
import {API_BASE,imageSources,allowedImage,collageLayout,requestBody,selectPosts as selectRatedPosts} from '../extension/ai.js';
export const AI_TIMEOUT_MS=90000;
export function selectPosts(posts,settings,topics,onRatingError){
 return selectRatedPosts(posts,settings,topics,{requireAllRatings:false,timeoutMs:AI_TIMEOUT_MS,onRatingError});
}
export async function collage(post){
 const sources=imageSources(post);if(!sources.length)return null;
 const buffers=[],sizes=[];
 for(const src of sources){
  if(!allowedImage(src))throw Error('Ảnh ngoài CDN Threads.');
  const response=await fetch(src,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Không tải được ảnh bài viết: HTTP '+response.status);
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>10*1024*1024){await reader.cancel();throw Error('Ảnh bài viết vượt 10 MB');}chunks.push(r.value);}
  const buf=Buffer.concat(chunks);const metadata=await sharp(buf,{limitInputPixels:40000000}).metadata();buffers.push(buf);sizes.push({width:metadata.width,height:metadata.height});
 }
 const layout=collageLayout(sizes),layers=[];
 for(let i=0;i<buffers.length;i++){const c=layout.cells[i];layers.push({input:await sharp(buffers[i]).resize(c.width,c.height,{fit:'fill'}).toBuffer(),left:c.x,top:c.y});}
 const jpg=await sharp({create:{width:layout.width,height:layout.height,channels:3,background:'#ffffff'}}).composite(layers).jpeg({quality:85}).toBuffer();
 return {data_url:'data:image/jpeg;base64,'+jpg.toString('base64'),image_count:sources.length};
}
export async function generate(post,settings,withImages){
 const configured={...settings};if(!withImages)configured.prompt+='\nLượt này chỉ có chữ, giữ giọng văn trên và thêm đúng @hoanxu.app một lần khi giới thiệu tài khoản Threads Hoàn Xu. Không nói có ảnh đính kèm. Tối đa 450 ký tự.';
 const merged=await collage(post),body=requestBody(post,configured,merged);
 const r=await fetch(API_BASE+'/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+configured.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(AI_TIMEOUT_MS)});
 if(!r.ok)throw Error('Hoàn Xu AI HTTP '+r.status);
 const data=await r.json();let text=data.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw Error('AI chưa trả response chữ');
 if(!withImages&&!text.includes('@hoanxu.app'))text=[...text].slice(0,475).join('').trimEnd()+' @hoanxu.app';
 return {text,model:configured.model,created_at:new Date().toISOString()};
}

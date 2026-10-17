import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {registrationUsername} from './instagram-registration.mjs';
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
export async function generate(post,settings,withImages,tagHoanxu=false){
 const configured={...settings};
 const tag=tagHoanxu&&settings.runConfig?.tagHoanxu===true;
 configured.prompt+='\n'+(tag?'Lượt này thêm đúng @hoanxu.app một lần.':'Lượt này không được nhắc hay tag @hoanxu.app, kể cả khi hướng dẫn trước yêu cầu.');
 if(!withImages)configured.prompt+='\nLượt này chỉ có chữ. Không nói có ảnh đính kèm. Tối đa 450 ký tự.';
 const merged=await collage(post),body=requestBody(post,configured,merged);
 const r=await fetch(API_BASE+'/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+configured.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(AI_TIMEOUT_MS)});
 if(!r.ok)throw Error('Hoàn Xu AI HTTP '+r.status);
 const data=await r.json();let text=data.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw Error('AI chưa trả response chữ');
 text=text.replace(/@hoanxu\.app\b/gi,'').trim();
 if(!text.trim())throw Error('AI chưa trả nội dung bình luận hợp lệ');
 if(tag)text=[...text].slice(0,475).join('').trimEnd()+' @hoanxu.app';
 return {text,model:configured.model,created_at:new Date().toISOString()};
}

export async function generateRegistrationIdentity(settings,{fetchImpl=globalThis.fetch}={}){
 if(!settings.apiKey?.trim())throw Error('Lưu API key trong Cài đặt trước khi tạo tên Instagram bằng AI.');
 if(!settings.model?.trim())throw Error('Chọn và lưu model AI trước khi tạo tên Instagram.');
 const body={model:settings.model,max_tokens:500,messages:[
  {role:'system',content:'Tạo một biệt danh nữ Việt Nam hư cấu để bảo vệ tên thật. Không mô phỏng một cá nhân cụ thể, người nổi tiếng hoặc thương hiệu. fullName là tên nữ Việt Nam tự nhiên gồm 2–5 từ, dùng tiếng Việt có dấu. Mỗi yêu cầu tạo tên mới, đa dạng họ và tên. Chỉ trả một object JSON có duy nhất khóa fullName là chuỗi. Không tạo username. Không Markdown, giải thích hay trường khác.'},
  {role:'user',content:JSON.stringify({requestId:randomUUID(),task:'Tạo một tên nữ Việt Nam hư cấu mới.'})}
 ]};
 let response;
 try{response=await fetchImpl(API_BASE+'/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+settings.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(AI_TIMEOUT_MS)});}catch(e){throw Error(e.name==='TimeoutError'?'AI tạo tên quá thời gian 90 giây. Bấm Đăng ký Instagram để thử lại.':'Không kết nối được AI để tạo tên. Kiểm tra kết nối rồi thử lại.');}
 if(!response.ok)throw Error('AI tạo tên · HTTP '+response.status+'. Kiểm tra model và API key đã lưu rồi thử lại.');
 let identity;
 try{const result=await response.json(),content=result.choices?.[0]?.message?.content;if(typeof content!=='string')throw Error();identity=JSON.parse(content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('AI tạo tên chưa trả JSON hợp lệ. Bấm Đăng ký Instagram để thử lại.');}
 const fullName=typeof identity?.fullName==='string'?identity.fullName.normalize('NFC').trim().replace(/\s+/g,' '):'';
 if(!/^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+){1,4}$/u.test(fullName)||fullName.length>100)throw Error('AI tạo tên không hợp lệ. Bấm Đăng ký Instagram để thử lại.');
 return {fullName,username:registrationUsername(fullName)};
}

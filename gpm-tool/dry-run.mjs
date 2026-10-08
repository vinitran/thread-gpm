import {autoPage} from '../extension/auto-dom.js';
import {extractPosts} from '../extension/extract.js';
import {generate,selectPosts} from './ai.mjs';
// One pass through read + AI only. It never imports posting or engagement code.
export async function dryRunProfile(browser,settings,{classify=selectPosts,respond=generate}={}){
 const tabs=(await browser.query()).filter(t=>t.url.startsWith('https://www.threads.com/'));
 const tab=tabs.find(t=>new URL(t.url).pathname==='/')||tabs[0];
 if(!tab)throw Error('Mở Threads và đăng nhập trong profile trước khi chạy thử.');
 const health=await browser.evaluate(tab.id,autoPage,['check']);
 const batch=await browser.evaluate(tab.id,extractPosts,[{limit:10,mode:'feed'}]);
 const posts=(batch.posts||[]).filter(p=>p.author!==health.self);
 const result={ok:true,dryRun:true,model:settings.model,self:health.self,scanned:posts.length,selected:0,createdAt:new Date().toISOString()};
 if(!posts.length)return {...result,message:'Đã kết nối Threads · chưa có bài trên màn hình để kiểm tra AI.'};
 if(!settings.apiKey)throw Error('Đã kết nối Threads. Nhập API key để kiểm tra bước AI.');
 const urls=await classify(posts,settings,settings.runConfig.keywords);
 const post=posts.find(p=>urls.includes(p.url));result.selected=posts.filter(p=>urls.includes(p.url)).length;
 if(!post)return {...result,message:'AI đã đọc bài · chưa chọn được bài phù hợp chủ đề.'};
 const response=await respond(post,settings,false);
 return {...result,postUrl:post.url,preview:response.text,message:'Đã tạo bản xem trước · không đăng bình luận và không thả tim.'};
}

import {autoPage} from '../extension/auto-dom.js';
import {extractPosts} from '../extension/extract.js';
import {generate,selectPosts} from './ai.mjs';
import {MIN_SCORE} from '../extension/ai.js';
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
 const picks=(await classify(posts,settings,settings.runConfig.keywords)).map(p=>typeof p==='string'?{url:p,score:100,topic:''}:p);
 // Preview a promotion, so only posts that would get a promotion slot qualify.
 const fit=picks.filter(p=>p.score>=MIN_SCORE.promotion),best=picks[0],pick=fit[0],post=pick&&posts.find(p=>p.url===pick.url);
 const describe=p=>p.score+' điểm'+(p.topic?' · chủ đề '+p.topic:'');
 result.selected=fit.length;result.regular=picks.length-fit.length;result.ratings=picks.slice(0,10);
 if(!post)return {...result,message:'AI đã đọc '+posts.length+' bài · chưa có bài đạt '+MIN_SCORE.promotion+' điểm cho lượt giới thiệu'+(best?' · cao nhất '+describe(best)+' (chỉ đủ cho trả lời thường)':' · không bài nào thuộc chủ đề')+'.'};
 const response=await respond(post,settings,false);
 return {...result,postUrl:post.url,preview:response.text,message:'Chọn @'+post.author+' · '+describe(pick)+' · '+fit.length+' bài đạt lượt giới thiệu, '+result.regular+' bài chỉ đủ trả lời thường · đã tạo bản xem trước, không đăng bình luận và không thả tim.'};
}

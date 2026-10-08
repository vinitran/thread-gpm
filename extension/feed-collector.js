export async function collectFreshPosts({read,scroll,shouldContinue=()=>true,onProgress=async()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),targetCount=10,maxScrolls=10}){
 const collected=new Map();let latest,scrolls=0;
 for(;;){
  if(!shouldContinue())break;
  latest=await read();
  for(const post of latest.posts){if(post.url&&post.author!==latest.self)collected.set(post.url,post);}
  await onProgress(`Đang gom bài mới · ${collected.size}/${targetCount} bài · đã cuộn ${scrolls}/${maxScrolls} lượt`);
  if(collected.size>=targetCount||scrolls>=maxScrolls||!shouldContinue())break;
  await scroll();scrolls++;
  await wait(1500);
 }
 return {...latest,posts:[...collected.values()],count:collected.size,collection_scrolls:scrolls};
}

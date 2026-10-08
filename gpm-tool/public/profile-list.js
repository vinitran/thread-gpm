export const PROFILE_LIST_FORMAT='hoanxu-profile-list';
export const PROFILE_LIST_MAX=10000;
export function exportProfileList(profiles,ids=null,now=new Date()){
 const selected=ids===null?null:new Set(ids),seen=new Set(),rows=[];
 for(const p of profiles){if(selected&&!selected.has(p.id)||seen.has(p.id))continue;seen.add(p.id);rows.push({id:p.id,name:p.name||p.id});}
 if(!rows.length)throw Error('Chưa có profile để xuất.');
 if(rows.length>PROFILE_LIST_MAX)throw Error('Mỗi file tối đa '+PROFILE_LIST_MAX+' profile. Chọn ít profile hơn để xuất.');
 return {format:PROFILE_LIST_FORMAT,version:1,exportedAt:now.toISOString(),profiles:rows};
}

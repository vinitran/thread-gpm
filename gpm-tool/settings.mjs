import {AUTO_DEFAULTS,autoConfig} from '../extension/auto-runner.js';
import {endpoint} from './browser.mjs';
import {localApi,proxy,proxyLabel} from './gpm-api.mjs';
export function validateSettings(input,old={}){
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>50000)throw Error('Prompt cần 1–50.000 ký tự.');
 if(typeof input.model!=='string'||!/^[-\w/.]{1,100}$/.test(input.model))throw Error('Model không hợp lệ.');
 if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>512))throw Error('API key không hợp lệ.');
 if(input.proxy!==undefined&&typeof input.proxy!=='string')throw Error('Proxy không hợp lệ.');
 const profileId=input.profileId??old.profileId??'';
 if(typeof profileId!=='string'||(profileId&&!/^[-\w]{1,100}$/.test(profileId)))throw Error('Profile ID không hợp lệ.');
 if(input.imagesFolder!==undefined&&(typeof input.imagesFolder!=='string'||input.imagesFolder.length>2000))throw Error('Đường dẫn folder ảnh không hợp lệ.');
 return {...old,model:input.model,prompt:input.prompt,apiKey:input.apiKey?.trim()||old.apiKey||'',cdp:endpoint(input.cdp),gpmApi:localApi(input.gpmApi||old.gpmApi||'http://localhost:9495'),profileId,profileName:profileId===old.profileId?old.profileName:undefined,proxy:input.proxy===undefined?old.proxy||'':input.proxy.trim()?proxy(input.proxy):'',imagesFolder:input.imagesFolder?.trim()??old.imagesFolder??'',runConfig:autoConfig(input.runConfig||old.runConfig||AUTO_DEFAULTS)};
}
export function publicSettings(settings){const {apiKey,proxy:rawProxy,...rest}=settings;return {...rest,proxy:rawProxy||'',hasKey:!!apiKey,hasProxy:!!rawProxy,proxyLabel:proxyLabel(rawProxy),runConfig:autoConfig(settings.runConfig||AUTO_DEFAULTS)};}
export function redact(message,settings={}){
 let text=String(message);const secrets=[settings.apiKey,settings.proxy];
 if(settings.proxy){try{const raw=settings.proxy;if(raw.includes('://')){const url=new URL(raw);secrets.push(decodeURIComponent(url.password),decodeURIComponent(url.username));}else secrets.push(...raw.split(':').slice(2));}catch{}}
 const escaped=[...new Set(secrets.filter(Boolean))].sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 if(escaped.length)text=text.replace(new RegExp(escaped.join('|'),'g'),'[secret]');
 return text.replace(/sk-[A-Za-z0-9_-]{15,}/g,'[key]');
}

export function assertLiveSettings(settings,old,active){
 const comparable=(key,value)=>{if(!value)return '';try{if(key==='cdp')return endpoint(value);if(key==='gpmApi')return localApi(value);}catch{}return value;};
 if(active&&['profileId','gpmApi','cdp','proxy'].some(key=>comparable(key,settings[key])!==comparable(key,old[key])))throw Error('Dừng profile trước khi đổi kết nối GPM hoặc proxy. Nhịp chạy, chủ đề và AI có thể đổi khi đang chạy.');
}

export async function applyRunnerSettings(runner,settings){
 await runner.load();if(runner.state.config){runner.state.config=settings.runConfig;runner.event('Đã áp dụng cài đặt · model '+settings.model+' · dùng từ bước tiếp theo');await runner.save();}
}

export function sharedProfileSettings(shared,profile){
 return {...profile,gpmApi:shared.gpmApi||profile.gpmApi,model:shared.model,prompt:shared.prompt,apiKey:shared.apiKey,imagesFolder:shared.imagesFolder||'',runConfig:structuredClone(shared.runConfig)};
}

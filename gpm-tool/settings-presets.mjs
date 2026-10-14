import {randomUUID} from 'node:crypto';
import {AUTO_DEFAULTS,autoConfig} from '../extension/auto-runner.js';
export const DEFAULT_PRESET_ID='default';
export function validatePreset(input,id=input?.id||randomUUID()){
 if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id)||['__proto__','constructor','prototype'].includes(id))throw Error('Bộ cài đặt không hợp lệ.');
 const name=id===DEFAULT_PRESET_ID?'Mặc định':input?.name?.trim();
 if(typeof name!=='string'||!name||name.length>100||/[\x00-\x1f]/.test(name))throw Error('Tên bộ cài đặt cần 1–100 ký tự.');
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>50000)throw Error('Prompt cần 1–50.000 ký tự.');
 if(typeof input.keywords!=='string'||!input.keywords.trim())throw Error('Chủ đề không được trống.');
 const keywords=autoConfig({keywords:input.keywords}).keywords;
 return {id,name,prompt:input.prompt,keywords};
}
export async function ensurePresetCatalog(store,fallback){
 if(store.value.settingsPresets?.some(p=>p.id===DEFAULT_PRESET_ID))return store.value.settingsPresets;
 const configured=store.value.sharedSettings||store.value.settings||fallback;
 const preset=validatePreset({prompt:configured.prompt,keywords:configured.runConfig?.keywords||AUTO_DEFAULTS.keywords},DEFAULT_PRESET_ID);
 await store.set({settingsPresets:[preset,...(store.value.settingsPresets||[])]});return store.value.settingsPresets;
}
export function getPreset(presets,id=DEFAULT_PRESET_ID){
 const preset=presets?.find(p=>p.id===id);if(!preset)throw Error('Bộ cài đặt đã chọn không tồn tại.');return preset;
}

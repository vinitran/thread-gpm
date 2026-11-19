import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encryptKey,decryptKey,loadBundledKey,validateBundle,BUNDLED_KEY_FILE,WRONG_PASSWORD} from './bundled-key.mjs';

const fast={N:2**14,r:8,p:1};

test('bundled key decrypts only with the right password',async()=>{
 const bundle=await encryptKey('sk-test-key','Mat-khau@1',{cost:fast});
 assert.equal(await decryptKey(bundle,'Mat-khau@1'),'sk-test-key');
 await assert.rejects(decryptKey(bundle,'mat-khau@1'),{message:WRONG_PASSWORD});
 await assert.rejects(decryptKey(bundle,''),/Chưa nhập mật khẩu/);
 assert.ok(!JSON.stringify(bundle).includes('sk-test-key'));
 assert.match(bundle.id,/^[a-f0-9]{16}$/);
});

test('tampered ciphertext or identity is rejected',async()=>{
 const bundle=await encryptKey('sk-test-key','pw',{cost:fast});
 await assert.rejects(decryptKey({...bundle,id:'0'.repeat(16)},'pw'),{message:WRONG_PASSWORD});
 const data=Buffer.from(bundle.cipher.data,'base64');data[0]^=1;
 await assert.rejects(decryptKey({...bundle,cipher:{...bundle.cipher,data:data.toString('base64')}},'pw'),{message:WRONG_PASSWORD});
});

test('bundle validation limits scrypt cost and format',async()=>{
 const bundle=await encryptKey('sk-test-key','pw',{cost:fast});
 assert.throws(()=>validateBundle({...bundle,kdf:{...bundle.kdf,N:2**22}}),/Thông số/);
 assert.throws(()=>validateBundle({...bundle,format:'other'}),/định dạng/);
 assert.throws(()=>validateBundle({...bundle,cipher:{...bundle.cipher,iv:'AA=='}}),/không hợp lệ/);
});

test('missing bundle file means no bundled key; saved file round-trips',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bundled-key-'));
 try{
  assert.equal(await loadBundledKey(path.join(dir,'missing.json')),null);
  const bundle=await encryptKey('sk-test-key','pw',{cost:fast}),file=path.join(dir,'key.json');
  await writeFile(file,JSON.stringify(bundle));
  assert.equal(await decryptKey(await loadBundledKey(file),'pw'),'sk-test-key');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('committed bundled key file is encrypted and well formed',async()=>{
 const text=await readFile(BUNDLED_KEY_FILE,'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
 if(text===null)return;
 assert.ok(!/sk-[A-Za-z0-9]/.test(text),'File key đi kèm không được chứa key chưa mã hoá');
 const bundle=validateBundle(JSON.parse(text));
 assert.ok(bundle.kdf.N>=2**17,'Key đi kèm cần scrypt đủ chậm');
});

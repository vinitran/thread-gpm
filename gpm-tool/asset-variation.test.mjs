import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {attachments} from './assets.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const decode=bytes=>sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
async function assertCornerOnly(original,modified){
 const a=await decode(original),b=await decode(modified);
 assert.equal(b.info.width,a.info.width);assert.equal(b.info.height,a.info.height);
 let changes=0;const corners=new Set();
 for(let y=0;y<a.info.height;y++)for(let x=0;x<a.info.width;x++){
  const offset=(y*a.info.width+x)*4;
  if(!a.data.subarray(offset,offset+4).equals(b.data.subarray(offset,offset+4))){
   changes++;assert.ok(x<2||x>=a.info.width-2);assert.ok(y<2||y>=a.info.height-2);
   corners.add((x<2?'left':'right')+(y<2?'top':'bottom'));
  }
 }
 assert.ok(changes>0&&changes<=4);assert.equal(corners.size,1);
}
test('backend varies each upload after cache while preserving originals and the center image',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gpm-variation-'));
 const original=await sharp({create:{width:32,height:32,channels:3,background:'#eee'}}).png().toBuffer();
 try{
  for(const name of ['a.png','app_store.png','b.png'])await fs.writeFile(path.join(dir,name),original);
  const hashes=new Set();
  for(let attempt=0;attempt<3;attempt++){
   const result=await attachments(dir);assert.equal(result.files[1].name,'app_store.png');
   for(const file of result.files){
    const bytes=Buffer.from(file.data_url.split(',')[1],'base64');
    await assertCornerOnly(original,bytes);assert.ok(!hashes.has(hash(bytes)));hashes.add(hash(bytes));
   }
  }
  for(const name of ['a.png','app_store.png','b.png'])assert.equal(hash(await fs.readFile(path.join(dir,name))),hash(original));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('browser uploads change only one 2x2 corner, including small images',async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome'),headless:true});
 try{
  const page=await browser.newPage();const source=await fs.readFile(new URL('../extension/reply-assets.js',import.meta.url),'utf8');
  const original=await sharp({create:{width:32,height:32,channels:3,background:'#eee'}}).png().toBuffer();
  const files=await page.evaluate(async({source,data})=>{
   const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
   try{
    const {makeReplyAttachments}=await import(url),blob=await (await fetch('data:image/png;base64,'+data)).blob();
    const images=['a.png','app_store.png','b.png'].map(name=>({name,path:name,blob}));
    const results=[];for(let i=0;i<2;i++)results.push(...(await makeReplyAttachments(images,{optimizeUpload:true,varyImages:true})).files);
    return results;
   }finally{URL.revokeObjectURL(url);}
  },{source,data:original.toString('base64')});
  const hashes=new Set();
  for(const file of files){const bytes=Buffer.from(file.data_url.split(',')[1],'base64');await assertCornerOnly(original,bytes);assert.ok(!hashes.has(hash(bytes)));hashes.add(hash(bytes));}
  assert.equal(files[1].name,'app_store.png');assert.equal(files[4].name,'app_store.png');
 }finally{await browser.close();}
});

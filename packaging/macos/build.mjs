import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {repository,APP_ID} from '../../gpm-tool/updates.mjs';

if(process.platform!=='darwin')throw Error('Build DMG cần runner macOS.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arch=process.env.BUILD_ARCH||process.arch;
if(arch!=='arm64')throw Error('Bản Mac chỉ hỗ trợ Apple Silicon (arm64).');
const repo=repository(process.env.GPM_UPDATE_REPOSITORY||'vinitran/thread-gpm');
const work=path.join(root,'.build','macos-'+arch),app=path.join(work,'HoanXu GPM.app'),contents=path.join(app,'Contents'),payload=path.join(contents,'Resources'),out=path.join(root,'release');
const version=JSON.parse(await fs.readFile(path.join(root,'gpm-tool/package.json'),'utf8')).version;
const identity=process.env.MAC_SIGN_ID||'-';
async function run(command,args,cwd=root){await new Promise((resolve,reject)=>{const p=spawn(command,args,{cwd,stdio:'inherit',env:{...process.env,PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1'}});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(command+' failed: '+code)));});}
async function copy(relative){const dest=path.join(payload,relative);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(root,relative),dest);}
await fs.mkdir(work,{recursive:true});await fs.mkdir(out,{recursive:true});await fs.rm(app,{recursive:true,force:true});await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});await fs.mkdir(payload,{recursive:true});
for(const name of await fs.readdir(path.join(root,'gpm-tool')))if(name.endsWith('.mjs')&&!/test|smoke/.test(name))await copy('gpm-tool/'+name);
for(const name of ['package.json','package-lock.json','HUONG-DAN-SU-DUNG.md'])await copy('gpm-tool/'+name);
await fs.writeFile(path.join(payload,'package.json'),JSON.stringify({private:true,type:'module'}));
await fs.writeFile(path.join(payload,'release-config.json'),JSON.stringify({repository:repo,updatesEnabled:process.env.GPM_UPDATES_ENABLED!=='0'}));
await fs.cp(path.join(root,'gpm-tool/public'),path.join(payload,'gpm-tool/public'),{recursive:true});
for(const name of ['ai.js','auto-runner.js','auto-dom.js','extract.js','feed-collector.js','post-reply.js','reply-dom.js','reply-assets.js','tab-actions.js','default-prompt.txt'])await copy('extension/'+name);
await fs.cp(path.join(root,'extension/default-assets'),path.join(payload,'extension/default-assets'),{recursive:true});
await run('npm',['ci','--omit=dev','--include=optional','--os=darwin','--cpu='+arch,'--ignore-scripts','--no-audit','--no-fund'],path.join(payload,'gpm-tool'));
// Fixed runtime version makes CI builds reproducible. Verify the upstream checksum before bundling.
const nodeVersion='22.23.3',name=`node-v${nodeVersion}-darwin-${arch}.tar.gz`,base=`https://nodejs.org/dist/v${nodeVersion}/`;
const response=await fetch(base+'SHASUMS256.txt');if(!response.ok)throw Error('Không tải được checksum Node.');
const expected=(await response.text()).split('\n').find(l=>l.endsWith('  '+name))?.split(/\s+/)[0];if(!expected)throw Error('Không có checksum runtime.');
const archive=path.join(work,name);let bytes;try{bytes=await fs.readFile(archive);}catch{}
if(!bytes||createHash('sha256').update(bytes).digest('hex')!==expected){console.log('Tải official Node '+name);await run('/usr/bin/curl',['--fail','--silent','--show-error','--location','--retry','3','--connect-timeout','20','--max-time','180','--output',archive,base+name]);bytes=await fs.readFile(archive);if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Node sai checksum.');}
await run('/usr/bin/tar',['-xzf',archive,'-C',work]);const runtime=path.join(work,name.replace(/\.tar\.gz$/,''));await fs.copyFile(path.join(runtime,'bin/node'),path.join(payload,'node'));await fs.chmod(path.join(payload,'node'),0o755);await fs.copyFile(path.join(runtime,'LICENSE'),path.join(payload,'NODE-LICENSE.txt'));
await run('/usr/bin/swiftc',[path.join(root,'packaging/macos/Launcher.swift'),path.join(root,'desktop/macos/Desktop.swift'),path.join(root,'desktop/macos/main.swift'),'-O','-target','arm64-apple-macos12.0','-o',path.join(contents,'MacOS/HoanXuGPM')]);
const require=createRequire(path.join(root,'gpm-tool/package.json')),sharp=require('sharp');const icons=path.join(work,'AppIcon.iconset');await fs.mkdir(icons,{recursive:true});
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="24" y="24" width="976" height="976" rx="215" fill="#102923"/><rect x="200" y="218" width="120" height="588" rx="35" fill="#84edc0"/><rect x="704" y="218" width="120" height="588" rx="35" fill="#84edc0"/><rect x="270" y="455" width="484" height="114" rx="35" fill="#84edc0"/></svg>');
for(const size of [16,32,128,256,512])for(const scale of [1,2])await sharp(svg).resize(size*scale).png().toFile(path.join(icons,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
await run('/usr/bin/iconutil',['-c','icns',icons,'-o',path.join(payload,'AppIcon.icns')]);
await fs.writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${APP_ID}</string><key>CFBundleExecutable</key><string>HoanXuGPM</string><key>CFBundleName</key><string>HoanXu GPM</string><key>CFBundleDisplayName</key><string>Hoàn Xu GPM</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundleIconFile</key><string>AppIcon</string><key>LSMinimumSystemVersion</key><string>12.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
const entitlements=path.join(root,'packaging/macos/entitlements.plist');
const sign=async file=>run('/usr/bin/codesign',['--force','--sign',identity,...(identity==='-'?[]:['--timestamp','--options','runtime','--entitlements',entitlements]),file]);
for(const file of await fs.readdir(payload,{recursive:true}))if(/\.(node|dylib)$/.test(file))await sign(path.join(payload,file));
await sign(path.join(payload,'node'));await sign(path.join(contents,'MacOS/HoanXuGPM'));await sign(app);await run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
const imageRoot=path.join(work,'image');await fs.rm(imageRoot,{recursive:true,force:true});await fs.mkdir(imageRoot);await fs.cp(app,path.join(imageRoot,'HoanXu GPM.app'),{recursive:true,verbatimSymlinks:true});await run('/usr/bin/codesign',['--verify','--deep','--strict',path.join(imageRoot,'HoanXu GPM.app')]);await fs.symlink('/Applications',path.join(imageRoot,'Applications'));await fs.copyFile(path.join(root,'packaging/macos/HUONG-DAN-MAC.md'),path.join(imageRoot,'HUONG-DAN-MAC.md'));
const artifact=path.join(out,`HoanXu-GPM-${version}-mac-${arch}.dmg`);await fs.rm(artifact,{force:true});await run('/usr/bin/hdiutil',['create','-volname','HoanXu GPM','-srcfolder',imageRoot,'-format','UDZO','-ov',artifact]);
let notarized=false;if(process.env.MAC_NOTARY_PROFILE){if(identity==='-')throw Error('Notarize cần Developer ID.');await run('/usr/bin/xcrun',['notarytool','submit',artifact,'--keychain-profile',process.env.MAC_NOTARY_PROFILE,'--wait']);await run('/usr/bin/xcrun',['stapler','staple',artifact]);notarized=true;}
const artifactBytes=await fs.readFile(artifact),sha256=createHash('sha256').update(artifactBytes).digest('hex');
const manifest={format:'hoanxu-macos-update',bundleId:APP_ID,version,platform:'darwin',arch,bytes:artifactBytes.length,sha256,url:`https://github.com/${repo}/releases/download/v${version}/${path.basename(artifact)}`};
await fs.writeFile(path.join(out,`hoanxu-macos-${arch}.json`),JSON.stringify(manifest,null,2)+'\n');await fs.writeFile(artifact+'.sha256',sha256+'  '+path.basename(artifact)+'\n');
await fs.writeFile(path.join(out,`macos-${arch}-build-manifest.json`),JSON.stringify({...manifest,nodeArchive:name,nodeArchiveSha256:expected,embeddedApiKey:false,developerIdSigned:identity!=='-',notarized},null,2));
console.log('Built '+artifact+' · '+Math.round(artifactBytes.length/1048576)+' MB');

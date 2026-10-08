import fs from 'node:fs/promises';
const packageFile=new URL('../gpm-tool/package.json',import.meta.url),lockFile=new URL('../gpm-tool/package-lock.json',import.meta.url);
const pkg=JSON.parse(await fs.readFile(packageFile,'utf8'));
const valid=v=>/^\d+\.\d+\.\d+$/.test(v)&&v.split('.').every(n=>Number.isSafeInteger(Number(n)));
const apply=async version=>{if(!valid(version))throw Error('Invalid release version');const lock=JSON.parse(await fs.readFile(lockFile,'utf8'));pkg.version=version;lock.version=version;lock.packages[''].version=version;await fs.writeFile(packageFile,JSON.stringify(pkg,null,2)+'\n');await fs.writeFile(lockFile,JSON.stringify(lock,null,2)+'\n');};
if(process.argv[2]==='--apply'){await apply(process.argv[3]);console.log('Build version: '+pkg.version);}else{
 if(!valid(pkg.version))throw Error('Invalid source version');
 const ref=process.env.GITHUB_REF||'',publish=ref.startsWith('refs/tags/v')||(process.env.GITHUB_EVENT_NAME==='push'&&ref==='refs/heads/main');let version=pkg.version;
 if(ref.startsWith('refs/tags/')){if(ref!==`refs/tags/v${version}`)throw Error('Tag must match source version v'+version);}
 else if(publish){
  const repo=process.env.GITHUB_REPOSITORY;if(!/^[\w.-]+\/[\w.-]+$/.test(repo||''))throw Error('Invalid GitHub repository');
  const response=await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`,{headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Cannot read published versions: HTTP '+response.status);
  const [major,minor,patch]=version.split('.').map(Number);let highest=patch-1;
  for(const release of await response.json()){const v=release.tag_name?.replace(/^v/,'');if(!valid(v))continue;const [a,b,c]=v.split('.').map(Number);if(a===major&&b===minor)highest=Math.max(highest,c);}
  version=`${major}.${minor}.${Math.max(patch,highest+1)}`;
 }
 const values=`version=${version}\ntag=v${version}\npublish=${publish}\n`;
 if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,values);console.log(values.trim());
}

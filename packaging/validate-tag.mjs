import fs from 'node:fs/promises';
const version=JSON.parse(await fs.readFile(new URL('../gpm-tool/package.json',import.meta.url),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version)||process.env.GITHUB_REF_NAME!==`v${version}`)throw Error('Tag cần khớp version trong gpm-tool/package.json: v'+version);
console.log('Release tag matches package version.');

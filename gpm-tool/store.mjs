import {mkdir,readFile,rename,chmod,access} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const SCHEMA_VERSION=1;
function location(dir){
 const resolved=path.resolve(dir),parent=path.dirname(resolved),profile=path.basename(parent)==='profiles';
 return {file:path.join(profile?path.dirname(parent):resolved,'tool.sqlite'),namespace:profile?'profile:'+path.basename(resolved):'global'};
}
function readNamespace(db,namespace){return Object.fromEntries(db.prepare('SELECT key,value FROM state_values WHERE namespace=?').all(namespace).map(row=>[row.key,JSON.parse(row.value)]));}
function open(file){
 const db=new DatabaseSync(file);
 try{
  db.exec('PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>SCHEMA_VERSION)throw Error('Database thuộc phiên bản app mới hơn. Cập nhật app trước khi mở dữ liệu.');
  db.exec('PRAGMA journal_mode=WAL;');
  if(version===0){
   db.exec('BEGIN IMMEDIATE;');
   try{db.exec('CREATE TABLE IF NOT EXISTS namespaces (namespace TEXT PRIMARY KEY, initialized_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS state_values (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), PRIMARY KEY(namespace,key)); PRAGMA user_version=1; COMMIT;');}
   catch(error){db.exec('ROLLBACK;');throw error;}
  }
  return db;
 }catch(error){db.close();throw error;}
}
// Read without migrating/writing; used by backups and package verification.
export async function readPersistedState(dir){
 const {file,namespace}=location(dir);
 try{await access(file);}catch(error){if(error.code!=='ENOENT')throw error;return JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));}
 const db=new DatabaseSync(file,{readOnly:true});
 try{db.exec('PRAGMA busy_timeout=10000;');return readNamespace(db,namespace);}finally{db.close();}
}
export class Store{
 constructor(dir){this.dir=path.resolve(dir);Object.assign(this,location(dir));this.value={};this.pending=Promise.resolve();this.listeners=new Set();}
 subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
 async load(){
  await mkdir(this.dir,{recursive:true});await mkdir(path.dirname(this.file),{recursive:true});
  const db=open(this.file);let migrated=false;
  try{
   if(!db.prepare('SELECT namespace FROM namespaces WHERE namespace=?').get(this.namespace)){
    let legacy={};try{legacy=JSON.parse(await readFile(path.join(this.dir,'state.json'),'utf8'));migrated=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))throw Error('Dữ liệu JSON cũ không hợp lệ; chưa chuyển dữ liệu.');
    db.exec('BEGIN IMMEDIATE;');
    try{
     // A worker may have migrated this namespace while the JSON was being read.
     if(!db.prepare('SELECT namespace FROM namespaces WHERE namespace=?').get(this.namespace)){
      const insert=db.prepare('INSERT INTO state_values(namespace,key,value) VALUES(?,?,?)');
      for(const [key,value] of Object.entries(legacy))insert.run(this.namespace,key,JSON.stringify(value));
      db.prepare('INSERT INTO namespaces(namespace,initialized_at) VALUES(?,?)').run(this.namespace,new Date().toISOString());
     }
     db.exec('COMMIT;');
    }catch(error){db.exec('ROLLBACK;');throw error;}
   }
   this.value=readNamespace(db,this.namespace);
  }finally{db.close();}
  await chmod(this.file,0o600);
  if(migrated){const source=path.join(this.dir,'state.json'),backup=path.join(this.dir,'state.pre-sqlite.json');try{await access(backup);}catch(error){if(error.code!=='ENOENT')throw error;try{await rename(source,backup);await chmod(backup,0o600);}catch(error){if(error.code!=='ENOENT')throw error;}}}
  return this;
 }
 async get(keys){if(!keys)return structuredClone(this.value);if(typeof keys==='string')keys=[keys];return Object.fromEntries(keys.filter(k=>k in this.value).map(k=>[k,structuredClone(this.value[k])]));}
 async set(patch){
  const cloned=structuredClone(patch),entries=Object.entries(cloned).map(([key,value])=>[key,JSON.stringify(value)]);
  if(entries.some(([,value])=>value===undefined))throw Error('Không thể lưu giá trị undefined vào database.');
  this.pending=this.pending.catch(()=>{}).then(()=>{
   const db=open(this.file);
   try{
    db.exec('BEGIN IMMEDIATE;');
    try{const insert=db.prepare('INSERT INTO state_values(namespace,key,value) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value');for(const [key,value] of entries)insert.run(this.namespace,key,value);db.exec('COMMIT;');}
    catch(error){db.exec('ROLLBACK;');throw error;}
    this.value={...this.value,...cloned};
   }finally{db.close();}
  });
  await this.pending;for(const listener of this.listeners){try{listener(Object.keys(patch));}catch{}}
 }
}

import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const key=x=>createHash('sha256').update(x).digest('hex');
export function createHistoryStore(root){
 return {
 async put(snapshot){const dir=join(root,key(snapshot.sessionId));await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,key(snapshot.snapshotId)+'.json');try{await readFile(path);return;}catch(e){if(e.code!=='ENOENT')throw e;}const tmp=path+'.'+randomUUID();await writeFile(tmp,JSON.stringify(snapshot),{mode:0o600});await rename(tmp,path);},
 async list(sessionId){const dir=join(root,key(sessionId));let names;try{names=await readdir(dir)}catch(e){if(e.code==='ENOENT')return [];throw e;}const result=[];for(const name of names.filter(n=>n.endsWith('.json'))){const s=JSON.parse(await readFile(join(dir,name),'utf8'));if(s.sessionId===sessionId)result.push(s);}return result.sort((a,b)=>a.capturedAt-b.capturedAt);},
 async get(sessionId,snapshotId){try{const s=JSON.parse(await readFile(join(root,key(sessionId),key(snapshotId)+'.json'),'utf8'));return s.sessionId===sessionId?s:undefined;}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
 };
}

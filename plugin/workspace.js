import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,realpath,lstat} from 'node:fs/promises';import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';import {structuredPatch} from 'diff';
import {parseDiff} from './git.js';import {normalizeSnapshot} from '../core/model.js';import {analyzeSources} from '../core/dependencies.js';
const run=promisify(execFile);
export async function readWorkspaceReview(context){
 const root=await realpath(context.root);const options={cwd:root,timeout:10000,maxBuffer:4*1024*1024};
 const git=async args=>(await run('git',['-c','core.quotePath=false',...args],options)).stdout;
 let base='HEAD';try{await git(['rev-parse','--verify','HEAD']);}catch{base=(await git(['hash-object','-t','tree','/dev/null'])).trim();}
 const tracked=(await git(['diff','--no-renames','--name-only','-z',base,'--'])).split('\0').filter(Boolean);
 const untracked=(await git(['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean);
 const names=[...new Set([...tracked,...untracked])];const files=[],hunks=[],sources=[],notices=[];
 for(const path of names.slice(0,100)){
  let content;let safe=false;
  try{const full=join(root,path);const stat=await lstat(full);const resolved=await realpath(full);const rel=relative(root,resolved);safe=!stat.isSymbolicLink()&&!rel.startsWith('../')&&stat.size<=512000;if(safe)content=await readFile(full,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(content?.includes('\0')){files.push({path,kind:'binary'});continue;}
  if(content!==undefined)sources.push({path,content});
  let parsed;
  if(untracked.includes(path)){
   if(!safe){files.push({path,kind:'unavailable'});continue;}
   parsed=structuredPatch(path,path,'',content,'','',{context:3,timeout:100})?.hunks.map((h,i)=>({id:path+':'+i,lines:h.lines,oldLine:h.oldStart,newLine:h.newStart}));
  }else{
   const patch=await git(['diff','--no-ext-diff','--no-textconv','--no-renames','--no-color','--unified=3',base,'--',path]);
   if(patch.length>512000){files.push({path,kind:'oversized'});continue;}
   parsed=parseDiff(patch);
   if(!parsed.length && /Binary files|GIT binary patch/.test(patch)){files.push({path,kind:'binary'});continue;}
  }
  files.push({path,kind:untracked.includes(path)?'added':content===undefined?'deleted':'modified'});
  for(const [i,h]of (parsed??[]).entries())hunks.push({id:path+':'+i,path,title:path.split('/').at(-1),oldStart:h.oldLine,newStart:h.newLine,rangeKind:'file',lines:h.lines.filter(l=>/^[ +\-]/.test(l))});
 }
 if(names.length>100)notices.push(`Showing 100 of ${names.length} files. Narrow the workspace to inspect the remainder.`);
 const analysis=analyzeSources(sources);for(const h of hunks)h.symbol=analysis.symbols.find(s=>s.path===h.path&&s.line<=h.newStart&&s.endLine>=h.newStart)?.name;
 const snapshotId=createHash('sha256').update(JSON.stringify([context.sessionId,files,hunks])).digest('hex').slice(0,24);
 return normalizeSnapshot({...context,source:'live',snapshotId,scope:'workspace',title:'Workspace changes',baseRevision:base,hunks,files,...analysis,notices:['Current workspace changes, including edits outside this session. No agent attribution.',...notices]});
}

import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {homedir} from 'node:os';
import {readChanges} from './git.js';import {readSessionReview} from './dsh-adapter.js';import {readWorkspaceReview} from './workspace.js';import {createHistoryStore} from './history-store.js';
export const name='agent-xray';export const inject=['webServer'];
const assets=new Map(['index.html','app.js','examples.js','style.css','core/model.js','ui/state.js','ui/render.js','ui/diff.js'].map(path=>['/agent-xray/'+path,[path,path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript']]));
export function apply(ctx){
 const store=createHistoryStore(join(process.env.DSH_HOME??join(homedir(),'.dsh'),'agent-xray','history'));
 const services=()=>({sessionQuery:ctx.get('sessionQuery'),workspaceChanges:ctx.get('workspaceChanges')});
 const jobs=new Map();
 // Capture only sessions producing changes; never block the host event dispatch.
 if(typeof ctx.on==='function')ctx.on('session/event',(session,event)=>{
  if(!['workspace/changes','turn/end'].includes(event.type))return;
  clearTimeout(jobs.get(session.id));jobs.set(session.id,setTimeout(()=>{
   jobs.delete(session.id);readSessionReview(services(),session.id).then(s=>store.put(s)).catch(()=>{});
  },250));
 });
 ctx.effect(()=>()=>{for(const timer of jobs.values())clearTimeout(timer);jobs.clear();});
 ctx.effect(()=>ctx.get('webServer').register({kind:'prefix',path:'/agent-xray',handler:async(req,res)=>{
  const connection=ctx.get('connection');if(!connection?.admit){res.writeHead(503);res.end('Authentication unavailable');return;}
  const admission=connection.admit(req);if('rejection'in admission){res.writeHead(admission.rejection);res.end('Authentication required');return;}
  if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'});res.end();return;}
  const url=new URL(req.url,'http://localhost');
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
   if(url.pathname==='/agent-xray/review'){
    const sessionId=url.searchParams.get('session');
    const current=await readSessionReview(services(),sessionId);
    if(url.searchParams.get('scope')==='workspace'){json(200,await readWorkspaceReview({sessionId,workspaceId:current.workspaceId,root:current.root}));return;}
    await store.put(current);
    const requested=url.searchParams.get('snapshot');
    const snapshot=requested?await store.get(sessionId,requested):current;
    if(!snapshot){json(404,{error:'This historical snapshot is unavailable.'});return;}
    const history=await store.list(sessionId);
    json(200,{...snapshot,history:history.map(s=>({id:s.snapshotId,time:s.capturedAt,title:s.title,count:s.hunks.length})),latestSnapshotId:current.snapshotId});return;
   }
   // Explicit lab endpoint retained for smoke tests; normal panels never use it.
   if(url.pathname==='/agent-xray/changes'){
    if(!process.env.XRAY_TEST_REPOSITORY)throw Error('Lab repository is not configured');
    json(200,await readChanges(process.env.XRAY_TEST_REPOSITORY));return;
   }
   const asset=assets.get(url.pathname);if(!asset){res.writeHead(404);res.end();return;}
   const content=await readFile(new URL('../'+asset[0],import.meta.url));res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);
  }catch(error){json(503,{error:error.message});}
 }}),'agent-xray: routes');
}

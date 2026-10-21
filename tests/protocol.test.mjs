import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import worker from '../worker/index.js';
import {emptyState} from '../src/core.js';
let data=emptyState();const env={LOCAL:true,STORE:{load:async()=>structuredClone(data),save:async(owner,revision,next)=>{if(data.revision!==revision)return false;data=structuredClone(next);return true;}}};
let id=0;
const req=(method,params={},headers={},raw)=>new Request('http://127.0.0.1:8787/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25',...headers},body:raw??JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
test('MCP lifecycle, discovery, structured tools, notifications and errors',async()=>{
  const init=await(await worker.fetch(req('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}),env)).json();
  assert.equal(init.result.protocolVersion,'2025-11-25');assert.ok(init.result.capabilities.tools);
  assert.equal((await worker.fetch(req('x',{}, {},JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})),env)).status,202);
  assert.equal((await(await worker.fetch(req('tools/list'),env)).json()).result.tools.length,8);
  const state=await(await worker.fetch(req('tools/call',{name:'get_workspace',arguments:{}}),env)).json();assert.equal(state.result.isError,false);assert.deepEqual(state.result.structuredContent.tasks,[]);
  assert.equal((await(await worker.fetch(req('tools/call',{name:'confirm_plan',arguments:{proposal_id:'invalid',confirmed:true}}),env)).json()).result.isError,true);
  assert.equal((await(await worker.fetch(req('tools/call',{name:'not_real'}),env)).json()).error.code,-32602);
  assert.equal((await(await worker.fetch(req('x',{}, {},'{'),env)).json()).error.code,-32700);
});
test('Origin, identity, content negotiation and protocol version are enforced',async()=>{
  assert.equal((await worker.fetch(req('tools/list',{}, {Origin:'https://untrusted.example'}),env)).status,403);
  assert.equal((await worker.fetch(req('tools/list'),{})).status,401);
  assert.equal((await worker.fetch(req('tools/list',{}, {Accept:'application/json'}),env)).status,406);
  assert.equal((await worker.fetch(req('tools/list',{}, {'MCP-Protocol-Version':'wrong'}),env)).status,400);
  assert.equal((await worker.fetch(new Request('http://127.0.0.1:8787/mcp'),env)).status,405);
});
test('Optimistic concurrency prevents silent lost updates',async()=>{
  const brokenEnv={LOCAL:true,STORE:{load:async()=>emptyState(),save:async()=>false}};
  const r=await(await worker.fetch(req('tools/call',{name:'load_demo',arguments:{}}),brokenEnv)).json();assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/Another request/);
});
test('HTTP flow retains progress after process restart',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'studyrelay-test-'));const port=18879;
  async function start(){const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),STUDYRELAY_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.on('data',x=>{if(String(x).includes('is ready'))resolve();});child.on('error',reject);child.on('exit',code=>{if(code)reject(Error('Server failed '+code));});});return child;}
  async function stop(child){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
  async function rpc(name,args={}){const r=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return(await r.json()).result;}
  let child;
  try{child=await start();assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);await rpc('load_demo');await rpc('record_progress',{task_id:'algebra',minutes:45});await stop(child);child=await start();const state=await rpc('get_workspace');assert.equal(state.structuredContent.tasks[0].completed,45);assert.equal(state.structuredContent.revision,2);}finally{if(child?.exitCode===null)await stop(child);await rm(dir,{recursive:true,force:true});}
});

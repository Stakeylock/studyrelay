// Bundled by scripts/build.mjs. HTML and the pure planner share one Worker module.
import { PROTOCOL, tools, emptyState, runTool } from './core.js';
import { HTML } from './page.js';
const versions = [PROTOCOL, '2026-07-28'];
const json = (data, status=200, more={}) => new Response(JSON.stringify(data), { status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...more} });
const rpcError = (id,code,message,status=200) => json({jsonrpc:'2.0',id:id??null,error:{code,message}},status);

async function readState(env, owner) {
  if (env.STORE) return await env.STORE.load(owner);
  if (!env.DB) throw new Error('Persistent storage is not configured.');
  // This deliberately tiny table is application-owned (no migration-owned schema).
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS studyrelay_workspace (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)').run();
  const row = await env.DB.prepare('SELECT data FROM studyrelay_workspace WHERE owner = ?').bind(owner).first();
  return row ? JSON.parse(row.data) : emptyState();
}
async function saveState(env, owner, before, after) {
  if (env.STORE) return await env.STORE.save(owner,before.revision,after);
  if (before.revision === 0) {
    const result = await env.DB.prepare('INSERT OR IGNORE INTO studyrelay_workspace (owner, revision, data) VALUES (?, ?, ?)').bind(owner,after.revision,JSON.stringify(after)).run();
    if (result.meta.changes === 1) return true;
  }
  const result = await env.DB.prepare('UPDATE studyrelay_workspace SET revision = ?, data = ? WHERE owner = ? AND revision = ?').bind(after.revision,JSON.stringify(after),owner,before.revision).run();
  return result.meta.changes === 1;
}
export default {
  async fetch(request,env={}) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method==='GET') return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com https://chatgpt.site"}});
    if (url.pathname==='/health') return json({ok:true,app:'StudyRelay',protocol:PROTOCOL});
    if (url.pathname!=='/mcp') return json({error:'Not found'},404);
    const origin = request.headers.get('Origin');
    if (origin && origin!==url.origin) return rpcError(null,-32000,'Origin is not allowed.',403);
    const owner = env.LOCAL === true ? 'local-user' : request.headers.get('oai-authenticated-user-id');
    if (!owner) return rpcError(null,-32000,'Sign in to your private StudyRelay workspace.',401);
    if (request.method==='GET' || request.method==='DELETE') return new Response(null,{status:405,headers:{Allow:'POST'}});
    if (request.method!=='POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return rpcError(null,-32600,'Use application/json.',415);
    if (Number(request.headers.get('content-length') || 0)>32768) return rpcError(null,-32600,'Request is too large.',413);
    const accept = request.headers.get('accept') ?? '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return rpcError(null,-32600,'Accept must include application/json and text/event-stream.',406);
    let input;
    try { const body=await request.text(); if(body.length>32768) return rpcError(null,-32600,'Request is too large.',413); input=JSON.parse(body); } catch { return rpcError(null,-32700,'Invalid JSON.'); }
    if (!input || Array.isArray(input) || input.jsonrpc!=='2.0' || typeof input.method!=='string') return rpcError(null,-32600,'Invalid JSON-RPC request.');
    const {id,method,params={}} = input;
    if (id !== undefined && typeof id!=='string' && typeof id!=='number') return rpcError(null,-32600,'Invalid request ID.');
    if (!params || Array.isArray(params) || typeof params!=='object') return rpcError(id,-32602,'Params must be an object.');
    if (method==='notifications/initialized' || method==='notifications/cancelled') return new Response(null,{status:202});
    if (id===undefined) return new Response(null,{status:202});
    if (method!=='initialize' && method!=='server/discover') {
      if (!versions.includes(request.headers.get('mcp-protocol-version'))) return rpcError(id,-32000,'Unsupported or missing MCP-Protocol-Version header.',400);
    }
    const response = result => json({jsonrpc:'2.0',id,result});
    if (method==='initialize') {
      if (typeof params.protocolVersion!=='string' || !params.clientInfo || !params.capabilities) return rpcError(id,-32602,'Initialization requires protocolVersion, clientInfo, and capabilities.');
      return response({protocolVersion:versions.includes(params.protocolVersion)?params.protocolVersion:PROTOCOL,capabilities:{tools:{listChanged:false}},serverInfo:{name:'studyrelay',version:'1.0.0'},instructions:'Always read get_workspace first. Ask for missing estimates. Use preview_availability before changing capacity. Describe all risks, and call confirm_plan only after explicit approval. This is a study planning tool, not a promise of academic results.'});
    }
    if (method==='server/discover') return response({supportedVersions:['2026-07-28',PROTOCOL],capabilities:{tools:{}}});
    if (method==='ping') return response({});
    if (method==='tools/list') return response({tools});
    if (method!=='tools/call') return rpcError(id,-32601,'Method not found.');
    const name = params.name;
    if (!tools.some(t=>t.name===name)) return rpcError(id,-32602,'Unknown tool.');
    try {
      // The UI sends its IANA timezone; agents may send the same header. Dates are local.
      const zone=request.headers.get('x-studyrelay-timezone') || 'Asia/Kolkata';
      let today;
      try { today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); } catch { return rpcError(id,-32602,'Invalid IANA timezone.'); }
      const before=await readState(env,owner);
      const result=runTool(before,name,params.arguments??{},today);
      if(result.mutated && !await saveState(env,owner,before,result.state)) throw new Error('Another request changed your workspace. Refresh and try again; no changes from this request were saved.');
      return response({content:[{type:'text',text:JSON.stringify(result.data)}],structuredContent:result.data,isError:false});
    } catch(error) { return response({content:[{type:'text',text:error.message ?? 'The operation failed.'}],isError:true}); }
  }
};

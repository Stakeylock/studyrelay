import http from 'node:http';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import worker from './worker/index.js';
const port=Number(process.env.PORT || 8787);
const dataDir=path.resolve(process.env.STUDYRELAY_DATA_DIR || path.join(import.meta.dirname,'.data'));
await mkdir(dataDir,{recursive:true});
let queue=Promise.resolve();
const file=path.join(dataDir,'workspace.json');
const store={
  async load(){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {revision:0,tasks:[],capacities:{},defaultMinutes:120,plan:null,pending:null,history:[],events:[]};throw e;}},
  async save(owner,revision,state){
    let release; const old=queue; queue=new Promise(resolve=>{release=resolve;}); await old;
    try {const current=await this.load();if(current.revision!==revision)return false;const temp=file+'.tmp';await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,file);return true;}finally{release();}
  }
};
const server=http.createServer(async(req,res)=>{
  try{
    // A loopback-only personal server. Reject forged Host headers and DNS rebinding.
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);res.end('Invalid host');return;}
    const chunks=[];let size=0;
    for await(const part of req){size+=part.length;if(size>32768){res.writeHead(413);res.end('Request too large');return;}chunks.push(part);}
    const body=Buffer.concat(chunks);
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})});
    const response=await worker.fetch(request,{LOCAL:true,STORE:store});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){console.error(error.message);res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Server error. See the terminal for details.'}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`StudyRelay is ready at http://127.0.0.1:${port}\nMCP endpoint: http://127.0.0.1:${port}/mcp\nData stays in ${dataDir}`));

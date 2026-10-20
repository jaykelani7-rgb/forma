import { createServer, type Socket } from "node:net";
import { mkdirSync, chmodSync, existsSync, lstatSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { defaultCompanionEndpoint, BoundedJsonLines, parseTransportRequest, encodeTransportMessage } from "../../../packages/integrations/protocol";
import type { RecognitionRequest } from "../../../packages/integrations/recognition";

export function sameCredential(expected:string|null,actual:string) {
  if(!expected)return false;
  const a=Buffer.from(expected), b=Buffer.from(actual);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export async function startTransport(options:{endpoint?:string;credential:()=>string|null;command:(command:unknown)=>Promise<{revision:number}>;action:(action:string)=>Promise<number>;recognition?:(request:RecognitionRequest)=>Promise<Record<string,unknown>>;context?:()=>Promise<{identity:string|null;sessionId:string|null}>;connected:(value:boolean)=>void}) {
  const endpoint=options.endpoint??defaultCompanionEndpoint();
  if(process.platform!=='win32') {
    mkdirSync(dirname(endpoint),{recursive:true,mode:0o700});chmodSync(dirname(endpoint),0o700);
    if(existsSync(endpoint)) {
      if(!lstatSync(endpoint).isSocket())throw new Error('The companion endpoint is occupied by a non-socket file.');
      unlinkSync(endpoint);
    }
  }
  const sockets=new Set<Socket>();
  let heartbeat:ReturnType<typeof setTimeout>|undefined;
  function alive(){
    options.connected(true);clearTimeout(heartbeat);
    heartbeat=setTimeout(()=>options.connected(false),65000);heartbeat.unref();
  }
  const server=createServer(socket=>{
    if(sockets.size>=16){socket.destroy();return;}
    sockets.add(socket);socket.setTimeout(45000,()=>socket.destroy());
    let queued=0;let tail=Promise.resolve();
    const lines=new BoundedJsonLines();
    socket.on('data',chunk=>{
      try {
        for(const line of lines.push(chunk)) {
          if(++queued>32)throw new Error('Too many queued requests.');
          tail=tail.then(async()=>{
            let id='invalid';
            try {
              const request=parseTransportRequest(line);id=request.id;
              if(!sameCredential(options.credential(),request.credential))throw new Error('Pair this extension with Forma Companion again.');
              alive();
              if(request.recognition){
                if(!options.recognition)throw new Error('Update Forma Companion to use recognition.');
                const result=await options.recognition(request.recognition);
                socket.write(encodeTransportMessage({version:1,id,ok:true,revision:await options.action('ping'),...result,...(options.context?await options.context():{})}));
                return;
              }
              const revision='command' in request && request.command ? (await options.command(request.command)).revision : await options.action('action' in request ? String(request.action) : 'ping');
              socket.write(encodeTransportMessage({version:1,id,ok:true,revision,...(options.context?await options.context():{})}));
            }catch(error){socket.write(encodeTransportMessage({version:1,id,ok:false,error:error instanceof Error?error.message:'Request rejected.'}));}
            finally{queued--;}
          });
        }
      }catch{socket.destroy();}
    });
    socket.on('error',()=>{});
    socket.on('close',()=>{sockets.delete(socket);});
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,()=>{server.removeListener('error',reject);resolve();});});
  if(process.platform!=='win32')chmodSync(endpoint,0o600);
  return {endpoint,revoke(){clearTimeout(heartbeat);options.connected(false);for(const socket of sockets)socket.destroy();},close(){clearTimeout(heartbeat);for(const socket of sockets)socket.destroy();server.close();if(process.platform!=='win32'&&existsSync(endpoint))unlinkSync(endpoint);}};
}

import { _electron as electron } from '@playwright/test';
import executablePath from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { connect } from 'node:net';

const folder=await mkdtemp(join(tmpdir(),'forma-native-'));
const output=resolve(process.env.FORMA_NATIVE_OUTPUT||'dist/companion-verification');await mkdir(output,{recursive:true});
const env={...process.env,FORMA_COMPANION_DATA_DIR:folder};delete env.ELECTRON_RUN_AS_NODE;
const software=process.env.FORMA_MEASURE_SOFTWARE==='1';
const application=await electron.launch({executablePath,args:['.companion-build',...(software?['--disable-gpu']:[])],env});
try {
  const page=await application.firstWindow();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>!!window.forma);
  await page.waitForTimeout(500);
  await page.screenshot({path:join(output,'native-pet.png')});
  await page.evaluate(()=>window.forma.ui('expand',true));
  await page.waitForTimeout(100);
  await page.screenshot({path:join(output,'native-welcome.png')});
  const timings=await page.evaluate(async()=>{
    const api=window.forma;
    await api.command({id:'native-attach',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',title:'Watermelon'}});
    const samples=[];
    for(let i=0;i<20;i++){
      const before=performance.now();
      await api.command({id:`native-note-${i}`,type:'thought',payload:{text:`Native durability check ${i}`}});
      samples.push(performance.now()-before);
    }
    await api.command({id:'native-start',type:'start',payload:{}});
    await api.command({id:'native-pause',type:'pause',payload:{}});
    await api.command({id:'native-finish',type:'finish',payload:{}});
    await api.command({id:'native-reflect',type:'reflect',payload:{outcome:'hint',takeaway:'Check parity before branching.'}});
    const state=await api.getSnapshot();
    samples.sort((a,b)=>a-b);
    return {saveP95Ms:samples[Math.ceil(samples.length*.95)-1],noteCount:state.state.thoughts.length,attempts:state.data.attempts.length,outcome:state.data.attempts[0].outcome};
  });
  assert.equal(timings.noteCount,20);assert.equal(timings.attempts,1);assert.equal(timings.outcome,'hint');
  await page.screenshot({path:join(output,'native-practice.png')});
  await page.evaluate(()=>window.forma.ui('theme','light'));
  await page.waitForTimeout(100);
  await page.screenshot({path:join(output,'native-light.png')});
  await page.evaluate(()=>window.forma.ui('theme','ink'));
  await page.waitForTimeout(100);
  await page.screenshot({path:join(output,'native-ink.png')});
  await page.evaluate(()=>window.forma.ui('expand',false));
  await page.waitForTimeout(100);
  await page.screenshot({path:join(output,'native-pet-after.png')});
  const cardP95Ms=await page.evaluate(async()=>{
    const values=[];
    for(let i=0;i<10;i++){
      await window.forma.ui('expand',false);
      const before=performance.now();await window.forma.ui('expand',true);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      values.push(performance.now()-before);
    }
    await window.forma.ui('expand',false);values.sort((a,b)=>a-b);
    return values[Math.ceil(values.length*.95)-1];
  });
  const pairing=await page.evaluate(()=>window.forma.ui('pair'));
  const ping=()=>new Promise((resolve,reject)=>{
    const socket=connect(pairing.endpoint);socket.setTimeout(3000,()=>{socket.destroy();reject(new Error('Pairing acknowledgement timeout'));});socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify({version:1,id:'native-ping',credential:pairing.credential,action:'ping'})+'\n'));
    socket.on('data',chunk=>{socket.end();resolve(JSON.parse(chunk.toString()));});
  });
  const pairedAck=await ping();assert.equal(pairedAck.ok,true);
  await page.evaluate(()=>window.forma.ui('revoke-pairing'));
  const revokedAck=await ping();assert.equal(revokedAck.ok,false);
  const idleStart=await application.evaluate(({app})=>app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,cpu:p.cpu.cumulativeCPUUsage,kib:p.memory.workingSetSize})));
  const idleMs=Number(process.env.FORMA_IDLE_MEASURE_MS||5000);
  await page.waitForTimeout(idleMs);
  const idleEnd=await application.evaluate(({app})=>app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,cpu:p.cpu.cumulativeCPUUsage,kib:p.memory.workingSetSize})));
  const cpuSeconds=idleEnd.reduce((sum,p)=>sum+Math.max(0,p.cpu-(idleStart.find(s=>s.pid===p.pid)?.cpu??p.cpu)),0);
  const traySvgEmpty=await application.evaluate(({nativeImage})=>nativeImage.createFromBuffer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="9"/></svg>')).isEmpty());
  const trayPngEmpty=await application.evaluate(({nativeImage},path)=>nativeImage.createFromPath(path).isEmpty(),resolve('.companion-build/assets/fenn-tray.png'));
  assert.equal(trayPngEmpty,false);
  const report={verifiedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,softwareRendering:software,notebook:folder,traySvgEmpty,trayPngEmpty,pairing:{acknowledged:pairedAck.ok,revocationRejected:!revokedAck.ok},cardP95Ms,...timings,idle:{durationMs:idleMs,cpuPercentOfOneCore:cpuSeconds/(idleMs/1000)*100,totalWorkingSetMiB:idleEnd.reduce((s,p)=>s+p.kib,0)/1024,processes:idleEnd},pageErrors:errors};
  assert.deepEqual(errors,[]);
  await writeFile(join(output,'native-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await application.close();}

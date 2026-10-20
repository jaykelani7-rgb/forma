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
  await page.evaluate(()=>window.forma.command({id:'native-attach',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',title:'Watermelon'}}));
  await page.getByRole('button',{name:/Today with Fenn/}).click();
  await page.getByRole('button',{name:'Start & open problem',exact:true}).waitFor();
  const planned=await page.evaluate(()=>window.forma.getSnapshot());
  assert.equal(planned.today.items[0].title,'Watermelon');
  assert.equal(planned.today.items[0].activity,'coding');
  assert.equal(planned.data.session,null);
  await page.screenshot({path:join(output,'native-today-suggestion.png')});
  await page.getByRole('button',{name:'Back to practice',exact:true}).click();
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
  await page.getByRole('button',{name:/Today with Fenn/}).click();
  await page.getByText('TODAY WITH FENN',{exact:true}).waitFor();
  await page.screenshot({path:join(output,'native-today.png')});
  const todayWindow=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  assert.equal(todayWindow.height,520);
  await page.getByRole('button',{name:'Back to practice',exact:true}).click();
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
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].blur());
  const recognitionAck=await new Promise((resolve,reject)=>{
    const socket=connect(pairing.endpoint);let data='';socket.setTimeout(4000,()=>{socket.destroy();reject(new Error('Recognition acknowledgement timeout'));});socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify({version:1,id:'native-recognition',credential:pairing.credential,recognition:{clientId:'native-client',workspaceId:'native-workspace',instanceId:'native-window',generation:1,observedAt:Date.now(),automatic:true,focused:true,fileUri:'file:///fixture/native.cpp',reason:'focus',binding:{url:'https://codeforces.com/contest/4/problem/B',title:'Before an Exam',source:'cph',adapterVersion:'2026.10.1792170155'}}})+'\n'));
    socket.on('data',chunk=>{data+=chunk;if(data.includes('\n')){socket.end();resolve(JSON.parse(data));}});
  });
  assert.equal(recognitionAck.ok,true);
  await page.getByRole('status',{name:'Problem recognition'}).waitFor({state:'visible'});
  const didNotFocus=await application.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows()[0].isFocused());
  assert.equal(didNotFocus,true);
  await page.screenshot({path:join(output,'native-recognition.png')});
  const recognised=await page.evaluate(()=>window.forma.getSnapshot());
  assert.equal(recognised.state.identity,'contest:4:B');assert.equal(recognised.presentation.expanded,false);
  const recognition={identity:recognised.state.identity,status:recognised.presentation.recognition.status,didNotFocus,fixtureClient:true};
  await page.evaluate(()=>window.forma.ui('expand',true));
  const sendRecognition = recognition => new Promise((resolve,reject)=>{
    const socket=connect(pairing.endpoint);let data='';socket.setTimeout(4000,()=>{socket.destroy();reject(new Error('File switch acknowledgement timeout'));});socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify({version:1,id:`switch-${recognition.generation}`,credential:pairing.credential,recognition})+'\n'));
    socket.on('data',chunk=>{data+=chunk;if(data.includes('\n')){socket.end();resolve(JSON.parse(data));}});
  });
  const source={clientId:'native-client',workspaceId:'native-workspace',instanceId:'native-window',automatic:true,focused:true,reason:'focus'};
  for (const [generation,fileUri] of [[2,'file:///fixture/B_Prefiquence.cpp'],[3,'file:///fixture/1968B.cpp']]) {
    const reply=await sendRecognition({...source,generation,fileUri,observedAt:Date.now(),binding:{url:'https://codeforces.com/contest/4/problem/B',title:'Before an Exam',source:'cph',adapterVersion:'2026.10.1792170155'}});
    assert.equal(reply.ok,true);
    await page.locator('.binding-source').filter({hasText:fileUri.split('/').at(-1)}).waitFor({state:'visible'});
    const snap=await page.evaluate(()=>window.forma.getSnapshot());
    await page.evaluate(id=>window.forma.ui('recognition-dismiss',id),snap.presentation.recognition.id);
  }
  await sendRecognition({...source,generation:4,fileUri:'file:///fixture/B_Prefiquence.cpp',observedAt:Date.now()});
  await page.locator('.binding-source').filter({hasText:'B_Prefiquence.cpp'}).waitFor({state:'visible'});
  await sendRecognition({...source,generation:5,fileUri:'file:///fixture/1968B.cpp',observedAt:Date.now()});
  await page.locator('.binding-source').filter({hasText:'1968B.cpp'}).waitFor({state:'visible'});
  await page.screenshot({path:join(output,'native-active-own-file.png')});
  recognition.ownFileShownAfterClosingGenerated=true;
  await page.getByRole('status',{name:'Problem recognition'}).waitFor({state:'hidden',timeout:12000});
  recognition.recognisedBubbleDismissed=true;
  await page.getByRole('button',{name:'Just leave a thought',exact:true}).click();
  await page.locator('#thought').fill('Controlled draft for Before an Exam');
  await page.evaluate(()=>window.forma.command({id:'native-draft-context-change',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A'}}));
  await page.getByRole('button',{name:'Save thought locally',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'active problem changed'}).waitFor({state:'visible'});
  assert.equal(await page.locator('#thought').inputValue(),'Controlled draft for Before an Exam');
  assert.equal((await page.evaluate(()=>window.forma.getSnapshot())).state.thoughts.length,20);
  recognition.desktopDraftGuard=true;
  await page.screenshot({path:join(output,'native-draft-guard.png')});
  await page.evaluate(()=>window.forma.ui('expand',false));


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
  const report={today:{suggestionRendered:true,compactHeight:todayWindow.height,readingCreatedNoSession:true},recognition,verifiedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,softwareRendering:software,notebook:folder,traySvgEmpty,trayPngEmpty,pairing:{acknowledged:pairedAck.ok,revocationRejected:!revokedAck.ok},cardP95Ms,...timings,idle:{durationMs:idleMs,cpuPercentOfOneCore:cpuSeconds/(idleMs/1000)*100,totalWorkingSetMiB:idleEnd.reduce((s,p)=>s+p.kib,0)/1024,processes:idleEnd},pageErrors:errors};
  assert.deepEqual(errors,[]);
  await writeFile(join(output,'native-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await application.close();}

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
  await page.getByRole('button',{name:/Today’s plan/}).click();
  await page.getByRole('button',{name:'Start & open problem',exact:true}).waitFor();
  const planned=await page.evaluate(()=>window.forma.getSnapshot());
  assert.equal(planned.today.items[0].title,'Watermelon');
  assert.equal(planned.today.items[0].activity,'coding');
  assert.equal(planned.data.session,null);
  await page.screenshot({path:join(output,'native-today-suggestion.png')});
  await page.getByRole('button',{name:'Back to practice',exact:true}).click();
  await page.getByRole('button', {name:'Begin a session',exact:true}).click();
  await page.getByRole('button', {name:'Pause from ribbon',exact:true}).click();
  const thread = 'Check what happens when both bounds are equal.';
  await page.getByLabel('What would you try next?').fill(thread);
  await page.getByRole('button',{name:'Save thread',exact:true}).click();
  await page.locator('.desktop-ribbon-fold[data-feedback="thought"]').waitFor();
  await page.getByRole('button',{name:'Hypothesis',exact:true}).click();
  await page.getByLabel('Hypothesis',{exact:true}).fill('Try keeping the invariant at the boundary.');
  await page.getByRole('button',{name:'Save to desk',exact:true}).click();
  await page.getByText('Try keeping the invariant at the boundary.',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Screenshot',exact:true}).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({name:'practice.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.getByRole('img',{name:'Screenshot to save',exact:true}).waitFor();
  await page.getByLabel('Caption (optional)',{exact:true}).fill('Boundary example');
  await page.getByRole('button',{name:'Save to desk',exact:true}).click();
  await page.getByText('Boundary example',{exact:true}).first().waitFor();
  const desk = await page.evaluate(()=>window.forma.getSnapshot());
  assert.equal(desk.data.session.runningSince,null);
  assert.deepEqual(desk.state.desk.map(item=>item.kind),['thread','hypothesis','screenshot']);
  await page.reload();
  await page.getByRole('button',{name:'Back to practice',exact:true}).click();
  await page.getByRole('button',{name:/^Pick up the thread/}).click();
  await page.getByText(thread,{exact:true}).waitFor();
  await page.getByText('Try keeping the invariant at the boundary.',{exact:true}).first().waitFor();
  await page.evaluate(()=>window.forma.ui('theme','ink'));
  await page.locator('.companion.theme-ink').waitFor();
  await page.screenshot({path:join(output,'native-problem-desk-ink.png')});
  await page.evaluate(()=>window.forma.ui('theme','light'));
  await page.locator('.companion.theme-light').waitFor();
  await page.screenshot({path:join(output,'native-problem-desk-light.png')});
  await page.getByText('Boundary example',{exact:true}).first().click();
  await page.getByRole('img',{name:'Boundary example',exact:true}).waitFor();
  await page.getByRole('button',{name:'Remove screenshot',exact:true}).click();
  await page.getByText('Boundary example',{exact:true}).first().waitFor({state:'hidden'});
  await page.keyboard.press(process.platform==='darwin'?'Meta+k':'Control+k');
  const palette=page.getByRole('dialog',{name:'Command palette'});
  const paletteSearch=palette.getByRole('combobox',{name:'Search commands and notebook'});
  await paletteSearch.waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Search commands and notebook');
  await palette.getByRole('option',{name:/Resume Watermelon/}).filter({hasText:thread}).waitFor();
  await page.screenshot({path:join(output,'native-command-palette-light.png')});
  await paletteSearch.fill('both bounds');
  await palette.getByRole('option',{name:/Saved thread/}).waitFor();
  await paletteSearch.press('Enter');
  await palette.getByRole('heading',{name:'Saved thread',exact:true}).waitFor();
  await palette.getByText(thread,{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.forma.getSnapshot())).data.session.runningSince,null);
  await page.keyboard.press('Escape');
  assert.equal(await paletteSearch.inputValue(),'both bounds');
  await page.keyboard.press('Escape');
  await palette.waitFor({state:'hidden'});
  await page.getByRole('button', {name:'Resume session',exact:true}).click();
  await page.getByRole('button', {name:'Pause from ribbon',exact:true}).waitFor();

  // Rehearsal must not mutate the real, paused session in this isolated profile.
  await page.getByRole('button',{name:'Pause from ribbon',exact:true}).click();
  const original=await page.evaluate(()=>window.forma.getSnapshot());
  await page.getByRole('button',{name:'Companion settings',exact:true}).click();
  const studio=page.getByRole('region',{name:'Ribbon personalization'});
  await studio.getByRole('button',{name:'Small fold',exact:true}).click();
  await studio.getByRole('button',{name:'Right edge',exact:true}).click();
  await studio.getByRole('button',{name:'Save appearance',exact:true}).click();
  await studio.getByRole('status').filter({hasText:'saved'}).waitFor();
  await studio.getByRole('button',{name:'Rehearse a session'}).click();
  await page.getByRole('button',{name:'Open sample ribbon'}).click();
  await page.getByRole('button',{name:'Start sample timer'}).click();
  await page.getByRole('button',{name:'Pause sample timer'}).click();
  await page.getByLabel('Sample outcome').selectOption('unsolved');
  await page.getByLabel('One thought for next time').fill('Sample bookmark only.');
  await page.getByRole('button',{name:'Bookmark sample thought'}).click();
  await page.locator('.rs-bookmark').filter({hasText:'Sample bookmark only.'}).waitFor();
  const afterRehearsal=await page.evaluate(()=>window.forma.getSnapshot());
  assert.deepEqual(afterRehearsal.data.attempts,original.data.attempts);
  assert.deepEqual(afterRehearsal.data.session,original.data.session);
  await page.getByRole('button',{name:'Finish rehearsal'}).click();
  await page.evaluate(async()=>{
    await window.forma.command({id:'edge-resume',type:'resume',payload:{}});
    await window.forma.ui('expand',false);
  });
  await page.waitForFunction(()=>document.querySelector('[data-tucked="true"]'));
  const tucked=await application.evaluate(({BrowserWindow,screen})=>{
    const b=BrowserWindow.getAllWindows()[0].getBounds(),a=screen.getDisplayMatching(b).workArea;
    return {right:b.x+b.width,edge:a.x+a.width,width:b.width};
  });
  assert.equal(tucked.width,96);assert.equal(tucked.right,tucked.edge);
  await page.getByRole('button',{name:/^Open companion/}).click();
  await page.getByRole('button',{name:'Pause from ribbon'}).click();
  await page.evaluate(()=>window.forma.ui('ribbon-options',{shape:'strip',edge:'free',motion:'gentle'}));
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
    await api.command({id:'native-pause',type:'pause',payload:{}});
    await api.command({id:'native-finish',type:'finish',payload:{}});
    await api.command({id:'native-reflect',type:'reflect',payload:{outcome:'hint',takeaway:'Check parity before branching.'}});
    const state=await api.getSnapshot();
    samples.sort((a,b)=>a-b);
    return {saveP95Ms:samples[Math.ceil(samples.length*.95)-1],noteCount:state.state.thoughts.length,attempts:state.data.attempts.length,outcome:state.data.attempts[0].outcome};
  });
  assert.equal(timings.noteCount,20);assert.equal(timings.attempts,1);assert.equal(timings.outcome,'hint');
  await page.screenshot({path:join(output,'native-practice.png')});
  await page.evaluate(async()=>{
    const api=window.forma;
    await api.command({id:'native-comparison-start',type:'start',payload:{}});
    await api.command({id:'native-comparison-finish',type:'finish',payload:{}});
    await api.command({id:'native-comparison-reflect',type:'reflect',payload:{outcome:'independent',takeaway:'Verify the even split directly.',approach:'Check each parity case before writing a branch.'}});
    await api.ui('theme','ink');
  });
  const beforeComparison=await page.evaluate(()=>window.forma.getSnapshot());
  await page.keyboard.press(process.platform==='darwin'?'Meta+k':'Control+k');
  await paletteSearch.fill('Verify the even split');
  await paletteSearch.press('Enter');
  await palette.getByRole('button',{name:'Compare attempts',exact:true}).click();
  await palette.getByRole('heading',{name:'Then / Now',exact:true}).waitFor();
  await palette.getByText('Check parity before branching.',{exact:true}).waitFor();
  await palette.getByText('Check each parity case before writing a branch.',{exact:true}).waitFor();
  await page.screenshot({path:join(output,'native-then-now-ink.png')});
  await page.keyboard.press('Escape');
  await palette.getByRole('heading',{name:'Solved independently',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await palette.waitFor({state:'hidden'});
  const afterComparison=await page.evaluate(()=>window.forma.getSnapshot());
  assert.deepEqual(afterComparison.data.attempts,beforeComparison.data.attempts);
  assert.equal(afterComparison.revision,beforeComparison.revision);

  // Exercise the native source UI against a deterministic handoff endpoint.
  const destination='ea7f3538-0d0a-466d-8e34-e08a1747aac7';
  await application.evaluate(({shell},accountId)=>{
    const originalFetch=globalThis.fetch, originalOpen=shell.openExternal;
    const fixture={state:'linked',opened:'',packet:null};
    globalThis.__formaHandoffFixture=fixture;
    shell.openExternal=(url,...args)=>{
      if(new URL(url).pathname==='/handoff'){fixture.opened=url;return Promise.resolve();}
      return originalOpen(url,...args);
    };
    globalThis.fetch=(url,options)=>{
      if(new URL(String(url)).pathname!=='/api/handoff')return originalFetch(url,options);
      const input=JSON.parse(options.body);
      if(input.action==='source-send'){
        fixture.packet=input.packet;
        fixture.state='ready';
      }
      return Promise.resolve(Response.json({state:fixture.state,accountId,accountLabel:'learner@example.test',
        ...(fixture.packet?{sessionId:fixture.packet.session.id}:{})}));
    };
    globalThis.__formaRestoreHandoffFixture=()=>{globalThis.fetch=originalFetch;shell.openExternal=originalOpen;};
  },destination);
  await page.evaluate(()=>window.forma.command({id:'native-handoff-start',type:'start',payload:{}}));
  await page.getByRole('button',{name:'Pause and continue on web',exact:true}).click();
  const handoff=page.getByRole('region',{name:'Continue on web',exact:true});
  const nextStep='Try a boundary case in the browser.';
  await handoff.getByRole('textbox',{name:/What would you try next/}).fill(nextStep);
  await handoff.getByRole('button',{name:'Open browser to link',exact:true}).click();
  await handoff.getByRole('button',{name:'Check status',exact:true}).click();
  await handoff.getByText('learner@example.test',{exact:true}).waitFor();
  const pausedForHandoff=await page.evaluate(()=>window.forma.getSnapshot());
  assert.equal(pausedForHandoff.data.session.runningSince,null);
  assert.equal(pausedForHandoff.presentation.handoffPending,true);
  await handoff.getByRole('button',{name:'Send paused session',exact:true}).click();
  await handoff.getByText(/Choose Receive session in the browser/).waitFor();
  const sent=await application.evaluate(()=>{
    const fixture=globalThis.__formaHandoffFixture;
    fixture.state='received';
    return {url:fixture.opened,packet:fixture.packet};
  });
  assert.equal(new URL(sent.url).search,'');
  assert.equal(sent.packet.session.id,pausedForHandoff.data.session.id);
  assert.equal(sent.packet.session.elapsedMs,pausedForHandoff.data.session.elapsedMs);
  assert.equal(sent.packet.thread,nextStep);
  await handoff.getByRole('button',{name:'Check status',exact:true}).click();
  await handoff.getByText(/Received in your web workspace/).waitFor();
  const transferred=await page.evaluate(()=>window.forma.getSnapshot());
  assert.equal(transferred.data.session,null);
  assert.equal(transferred.presentation.handoffPending,false);
  assert.deepEqual(transferred.data.attempts,afterComparison.data.attempts);
  await application.evaluate(()=>globalThis.__formaRestoreHandoffFixture());
  await handoff.getByRole('button',{name:'Back to practice',exact:true}).click();

  await page.getByRole('button',{name:/Today’s plan/}).click();
  await page.getByText('TODAY’S PLAN',{exact:true}).waitFor();
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
  const trayPngEmpty=await application.evaluate(({nativeImage},path)=>nativeImage.createFromPath(path).isEmpty(),resolve('.companion-build/assets/ribbon-tray.png'));
  assert.equal(trayPngEmpty,false);
  const report={today:{suggestionRendered:true,compactHeight:todayWindow.height,readingCreatedNoSession:true},commandPalette:{keyboardOpened:true,pausedThreadShown:true,exactThreadPreview:true,preservedSession:true},thenNow:{openedFromReflection:true,exactAttempts:true,readOnly:true},handoff:{pausedAndReviewed:true,exactTimerAndThread:true,retiredOnReceipt:true,fixtureEndpoint:true},recognition,verifiedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,softwareRendering:software,notebook:folder,traySvgEmpty,trayPngEmpty,pairing:{acknowledged:pairedAck.ok,revocationRejected:!revokedAck.ok},cardP95Ms,...timings,idle:{durationMs:idleMs,cpuPercentOfOneCore:cpuSeconds/(idleMs/1000)*100,totalWorkingSetMiB:idleEnd.reduce((s,p)=>s+p.kib,0)/1024,processes:idleEnd},pageErrors:errors};
  assert.deepEqual(errors,[]);
  await writeFile(join(output,'native-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await application.close();}

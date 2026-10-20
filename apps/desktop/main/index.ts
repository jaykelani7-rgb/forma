import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell, dialog, safeStorage, powerMonitor, nativeTheme } from "electron";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { RecognitionHub } from "./recognition";
import { startBrowserTransport } from "./browser-transport";
import { DatabaseClient } from "./database-client";
import { startTransport } from "./transport";
import { clampPosition, type CompanionPreferences } from "./preferences";
import type { LocalSnapshot } from "./store";
import { createCodeforcesAdapter } from "../../../src/lib/codeforces-api";
import { parseVerifiedCodeforcesPage } from "../../../packages/integrations/codeforces";
import type { SubmissionInput } from "../../../src/lib/codeforces-types";

app.setName('Forma Companion');
const developmentData = !app.isPackaged || process.argv.includes('--companion-smoke') ? process.env.FORMA_COMPANION_DATA_DIR : undefined;
if(developmentData)app.setPath('userData',resolve(developmentData));
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
let window: BrowserWindow;
let tray: Tray;
let database: DatabaseClient;
let preferences: CompanionPreferences;
let transport: Awaited<ReturnType<typeof startTransport>> | undefined;
let credential:string|null=null;
let browserCredential:string|null=null;
let browserTransport: Awaited<ReturnType<typeof startBrowserTransport>> | undefined;
let recognition: RecognitionHub;
const hostEpoch = randomUUID();
let connected=false;
let expanded=false;
let panelRequest:{id:number;panel:'home'|'memory'}|undefined;
let quitting=false;
let checkPromise:Promise<void>|null=null;
let codeforces:{checking:boolean;checkedAt:string|null;error:string|null}={checking:false,checkedAt:null,error:null};
let codeforcesHandle:string|null=null;
let lastCheck=0;
let lastTick=Date.now();
function platformStatus(state:LocalSnapshot['state']){
  return codeforcesHandle===state.handle?{...codeforces,checkedAt:codeforces.checkedAt??state.checkedAt}:{checking:false,checkedAt:state.checkedAt,error:null};
}
const snapshot=async()=>{
  const local=await database.call<LocalSnapshot>('snapshot');
  return {...local,preferences,presentation:{expanded,panelRequest,activeFileUri:recognition?.activeFileUri()??null,recognition:recognition?.presentation()??null},integration:{connected,paired:!!credential,browserEnabled:!!browserCredential,browserSupported:process.platform==='darwin',status:connected?'VS Code connected':credential?'Waiting for VS Code':'Pair VS Code when you’re ready'},codeforces:platformStatus(local.state)};
};
async function broadcast() {
  if(!window||window.isDestroyed())return;
  const next=await snapshot();
  if(!expanded){
    const bubble=!!next.presentation.recognition&&!(preferences.snoozedUntil&&Date.parse(preferences.snoozedUntil)>Date.now());
    const b=window.getBounds(), size={width:bubble?340:148,height:bubble?310:164};
    if(b.width!==size.width||b.height!==size.height){const area=screen.getDisplayMatching(b).workArea;const at=clampPosition({x:b.x+b.width-size.width,y:b.y+b.height-size.height},size,area);window.setBounds({...at,...size});}
  }
  window.webContents.send('forma:changed',next);
}
function constrain(){if(!window||window.isDestroyed())return;const b=window.getBounds();const a=screen.getDisplayMatching(b).workArea;window.setPosition(...Object.values(clampPosition(b,b,a)) as [number,number]);}
function expand(value:boolean,focus=false){
  const b=window.getBounds();expanded=value;
  const width=value?380:148, height=value?700:164;
  const a=screen.getDisplayMatching(b).workArea;
  const size={width:Math.min(width,a.width),height:Math.min(height,a.height)};
  const at=clampPosition({x:b.x+b.width-size.width,y:b.y+b.height-size.height},size,a);
  window.setIgnoreMouseEvents(false);window.setBounds({...at,...size});
  if(focus)window.show();else window.showInactive();
  void broadcast();
}
function show(){expand(true,true);void broadcast();}
function credentialPath(){return join(app.getPath('userData'),'pairing.enc');}
function secureAvailable(){return safeStorage.isEncryptionAvailable() && (process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');}
function saveCredential(value:string|null){
  if(!secureAvailable())throw new Error('OS credential storage is unavailable. Enable Keychain or a supported secret store to pair VS Code.');
  writeFileSync(credentialPath(),safeStorage.encryptString(value??''),{mode:0o600});credential=value;transport?.revoke();recognition?.reset();connected=false;
}
async function applyCommand(command:unknown,producer='desktop') {
  await database.call<LocalSnapshot>('command',command,producer);
  if((command as {type?:string})?.type==='reflect')await recognition?.afterReflection();
  await broadcast();return snapshot();
}
async function saveFile(kind:'notebook'|'companion'){
  const choice=await dialog.showSaveDialog(window,{defaultPath:`forma-${kind}-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'JSON backup',extensions:['json']}]});
  if(choice.canceled||!choice.filePath)return {saved:false};
  const json=await database.call<string>(kind==='notebook'?'exportNotebook':'exportCompanion');
  writeFileSync(choice.filePath,json,{mode:0o600});return {saved:true};
}
async function setPreferences(change:Partial<CompanionPreferences>){preferences=await database.call('setPreferences',{...preferences,...change});await broadcast();return preferences;}
function registerShortcut(shortcut:string){
  if(!globalShortcut.register(shortcut,show))throw new Error('That shortcut is in use. Choose another shortcut.');
}

let verifiedContext:{handle:string;identity:string}|null=null;
let verifiedSubmissions:SubmissionInput[]=[];
const cf=createCodeforcesAdapter({fetcher:async(url,init)=>{
  const response=await fetch(url,init);
  if(!response.ok||!url.includes('/user.status'))return response;
  const body=await response.clone().json();
  if(body.status!=='OK')return response;
  const context=verifiedContext;
  if(!context)throw new Error('No verified problem context.');
  const [namespace,contestId]=context.identity.split(':');
  if(!Array.isArray(body.result)||body.result.length>100)throw new Error('Invalid Codeforces page.');
  const relevant=body.result.filter((item:{problem?:{contestId?:number}})=>item?.problem?.contestId===Number(contestId));
  // Only the selected canonical namespace is known. Other problems remain
  // unassigned. Public author membership is checked before accepting evidence.
  verifiedSubmissions=parseVerifiedCodeforcesPage(relevant,{handle:context.handle,observedAt:new Date().toISOString(),namespaceForContest:id=>id===Number(contestId)?namespace as 'gym'|'contest':null}).map(e=>e.submission);
  return Response.json({...body,result:relevant});
}});
async function checkCodeforces(){
  if(checkPromise)return checkPromise;
  checkPromise=(async()=>{
    const before=await database.call<LocalSnapshot>('snapshot');
    const handle=before.state.handle;
    if(!handle)throw new Error('Add your Codeforces handle first.');
    if(!before.state.identity)throw new Error('Attach a problem before checking its submissions.');
    if(Date.now()-lastCheck<10000)throw new Error('The last check was recent. Please wait a moment.');
    lastCheck=Date.now();codeforcesHandle=handle;codeforces={checking:true,checkedAt:before.state.checkedAt,error:null};await broadcast();
    try{
      verifiedContext={handle,identity:before.state.identity};
      verifiedSubmissions=[];
      await cf.activity(handle,1);
      const current=await database.call<LocalSnapshot>('snapshot');
      if(current.state.handle?.toLowerCase()!==handle.toLowerCase())return;
      // Keep identities emitted by the author-verifying adapter. Its namespace
      // comes from the selected URL, without the legacy numeric Gym heuristic.
      const submissions=verifiedSubmissions;
      const checkedAt=new Date().toISOString();
      await database.call('evidence',{handle,submissions,checkedAt},randomUUID());
      codeforces={checking:false,checkedAt,error:null};
    }catch(error){codeforces={...codeforces,checking:false,error:error instanceof Error?error.message:'Waiting for platform confirmation.'};}
    finally{codeforces.checking=false;await broadcast();}
  })().finally(()=>{checkPromise=null;});
  return checkPromise;
}

function verifySender(event:Electron.IpcMainInvokeEvent){
  if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url.split('?')[0]!==new URL(`file://${join(__dirname,'renderer','index.html')}`).href)throw new Error('Untrusted companion sender.');
}
async function ui(action:string,payload:unknown){
  switch(action){
    case 'recognition-dismiss':recognition.dismiss(typeof payload==='string'?payload:undefined);return null;
    case 'recognition-resolve':await recognition.resolveConflict();return null;
    case 'recognition-finish':await recognition.finishAndSwitch();show();return null;
    case 'enable-browser':{
      if(process.platform!=='darwin')throw new Error('Chrome capture is currently available on macOS. CPH recognition remains available.');
      if(typeof payload!=='boolean')throw new Error('Choose whether Chrome capture is enabled.');
      if(!secureAvailable())throw new Error('OS-protected storage is required for Chrome capture.');
      browserCredential=payload?randomBytes(32).toString('base64url'):null;
      writeFileSync(join(app.getPath('userData'),'browser-pairing.enc'),safeStorage.encryptString(browserCredential??''),{mode:0o600});
      if(!payload)recognition.cancelBrowser();await broadcast();return null;
    }
    case 'expand':expand(typeof payload==='boolean'?payload:!!(payload as {expanded?:boolean})?.expanded);return null;
    case 'hide':window.hide();return null;
    case 'hitbox':if(typeof payload!=='boolean')throw new Error('Invalid hitbox.');window.setIgnoreMouseEvents(!payload,{forward:true});return null;
    case 'open-external': {
      if(typeof payload!=='string')throw new Error('Invalid link.');
      const url=new URL(payload);
      if(url.protocol!=='https:'||url.username||url.password||url.port||!['codeforces.com','www.codeforces.com'].includes(url.hostname))throw new Error('Only verified Codeforces links may open from the companion.');
      await shell.openExternal(url.toString());return null;
    }
    case 'open-vscode':await shell.openExternal('vscode://');return null;
    case 'open-forma':await shell.openExternal('http://localhost:3001');return null;
    case 'export-notebook':return saveFile('notebook');
    case 'export-companion':return saveFile('companion');
    case 'import-notebook':{
      const choice=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Forma notebook',extensions:['json']}]});
      if(choice.canceled)return {saved:false};
      const {statSync}=await import('node:fs');
      if(statSync(choice.filePaths[0]).size>64*1024*1024)throw new Error('Choose a Forma notebook no larger than 64 MB.');
      await database.call('importNotebook',readFileSync(choice.filePaths[0],'utf8'));await broadcast();return {saved:true};
    }
    case 'pair':{
      const secret=randomBytes(32).toString('base64url');saveCredential(secret);await broadcast();return {credential:secret,endpoint:transport?.endpoint};
    }
    case 'revoke-pairing':saveCredential(null);await broadcast();return null;
    case 'check-codeforces':await checkCodeforces();return snapshot();
    case 'theme':if(!['light','ink','system'].includes(String(payload)))throw new Error('Choose Light, Ink, or System.');return setPreferences({theme:payload as CompanionPreferences['theme']});
    case 'reduced-motion':if(typeof payload!=='boolean')throw new Error('Invalid motion preference.');return setPreferences({reducedMotion:payload});
    case 'snooze':return setPreferences({snoozedUntil:payload===false?null:new Date(Date.now()+60*60*1000).toISOString()});
    case 'shortcut':{
      if(typeof payload!=='string'||payload.length>100||!/^[A-Za-z0-9+]+$/.test(payload))throw new Error('Invalid shortcut.');
      const old=preferences.shortcut;
      if(payload===old)return preferences;
      registerShortcut(payload);
      try{await setPreferences({shortcut:payload});globalShortcut.unregister(old);return preferences;}catch(error){globalShortcut.unregister(payload);throw error;}
    }
    default:throw new Error('Unsupported companion action.');
  }
}

async function main(){
  await app.whenReady();
  const userData=app.getPath('userData');mkdirSync(userData,{recursive:true,mode:0o700});
  database=new DatabaseClient(join(userData,'notebook.sqlite'));
  preferences=await database.call('preferences');
  recognition=new RecognitionHub({snapshot:()=>database.call<LocalSnapshot>('snapshot'),command:c=>database.call('command',c,'vscode'),select:(file,client)=>database.call('selectBinding',file,client),changed:()=>{void broadcast();}});
  const browserSecret=join(userData,'browser-pairing.enc');
  if(existsSync(browserSecret)&&secureAvailable())try{browserCredential=safeStorage.decryptString(readFileSync(browserSecret))||null;}catch{browserCredential=null;}

  if(existsSync(credentialPath())&&secureAvailable())try{credential=safeStorage.decryptString(readFileSync(credentialPath()))||null;}catch{credential=null;}
  const a=screen.getPrimaryDisplay().workArea;
  const size={width:148,height:164};const position=clampPosition(preferences.position??{x:a.x+a.width-180,y:a.y+a.height-200},size,a);
  window=new BrowserWindow({...size,...position,frame:false,transparent:true,resizable:false,show:false,hasShadow:false,alwaysOnTop:true,skipTaskbar:true,title:'Forma Companion — unsigned development build',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:true}});
  window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.session.setPermissionCheckHandler(()=>false);
  ipcMain.handle('forma:snapshot',event=>{verifySender(event);return snapshot();});
  ipcMain.handle('forma:command',(event,command)=>{verifySender(event);return applyCommand(command);});
  ipcMain.handle('forma:ui',(event,action,payload)=>{verifySender(event);return ui(action,payload);});
  await window.loadFile(join(__dirname,'renderer','index.html'));
  window.showInactive();
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
  let moveTimer:ReturnType<typeof setTimeout>;
  window.on('moved',()=>{clearTimeout(moveTimer);moveTimer=setTimeout(()=>{constrain();const b=window.getBounds();void setPreferences({position:{x:b.x+b.width-148,y:b.y+b.height-164}});},400);});
  screen.on('display-removed',constrain);screen.on('display-metrics-changed',constrain);
  // A static original fox mark remains discoverable when the pet is hidden.
  const icon=nativeImage.createFromPath(join(__dirname,'assets','fenn-tray.png'));
  if(icon.isEmpty())throw new Error('The menu-bar recovery icon is missing from this build.');
  icon.setTemplateImage(true);tray=new Tray(icon);tray.setToolTip('Forma Companion');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Fenn',click:show},{label:'Pet only',click:()=>expand(false)},{label:'Hide companion',click:()=>window.hide()},{label:'Snooze for an hour',click:()=>void setPreferences({snoozedUntil:new Date(Date.now()+3600000).toISOString()})},{type:'separator'},{label:'Export notebook…',click:()=>void saveFile('notebook')},{label:'Unsigned development build',enabled:false},{label:'Quit Forma Companion',click:()=>app.quit()}]));
  tray.on('click',show);
  try{registerShortcut(preferences.shortcut);}catch{ /* Tray recovery stays available when the shortcut is occupied. */ }
  transport=await startTransport({...(developmentData?{endpoint:join(userData,'runtime','companion.sock')}:{}),credential:()=>credential,command:command=>applyCommand(command,'vscode'),recognition:request=>recognition.request(request),action:async action=>{if(action==='open'||action==='memory'){panelRequest={id:(panelRequest?.id??0)+1,panel:action==='memory'?'memory':'home'};show();}return (await database.call<LocalSnapshot>('snapshot')).revision;},context:async()=>{const local=await database.call<LocalSnapshot>('snapshot');return {identity:local.state.identity,sessionId:local.data.session?.id??null,hostEpoch};},connected:value=>{connected=value;void broadcast();}});
  if(process.platform==='darwin')browserTransport=await startBrowserTransport({endpoint:join(userData,'runtime','browser.sock'),credential:()=>browserCredential,message:m=>recognition.browser(m)});
  powerMonitor.on('suspend',()=>void database.call('pause','suspend').then(broadcast));
  powerMonitor.on('lock-screen',()=>void database.call('pause','screen-lock').then(broadcast));
  powerMonitor.on('resume',()=>{lastTick=Date.now();void broadcast();});
  nativeTheme.on('updated',()=>void broadcast());
  const timer=setInterval(async()=>{
    const now=Date.now(),gap=now-lastTick;lastTick=now;
    if(gap<0||gap>45000){await database.call('pause','clock-discontinuity');await broadcast();return;}
    const local=await database.call<LocalSnapshot>('snapshot');
    if(local.data.session?.runningSince!==null&&local.data.session)await database.call('checkpoint');
    const recentPending=local.state.platform==='pending'&&local.state.submissions.some(s=>s.verdict===null||s.verdict==='TESTING')&&local.state.submissions.some(s=>now-Date.parse(s.submittedAt)<10*60*1000);
    if(local.state.handle&&(local.state.lifecycle==='working'||recentPending)&&now-lastCheck>=30000)void checkCodeforces().catch(()=>{});
  },15000);timer.unref();
  if(process.argv.includes('--companion-smoke')){
    expand(true,true);await new Promise(r=>setTimeout(r,1500));
    const out=join(userData,'smoke.png');writeFileSync(out,(await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({sqlite:'ready',screenshot:out,metrics:app.getAppMetrics()}));app.quit();
  }
}
app.on('second-instance',()=>{if(window)show();});
app.on('activate',()=>{if(window)show();});
app.on('before-quit',event=>{
  if(quitting)return;
  quitting=true;globalShortcut.unregisterAll();transport?.close();browserTransport?.close();recognition?.reset();
  if(database){event.preventDefault();void database.call('pause','quit').catch(()=>{}).then(()=>database.close()).finally(()=>app.exit());}
});
if(lock)main().catch(error=>{console.error('Forma Companion startup:',error.message);dialog.showErrorBox('Forma Companion could not start',String(error.message));app.quit();});

import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell, dialog, safeStorage, powerMonitor, nativeTheme, systemPreferences } from "electron";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { TutorConfiguration } from "./tutor-config";
import { ConfiguredTutorProvider, speechReadyText, TutorProviderError } from "./tutor-provider";
import { TutorService } from "./tutor-service";
import { TutorHostVoice } from "./tutor-host-voice";
import { tutorExternalUrl } from "../../../packages/tutor/links";
import type { SharedCode, StatementSnapshot, TutorConversation, TutorEvent, TutorSendInput, TutorStoredView, TutorTurn } from "../../../packages/tutor/types";
import { AttentionPolicy } from "./attention";
import { companionToday } from "../../../packages/core/src/companion-today";
import { localDate } from "../../../src/lib/model";
import { RecognitionHub } from "./recognition";
import { startBrowserTransport } from "./browser-transport";
import { DatabaseClient } from "./database-client";
import { startTransport } from "./transport";
import { clampPosition, type CompanionPreferences } from "./preferences";
import type { LocalSnapshot } from "./store";
import { createCodeforcesAdapter } from "../../../src/lib/codeforces-api";
import { parseVerifiedCodeforcesPage } from "../../../packages/integrations/codeforces";
import { VerdictScheduler } from "../../../packages/integrations/verdict-scheduler";
import { followupDue } from "../../../packages/core/src/verdict-followup";
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
const attention=new AttentionPolicy();
let plannerDay="";
let expanded=false;
let panelRequest:{id:number;panel:'home'|'memory'|'today'|'tutor';conversationId?:string}|undefined;
let quitting=false;
let checkPromise:Promise<void>|null=null;
let codeforces:{checking:boolean;checkedAt:string|null;error:string|null}={checking:false,checkedAt:null,error:null};
let codeforcesHandle:string|null=null;
let lastCheck=0;
let lastTick=Date.now();
let tutorConfiguration:TutorConfiguration;
let tutorProvider:ConfiguredTutorProvider;
let tutorService:TutorService;
let microphoneLeaseUntil=0;
const hostVoice=new TutorHostVoice();
function cancelVoice(){microphoneLeaseUntil=0;hostVoice.cancel();}
function emitTutor(event:TutorEvent){if(window&&!window.isDestroyed())window.webContents.send('forma:tutor-event',event);}
async function captureTutorStatement(input:unknown){
  const saved=await database.call<StatementSnapshot|null>('tutor-statement',input);
  if(saved&&input&&typeof input==='object'&&Object.keys(input).length>1)emitTutor({kind:'context',identity:saved.identity,source:'statement'});
  return saved;
}
async function shareTutorCode(code:SharedCode){
  await database.call('tutor-code',code);
  const local=await database.call<LocalSnapshot>('snapshot');
  const binding=local.state.bindings.find(b=>b.fileUri===code.fileUri&&b.identity===code.identity&&b.clientId===code.clientId&&b.workspaceId===code.workspaceId);
  if(!binding)throw new Error('Confirm the shared code association first.');
  const conversation=await database.call<TutorConversation>('tutor-open',{problemId:binding.problemId,workspaceId:code.workspaceId});
  emitTutor({kind:'context',identity:code.identity,conversationId:conversation.id,source:'code'});
  // An explicit share opens Fenn when needed; an existing draft stays on screen.
  if(panelRequest?.panel!=='tutor')await openTutor({conversationId:conversation.id});
  return {revision:local.revision};
}
function voiceReady(capability:'transcription'|'speech'){
  if(tutorService.isConfiguring)throw new TutorProviderError('busy');
  const status=tutorProvider.status();
  if(!status.configured)throw new TutorProviderError('setup',status.provider);
  if(!status.capabilities[capability])throw new TutorProviderError('model-capability',status.provider);
}
async function openTutor(input:unknown={}){
  cancelVoice();
  let choice=input;
  if(input&&typeof input==='object'&&!Object.keys(input).length){const current=await database.call<LocalSnapshot>('snapshot');if(!current.state.problemId){const prior=(await database.call<TutorStoredView>('tutor-view')).conversations[0];if(prior)choice={conversationId:prior.id};}}
  const conversation=await database.call<TutorConversation>('tutor-open',choice);
  panelRequest={id:(panelRequest?.id??0)+1,panel:'tutor',conversationId:conversation.id};expanded=true;
  const b=window.getBounds(),area=screen.getDisplayMatching(b).workArea,size={width:Math.min(560,area.width),height:Math.min(820,area.height)};
  const at=clampPosition({x:b.x+b.width-size.width,y:b.y+b.height-size.height},size,area);
  window.setIgnoreMouseEvents(false);window.setBounds({...at,...size});window.showInactive();await broadcast();return conversation;
}
async function tutorUi(action:string,payload:unknown){
  switch(action){
    case 'tutor-show':return openTutor(payload??{});
    case 'tutor-view':{const stored=await database.call<TutorStoredView>('tutor-view');return {...stored,provider:tutorProvider.status(),activeRequestId:tutorService.activeRequestId};}
    case 'tutor-provider-options':return [tutorProvider.statusFor('gemini'),tutorProvider.statusFor('openai')];
    case 'tutor-open':return database.call('tutor-open',payload??{});
    case 'tutor-statement':return captureTutorStatement(payload);
    case 'tutor-turns':case 'tutor-context':case 'tutor-exposed':case 'tutor-propose':return database.call(action,payload);
    case 'tutor-code-remove':return database.call(action);
    case 'tutor-approve':{const result=await database.call(action,payload);await broadcast();return result;}
    case 'tutor-send':return tutorService.send(payload as TutorSendInput);
    case 'tutor-stop':if(typeof payload!=='string')throw new Error('Choose a running response.');await tutorService.stop(payload);return null;
    case 'tutor-settings':{const result=await database.call(action,payload);if((payload as {contestMode?:boolean})?.contestMode){cancelVoice();await tutorService.cancelAll();}return result;}
    case 'tutor-configure':{
      cancelVoice();
      return tutorService.configure(()=>{tutorConfiguration.update(payload);const status=tutorProvider.status();emitTutor({kind:'configuration',provider:status.provider});return status;});
    }
    case 'tutor-delete':await tutorService.cancelAll();cancelVoice();return database.call(action,payload);
    case 'tutor-export':{
      const json=await database.call<string>(action,payload);const choice=await dialog.showSaveDialog(window,{defaultPath:'forma-tutor-conversation.json',filters:[{name:'Tutor conversation',extensions:['json']}]});
      if(choice.canceled||!choice.filePath)return {saved:false};writeFileSync(choice.filePath,json,{mode:0o600});return {saved:true};
    }
    case 'tutor-microphone':{
      cancelVoice();const request=hostVoice.begin();
      try{
        const settings=(await database.call<TutorStoredView>('tutor-view')).settings;request.assertCurrent();
        if(settings.contestMode)throw new Error('Contest mode disables voice assistance.');voiceReady('transcription');
        if(process.platform==='darwin'&&!await systemPreferences.askForMediaAccess('microphone'))throw new Error('Microphone access was denied. Enable it in macOS Privacy settings, or type your question.');
        request.assertCurrent();voiceReady('transcription');microphoneLeaseUntil=Date.now()+15000;return {allowed:true};
      }catch(error){request.finish();throw error;}
    }
    case 'tutor-voice-cancel':cancelVoice();return null;
    case 'tutor-transcribe':{
      if(!payload||typeof payload!=='object'||Object.keys(payload).some(k=>!['conversationId','bytes','mime'].includes(k)))throw new Error('Invalid voice recording.');
      const {conversationId,bytes,mime}=payload as {conversationId:string;bytes:Uint8Array;mime:string};if(typeof conversationId!=='string'||!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>8*1024*1024||typeof mime!=='string')throw new Error('Choose a conversation and a nonempty recording smaller than 8 MB.');
      cancelVoice();const request=hostVoice.begin();
      try{
        const settings=(await database.call<TutorStoredView>('tutor-view')).settings;request.assertCurrent();
        if(settings.contestMode)throw new Error('Contest mode disables voice assistance.');voiceReady('transcription');
        await database.call('tutor-context',conversationId);request.assertCurrent();voiceReady('transcription');
        const text=await tutorProvider.transcribe(bytes,mime,request.signal);request.assertCurrent();return {text};
      }finally{request.finish();}
    }
    case 'tutor-speech':{
      if(!payload||typeof payload!=='object'||Object.keys(payload).some(k=>!['conversationId','turnId'].includes(k)))throw new Error('Choose a completed response.');
      cancelVoice();const request=hostVoice.begin();
      try{
        const settings=(await database.call<TutorStoredView>('tutor-view')).settings;request.assertCurrent();
        if(settings.contestMode||!settings.voiceOutput)throw new Error('Enable spoken replies to hear a completed response.');voiceReady('speech');
        const {conversationId,turnId}=payload as {conversationId:string;turnId:string};const turn=(await database.call<TutorTurn[]>('tutor-turns',conversationId)).find(t=>t.id===turnId&&t.status==='completed');request.assertCurrent();
        if(!turn)throw new Error('Only completed responses can be spoken.');const text=speechReadyText(turn.assistantText);if(!text)throw new Error('This response is best read as text.');voiceReady('speech');
        const audio=await tutorProvider.speech(text,request.signal);request.assertCurrent();return audio;
      }finally{request.finish();}
    }
    default:throw new Error('Unsupported Tutor action.');
  }
}

function platformStatus(state:LocalSnapshot['state']){
  return codeforcesHandle===state.handle?{...codeforces,checkedAt:codeforces.checkedAt??state.checkedAt}:{checking:false,checkedAt:state.checkedAt,error:null};
}
const snapshot=async()=>{
  const local=await database.call<LocalSnapshot>('snapshot');
  const slot=attention.view(local.state,recognition?.presentation()??null,!!preferences.snoozedUntil&&Date.parse(preferences.snoozedUntil)>Date.now(),Date.now());
  const tutorAssistance=local.data.session?.phase==='reflection'?await database.call('tutor-assistance',{problemId:local.data.session.problemId,sessionId:local.data.session.id}):null;
  return {...local,tutorAssistance,today:companionToday(local.data),preferences,presentation:{expanded,panelRequest,activeFileUri:recognition?.activeFileUri()??null,recognition:slot.recognition,verdict:slot.verdict},integration:{connected,paired:!!credential,browserEnabled:!!browserCredential,browserSupported:process.platform==='darwin',status:connected?'VS Code connected':credential?'Waiting for VS Code':'Pair VS Code when you’re ready'},codeforces:platformStatus(local.state)};
};
async function broadcast() {
  if(!window||window.isDestroyed())return;
  const next=await snapshot();
  if(!expanded){
    const bubble=!!(next.presentation.recognition||next.presentation.verdict)&&!(preferences.snoozedUntil&&Date.parse(preferences.snoozedUntil)>Date.now());
    const b=window.getBounds(), size={width:bubble?340:148,height:bubble?310:164};
    if(b.width!==size.width||b.height!==size.height){const area=screen.getDisplayMatching(b).workArea;const at=clampPosition({x:b.x+b.width-size.width,y:b.y+b.height-size.height},size,area);window.setBounds({...at,...size});}
  }
  window.webContents.send('forma:changed',next);
}
function constrain(){if(!window||window.isDestroyed())return;const b=window.getBounds();const a=screen.getDisplayMatching(b).workArea;window.setPosition(...Object.values(clampPosition(b,b,a)) as [number,number]);}
function expand(value:boolean,focus=false,glance=false){
  const b=window.getBounds();expanded=value;
  const width=value?380:148, height=value?(glance?520:700):164;
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
  if(['finish','reflect'].includes((command as {type?:string})?.type??''))void checkCodeforces();
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

// One paced adapter and one in-flight batch coalesce all attempts for a handle.
let verifiedContext:{handle:string;identities:string[]}|null=null;
let verifiedSubmissions:SubmissionInput[]=[];
const cf=createCodeforcesAdapter({fetcher:async(url,init)=>{
  const response=await fetch(url,init);
  if(!response.ok||!url.includes('/user.status'))return response;
  const body=await response.clone().json(), context=verifiedContext;
  if(body.status!=='OK')return response;
  if(!context||!Array.isArray(body.result)||body.result.length>100)throw new Error('Invalid Codeforces page.');
  const namespaces=new Map<number,Set<string>>();
  for(const identity of context.identities){const [ns,id]=identity.split(':');const values=namespaces.get(Number(id))??new Set<string>();values.add(ns);namespaces.set(Number(id),values);}
  const relevant=body.result.filter((item:{problem?:{contestId?:number}})=>namespaces.get(item?.problem?.contestId??0)?.size===1);
  verifiedSubmissions=parseVerifiedCodeforcesPage(relevant,{handle:context.handle,observedAt:new Date().toISOString(),namespaceForContest:id=>{const values=namespaces.get(id);return values?.size===1?[...values][0] as 'gym'|'contest':null;}}).map(e=>e.submission);
  return Response.json({...body,result:relevant});
}});
const verdictScheduler=new VerdictScheduler({
  now:Date.now,
  read:async()=>(await database.call<LocalSnapshot>('reconcile')).state,
  fetch:async(handle,identities)=>{
    verifiedContext={handle,identities};verifiedSubmissions=[];
    await cf.activity(handle,1);return verifiedSubmissions;
  },
  write:async evidence=>{
    await database.call('followup-evidence',evidence,randomUUID());
    const current=await database.call<LocalSnapshot>('snapshot');
    if(current.state.handle?.toLowerCase()===evidence.handle.toLowerCase())codeforces={checking:true,checkedAt:evidence.checkedAt,error:evidence.error??null};
  },
});
async function checkCodeforces(manual=false){
  if(checkPromise)return checkPromise;
  lastCheck=Date.now();
  checkPromise=(async()=>{
    codeforcesHandle=(await database.call<LocalSnapshot>('snapshot')).state.handle;
    codeforces={...codeforces,checking:true,error:null};await broadcast();
    try{await verdictScheduler.run(manual);}
    finally{codeforces.checking=false;await broadcast();}
  })().finally(()=>{checkPromise=null;});
  return checkPromise;
}

function verifySender(event:Electron.IpcMainInvokeEvent){
  if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url.split('?')[0]!==new URL(`file://${join(__dirname,'renderer','index.html')}`).href)throw new Error('Untrusted companion sender.');
}
async function ui(action:string,payload:unknown){
  if(action.startsWith('tutor-'))return tutorUi(action,payload);
  switch(action){
    case 'attention-dismiss':if(typeof payload==='string')attention.dismiss(payload);await broadcast();return null;
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
    case 'today':panelRequest={id:(panelRequest?.id??0)+1,panel:'today'};expand(true,false,true);return null;
    case 'expand':expand(typeof payload==='boolean'?payload:!!(payload as {expanded?:boolean})?.expanded);return null;
    case 'hide':cancelVoice();window.hide();return null;
    case 'hitbox':if(typeof payload!=='boolean')throw new Error('Invalid hitbox.');window.setIgnoreMouseEvents(!payload,{forward:true});return null;
    case 'open-external': {
      await shell.openExternal(tutorExternalUrl(payload));return null;
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
    case 'check-codeforces':await checkCodeforces(true);return snapshot();
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
  tutorConfiguration=new TutorConfiguration(join(userData,'tutor-provider.enc'),{available:secureAvailable,encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)});
  tutorProvider=new ConfiguredTutorProvider(provider=>tutorConfiguration.get(provider));
  tutorService=new TutorService({call:(method,...args)=>database.call(method,...args),emit:emitTutor},tutorProvider);
  await database.call('reconcile');
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
  window.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===window.webContents&&permission==='media'&&Date.now()<microphoneLeaseUntil&&'mediaTypes' in details&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio'));
  window.webContents.session.setPermissionCheckHandler((contents,permission,_origin,details)=>contents===window.webContents&&permission==='media'&&Date.now()<microphoneLeaseUntil&&details.mediaType==='audio');
  ipcMain.handle('forma:snapshot',event=>{verifySender(event);return snapshot();});
  ipcMain.handle('forma:command',(event,command)=>{verifySender(event);return applyCommand(command);});
  ipcMain.handle('forma:ui',(event,action,payload)=>{verifySender(event);return ui(action,payload);});
  await window.loadFile(join(__dirname,'renderer','index.html'));
  window.showInactive();
  window.on('hide',cancelVoice);
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
  transport=await startTransport({...(developmentData?{endpoint:join(userData,'runtime','companion.sock')}:{}),credential:()=>credential,command:command=>applyCommand(command,'vscode'),tutorCode:shareTutorCode,recognition:request=>recognition.request(request),action:async action=>{if(action==='open'||action==='memory'){panelRequest={id:(panelRequest?.id??0)+1,panel:action==='memory'?'memory':'home'};show();}return (await database.call<LocalSnapshot>('snapshot')).revision;},context:async()=>{const local=await database.call<LocalSnapshot>('snapshot');return {identity:local.state.identity,sessionId:local.data.session?.id??null,hostEpoch};},connected:value=>{connected=value;void broadcast();}});
  if(process.platform==='darwin')browserTransport=await startBrowserTransport({endpoint:join(userData,'runtime','browser.sock'),credential:()=>browserCredential,message:async m=>{if((m as {kind?:string})?.kind==='statement'){await captureTutorStatement((m as {statement:unknown}).statement);return {ok:true,status:'saved'};}return recognition.browser(m);}});
  powerMonitor.on('suspend',()=>void database.call('pause','suspend').then(broadcast));
  powerMonitor.on('lock-screen',()=>void database.call('pause','screen-lock').then(broadcast));
  powerMonitor.on('resume',()=>{lastTick=Date.now();void broadcast();});
  nativeTheme.on('updated',()=>void broadcast());
  const timer=setInterval(async()=>{
    const now=Date.now(),gap=now-lastTick;lastTick=now;
    if(gap<0||gap>45000){await database.call('pause','clock-discontinuity');await broadcast();return;}
    const local=await database.call<LocalSnapshot>('snapshot');
    if(local.data.session?.runningSince!==null&&local.data.session)await database.call('checkpoint');
    const day=`${localDate(new Date(now))}:${new Date(now).getTimezoneOffset()}`;
    if(day!==plannerDay){plannerDay=day;await database.call('reconcile');await broadcast();}
    if((local.state.followups??[]).some(f=>followupDue(f,now))&&now-lastCheck>=30000)void checkCodeforces().catch(()=>{});
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
  if(database){event.preventDefault();cancelVoice();void Promise.resolve(tutorService?.dispose()).catch(()=>{}).then(()=>database.call('pause','quit')).catch(()=>{}).then(()=>database.close()).finally(()=>app.exit());}
});
if(lock)main().catch(error=>{console.error('Forma Companion startup:',error.message);dialog.showErrorBox('Forma Companion could not start',String(error.message));app.quit();});

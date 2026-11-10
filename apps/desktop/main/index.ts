import { readRibbonOptions } from "../../../packages/ribbon/options";
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell, dialog, safeStorage, powerMonitor, nativeTheme, systemPreferences } from "electron";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from "node:crypto";
import { TutorConfiguration } from "./tutor-config";
import { ConfiguredTutorProvider, speechReadyText, TutorProviderError } from "./tutor-provider";
import { TutorService } from "./tutor-service";
import { ThoughtHostVoice, TutorHostVoice, type ThoughtVoiceContext } from "./tutor-host-voice";
import { ThoughtTakeStore } from "./thought-take-store";
import { DesktopSessionHandoff } from "./session-handoff-client";
import { tutorExternalUrl } from "../../../packages/tutor/links";
import { FIRST_CHALLENGE_CASE_ID, type ChallengeCaseState, type ChallengeRunPlan, type ChallengeRunReceipt, type ChallengeRunRequest } from "../../../packages/tutor/challenge-run";
import type { DeskHintReview, DeskIdeaReview, SharedCode, StatementSnapshot, TutorConversation, TutorEvent, TutorSendInput, TutorStoredView, TutorTurn } from "../../../packages/tutor/types";
import { AttentionPolicy } from "./attention";
import { companionToday } from "../../../packages/core/src/companion-today";
import { localDate } from "../../../src/lib/model";
import { RecognitionHub } from "./recognition";
import { startBrowserTransport } from "./browser-transport";
import { DatabaseClient } from "./database-client";
import { startTransport } from "./transport";
import { clampPosition, DEFAULT_PALETTE_SHORTCUT, DEFAULT_THOUGHT_SHORTCUT, validateModifiedShortcut, type CompanionPreferences } from "./preferences";
import type { LocalSnapshot } from "./store";
import { createCodeforcesAdapter } from "../../../src/lib/codeforces-api";
import { parseVerifiedCodeforcesPage } from "../../../packages/integrations/codeforces";
import { VerdictScheduler } from "../../../packages/integrations/verdict-scheduler";
import { followupDue } from "../../../packages/core/src/verdict-followup";
import type { SubmissionInput } from "../../../src/lib/codeforces-types";
import { createLoginStartup } from './login-startup';
import { deriveSetupStatus, type BackupRestorePreview } from '../../../packages/setup/status';
import { BACKUP_LIMIT } from './backup-schema';
import { RecoveryFence, writeVerifiedRecovery } from './local-recovery';

app.setName('Forma Companion');
const developmentData = !app.isPackaged || process.argv.includes('--companion-smoke') ? process.env.FORMA_COMPANION_DATA_DIR : undefined;
if(developmentData)app.setPath('userData',resolve(developmentData));
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
let parkedAt: Electron.Rectangle | null = null;
let shortcutPress = 0;
let thoughtShortcutPress = 0;
let lastThoughtShortcutEvent = -Infinity;
let paletteShortcutPress = 0;
let paletteShortcutWasExpanded = false;
let lastPaletteShortcutEvent = -Infinity;
const ribbonWindow = { width: 216, height: 78 };
let window: BrowserWindow;
let tray: Tray;
let database: DatabaseClient;
const desktopHandoff = new DesktopSessionHandoff({
  call: <T>(method: string, ...args: unknown[]) => database.call<T>(method, ...args),
  open: url => shell.openExternal(url),
  changed: () => broadcast(),
  configuredOrigin: () => process.env.FORMA_WEB_ORIGIN ?? "http://localhost:3001",
});
let preferences: CompanionPreferences;
let transport: Awaited<ReturnType<typeof startTransport>> | undefined;
let credential:string|null=null;
let browserCredential:string|null=null;
let browserTransport: Awaited<ReturnType<typeof startBrowserTransport>> | undefined;
let recognition: RecognitionHub;
let hostEpoch = randomUUID();
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
const recoveryFence=new RecoveryFence();
let thoughtTakes: ThoughtTakeStore;
const thoughtVoice = new ThoughtHostVoice({
  async readContext() {
    if (!expanded || !window.isVisible()) throw new Error("Open the thought panel to record.");
    const current = recoveryFence.lease();
    const context = await database.call<ThoughtVoiceContext>("thought-voice-context");
    current();
    return context;
  },
  requireProvider: () => voiceReady("transcription"),
  requestMicrophone: () => requestMicrophoneAccess("thought"),
  transcribe: (bytes, mime, signal) => tutorProvider.transcribe(bytes, mime, signal),
  takes: {
    list: () => thoughtTakes.list(),
    keep: take => thoughtTakes.keep(take),
    read: id => thoughtTakes.read(id),
    remove: id => thoughtTakes.remove(id),
  },
});
const loginStartup=createLoginStartup({platform:process.platform,isPackaged:app.isPackaged,getLoginItemSettings:()=>app.getLoginItemSettings(),setLoginItemSettings:settings=>app.setLoginItemSettings(settings)});
let browserVerifiedAt:string|null=null;
let pendingRestore:{token:string;json:string;expiresAt:number}|null=null;
let restoring=false;
const draftFlushes=new Map<string,(error?:string)=>void>();
function flushTutorDrafts(timeout=2500):Promise<void>{
  if(!window||window.isDestroyed()||window.webContents.isDestroyed())return Promise.resolve();
  return new Promise((resolve,reject)=>{const requestId=randomUUID();const timer=setTimeout(()=>{draftFlushes.delete(requestId);reject(new Error('Draft saving did not finish in time. Return to Tutor, check the saved status, and retry.'));},timeout);draftFlushes.set(requestId,error=>{clearTimeout(timer);draftFlushes.delete(requestId);if(error)reject(new Error(error));else resolve();});emitTutor({kind:'flush-drafts',requestId});});
}
async function setupStatus(){
  let storage:{available:boolean;savedAt?:string;error?:string};
  try{const health=await database.call<{healthy:boolean;savedAt:string}>('health');storage={available:health.healthy,savedAt:health.savedAt};}catch{storage={available:false,error:'Local storage could not be read. Reopen Fenn; the original notebook is preserved.'};}
  const login=loginStartup.read(),provider=tutorProvider.status();let hostInstalled:boolean|null=null;
  if(process.platform==='darwin')try{const path=join(homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts/app.forma.problem_capture.json');hostInstalled=existsSync(path)&&statSync(path).size<32_000; if(hostInstalled){const m=JSON.parse(readFileSync(path,'utf8'));hostInstalled=m.name==='app.forma.problem_capture'&&m.type==='stdio'&&typeof m.path==='string'&&existsSync(m.path);}}catch{hostInstalled=null;}
  return deriveSetupStatus({storage,vscode:{paired:!!credential,connected},practiceFolders:connected?recognition.folderObservation():{observable:false},browser:{supported:process.platform==='darwin',enabled:!!browserCredential,hostInstalled,verifiedAt:browserVerifiedAt},provider:{provider:provider.provider,configured:provider.configured},login:{supported:process.platform==='darwin',packaged:app.isPackaged,enabled:login.enabled,detail:login.detail,...(login.status==='unavailable'&&app.isPackaged?{error:login.detail}:{})}});
}
async function chooseRestore():Promise<BackupRestorePreview|null>{
  const current=recoveryFence.lease();
  const choice=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Forma local backup',extensions:['json']}]});current();
  if(choice.canceled||!choice.filePaths[0])return null;
  if(statSync(choice.filePaths[0]).size>BACKUP_LIMIT)throw new Error('Choose a Forma backup no larger than 64 MiB.');
  const json=readFileSync(choice.filePaths[0],'utf8'),preview=await database.call<Omit<BackupRestorePreview,'token'>>('backup-preview',json);current();
  const token=randomUUID(),expiresAt=Date.now()+600_000;pendingRestore={token,json,expiresAt};return {...preview,token,expiresAt:new Date(expiresAt).toISOString()};
}
async function confirmRestore(payload:unknown){
  if(restoring)throw new Error('A local restore is already in progress.');
  if(!payload||typeof payload!=='object'||Object.keys(payload).some(k=>k!=='token')||(payload as {token:unknown}).token!==pendingRestore?.token||!pendingRestore||pendingRestore.expiresAt<Date.now())throw new Error('This restore preview expired. Choose the backup again.');
  const chosen=pendingRestore;restoring=true;
  try{
  await flushTutorDrafts();
  const release=recoveryFence.begin();
  let backupPath='';
  try{
    transport?.revoke();recognition.reset();await recognition.idle();
    // This snapshot is validated by the writer, fsynced, reread and verified
    // before cancelling requests or replacing any persisted record.
    const json=await database.call<string>('backup-export',{scope:'companion',includeTutor:true});
    const recovery=writeVerifiedRecovery(join(app.getPath('userData'),'recovery-backups'),json);
    backupPath=recovery.path;
    cancelVoice();
    await tutorService.configure(async()=>{await database.call('backup-restore',chosen.json,recovery.receipt);});
    hostEpoch=randomUUID();codeforces={checking:false,checkedAt:null,error:null};browserVerifiedAt=null;
  }finally{release();}
  pendingRestore=null;
  emitTutor({kind:'recovery'});await broadcast();
  return {backupPath,summary:'The selected records were replaced. Timers are paused; Tutor requests and drafts were not sent.'};
  }finally{restoring=false;}
}
function cancelTutorVoice(){microphoneLeaseUntil=0;hostVoice.cancel();}
function cancelVoice(){cancelTutorVoice();thoughtVoice.cancel();}
function microphoneAllowed() {
  return window.isVisible() && (Date.now() < microphoneLeaseUntil || thoughtVoice.microphoneAllowed);
}
async function requestMicrophoneAccess(input: "thought" | "question") {
  if (process.platform === "darwin" && !await systemPreferences.askForMediaAccess("microphone")) {
    throw new Error(`Microphone access was denied. Enable it in macOS Privacy settings, or type your ${input}.`);
  }
}
function emitTutor(event:TutorEvent){if(window&&!window.isDestroyed())window.webContents.send('forma:tutor-event',event);}
async function captureTutorStatement(input:unknown){
  const current=recoveryFence.lease();
  const saved=await database.call<StatementSnapshot|null>('tutor-statement',input);
  current();
  if(saved&&input&&typeof input==='object'&&Object.keys(input).length>1)emitTutor({kind:'context',identity:saved.identity,source:'statement'});
  return saved;
}
async function shareTutorCode(code:SharedCode){
  const current=recoveryFence.lease();
  await database.call('tutor-code',code);
  current();
  const local=await database.call<LocalSnapshot>('snapshot');
  const binding=local.state.bindings.find(b=>b.fileUri===code.fileUri&&b.identity===code.identity&&b.clientId===code.clientId&&b.workspaceId===code.workspaceId);
  if(!binding)throw new Error('Confirm the shared code association first.');
  current();
  const conversation=await database.call<TutorConversation>('tutor-open',{problemId:binding.problemId,workspaceId:code.workspaceId});
  emitTutor({kind:'context',identity:code.identity,conversationId:conversation.id,source:'code'});
  // An explicit share opens Fenn when needed; an existing draft stays on screen.
  if(panelRequest?.panel!=='tutor')await openTutor({conversationId:conversation.id});
  return {revision:local.revision};
}
// Preserve the original wire shape for extensions that support only the first case.
function challengeCaseOnWire<T extends { caseId?: string }>(value: T) {
  const { caseId, ...rest } = value;
  return caseId && caseId !== FIRST_CHALLENGE_CASE_ID ? { ...rest, caseId } : rest;
}

async function handleChallengeRun(request: ChallengeRunRequest) {
  const current = recoveryFence.lease();
  const result = await database.call<{ plan: ChallengeRunPlan } | { receipt: ChallengeRunReceipt; conversationId: string }>('challenge-run', request);
  current();
  if ('plan' in result) return { plan: challengeCaseOnWire(result.plan) };
  if (request.operation !== 'record') throw new Error('The challenge run acknowledgement is invalid.');
  emitTutor({ kind: 'updated', conversationId: result.conversationId, turnId: request.run.turnId, requestId: request.run.requestId });
  return { receipt: challengeCaseOnWire(result.receipt) };
}
function voiceReady(capability:'transcription'|'speech'){
  if(tutorService.isConfiguring)throw new TutorProviderError('busy');
  const status=tutorProvider.status();
  if(!status.configured)throw new TutorProviderError('setup',status.provider);
  if(!status.capabilities[capability])throw new TutorProviderError('model-capability',status.provider);
}
async function openTutor(input:unknown={}){
  const current=recoveryFence.lease();
  cancelVoice();
  let choice=input;
  if(input&&typeof input==='object'&&!Object.keys(input).length){const local=await database.call<LocalSnapshot>('snapshot'),view=await database.call<TutorStoredView>('tutor-view');if(view.lastConversationId){const prior=view.conversations.find(c=>c.id===view.lastConversationId&&(!local.state.problemId||c.problemId===local.state.problemId));if(prior)choice={conversationId:prior.id};}else if(!local.state.problemId&&view.conversations[0])choice={conversationId:view.conversations[0].id};}
  current();
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
    case 'tutor-turns':case 'tutor-context':case 'tutor-exposed':case 'tutor-propose':case 'tutor-draft':case 'tutor-draft-save':return database.call(action,payload);
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
        await requestMicrophoneAccess("question");
        request.assertCurrent();voiceReady('transcription');microphoneLeaseUntil=Date.now()+15000;return {allowed:true};
      }catch(error){request.finish();throw error;}
    }
    case 'tutor-voice-cancel':cancelTutorVoice();return null;
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
  const [local, handoff] = await Promise.all([
    database.call<LocalSnapshot>("snapshot"), desktopHandoff.local(),
  ]);
  const slot=attention.view(local.state,recognition?.presentation()??null,!!preferences.snoozedUntil&&Date.parse(preferences.snoozedUntil)>Date.now(),Date.now());
  const tutorAssistance=local.data.session?.phase==='reflection'?await database.call('tutor-assistance',{problemId:local.data.session.problemId,sessionId:local.data.session.id}):null;
  return {...local,tutorAssistance,today:companionToday(local.data),preferences,presentation:{
    expanded, shortcutPress, thoughtShortcutPress, paletteShortcutPress, paletteShortcutWasExpanded,
    thoughtShortcutAvailable: shortcutAvailable("thoughtShortcut"),
    paletteShortcutAvailable: shortcutAvailable("paletteShortcut"),
    handoffPending: !!handoff,
    panelRequest, activeFileUri:recognition?.activeFileUri()??null, recognition:slot.recognition, verdict:slot.verdict,
  },integration:{connected,paired:!!credential,browserEnabled:!!browserCredential,browserSupported:process.platform==='darwin',status:connected?'VS Code connected':credential?'Waiting for VS Code':'Pair VS Code when you’re ready'},codeforces:platformStatus(local.state)};
};
async function broadcast() {
  if(!window||window.isDestroyed())return;
  const next=await snapshot();
  if(!expanded){
    const bubble=!!(next.presentation.recognition||next.presentation.verdict)&&!(preferences.snoozedUntil&&Date.parse(preferences.snoozedUntil)>Date.now());
    const b=window.getBounds();
    const edge=preferences.ribbon.edge;
    const tuck = !bubble && edge !== "free" && next.data.session?.phase === "focus" && next.data.session.runningSince !== null;
    if (tuck) {
      parkedAt ??= b;
      const area = screen.getDisplayMatching(b).workArea;
      const size = {width:96, height:ribbonWindow.height};
      const at = clampPosition({x:edge === "left" ? area.x : area.x+area.width-size.width, y:b.y+b.height-size.height},size,area);
      if(b.x!==at.x || b.y!==at.y || b.width!==size.width || b.height!==size.height) window.setBounds({...at,...size});
    } else {
      const base = parkedAt ?? b;
      parkedAt = null;
      const size=bubble?{width:340,height:310}:ribbonWindow;
    if(base!==b || b.width!==size.width || b.height!==size.height){const area=screen.getDisplayMatching(base).workArea;const at=clampPosition({x:base.x+base.width-size.width,y:base.y+base.height-size.height},size,area);window.setBounds({...at,...size});}
    }
  }
  window.webContents.send('forma:changed',next);
}
function constrain(){if(!window||window.isDestroyed())return;const b=window.getBounds();const a=screen.getDisplayMatching(b).workArea;window.setPosition(...Object.values(clampPosition(b,b,a)) as [number,number]);}
function expand(value:boolean,focus=false,glance=false){
  if (!value) cancelVoice();
  const b=parkedAt ?? window.getBounds();parkedAt=null;expanded=value;
  const width=value?380:ribbonWindow.width, height=value?(glance?520:700):ribbonWindow.height;
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
async function applyCommand(command:unknown,producer='desktop',expectedRecoveryEpoch?:string) {
  const current=recoveryFence.lease();
  await database.call<LocalSnapshot>('command',command,producer,expectedRecoveryEpoch);
  current();
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
async function setPreferences(change:Partial<CompanionPreferences>){preferences=await database.call('patchPreferences',change);await broadcast();return preferences;}
function triggerThoughtShortcut() {
  const now = performance.now();
  const quietFor = now - lastThoughtShortcutEvent;
  lastThoughtShortcutEvent = now;
  if (quietFor < 750 || quitting || recoveryFence.busy) return;
  thoughtShortcutPress++;
  // Leave focus in the editor. The renderer owns the recorder and its cancellation.
  expand(true);
}

function triggerPaletteShortcut() {
  const now = performance.now();
  const quietFor = now - lastPaletteShortcutEvent;
  lastPaletteShortcutEvent = now;
  if (quietFor < 400 || quitting || recoveryFence.busy) return;
  paletteShortcutWasExpanded = expanded;
  paletteShortcutPress++;
  if (!expanded) {
    expand(true, true);
    return;
  }
  window.setIgnoreMouseEvents(false);
  window.show();
  void broadcast();
}

const shortcutActions = {
  shortcut: { label: "Open companion", run: () => { shortcutPress++; show(); } },
  thoughtShortcut: { label: "Speak a thought", run: triggerThoughtShortcut },
  paletteShortcut: { label: "Command palette", run: triggerPaletteShortcut },
};
type ShortcutAction = keyof typeof shortcutActions;
const shortcutOrder: ShortcutAction[] = ["shortcut", "thoughtShortcut", "paletteShortcut"];
const registeredShortcuts: Partial<Record<ShortcutAction, string>> = {};
let changingShortcut = false;

function registerShortcut(action: ShortcutAction, value: string) {
  if (!globalShortcut.register(value, () => {
    if (registeredShortcuts[action] === value) shortcutActions[action].run();
  })) throw new Error("That shortcut is in use. Choose another key combination.");
}

function shortcutAvailable(action: ShortcutAction) {
  const registered = registeredShortcuts[action];
  return !!registered && registered === preferences[action] && globalShortcut.isRegistered(registered);
}

async function changeShortcut(action: ShortcutAction, value: string | null) {
  if (changingShortcut) throw new Error("Another shortcut is being saved. Try again in a moment.");
  if (value === preferences[action] && (value === null || shortcutAvailable(action))) return preferences;
  const conflict = shortcutOrder.find(other => other !== action && value !== null
    && preferences[other]?.toLowerCase() === value.toLowerCase());
  if (conflict) throw new Error(`Choose a different key combination from ${shortcutActions[conflict].label}.`);
  const previous = registeredShortcuts[action];
  if (value !== null) registerShortcut(action, value);
  changingShortcut = true;
  try {
    preferences = await database.call("patchPreferences", { [action]: value });
    if (value === null) delete registeredShortcuts[action];
    else registeredShortcuts[action] = value;
  } catch (error) {
    if (value !== null) globalShortcut.unregister(value);
    throw error;
  } finally {
    changingShortcut = false;
  }
  if (previous && previous !== value) globalShortcut.unregister(previous);
  await broadcast();
  return preferences;
}


// One paced adapter and one in-flight batch coalesce all attempts for a handle.
let verifiedContext:{handle:string;identities:string[]}|null=null;
let verifiedSubmissions:SubmissionInput[]=[];
let verdictLease=()=>{};
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
  read:async()=>{verdictLease=recoveryFence.lease();return (await database.call<LocalSnapshot>('reconcile')).state;},
  fetch:async(handle,identities)=>{
    verifiedContext={handle,identities};verifiedSubmissions=[];
    await cf.activity(handle,1);return verifiedSubmissions;
  },
  write:async evidence=>{
    verdictLease();
    await database.call('followup-evidence',evidence,randomUUID());
    const current=await database.call<LocalSnapshot>('snapshot');
    if(current.state.handle?.toLowerCase()===evidence.handle.toLowerCase())codeforces={checking:true,checkedAt:evidence.checkedAt,error:evidence.error??null};
  },
});
async function checkCodeforces(manual=false){
  recoveryFence.lease();
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
  if(action==='tutor-drafts-flushed'){
    if(payload&&typeof payload==='object'){const p=payload as {requestId?:unknown;error?:unknown};if(typeof p.requestId==='string')draftFlushes.get(p.requestId)?.(typeof p.error==='string'?p.error.slice(0,500):undefined);}return null;
  }
  recoveryFence.lease();
  if(action.startsWith('tutor-'))return tutorUi(action,payload);
  switch(action){
    case 'handoff-local': return desktopHandoff.local();
    case 'handoff-begin': return desktopHandoff.begin(payload);
    case 'handoff-open': return desktopHandoff.reopen(payload);
    case 'handoff-refresh': return desktopHandoff.refresh(payload);
    case 'handoff-send': return desktopHandoff.send(payload);
    case 'handoff-cancel': return desktopHandoff.cancel(payload);
    case 'desk-challenge-runs': {
      const current = recoveryFence.lease();
      const runs = await database.call<ChallengeRunReceipt[]>(action, payload);
      current();
      return runs;
    }
    case 'desk-challenge-state': {
      const current = recoveryFence.lease();
      const state = await database.call<ChallengeCaseState>(action, payload);
      current();
      return state;
    }
    case 'desk-challenge-select':
    case 'desk-challenge-feedback': {
      const current = recoveryFence.lease();
      const { state, conversationId, turnId, requestId, changed } = await database.call<{
        state: ChallengeCaseState; conversationId: string; turnId: string; requestId: string; changed: boolean;
      }>(action, payload);
      current();
      if (changed) emitTutor({ kind: 'updated', conversationId, turnId, requestId });
      return state;
    }
    case 'desk-hint-review':
    case 'desk-idea-review': {
      const current=recoveryFence.lease(),provider=tutorProvider.status();
      const review=await database.call<Omit<DeskHintReview|DeskIdeaReview,'provider'|'activeRequestId'>>(action,payload,provider);
      current();
      return {...review,provider,activeRequestId:tutorService.activeRequestId} satisfies DeskHintReview;
    }
    case 'thought-voice-status': {
      const context = await database.call<ThoughtVoiceContext>("thought-voice-context");
      const provider = tutorProvider.status();
      const reason = !context.problemKey ? "Attach a problem before recording a thought."
        : context.contestMode ? "Voice transcription is off in contest mode. You can type your thought."
        : !provider.configured ? `Set up ${provider.name} in Tutor settings to transcribe a recording.`
        : !provider.capabilities.transcription ? `${provider.name} transcription is unavailable with the selected model. You can type your thought.`
        : undefined;
      return { providerName: provider.name, available: !reason, ...(reason ? { reason } : {}) };
    }
    case 'thought-microphone':cancelTutorVoice();return thoughtVoice.start(payload);
    case 'thought-transcribe':return thoughtVoice.transcribe(payload);
    case 'thought-voice-cancel':thoughtVoice.cancelRequest(payload);return null;
    case 'thought-takes':return thoughtVoice.listTakes();
    case 'thought-retry':cancelTutorVoice();return thoughtVoice.retryTake(payload);
    case 'thought-discard':thoughtVoice.discardTake(payload);return null;
    case 'setup-status':return setupStatus();
    case 'launch-at-login':return loginStartup.set(payload as boolean);
    case 'backup-export':{
      await flushTutorDrafts();const current=recoveryFence.lease();
      const json=await database.call<string>('backup-export',payload);current();
      const choice=await dialog.showSaveDialog(window,{defaultPath:`forma-local-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'Forma local backup',extensions:['json']}]});current();
      if(choice.canceled||!choice.filePath)return null;writeFileSync(choice.filePath,json,{mode:0o600});return {saved:true,path:choice.filePath};
    }
    case 'restore-choose':return chooseRestore();
    case 'restore-confirm':return confirmRestore(payload);
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
    case 'open-solution': {
      if (typeof payload !== "string" || payload.length > 90) throw new Error("Choose a linked solution.");
      const current = recoveryFence.lease();
      const local = await database.call<LocalSnapshot>("snapshot");
      current();
      const binding = local.state.bindings.find(item => item.id === payload && item.problemId === local.state.problemId);
      if (!binding) throw new Error("This solution is no longer linked to the current problem.");
      const url = new URL(binding.fileUri);
      if (!statSync(fileURLToPath(url), { throwIfNoEntry: false })?.isFile()) throw new Error("The linked solution moved. Reopen it in VS Code and update the association.");
      await shell.openExternal(`vscode://file${url.pathname}`);
      return null;
    }
    case 'open-vscode':await shell.openExternal('vscode://');return null;
    case 'open-forma':await shell.openExternal('http://localhost:3001');return null;
    case 'export-notebook':return saveFile('notebook');
    case 'export-companion':return saveFile('companion');
    case 'import-notebook':{
      return chooseRestore();
    }
    case 'pair':{
      const secret=randomBytes(32).toString('base64url');saveCredential(secret);await broadcast();return {credential:secret,endpoint:transport?.endpoint};
    }
    case 'revoke-pairing':saveCredential(null);await broadcast();return null;
    case 'check-codeforces':await checkCodeforces(true);return snapshot();
    case 'ribbon-options':return setPreferences({ribbon:readRibbonOptions(payload)});
    case 'theme':if(!['light','ink','system'].includes(String(payload)))throw new Error('Choose Light, Ink, or System.');return setPreferences({theme:payload as CompanionPreferences['theme']});
    case 'reduced-motion':if(typeof payload!=='boolean')throw new Error('Invalid motion preference.');return setPreferences({reducedMotion:payload});
    case 'snooze':return setPreferences({snoozedUntil:payload===false?null:new Date(Date.now()+60*60*1000).toISOString()});
    case 'thought-shortcut':return changeShortcut('thoughtShortcut',validateModifiedShortcut(payload,DEFAULT_THOUGHT_SHORTCUT));
    case 'palette-shortcut':return changeShortcut('paletteShortcut',validateModifiedShortcut(payload,DEFAULT_PALETTE_SHORTCUT));
    case 'shortcut':{
      if(typeof payload!=='string'||payload.length>100||!/^[A-Za-z0-9+]+$/.test(payload))throw new Error('Invalid shortcut.');
      return changeShortcut('shortcut',payload);
    }
    default:throw new Error('Unsupported companion action.');
  }
}

async function main(){
  await app.whenReady();
  const userData=app.getPath('userData');mkdirSync(userData,{recursive:true,mode:0o700});
  database=new DatabaseClient(join(userData,'notebook.sqlite'));
  thoughtTakes = new ThoughtTakeStore(join(userData, "thought-takes.sqlite"), {
    available: secureAvailable,
    encrypt: value => safeStorage.encryptString(value),
    decrypt: value => safeStorage.decryptString(Buffer.from(value)),
  });
  preferences=await database.call('preferences');
  tutorConfiguration=new TutorConfiguration(join(userData,'tutor-provider.enc'),{available:secureAvailable,encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)});
  tutorProvider=new ConfiguredTutorProvider(provider=>tutorConfiguration.get(provider));
  tutorService=new TutorService({call:(method,...args)=>database.call(method,...args),emit:emitTutor},tutorProvider);
  await database.call('reconcile');
  recognition=new RecognitionHub({snapshot:()=>database.call<LocalSnapshot>('snapshot'),command:c=>{recoveryFence.lease();return database.call('command',c,'vscode');},select:(file,client)=>{recoveryFence.lease();return database.call('selectBinding',file,client);},changed:()=>{void broadcast();}});
  const browserSecret=join(userData,'browser-pairing.enc');
  if(existsSync(browserSecret)&&secureAvailable())try{browserCredential=safeStorage.decryptString(readFileSync(browserSecret))||null;}catch{browserCredential=null;}

  if(existsSync(credentialPath())&&secureAvailable())try{credential=safeStorage.decryptString(readFileSync(credentialPath()))||null;}catch{credential=null;}
  const a=screen.getPrimaryDisplay().workArea;
  const size=ribbonWindow;const position=clampPosition(preferences.position??{x:a.x+a.width-180,y:a.y+a.height-200},size,a);
  window=new BrowserWindow({...size,...position,frame:false,transparent:true,resizable:false,show:false,hasShadow:false,alwaysOnTop:true,skipTaskbar:true,title:'Forma Companion — unsigned development build',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:true}});
  window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===window.webContents&&permission==='media'&&microphoneAllowed()&&'mediaTypes' in details&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio'));
  window.webContents.session.setPermissionCheckHandler((contents,permission,_origin,details)=>contents===window.webContents&&permission==='media'&&microphoneAllowed()&&details.mediaType==='audio');
  ipcMain.handle('forma:snapshot',event=>{verifySender(event);return snapshot();});
  ipcMain.handle('forma:command',(event,command)=>{verifySender(event);return applyCommand(command);});
  ipcMain.handle('forma:ui',(event,action,payload)=>{verifySender(event);return ui(action,payload);});
  await window.loadFile(join(__dirname,'renderer','index.html'));
  window.showInactive();
  window.on('hide',cancelVoice);
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
  let moveTimer:ReturnType<typeof setTimeout>;
  window.on('moved',()=>{clearTimeout(moveTimer);moveTimer=setTimeout(()=>{if(parkedAt)return;constrain();const b=window.getBounds();void setPreferences({position:{x:b.x+b.width-ribbonWindow.width,y:b.y+b.height-ribbonWindow.height}});},400);});
  screen.on('display-removed',constrain);screen.on('display-metrics-changed',constrain);
  // The menu-bar ribbon remains available when the companion is hidden.
  const icon=nativeImage.createFromPath(join(__dirname,'assets','ribbon-tray.png'));
  if(icon.isEmpty())throw new Error('The menu-bar recovery icon is missing from this build.');
  icon.setTemplateImage(true);tray=new Tray(icon);tray.setToolTip('Forma Companion');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Forma Ribbon',click:show},{label:'Compact ribbon',click:()=>expand(false)},{label:'Hide companion',click:()=>window.hide()},{label:'Snooze for an hour',click:()=>void setPreferences({snoozedUntil:new Date(Date.now()+3600000).toISOString()})},{type:'separator'},{label:'Export notebook…',click:()=>void saveFile('notebook')},{label:'Unsigned development build',enabled:false},{label:'Quit Forma Companion',click:()=>app.quit()}]));
  tray.on('click',show);
  for (const action of shortcutOrder) {
    const shortcut = preferences[action];
    if (shortcut === null) continue;
    try {
      registerShortcut(action, shortcut);
      registeredShortcuts[action] = shortcut;
    } catch { /* Tray recovery stays available and settings reports unavailable shortcuts. */ }
  }
  void broadcast();
  transport=await startTransport({...(developmentData?{endpoint:join(userData,'runtime','companion.sock')}:{}),credential:()=>credential,command:(command,epoch)=>{if(!epoch)throw new Error('Update the Forma VS Code extension before delivering saved captures.');return applyCommand(command,'vscode',epoch);},recoveryEpoch:()=>database.call<string>('recovery-epoch'),tutorCode:shareTutorCode,challengeRun:handleChallengeRun,recognition:request=>{recoveryFence.lease();return recognition.request(request);},action:async action=>{recoveryFence.lease();if(action==='open'||action==='memory'){panelRequest={id:(panelRequest?.id??0)+1,panel:action==='memory'?'memory':'home'};show();}return (await database.call<LocalSnapshot>('snapshot')).revision;},context:async()=>{const local=await database.call<LocalSnapshot>('snapshot');return {identity:local.state.identity,sessionId:local.data.session?.id??null,hostEpoch,recoveryEpoch:await database.call<string>('recovery-epoch')};},connected:value=>{connected=value;void broadcast();}});
  if(process.platform==='darwin')browserTransport=await startBrowserTransport({endpoint:join(userData,'runtime','browser.sock'),credential:()=>browserCredential,message:async m=>{recoveryFence.lease();if((m as {kind?:string})?.kind==='statement'){await captureTutorStatement((m as {statement:unknown}).statement);browserVerifiedAt=new Date().toISOString();return {ok:true,status:'saved'};}return recognition.browser(m);}});
  powerMonitor.on('suspend',()=>{cancelVoice();void database.call('pause','suspend').then(broadcast);});
  powerMonitor.on('lock-screen',()=>{cancelVoice();void database.call('pause','screen-lock').then(broadcast);});
  powerMonitor.on('resume',()=>{lastTick=Date.now();void broadcast();});
  nativeTheme.on('updated',()=>void broadcast());
  const timer=setInterval(async()=>{
    if(recoveryFence.busy||quitting)return;
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
  if(database){event.preventDefault();cancelVoice();void flushTutorDrafts().catch(()=>{}).then(()=>tutorService?.dispose()).catch(()=>{}).then(()=>database.call('pause','quit')).catch(()=>{}).then(()=>database.close()).finally(()=>app.exit());}
});
if(lock)main().catch(error=>{console.error('Forma Companion startup:',error.message);dialog.showErrorBox('Forma Companion could not start',String(error.message));app.quit();});

"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Data, Duration, Problem, Session, Theme, createDemo, elapsed, emptyData, uid } from "@/lib/model";
import { beginVisit, connectProfile, connectedProfile, disconnectProfile, mergeActivity, withCodeforcesDemo } from "@/lib/codeforces";
import { PublicProfile, handleKey, validHandle } from "@/lib/codeforces-types";
import { SyncState, collectActivity, idleSync, previewPublicProfile } from "@/lib/codeforces-client";
import { CodeforcesError } from "@/lib/codeforces-api";
import { Mode, STORAGE_KEYS, browserStorage, loadPersonal } from "@/lib/storage";

interface Workspace {
  data: Data; ready: boolean; mode: Mode; theme: Theme; resolvedTheme: "light" | "dark"; storageError: string | null;
  update: (fn: (data: Data) => Data) => void;
  setTheme: (theme: Theme) => void;
  setMode: (mode: Mode) => void;
  notify: (message: string) => void;
  startSession: (problem: Problem, duration?: Duration) => void;
  replaceData: (data: Data) => void;
  sync: SyncState; previewHandle: (handle:string)=>Promise<PublicProfile|null>; connectHandle:(profile:PublicProfile)=>Promise<void>; syncActivity:(older?:boolean)=>Promise<void>; disconnectHandle:()=>void;
  addOpen: boolean; setAddOpen: (value: boolean) => void;
}
const Context = createContext<Workspace | null>(null);
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace provider is missing.");
  return value;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [bundle,setBundle] = useState<{data:Data;mode:Mode;ready:boolean}>({data:emptyData(),mode:"personal",ready:false});
  const [theme,setThemeState] = useState<Theme>("light");
  const [resolvedTheme,setResolvedTheme] = useState<"light"|"dark">("light");
  const [storageError,setStorageError] = useState<string|null>(null);
  const persistBlocked = useRef(false);
  const memory = useRef<Partial<Record<Mode, Data>>>({});
  const memoryErrors = useRef<Partial<Record<Mode, string>>>({});
  const [toast,setToast] = useState<string|null>(null);
  const [sync,setSync]=useState<SyncState>(idleSync);
  const syncLock=useRef(false);
  const operationVersion=useRef(0);
  const syncAbort=useRef<AbortController|null>(null);
  const [addOpen,setAddOpen] = useState(false);
  const notify = useCallback((message: string) => setToast(message),[]);
  useEffect(() => {
    let mode: Mode = "personal";
    try {
      mode = localStorage.getItem(STORAGE_KEYS.mode) === "demo" ? "demo" : "personal";
      const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (["light","dark","system"].includes(savedTheme ?? "")) setThemeState(savedTheme as Theme);
    } catch { /* The data adapter reports unavailable storage below. */ }
    if (mode === "demo") {
      try { setBundle({data:beginVisit(withCodeforcesDemo(browserStorage.load(mode)??createDemo())),mode,ready:true}); }
      catch { persistBlocked.current=true; memoryErrors.current.demo="Demo storage is unavailable. You can explore in this tab."; setStorageError(memoryErrors.current.demo); setBundle({data:withCodeforcesDemo(createDemo()),mode,ready:true}); }
    } else {
      const loaded = loadPersonal();
      persistBlocked.current=!!loaded.error; setStorageError(loaded.error);
      if (loaded.error) memoryErrors.current.personal=loaded.error;
      setBundle({data:beginVisit(loaded.data),mode,ready:true});
    }
  },[]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
    };
    apply(); media.addEventListener("change",apply);
    return () => media.removeEventListener("change",apply);
  },[theme]);
  useEffect(() => {
    if (!bundle.ready) return;
    memory.current[bundle.mode] = bundle.data;
    if (persistBlocked.current) return;
    try { browserStorage.save(bundle.mode,bundle.data); }
    catch { persistBlocked.current=true; memoryErrors.current[bundle.mode]="Local storage is unavailable or full. Changes stay in this tab. Export a backup in Settings."; setStorageError(memoryErrors.current[bundle.mode]!); }
  },[bundle]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(()=>setToast(null),5000);
    return () => clearTimeout(timer);
  },[toast]);
  const update = useCallback((fn:(data:Data)=>Data) => setBundle(previous=>({...previous,data:fn(previous.data)})),[]);
  function setTheme(value: Theme) {
    setThemeState(value);
    try { localStorage.setItem(STORAGE_KEYS.theme,value); }
    catch { notify("Theme changed for this tab. Your browser could not save the preference."); }
  }
  function setMode(mode: Mode) {
    if (mode===bundle.mode) return;
    operationVersion.current++; syncAbort.current?.abort(); syncLock.current=false; setSync(idleSync);
    memory.current[bundle.mode] = bundle.data;
    let data: Data;
    persistBlocked.current=false; setStorageError(null);
    try {
      data=memory.current[mode] ?? browserStorage.load(mode) ?? (mode==="demo" ? createDemo() : emptyData());
      localStorage.setItem(STORAGE_KEYS.mode,mode);
      persistBlocked.current=!!memoryErrors.current[mode];
      setStorageError(memoryErrors.current[mode]??null);
    } catch {
      data=memory.current[mode] ?? (mode==="demo" ? createDemo() : emptyData()); persistBlocked.current=true;
      memoryErrors.current[mode]="Saved data could not be read. Original storage is preserved; changes stay in this tab. Export a backup in Settings.";
      setStorageError(memoryErrors.current[mode]!);
    }
    if(mode==="demo") data=withCodeforcesDemo(data);
    setBundle({data,mode,ready:true});
    router.push("/");
    notify(mode==="demo" ? "You're exploring sample data. Your personal workspace is separate." : "Welcome back to your own practice.");
  }
  function startSession(problem: Problem, duration = bundle.data.settings.defaultDuration) {
    if (bundle.data.session) {
      if(bundle.data.session.problemId !== problem.id) notify("A session is already open. Finish or discard it before starting another.");
      router.push("/session"); return;
    }
    const now = Date.now();
    const session: Session = {id:uid(),problemId:problem.id,startedAt:new Date(now).toISOString(),runningSince:now,elapsedMs:0,targetMinutes:duration,notes:"",timerVisible:true,phase:"focus"};
    update(data=>({...data,session})); router.push("/session");
  }
  function replaceData(data: Data) {
    operationVersion.current++; syncAbort.current?.abort(); syncLock.current=false; setSync(idleSync);
    persistBlocked.current=false;
    delete memoryErrors.current[bundle.mode];
    setStorageError(null);
    setBundle(previous=>({...previous,data}));
    notify("Your data has been restored.");
  }
  async function previewHandle(raw:string):Promise<PublicProfile|null> {
    if(syncLock.current || bundle.mode==="demo") return null;
    const handle=raw.trim();
    if(!validHandle(handle)) {setSync({...idleSync,error:"Use 3–24 letters, numbers, dots, underscores or hyphens.",code:"invalid_request"});return null;}
    syncLock.current=true;
    const version=operationVersion.current;
    const controller=new AbortController();syncAbort.current=controller;
    setSync({...idleSync,busy:true,phase:"preview"});
    try {
      const profile=await previewPublicProfile(handle,controller.signal);
      if(version!==operationVersion.current) return null;
      setSync(idleSync);return profile;
    } catch(e) {
      if(version===operationVersion.current) setSync({...idleSync,phase:"preview",error:e instanceof Error?e.message:"Profile could not be read.",code:e instanceof CodeforcesError?e.code:"temporary"});
      return null;
    } finally {if(version===operationVersion.current)syncLock.current=false;}
  }
  async function performSync(snapshot:Data,older=false) {
    if(syncLock.current || bundle.mode==="demo") return;
    const profile=connectedProfile(snapshot);
    if(!profile) return;
    syncLock.current=true;
    const version=operationVersion.current;
    const controller=new AbortController();syncAbort.current=controller;
    const mode=bundle.mode;
    setSync({...idleSync,busy:true,phase:older?"older":"refresh"});
    try {
      const newest=Math.max(0,...snapshot.codeforces.submissions.filter(s=>handleKey(s.handle)===handleKey(profile.handle)).map(s=>s.id));
      const pages=await collectActivity(profile.handle,profile.nextFrom,newest,older,controller.signal);
      if(version!==operationVersion.current) return;
      setBundle(previous=>previous.mode===mode && handleKey(previous.data.codeforces.connectedHandle??"")===handleKey(profile.handle)?{...previous,data:mergeActivity(previous.data,profile.handle,pages,older?"older":"refresh")}:previous);
      setSync(idleSync);
      notify(older?"Older activity imported. Reflect on it whenever useful.":"Recent activity imported. Acceptance and understanding stay separate.");
    } catch(e) {
      if(version===operationVersion.current) setSync({...idleSync,error:e instanceof Error?e.message:"Activity could not be imported.",code:e instanceof CodeforcesError?e.code:"temporary"});
    } finally {if(version===operationVersion.current)syncLock.current=false;}
  }
  async function connectHandle(profile:PublicProfile) {
    if(syncLock.current || bundle.mode==="demo") return;
    const connected=connectProfile(bundle.data,profile);
    update(d=>connectProfile(d,profile));
    await performSync(connected);
  }
  async function syncActivity(older=false) {await performSync(bundle.data,older);}
  function disconnectHandle() {
    operationVersion.current++; syncAbort.current?.abort(); syncLock.current=false;
    update(disconnectProfile);setSync(idleSync);
    notify("Public profile disconnected. All imported history and reflections are kept.");
  }
  return <Context.Provider value={{...bundle,theme,resolvedTheme,storageError,update,setTheme,setMode,notify,startSession,replaceData,sync,previewHandle,connectHandle,syncActivity,disconnectHandle,addOpen,setAddOpen}}>
    {children}
    <div className="toast-region" aria-live="polite" aria-atomic="true">{toast && <div className="toast"><span className="toast-check"><Check size={16}/></span><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={16}/></button></div>}</div>
  </Context.Provider>;
}
export function pauseSession(session: Session): Session {
  return {...session,elapsedMs:elapsed(session),runningSince:null};
}

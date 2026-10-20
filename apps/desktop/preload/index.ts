import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld('forma',Object.freeze({
  getSnapshot:()=>ipcRenderer.invoke('forma:snapshot'),
  command:(command:unknown)=>ipcRenderer.invoke('forma:command',command),
  ui:(action:string,payload?:unknown)=>ipcRenderer.invoke('forma:ui',action,payload),
  subscribe:(callback:(snapshot:unknown)=>void)=>{
    const listener=(_event:unknown,snapshot:unknown)=>callback(snapshot);
    ipcRenderer.on('forma:changed',listener);
    return ()=>ipcRenderer.removeListener('forma:changed',listener);
  },
}));

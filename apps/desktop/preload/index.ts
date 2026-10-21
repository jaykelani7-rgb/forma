import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld('forma',Object.freeze({
  getSnapshot:()=>ipcRenderer.invoke('forma:snapshot'),
  command:(command:unknown)=>ipcRenderer.invoke('forma:command',command),
  ui:(action:string,payload?:unknown)=>ipcRenderer.invoke('forma:ui',action,payload),
  subscribeTutor:(callback:(event:unknown)=>void)=>{
    const listener=(_event:unknown,event:unknown)=>callback(event);ipcRenderer.on('forma:tutor-event',listener);return()=>ipcRenderer.removeListener('forma:tutor-event',listener);
  },
  subscribe:(callback:(snapshot:unknown)=>void)=>{
    const listener=(_event:unknown,snapshot:unknown)=>callback(snapshot);
    ipcRenderer.on('forma:changed',listener);
    return ()=>ipcRenderer.removeListener('forma:changed',listener);
  },
}));

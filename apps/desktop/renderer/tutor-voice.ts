/** Small cancellation scope shared by microphone, transcription and playback. No browser globals. */
export const TUTOR_RECORDING_LIMITS={durationMs:60_000,bytes:8*1024*1024} as const;
export function recordedAudioMime(supported:(mime:string)=>boolean):string|null {
  return ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(supported)??null;
}
/** PCM from Gemini is wrapped as WAV by the host. Raw PCM must never reach Audio. */
export function speechAudioMime(value:string):string|null {
  const mime=value.split(';')[0].trim().toLowerCase();
  return ['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/ogg','audio/webm'].includes(mime)?mime:null;
}
export class TutorVoiceController {
  private generation=0;
  private cleanups=new Set<()=>void>();
  begin():number{this.cancel();return this.generation;}
  current(token:number):boolean{return token===this.generation;}
  own(token:number,cleanup:()=>void):()=>void{
    let owned=true;const once=()=>{if(owned){owned=false;this.cleanups.delete(once);cleanup();}};
    if(!this.current(token))once();else this.cleanups.add(once);
    return once;
  }
  cancel():void{
    this.generation++;
    for(const cleanup of [...this.cleanups]){try{cleanup();}catch{/* Continue releasing the other resources. */}}
    this.cleanups.clear();
  }
}

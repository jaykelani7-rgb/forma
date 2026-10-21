/** Small cancellation scope shared by microphone, transcription and playback. No browser globals. */
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

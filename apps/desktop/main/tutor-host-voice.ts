/** A lease begins before asynchronous checks, so cancellation also fences setup. */
export class TutorHostVoice {
  private active:AbortController|null=null;
  cancel():void {this.active?.abort();this.active=null;}
  begin(){
    this.cancel();const controller=new AbortController();this.active=controller;
    return {
      signal:controller.signal,
      assertCurrent:()=>{if(this.active!==controller||controller.signal.aborted)throw new DOMException('The voice request was stopped.','AbortError');},
      finish:()=>{if(this.active===controller)this.active=null;},
    };
  }
}

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
export interface TutorProviderConfig {apiKey:string;model:string;transcriptionModel:string;speechModel:string}
export interface TutorCrypto {available():boolean;encrypt(value:string):Buffer;decrypt(value:Buffer):string}
const defaults={model:'gpt-5.4-mini',transcriptionModel:'gpt-transcribe',speechModel:'gpt-4o-mini-tts'};
const model=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(v);
/** This file is deliberately outside SQLite, exports and renderer-visible config. */
export class TutorConfiguration {
  private saved:Partial<TutorProviderConfig>={};
  constructor(private readonly path:string,private readonly crypto:TutorCrypto,private readonly env:NodeJS.ProcessEnv=process.env){
    if(existsSync(path)&&crypto.available())try{
      if(statSync(path).size>16384)throw new Error('Invalid credential file.');
      const value=JSON.parse(crypto.decrypt(readFileSync(path)));
      if(value&&typeof value==='object'){
        for(const field of ['model','transcriptionModel','speechModel'] as const)if(model(value[field]))this.saved[field]=value[field];
        if(typeof value.apiKey==='string'&&value.apiKey.length<=512)this.saved.apiKey=value.apiKey;
      }
    }catch{/* Setup remains available without exposing credential-store errors. */}
  }
  get():TutorProviderConfig {
    return {apiKey:this.saved.apiKey||this.env.OPENAI_API_KEY?.trim()||'',model:this.saved.model||(model(this.env.FORMA_TUTOR_MODEL)?this.env.FORMA_TUTOR_MODEL:defaults.model),transcriptionModel:this.saved.transcriptionModel||(model(this.env.FORMA_TUTOR_TRANSCRIPTION_MODEL)?this.env.FORMA_TUTOR_TRANSCRIPTION_MODEL:defaults.transcriptionModel),speechModel:this.saved.speechModel||(model(this.env.FORMA_TUTOR_SPEECH_MODEL)?this.env.FORMA_TUTOR_SPEECH_MODEL:defaults.speechModel)};
  }
  update(input:unknown):void {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['apiKey','forgetKey','model','transcriptionModel','speechModel'].includes(k)))throw new Error('Invalid provider setup.');
    const change=input as Record<string,unknown>,next={...this.saved};
    for(const field of ['model','transcriptionModel','speechModel'] as const)if(change[field]!==undefined){if(!model(change[field]))throw new Error('Enter a valid provider model ID.');next[field]=change[field];}
    if(change.forgetKey!==undefined&&typeof change.forgetKey!=='boolean')throw new Error('Invalid provider setup.');
    if(change.forgetKey)delete next.apiKey;
    if(change.apiKey!==undefined){if(typeof change.apiKey!=='string'||!/^\S{20,512}$/.test(change.apiKey))throw new Error('Enter a valid API key in the local setup field.');next.apiKey=change.apiKey;}
    if(!this.crypto.available())throw new Error('OS-protected credential storage is unavailable. Use OPENAI_API_KEY in the desktop environment for this personal build.');
    writeFileSync(this.path,this.crypto.encrypt(JSON.stringify(next)),{mode:0o600});this.saved=next;
  }
}

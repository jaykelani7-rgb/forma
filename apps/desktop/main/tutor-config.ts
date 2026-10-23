import { existsSync, readFileSync, writeFileSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { TutorProviderId } from '../../../packages/tutor/types';
export interface TutorProviderConfig {provider:TutorProviderId;apiKey:string;model:string;transcriptionModel:string;speechModel:string}
export interface TutorCrypto {available():boolean;encrypt(value:string):Buffer;decrypt(value:Buffer):string}
export const TUTOR_MODEL_DEFAULTS={
  gemini:{model:'gemini-3.8-flash',transcriptionModel:'gemini-3.8-flash',speechModel:'gemini-3.8-flash-tts'},
  openai:{model:'gpt-5.4-mini',transcriptionModel:'gpt-transcribe',speechModel:'gpt-4o-mini-tts'},
} as const;
const model=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(v);
const provider=(v:unknown):v is TutorProviderId=>v==='gemini'||v==='openai';
type SavedModels=Partial<Omit<TutorProviderConfig,'provider'>>;
interface SavedConfiguration {version:2;provider:TutorProviderId;providers:Partial<Record<TutorProviderId,SavedModels>>}
const models=(value:unknown):SavedModels=>{
  const result:SavedModels={};
  if(!value||typeof value!=='object'||Array.isArray(value))return result;
  const data=value as Record<string,unknown>;
  for(const field of ['model','transcriptionModel','speechModel'] as const)if(model(data[field]))result[field]=data[field];
  if(typeof data.apiKey==='string'&&data.apiKey.length<=512)result.apiKey=data.apiKey;
  return result;
};
/** Keys and per-provider models live only in the OS-encrypted host file, outside notebook exports. */
export class TutorConfiguration {
  private saved:SavedConfiguration={version:2,provider:'gemini',providers:{}};
  constructor(private readonly path:string,private readonly crypto:TutorCrypto,private readonly env:NodeJS.ProcessEnv=process.env){
    if(provider(env.FORMA_TUTOR_PROVIDER))this.saved.provider=env.FORMA_TUTOR_PROVIDER;
    if(existsSync(path)&&crypto.available())try{
      if(statSync(path).size>32768)throw new Error('Invalid credential file.');
      const value=JSON.parse(crypto.decrypt(readFileSync(path)));
      if(value&&typeof value==='object'&&!Array.isArray(value)){
        if(value.version===2&&provider(value.provider)&&value.providers&&typeof value.providers==='object'){
          this.saved={version:2,provider:value.provider,providers:{gemini:models(value.providers.gemini),openai:models(value.providers.openai)}};
        }else if(['apiKey','model','transcriptionModel','speechModel'].some(field=>field in value)){
          // The original flat file always represented OpenAI. Preserve it as the selected provider.
          // The next explicit Save writes version 2 atomically; reading never mutates credentials.
          this.saved={version:2,provider:'openai',providers:{openai:models(value)}};
        }
      }
    }catch{/* Setup stays available; credential-store content and errors never reach renderer/logs. */}
  }
  get(selected:TutorProviderId=this.saved.provider):TutorProviderConfig {
    const saved=this.saved.providers[selected]??{},prefix=selected==='gemini'?'FORMA_GEMINI_':'FORMA_OPENAI_';
    const legacy=(field:string)=>selected==='openai'?this.env[`FORMA_TUTOR_${field}`]:undefined;
    const chosen=(field:'model'|'transcriptionModel'|'speechModel',suffix:string)=>saved[field]||(model(this.env[`${prefix}${suffix}`])?this.env[`${prefix}${suffix}`]!:(model(legacy(suffix))?legacy(suffix)!:TUTOR_MODEL_DEFAULTS[selected][field]));
    return {provider:selected,apiKey:saved.apiKey||this.env[selected==='gemini'?'GEMINI_API_KEY':'OPENAI_API_KEY']?.trim()||'',model:chosen('model','MODEL'),transcriptionModel:chosen('transcriptionModel','TRANSCRIPTION_MODEL'),speechModel:chosen('speechModel','SPEECH_MODEL')};
  }
  update(input:unknown):void {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['provider','apiKey','forgetKey','model','transcriptionModel','speechModel'].includes(k)))throw new Error('Invalid provider setup.');
    const change=input as Record<string,unknown>;
    if(change.provider!==undefined&&!provider(change.provider))throw new Error('Choose a supported Tutor provider.');
    const selected=provider(change.provider)?change.provider:this.saved.provider;
    const entry={...this.saved.providers[selected]};
    for(const field of ['model','transcriptionModel','speechModel'] as const)if(change[field]!==undefined){if(!model(change[field]))throw new Error('Enter a valid provider model ID.');entry[field]=change[field];}
    if(change.forgetKey!==undefined&&typeof change.forgetKey!=='boolean')throw new Error('Invalid provider setup.');
    if(change.forgetKey)delete entry.apiKey;
    if(change.apiKey!==undefined){if(typeof change.apiKey!=='string'||!/^\S{20,512}$/.test(change.apiKey))throw new Error('Enter a valid API key in the local setup field.');entry.apiKey=change.apiKey;}
    if(!this.crypto.available())throw new Error(`OS-protected credential storage is unavailable. Use ${selected==='gemini'?'GEMINI_API_KEY':'OPENAI_API_KEY'} in the desktop environment for this personal build.`);
    const next:SavedConfiguration={version:2,provider:selected,providers:{...this.saved.providers,[selected]:entry}};
    const temporary=`${this.path}.${randomUUID()}.tmp`;
    try{writeFileSync(temporary,this.crypto.encrypt(JSON.stringify(next)),{mode:0o600,flag:'wx'});renameSync(temporary,this.path);this.saved=next;}
    catch{try{unlinkSync(temporary);}catch{}throw new Error('Tutor setup could not be saved. Check local storage and try again.');}
  }
}

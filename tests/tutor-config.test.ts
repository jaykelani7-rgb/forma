import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync,writeFileSync,readdirSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TutorConfiguration} from '../apps/desktop/main/tutor-config';
test('provider config uses injected OS encryption and never returns a secret through model setup fields',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-tutor-config-')),path=join(folder,'provider.enc');
 const crypto={available:()=>true,encrypt:(s:string)=>Buffer.from(s.split('').reverse().join('')),decrypt:(s:Buffer)=>s.toString().split('').reverse().join('')};
 try{const c=new TutorConfiguration(path,crypto,{NODE_ENV:"test"});assert.equal(c.get().apiKey,'');c.update({apiKey:'fixture-key-is-not-a-real-secret',model:'configured-model'});assert.equal(readFileSync(path,'utf8').includes('fixture-key'),false);assert.equal(new TutorConfiguration(path,crypto,{NODE_ENV:"test"}).get().model,'configured-model');c.update({forgetKey:true});assert.equal(c.get().apiKey,'');assert.throws(()=>c.update({baseURL:'https://untrusted.example'}),/Invalid/);assert.throws(()=>c.update({model:'../../bad'}),/valid provider/);}finally{rmSync(folder,{recursive:true,force:true});}
});

const fixtureCrypto={available:()=>true,encrypt:(value:string)=>Buffer.from(value.split('').reverse().join('')),decrypt:(value:Buffer)=>value.toString().split('').reverse().join('')};
test('new configuration defaults to Gemini with capability models and provider-specific environment fallbacks',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-provider-default-'));
 try{
  const c=new TutorConfiguration(join(folder,'provider.enc'),fixtureCrypto,{NODE_ENV:'test',GEMINI_API_KEY:'fixture-gemini-environment',OPENAI_API_KEY:'fixture-openai-environment',FORMA_TUTOR_MODEL:'legacy-openai-model'});
  assert.equal(c.get().provider,'gemini');assert.equal(c.get().apiKey,'fixture-gemini-environment');assert.equal(c.get().model,'gemini-3.8-flash');assert.equal(c.get().speechModel,'gemini-3.8-flash-tts');
  assert.equal(c.get('openai').model,'legacy-openai-model');assert.equal(c.get('openai').apiKey,'fixture-openai-environment');
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('legacy encrypted OpenAI setup is preserved on read and migrated atomically without replacing its provider',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-provider-legacy-')),path=join(folder,'provider.enc');
 try{
  const legacy={apiKey:'fixture-original-openai-secret',model:'legacy-text',transcriptionModel:'legacy-transcribe',speechModel:'legacy-speech'};
  const original=fixtureCrypto.encrypt(JSON.stringify(legacy));writeFileSync(path,original);
  const c=new TutorConfiguration(path,fixtureCrypto,{NODE_ENV:'test'});assert.equal(c.get().provider,'openai');assert.equal(c.get().apiKey,legacy.apiKey);assert.equal(c.get().model,'legacy-text');assert.deepEqual(readFileSync(path),original);
  c.update({provider:'gemini',apiKey:'fixture-gemini-provider-secret',model:'gemini-3.8-flash'});
  assert.equal(c.get('openai').apiKey,legacy.apiKey);assert.equal(c.get('openai').speechModel,'legacy-speech');
  const migrated=JSON.parse(fixtureCrypto.decrypt(readFileSync(path)));assert.equal(migrated.version,2);assert.equal(migrated.provider,'gemini');
  const restarted=new TutorConfiguration(path,fixtureCrypto,{NODE_ENV:'test'});assert.equal(restarted.get().provider,'gemini');assert.equal(restarted.get('openai').model,'legacy-text');
  assert.equal(readFileSync(path).includes(Buffer.from(legacy.apiKey)),false);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('provider switching retains independent keys/models and forgetting one never removes another',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-provider-switch-')),path=join(folder,'provider.enc');
 try{
  const c=new TutorConfiguration(path,fixtureCrypto,{NODE_ENV:'test'});
  c.update({provider:'gemini',apiKey:'fixture-gemini-provider-secret',model:'gemini-custom-text',transcriptionModel:'gemini-custom-transcribe',speechModel:'gemini-custom-speech'});
  c.update({provider:'openai',apiKey:'fixture-openai-provider-secret',model:'openai-custom-text'});
  assert.equal(c.get().provider,'openai');assert.equal(c.get('gemini').model,'gemini-custom-text');
  c.update({provider:'gemini'});assert.equal(c.get().apiKey,'fixture-gemini-provider-secret');assert.equal(c.get().speechModel,'gemini-custom-speech');
  c.update({forgetKey:true});assert.equal(c.get().apiKey,'');assert.equal(c.get('openai').apiKey,'fixture-openai-provider-secret');
  const restarted=new TutorConfiguration(path,fixtureCrypto,{NODE_ENV:'test'});assert.equal(restarted.get().provider,'gemini');assert.equal(restarted.get('openai').model,'openai-custom-text');
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('invalid or failed credential updates preserve the prior selection and encrypted file and clean temporary writes',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-provider-atomic-')),path=join(folder,'provider.enc');let fail=false;
 try{
  const c=new TutorConfiguration(path,{...fixtureCrypto,encrypt:value=>{if(fail)throw new Error('private credential detail');return fixtureCrypto.encrypt(value);}},{NODE_ENV:'test'});
  c.update({provider:'openai',apiKey:'fixture-original-openai-secret'});const original=readFileSync(path);
  for(const change of [{provider:'other'},{provider:'gemini',apiKey:'short'},{provider:'gemini',model:'../../model'}])assert.throws(()=>c.update(change));
  fail=true;assert.throws(()=>c.update({provider:'gemini',apiKey:'fixture-gemini-provider-secret'}),error=>error instanceof Error&&!error.message.includes('private credential'));
  assert.equal(c.get().provider,'openai');assert.deepEqual(readFileSync(path),original);assert.deepEqual(readdirSync(folder),['provider.enc']);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('development credentials are read only in the privileged config and unavailable encryption is honest',()=>{
 const c=new TutorConfiguration('/tmp/nonexistent-forma-tutor-config-fixture',{available:()=>false,encrypt:()=>{throw new Error('unused');},decrypt:()=>{throw new Error('unused');}},{NODE_ENV:'test',FORMA_TUTOR_PROVIDER:'openai',OPENAI_API_KEY:'fixture-environment-key',FORMA_TUTOR_MODEL:'chosen-model'});
 assert.equal(c.get().apiKey,'fixture-environment-key');assert.equal(c.get().model,'chosen-model');assert.throws(()=>c.update({model:'different-model'}),/OS-protected/);
});

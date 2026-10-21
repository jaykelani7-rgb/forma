import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TutorConfiguration} from '../apps/desktop/main/tutor-config';
test('provider config uses injected OS encryption and never returns a secret through model setup fields',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-tutor-config-')),path=join(folder,'provider.enc');
 const crypto={available:()=>true,encrypt:(s:string)=>Buffer.from(s.split('').reverse().join('')),decrypt:(s:Buffer)=>s.toString().split('').reverse().join('')};
 try{const c=new TutorConfiguration(path,crypto,{NODE_ENV:"test"});assert.equal(c.get().apiKey,'');c.update({apiKey:'fixture-key-is-not-a-real-secret',model:'configured-model'});assert.equal(readFileSync(path,'utf8').includes('fixture-key'),false);assert.equal(new TutorConfiguration(path,crypto,{NODE_ENV:"test"}).get().model,'configured-model');c.update({forgetKey:true});assert.equal(c.get().apiKey,'');assert.throws(()=>c.update({baseURL:'https://untrusted.example'}),/Invalid/);assert.throws(()=>c.update({model:'../../bad'}),/valid provider/);}finally{rmSync(folder,{recursive:true,force:true});}
});
test('development credentials are read only in the privileged config and unavailable encryption is honest',()=>{
 const c=new TutorConfiguration('/tmp/nonexistent-forma-tutor-config-fixture',{available:()=>false,encrypt:()=>{throw new Error('unused');},decrypt:()=>{throw new Error('unused');}},{NODE_ENV:'test',OPENAI_API_KEY:'fixture-environment-key',FORMA_TUTOR_MODEL:'chosen-model'});
 assert.equal(c.get().apiKey,'fixture-environment-key');assert.equal(c.get().model,'chosen-model');assert.throws(()=>c.update({model:'different-model'}),/OS-protected/);
});

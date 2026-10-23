import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionStore } from '../apps/desktop/main/store';
import { validateLocalBackup, type LocalBackup, type TutorBackup } from '../apps/desktop/main/backup-schema';
import { tutorHash } from '../packages/tutor/context';

const now=Date.now();
function fixture(){
  const store=new CompanionStore(':memory:');
  const make=(letter:string)=>{
    const identity=`contest:4:${letter}`,url=`https://codeforces.com/contest/4/problem/${letter}`;
    store.command({id:`attach-${letter}`,type:'attach',payload:{url,fileUri:`file:///practice/${letter}.cpp`,workspaceId:`workspace-${letter}`,clientId:'vscode'}},'desktop',now);
    const conversation=store.tutor.open({workspaceId:`workspace-${letter}`},now);
    const statement=store.tutor.statement({identity,url,title:letter,description:'A captured statement',input:'',output:'',constraints:'',samples:[],explanation:'',complete:false,source:'manual'},now)!;
    const text=`int problem_${letter};`;
    const code=store.tutor.code({id:`code-${letter}`,identity,workspaceId:`workspace-${letter}`,clientId:'vscode',fileUri:`file:///practice/${letter}.cpp`,filename:`${letter}.cpp`,language:'cpp',startLine:1,endLine:1,text,revision:`sha256:${tutorHash(text)}`,capturedAt:new Date(now).toISOString()});
    const draft=store.tutor.draft(conversation.id,now);
    return {conversation,statement,code,draft};
  };
  const a=make('A'),b=make('B');
  store.command({id:'thought-B',type:'thought',payload:{text:'B-only note'}},'desktop',now);
  const original=JSON.parse(store.backups.export({scope:'companion',includeTutor:true},now)) as LocalBackup;
  return {store,a,b,original};
}
function tutor(backup:LocalBackup):TutorBackup{return backup.tutor!;}
const json=(value:unknown)=>JSON.stringify(value);

test('strict backup schema round trips existing data while discarding imported file bindings',()=>{
  const f=fixture();try{
    const result=validateLocalBackup(json(f.original),f.store.snapshot().data);
    assert.equal(result.backup.tutor!.drafts.length,2);
    assert.equal(result.backup.companion!.bindings.length,0);
    assert.equal(result.backup.tutor!.codes[0].fileUri,'file:///practice/A.cpp');
  }finally{f.store.close();}
});

test('present draft code and statement references must belong to the same problem/workspace',()=>{
  const f=fixture();try{
    for(const kind of ['statement','code','workspace'] as const){
      const backup=structuredClone(f.original),draft=tutor(backup).drafts.find(d=>d.conversationId===f.a.conversation.id)!;
      if(kind==='statement')draft.statementId=f.b.statement.id;
      else if(kind==='code')draft.codeId=f.b.code.id;
      else {const source=tutor(backup).codes.find(code=>code.id===draft.codeId)!;source.workspaceId='another-workspace';}
      assert.throws(()=>validateLocalBackup(json(backup),f.store.snapshot().data),/selected draft source belongs to a different/);
    }
  }finally{f.store.close();}
});

test('expired draft references remain recoverable, while a present note from another problem is rejected',()=>{
  const f=fixture();try{
    const backup=structuredClone(f.original),draft=tutor(backup).drafts.find(d=>d.conversationId===f.a.conversation.id)!;
    draft.statementId='expired-statement';draft.codeId='expired-code';draft.noteIds=['expired-note'];draft.text='Keep my unsent question';
    assert.equal(validateLocalBackup(json(backup),f.store.snapshot().data).backup.tutor!.drafts.find(d=>d.conversationId===draft.conversationId)!.text,draft.text);
    draft.noteIds=[backup.companion!.thoughts[0].id];
    assert.throws(()=>validateLocalBackup(json(backup),f.store.snapshot().data),/selected draft note belongs to a different/);
  }finally{f.store.close();}
});

test('archived provider requests retain the parent turn immutable question and context',()=>{
  const f=fixture();try{
    const input={turnId:'turn-A',requestId:'request-old',conversationId:f.a.conversation.id,action:'discuss',text:'Question A',statementId:f.a.statement.id,codeId:null,noteIds:[]};
    const first=f.store.tutor.prepare(input,'model-one','gemini',now);
    f.store.tutor.finalize({turnId:first.id,requestId:first.requestId,status:'interrupted'},now);
    f.store.tutor.prepare({...input,requestId:'request-new'},'model-two','openai',now);
    const original=JSON.parse(f.store.backups.export({scope:'companion',includeTutor:true},now)) as LocalBackup;
    assert.equal(validateLocalBackup(json(original),f.store.snapshot().data).backup.tutor!.requests.length,1);
    for(const change of ['question','context'] as const){
      const backup=structuredClone(original),request=tutor(backup).requests[0];
      if(change==='question')request.userText='Tampered old question';else request.context.title='Tampered frozen title';
      assert.throws(()=>validateLocalBackup(json(backup),f.store.snapshot().data),/does not match its parent turn/);
    }
  }finally{f.store.close();}
});

test('unknown credential and executable fields are rejected at companion record boundaries',()=>{
  const f=fixture();try{
    const mutations=[
      (b:LocalBackup)=>Object.assign(b.companion!,{apiKey:'must-never-import'}),
      (b:LocalBackup)=>Object.assign(b.companion!.thoughts[0],{launchPath:'/untrusted/executable'}),
      (b:LocalBackup)=>Object.assign(b.notebook!,{pairingCredential:'must-never-import'}),
      (b:LocalBackup)=>{b.companion!.submissions.push({id:1,handle:'fixture',identity:'contest:4:A',verdict:null,submittedAt:new Date(now).toISOString(),observedAt:new Date(now).toISOString()});Object.assign(b.companion!.submissions[0],{credential:'secret'});},
    ];
    for(const mutate of mutations){const backup=structuredClone(f.original);mutate(backup);assert.throws(()=>validateLocalBackup(json(backup),f.store.snapshot().data),/Unsupported tutor fields/);}
  }finally{f.store.close();}
});

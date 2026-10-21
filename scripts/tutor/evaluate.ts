/** Explicit opt-in only: this script makes charged real provider calls, never runs in CI. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OpenAITutorProvider, tutorProviderError } from '../../apps/desktop/main/tutor-provider';
import { hintLevelForAction } from '../../packages/tutor/policy';
import type { TutorAction, TutorTurn } from '../../packages/tutor/types';

interface Case {id:string;title:string;action:TutorAction;statement:string|null;code?:string;request:string;rubric:string;expected?:string[];forbidden?:string[]}
async function main(){
const fixture=JSON.parse(await readFile(resolve('scripts/tutor/quality-cases.json'),'utf8')) as {version:number;cases:Case[]};
if(fixture.version!==1||fixture.cases.length!==5)throw new Error('Invalid Tutor evaluation fixture.');
for(const item of fixture.cases){if(!item.id||!item.rubric||!item.request)throw new Error('Incomplete evaluation case.');for(const expression of [...item.expected??[],...item.forbidden??[]])new RegExp(expression,'i');}
if(process.argv.includes('--fixtures')||process.env.FORMA_TUTOR_LIVE_EVAL!=='1'){
  process.stdout.write(`Validated ${fixture.cases.length} quality fixtures. Live model quality was not evaluated; no model calls were made. Explicit FORMA_TUTOR_LIVE_EVAL=1 and OPENAI_API_KEY are required for a charged live run.\n`);
}else if(!process.env.OPENAI_API_KEY){
  process.stderr.write('Live quality evaluation was not run. It requires FORMA_TUTOR_LIVE_EVAL=1 and OPENAI_API_KEY; requests are charged by OpenAI. Use --fixtures to validate fixtures without network access.\n');
  process.exitCode=2;
}else{
  const model=process.env.FORMA_TUTOR_MODEL??'gpt-5.4-mini';
  const provider=new OpenAITutorProvider(()=>({apiKey:process.env.OPENAI_API_KEY,model,transcriptionModel:process.env.FORMA_TUTOR_TRANSCRIPTION_MODEL??'gpt-transcribe',speechModel:process.env.FORMA_TUTOR_SPEECH_MODEL??'gpt-4o-mini-tts'}));
  const results=[];
  for(const item of fixture.cases){
    const now=new Date().toISOString();const conversationId=`evaluation:${item.id}`;const identity='contest:4:A';
    const turn:TutorTurn={id:`turn:${item.id}`,requestId:`request:${item.id}`,conversationId,action:item.action,userText:item.request,assistantText:'',context:{version:1,identity,problemId:'private-evaluation-fixture',title:item.title,url:'https://codeforces.com/problemset/problem/4/A',workspaceId:'evaluation',conversationId,sessionId:null,statement:item.statement?{id:`statement:${item.id}`,identity,url:'https://codeforces.com/problemset/problem/4/A',title:item.title,description:item.statement,input:'See the self-contained fixture description.',output:'See the self-contained fixture description.',constraints:'Included in description.',samples:[],explanation:'',complete:true,source:'manual',revision:'fixture-v1',capturedAt:now}:null,code:item.code?{id:`code:${item.id}`,identity,workspaceId:'evaluation',clientId:'evaluation',fileUri:'fixture.cpp',filename:'fixture.cpp',language:'cpp',startLine:1,endLine:1,text:item.code,revision:'fixture-v1',capturedAt:now}:null,notes:[],evidence:{platform:'unknown',checkedAt:null,localTests:'unknown',submissions:[]},frozenAt:now},status:'queued',createdAt:now,completedAt:null,error:null,hintLevel:hintLevelForAction(item.action,[]),exposed:false,usage:null,model};
    try{
      const response=await provider.stream({turn,history:[]},new AbortController().signal,text=>{turn.assistantText+=text;});
      const findings=[...(item.expected??[]).filter(pattern=>!new RegExp(pattern,'i').test(turn.assistantText)).map(pattern=>`Missing heuristic: ${pattern}`),...(item.forbidden??[]).filter(pattern=>new RegExp(pattern,'i').test(turn.assistantText)).map(pattern=>`Forbidden heuristic matched: ${pattern}`)];
      results.push({id:item.id,rubric:item.rubric,model:response.model,usage:response.usage,response:turn.assistantText,findings,assessment:findings.length?'flagged-for-human-review':'heuristics-passed-human-review-required'});
      process.stdout.write(`${item.id}: ${findings.length?'flagged':'human review required'}\n`);
    }catch(error){results.push({id:item.id,rubric:item.rubric,response:turn.assistantText,error:tutorProviderError(error),assessment:'provider-failure'});process.stdout.write(`${item.id}: provider failure\n`);}
  }
  const directory=resolve('dist/tutor-evaluation');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'live-results.json'),JSON.stringify({kind:'live-model-evaluation',at:new Date().toISOString(),model,notice:'Heuristics are not proof of correctness or quality. Review every response against its rubric; record observed failures.',results},null,2));
  process.stdout.write('Saved actual model responses and rubrics to dist/tutor-evaluation/live-results.json. No credentials were saved.\n');
}
}
main().catch(()=>{process.stderr.write('Tutor evaluation could not complete. Check the fixture and local output permissions.\n');process.exitCode=1;});

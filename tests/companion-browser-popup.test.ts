import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

const script = buildSync({ entryPoints: ['apps/chrome-extension/popup.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0].text;
class Element {
  hidden = false; disabled = false; textContent = ''; value = '';
  children: Element[] = []; listeners = new Map<string, () => void>();
  addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
  replaceChildren(...children: Element[]) { this.children = children; }
  click() { if (!this.disabled && !this.hidden) this.listeners.get('click')?.(); }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
type PopupMessage = {kind: string; proposalId?: string; statement?: Record<string,unknown>};
const problemUrl = 'https://codeforces.com/contest/1968/problem/B';
function popup(reply: (message: PopupMessage) => unknown | Promise<unknown>, options: {statement?: Record<string,unknown>; afterUrl?:string} = {}) {
  const elements = Object.fromEntries(['status', 'capture', 'confirm', 'cancel', 'targets', 'include-statement'].map(id => [id, new Element()]));
  elements.confirm.hidden = elements.cancel.hidden = elements.targets.hidden = true;
  const messages: PopupMessage[] = [], timers: (() => void)[] = []; let queries = 0;
  runInNewContext(script, { document: { querySelector: (selector: string) => elements[selector.slice(1)], createElement: () => new Element() },
    chrome: { tabs: { query: async () => [{ id: 1, url: ++queries > 1 ? options.afterUrl ?? problemUrl : problemUrl }] }, scripting: { executeScript: async () => [{ result: options.statement ?? {url: problemUrl,title: 'B. Prefiquence'} }] }, runtime: { sendNativeMessage: async (_host: string, message: PopupMessage) => { messages.push(message); return reply(message); } } },
    URL, Error, TextEncoder, setTimeout: (callback: () => void) => { timers.push(callback); } });
  return { elements, messages, timers };
}
const proposal = { ok: true, proposalId: 'proposal-1', status: 'choose-file', targets: [{id: 'target-1',label: '1968B.cpp'}] };
for (const terminal of ['saved', 'expired', 'rejected', 'cancelled']) test(`Chrome popup can capture again after ${terminal}`, async () => {
  const { elements: e, messages } = popup(m => m.kind === 'propose' ? proposal : {ok: true,status: terminal});
  e.capture.click(); await settle(); assert.equal(e.confirm.hidden, false); assert.match(e.confirm.textContent, /1968B.cpp/); assert.equal(e['include-statement'].disabled, true);
  e.confirm.click(); await settle(); assert.equal(e.capture.hidden, false); assert.equal(e.capture.disabled, false); assert.equal(e.confirm.hidden, true);
  assert.equal(e['include-statement'].disabled, false);
  e.capture.click(); await settle(); assert.equal(messages.filter(m => m.kind === 'propose').length, 2);
});
test('cancelling while confirmation is in flight prevents a late saved reply from changing cancelled UI', async () => {
  let finish!: (value: unknown) => void;
  const { elements: e } = popup(m => m.kind === 'propose' ? proposal : m.kind === 'confirm' ? new Promise(resolve => {finish = resolve;}) : {ok: true,status: 'cancelled'});
  e.capture.click(); await settle(); e.confirm.click(); await settle(); e.cancel.click(); await settle();
  finish({ok: true,status: 'saved'}); await settle(); assert.equal(e.status.textContent, 'Capture cancelled.'); assert.equal(e.capture.hidden, false);
});
test('a native-host error leaves an immediate retry path', async () => {
  const { elements: e } = popup(() => {throw new Error('Companion unavailable');});
  e.capture.click(); await settle(); assert.match(e.status.textContent, /Companion unavailable/); assert.equal(e.capture.hidden, false); assert.equal(e.capture.disabled, false);
});
test('cancelling a pending status poll never sends a request with a missing proposal ID', async () => {
  const { elements: e, timers, messages } = popup(m => m.kind === 'propose' ? proposal : {ok: true,status: m.kind === 'cancel' ? 'cancelled' : 'waiting'});
  e.capture.click(); await settle(); e.confirm.click(); await settle(); assert.equal(timers.length, 1);
  e.cancel.click(); await settle(); timers.shift()!(); await settle();
  assert.equal(messages.filter(m => m.kind === 'status').length, 0); assert.equal(e.status.textContent, 'Capture cancelled.');
});
const capturedStatement = {url:problemUrl,title:'B. Prefiquence',description:'Controlled fixture statement.',input:'Two strings.',output:'One integer.',constraints:'',samples:[{input:'a a',output:'1'}],explanation:'',complete:true,source:'browser'};
test('statement button stages only explicit local statement context and leaves file association available', async () => {
  const {elements:e,messages} = popup(() => ({ok:true,status:'saved'}), {statement:capturedStatement});
  e['include-statement'].click(); assert.equal(e.capture.disabled, true); await settle();
  assert.equal(messages.length, 1); assert.equal(messages[0].kind, 'statement'); assert.equal(messages[0].statement?.identity, 'contest:1968:B');
  assert.equal(messages[0].statement?.url, 'https://codeforces.com/problemset/problem/1968/B'); assert.equal(messages[0].statement?.description, capturedStatement.description);
  assert.match(e.status.textContent, /saved locally.*before sending/); assert.equal(e.capture.disabled, false); assert.equal(e['include-statement'].disabled, false);
});
test('partial statement captures stay explicitly partial in the popup and payload', async () => {
  const {elements:e,messages} = popup(() => ({ok:true,status:'saved'}), {statement:{...capturedStatement,input:'',complete:false}});
  e['include-statement'].click(); await settle();
  assert.equal(messages[0].statement?.complete, false); assert.match(e.status.textContent, /Partial statement saved locally/);
});
test('statement capture rejects a changed active problem before contacting the native host', async () => {
  const {elements:e,messages} = popup(() => ({ok:true}), {statement:capturedStatement,afterUrl:'https://codeforces.com/contest/4/problem/A'});
  e['include-statement'].click(); await settle();
  assert.equal(messages.length, 0); assert.match(e.status.textContent, /active problem changed/); assert.equal(e.capture.disabled, false);
});
test('oversized statement capture reports its limit without native delivery', async () => {
  const {elements:e,messages} = popup(() => ({ok:true}), {statement:{...capturedStatement,description:'色'.repeat(22000)}});
  e['include-statement'].click(); await settle();
  assert.equal(messages.length, 0); assert.match(e.status.textContent, /exceeds the local capture limit/); assert.equal(e['include-statement'].disabled, false);
});

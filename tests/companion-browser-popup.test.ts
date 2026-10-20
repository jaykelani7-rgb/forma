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
function popup(reply: (message: {kind: string; proposalId?: string}) => unknown | Promise<unknown>) {
  const elements = Object.fromEntries(['status', 'capture', 'confirm', 'cancel', 'targets'].map(id => [id, new Element()]));
  elements.confirm.hidden = elements.cancel.hidden = elements.targets.hidden = true;
  const messages: {kind: string; proposalId?: string}[] = [], timers: (() => void)[] = [];
  runInNewContext(script, { document: { querySelector: (selector: string) => elements[selector.slice(1)], createElement: () => new Element() },
    chrome: { tabs: { query: async () => [{ id: 1, url: 'https://codeforces.com/contest/1968/problem/B' }] }, scripting: { executeScript: async () => [{ result: {url: 'https://codeforces.com/contest/1968/problem/B',title: 'B. Prefiquence'} }] }, runtime: { sendNativeMessage: async (_host: string, message: {kind: string; proposalId?: string}) => { messages.push(message); return reply(message); } } },
    URL, Error, setTimeout: (callback: () => void) => { timers.push(callback); } });
  return { elements, messages, timers };
}
const proposal = { ok: true, proposalId: 'proposal-1', status: 'choose-file', targets: [{id: 'target-1',label: '1968B.cpp'}] };
for (const terminal of ['saved', 'expired', 'rejected', 'cancelled']) test(`Chrome popup can capture again after ${terminal}`, async () => {
  const { elements: e, messages } = popup(m => m.kind === 'propose' ? proposal : {ok: true,status: terminal});
  e.capture.click(); await settle(); assert.equal(e.confirm.hidden, false); assert.match(e.confirm.textContent, /1968B.cpp/);
  e.confirm.click(); await settle(); assert.equal(e.capture.hidden, false); assert.equal(e.capture.disabled, false); assert.equal(e.confirm.hidden, true);
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

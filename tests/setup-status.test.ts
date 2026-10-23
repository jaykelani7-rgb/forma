import test from "node:test";
import assert from "node:assert/strict";
import { deriveSetupStatus, type SetupObservations } from "../packages/setup/status";

const observations = (): SetupObservations => ({
  storage: { available: true }, vscode: { paired: true, connected: false },
  practiceFolders: { observable: false },
  browser: { supported: true, enabled: true, hostInstalled: true },
  provider: { provider: "gemini", configured: true },
  login: { supported: true, packaged: true, enabled: false },
});

test("setup keeps pairing, connection, folder visibility and optional provider evidence separate", () => {
  const state = deriveSetupStatus(observations());
  assert.equal(state.summary, "Local notebook ready");
  assert.equal(state.pairing.label, "Paired");
  assert.equal(state.connection.state, "disconnected");
  assert.equal(state.practiceFolders.label, "Not observable");
  assert.match(state.practiceFolders.detail, /does not mean no practice folders/);
  assert.equal(state.provider.state, "not verified");
  assert.match(state.provider.label, /key configured/);
  assert.match(state.provider.detail, /No request is made/);
  assert.equal(state.browser.state, "not verified");
  assert.match(state.browser.detail, /Installation alone does not prove capture works/);
});

test("setup reports only observed folder approval and past authenticated browser capture", () => {
  const observed = observations();
  observed.vscode.connected = true;
  observed.practiceFolders = { observable: true, approvedCount: 0 };
  assert.equal(deriveSetupStatus(observed).practiceFolders.state, "not configured");
  observed.practiceFolders.approvedCount = 2;
  observed.browser.verifiedAt = "2026-10-23T08:00:00.000Z";
  const state = deriveSetupStatus(observed);
  assert.equal(state.summary, "Ready for linked practice");
  assert.match(state.practiceFolders.detail, /2 approved practice folders/);
  assert.equal(state.browser.label, "Capture received");
  assert.match(state.browser.detail, /past success/);
  assert.match(state.browser.detail, /does not verify Chrome/);
  observed.practiceFolders = { observable: false, approvedCount: 2 };
  assert.equal(deriveSetupStatus(observed).practiceFolders.state, "unavailable");
});

test("setup distinguishes disabled integration, missing host and unsupported platform", () => {
  const observed = observations();
  observed.browser.enabled = false;
  assert.equal(deriveSetupStatus(observed).browser.state, "off");
  observed.browser.enabled = true;
  observed.browser.hostInstalled = false;
  assert.equal(deriveSetupStatus(observed).browser.state, "not configured");
  observed.browser.hostInstalled = null;
  assert.equal(deriveSetupStatus(observed).browser.state, "not verified");
  observed.browser.supported = false;
  assert.equal(deriveSetupStatus(observed).browser.state, "unavailable");
  observed.provider = { provider: "openai", configured: false };
  assert.equal(deriveSetupStatus(observed).provider.label, "OpenAI · not configured");
});
test("an eligible workspace proves an approved solution without inventing a folder count",()=>{
  const observed=observations();observed.practiceFolders={observable:true,eligibleWorkspaceCount:2};
  const state=deriveSetupStatus(observed).practiceFolders;assert.equal(state.state,'ready');assert.match(state.detail,/do not reveal their complete count/);assert.equal(state.label,'Approved solution observed');
});

test("setup uses actual login state and disables changes for unpackaged, unsupported or unreadable OS state", () => {
  const observed = observations();
  let state = deriveSetupStatus(observed);
  assert.equal(state.login.enabled, false);
  assert.equal(state.login.state, "off");
  assert.equal(state.login.canChange, true);
  observed.login.enabled = true;
  assert.equal(deriveSetupStatus(observed).login.state, "ready");
  observed.login.detail = "macOS requires approval in System Settings → General → Login Items.";
  assert.equal(deriveSetupStatus(observed).login.state,"not verified");
  assert.equal(deriveSetupStatus(observed).login.canChange,true);
  assert.match(deriveSetupStatus(observed).login.detail,/requires approval/);
  observed.login.detail = undefined;
  observed.login.packaged = false;
  state = deriveSetupStatus(observed);
  assert.equal(state.login.canChange, false);
  assert.equal(state.login.enabled, true);
  assert.match(state.login.detail, /Development builds do not change/);
  observed.login.packaged = true;
  observed.login.error = "The operating system could not read this setting.";
  assert.equal(deriveSetupStatus(observed).login.canChange, false);
  observed.login.error = undefined;
  observed.login.supported = false;
  assert.equal(deriveSetupStatus(observed).login.canChange, false);
});

test("setup storage failure stays actionable without inferring a lost notebook", () => {
  const observed = observations();
  observed.storage.available = false;
  const state = deriveSetupStatus(observed);
  assert.equal(state.summary, "The local notebook needs attention");
  assert.equal(state.storage.state, "unavailable");
  assert.match(state.storage.detail, /Existing files are kept/);
  assert.equal(state.pairing.state, "ready");
});

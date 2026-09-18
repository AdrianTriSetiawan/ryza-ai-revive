/* Headless regression for the turn layer (turn.js) and the reply epoch in
   api.js. Run:  node scripts/voice_regression.js

Why this exists
---------------
Interruption is the one behaviour that cannot be checked by looking at a
screenshot: it is about what *stops*. Three things must all be true when the
character is cut off — the utterance stops mid-clip, the queued lines are
dropped, and the reply still on the wire never lands. Before turn.js none of
that was expressible, and api.js had no epoch at all, so two replies could
resolve out of order (AUDIT 11.4-3).

The transport is stubbed with a hand-driven XMLHttpRequest, so every ordering
below is deterministic — no timers, no network, no race.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web', 'js');
let failures = 0;
function ok(cond, name) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

/* --------------------------------------------------------------- sandbox */
const store = {};
const sandbox = {
  console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise: Promise, JSON: JSON, Math: Math, Date: Date, String: String,
  Number: Number, Object: Object, Array: Array, RegExp: RegExp, Error: Error,
  isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
  AbortController: AbortController
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.location = { origin: 'http://127.0.0.1:8765', reload() {} };
sandbox.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  key: (i) => Object.keys(store)[i] || null,
  get length() { return Object.keys(store).length; }
};
sandbox.navigator = { userAgent: 'node' };
const fakeEl = {
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, querySelector() { return fakeEl; }, querySelectorAll() { return []; },
  appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {},
  innerHTML: '', textContent: '', value: ''
};
sandbox.document = {
  getElementById: () => fakeEl, querySelector: () => fakeEl,
  querySelectorAll: () => [], createElement: () => fakeEl,
  addEventListener() {}, body: fakeEl, documentElement: fakeEl
};

/* A hand-driven XHR: the test decides exactly when (and how) it completes. */
const pending = [];
function FakeXHR() {
  this.status = 0; this.responseText = ''; this.timeout = 0;
  this._aborted = false;
  pending.push(this);
}
FakeXHR.prototype.open = function () {};
FakeXHR.prototype.setRequestHeader = function () {};
FakeXHR.prototype.send = function () { this.sent = true; };
FakeXHR.prototype.abort = function () {
  this._aborted = true;
  if (typeof this.onabort === 'function') this.onabort();
};
/* Resolve the oldest outstanding request (sent, not aborted, not yet completed). */
function flush(status, payload) {
  const xhr = pending.find((x) => x.sent && !x._aborted && !x._done);
  if (!xhr) throw new Error('flush(): no in-flight request');
  xhr._done = true;
  xhr.status = status;
  xhr.responseText = JSON.stringify(payload);
  xhr.onload();
  return xhr;
}
function inflight() {
  return pending.filter((x) => x.sent && !x._aborted && !x._done).length;
}
sandbox.XMLHttpRequest = FakeXHR;

vm.createContext(sandbox);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'),
                                   sandbox, { filename: f });
for (const f of ['util.js', 'config.js', 'i18n.js', 'api.js', 'turn.js']) {
  load(f);
}
const { Turn, Api, Config } = sandbox;

/* ------------------------------------------------------------- harness */
function mkDeferred() {
  let res, rej;
  const p = new Promise((a, b) => { res = a; rej = b; });
  return { promise: p, resolve: res, reject: rej };
}
function recorder() {
  const ev = [];
  Turn.on((e) => ev.push(e));
  return ev;
}
const sleep = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  /* A promise that never settles would let node drain the event loop and exit
     0 with the run half-finished — the worst possible outcome for a gate. */
  const watchdog = setTimeout(() => {
    console.error('\nvoice_regression: TIMED OUT (a promise never settled)' +
                  ' — treated as a failure');
    process.exit(1);
  }, 15000);

  console.log('\n=== A. intent model (turn.js) ===');

  /* ---- A1: a plain utterance runs, and reports thinking → speaking */
  let synths = [], plays = [];
  const mkPlayer = () => (url, signal) => {
    const d = mkDeferred();
    plays.push({ url, signal, end: d.resolve });
    return d.promise;
  };
  Turn.setSynth((text, meta, signal) => {
    synths.push({ text, meta, signal });
    return Promise.resolve('blob:a1');
  });
  Turn.setPlayer(mkPlayer());
  let ev = recorder();

  const a1 = Turn.speak('いち', { mode: 'chat' });
  await sleep();
  ok(Turn.state() === Turn.SPEAKING, 'A1 utterance reaches speaking');
  ok(ev.some((e) => e.type === 'state' && e.state === 'thinking'), 'A1 thinking reported before speaking');
  ok(plays.length === 1 && plays[0].url === 'blob:a1', 'A1 player received the synthesized url');
  ok(Turn.isSpeaking() === true, 'A1 isSpeaking() is the authority the UI reads');

  /* ---- A2: 'queue' waits, does not cut in */
  Turn.speak('に', { behavior: 'queue' });
  await sleep();
  ok(Turn.waiting() === 1, 'A2 queue behaviour waits for the active utterance');
  ok(synths.length === 1, 'A2 queued text is not synthesized yet');

  /* ---- A3: the queue advances through ONE path, natural end included */
  plays[0].end();
  await sleep();
  ok(plays.length === 2 && Turn.waiting() === 0, 'A3 queued utterance starts when the active one ends');
  ok(synths.length === 2, 'A3 the promoted utterance was synthesized');
  plays[1].end();
  await sleep();
  ok(Turn.state() === Turn.IDLE, 'A3 state returns to idle once nothing is left');

  /* ---- A4: interrupt preempts; equal priority is enough */
  plays.length = 0; synths.length = 0;
  Turn.stopAll('reset');
  ev = recorder();
  Turn.speak('ながい', { priority: 1 });
  await sleep();
  plays.length = 0;
  Turn.speak('わりこみ', { behavior: 'interrupt', priority: 1 });
  await sleep();
  ok(ev.some((e) => e.type === 'cancel' && e.reason === 'preempted'), 'A4 equal-priority interrupt preempts');
  ok(Turn.waiting() === 0, 'A4 preempting utterance is not also queued');
  ok(plays.length === 1 && plays[0].url === 'blob:a1', 'A4 replacement playback started');

  /* ---- A5: a lower-priority interrupt must NOT cut in */
  Turn.stopAll('reset');
  plays.length = 0;
  Turn.speak('えらいひと', { priority: 5 });
  await sleep();
  plays.length = 0;
  Turn.speak('したっぱ', { behavior: 'interrupt', priority: 1 });
  await sleep();
  ok(Turn.waiting() === 1, 'A5 lower-priority interrupt queues instead of cutting in');
  ok(plays.length === 0, 'A5 no playback started for the queued intent');

  /* ---- A6: 'replace' cuts in regardless of priority */
  Turn.stopAll('reset');
  plays.length = 0;
  Turn.speak('えらいひと', { priority: 5 });
  await sleep();
  Turn.speak('よびだし', { behavior: 'replace', priority: 0 });
  await sleep();
  ok(Turn.waiting() === 0, 'A6 replace ignores priority');

  /* ---- A7: stopAll drops the queue, interrupt keeps it */
  Turn.stopAll('reset');
  plays.length = 0;
  Turn.speak('いち');
  await sleep();
  Turn.speak('に', { behavior: 'queue' });
  Turn.speak('さん', { behavior: 'queue' });
  ok(Turn.waiting() === 2, 'A7 two queued before the stops');
  Turn.interrupt('one-shot');
  await sleep();
  ok(Turn.waiting() === 1 && Turn.state() === Turn.SPEAKING,
     'A7 interrupt cuts the active one and the queue keeps playing');
  Turn.stopAll('all');
  await sleep();
  ok(Turn.waiting() === 0 && Turn.state() === Turn.IDLE, 'A7 stopAll drops the queue too');

  console.log('\n=== B. reply epoch (api.js) ===');
  Config.set('llm.apiKey', 'k');
  Config.set('llm.baseUrl', 'https://example.invalid/v1');

  /* ---- B1: chat allocates its own epoch when the caller hands in none */
  const e0 = Api.turnEpoch();
  const b1 = Api.chat([], 'ひとつめ', {});
  ok(Api.turnEpoch() === e0 + 1, 'B1 chat allocates its own epoch when none is given');
  ok(inflight() === 1, 'B1 the request is tracked so it can be aborted');

  /* ---- B2: bumping the epoch while the reply is on the wire aborts it */
  let staleB2 = null;
  b1.catch((e) => { staleB2 = e; });
  Api.newTurn('interrupt');                      // what Turn.cancelActive leads to
  await sleep();
  ok(staleB2 && staleB2.stale === true, 'B2 an interrupted reply rejects as STALE');
  ok(inflight() === 0, 'B2 nothing is left in flight after the abort');

  /* ---- B3: the ordered-landing guard. This is AUDIT 11.4-3: the reply has
     already resolved, the epoch moves in the same tick, and the caller's
     continuation must not see content. Without the check the older reply
     would land on top of the newer turn. */
  let staleB3 = null;
  const b3 = Api.chat([], 'ふたつめ', {});
  b3.catch((e) => { staleB3 = e; });
  flush(200, { choices: [{ message: { content: 'おそい へんじ' } }] });
  Api.newTurn('newer-turn');
  await sleep();
  ok(staleB3 && staleB3.stale === true, 'B3 a reply that resolved then got superseded is STALE');

  /* ---- B4: an untouched turn still parses normally. The visual tag line is
     the FIRST line of a reply (AUDIT 13), and it must be consumed, not shown. */
  const b4 = Api.chat([], 'みっつめ', {});
  flush(200, { choices: [{ message: { content: '[emotion:happy]\nげんき' } }] });
  const r4 = await b4;
  ok(r4 && r4.text === 'げんき' && r4.emotion === 'happy',
     'B4 an uninterrupted reply parses (tag line consumed, text clean)');

  console.log('\n=== C. turn begin/end (what App.say does) ===');
  let cancelled = [];
  Turn.setTurnCanceller((reason) => { cancelled.push(reason); return Api.newTurn(reason); });
  Turn.stopAll('reset');
  Turn.speak('とちゅう', {});
  await sleep();
  const eBegin = Turn.beginTurn('say');
  ok(cancelled.indexOf('say') >= 0, 'C1 beginTurn asks the transport to cancel');
  ok(Turn.state() === Turn.THINKING, 'C1 beginTurn puts the turn in thinking');
  ok(eBegin === Api.turnEpoch(), 'C1 the epoch handed to Api.chat is the live one');
  Turn.finishTurn();
  ok(Turn.state() === Turn.IDLE, 'C2 finishTurn is the only way back to idle after a reply');

  console.log('\n=== D. failures do not wedge the turn ===');
  Turn.stopAll('reset');
  const ev2 = recorder();
  Turn.setSynth(() => Promise.reject(new Error('NO_KEY')));
  Turn.speak('だめな こ', {});
  await sleep();
  ok(ev2.some((e) => e.type === 'error'), 'D1 a synth failure is reported as an event');
  ok(Turn.state() === Turn.IDLE, 'D2 the turn returns to idle after a failure (no wedge)');
  ok(Turn.waiting() === 0, 'D3 nothing is left waiting after a failure');

  console.log('\n--- 汇总 ---');
  clearTimeout(watchdog);
  console.log(failures ? '结果: FAIL (' + failures + ' 项)' : '结果: OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('voice_regression crashed: ' + (e && e.stack || e));
  process.exit(1);
});

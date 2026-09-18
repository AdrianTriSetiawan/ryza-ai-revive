/* Voice input: microphone → speech-to-text → gated transcript.

   Why this exists
   ---------------
   The client was half-duplex in the wrong direction: she could talk, the player
   could only type. Everything needed for the other direction already exists now
   — Turn knows whether she is speaking (so the microphone can stand down while
   she does), and echo.js can tell her own words coming back through the mic.
   This module is the missing half: capture, transcribe, and refuse to forward
   anything that is not the player.

   Two things it deliberately does NOT do:
     * It does not decide what a transcript means. It hands accepted text to an
       injected sink; App decides whether to fill the input box or send it.
     * It does not own a VAD. The browser recogniser segments on its own; a
       Silero-based endpoint (and true onset barge-in) is a separate step that
       needs an onnxruntime-web spike on all three hosts first — see
       docs/HANDOFF. Reporting "done" for that here would be a guess.

   Ports are injected (sink / speaker / notice / lang), so the module has no DOM
   and no knowledge of Config; scripts/voice_regression.js drives it with a
   stubbed recogniser, clock and speaker.
*/
(function (global) {
  'use strict';

  /* The recogniser wants a BCP-47 tag; the app's language slots are two-letter. */
  var LANG_TAG = {
    ja: 'ja-JP', zh: 'zh-CN', 'zh-tw': 'zh-TW', en: 'en-US', ko: 'ko-KR',
    fr: 'fr-FR', es: 'es-ES', ru: 'ru-RU', de: 'de-DE', it: 'it-IT', pt: 'pt-BR'
  };

  /* After she stops talking the microphone stays muted for a moment: the tail
     of her audio is still in the room (and in the recogniser's buffer) and would
     otherwise come back as a player turn. Same value airi uses. */
  var COOLDOWN_MS = 800;
  /* A recogniser that ends immediately, over and over, is broken (no mic, no
     permission, engine gone) — stop restarting instead of spinning. */
  var MAX_RAPID_RESTARTS = 5;

  var _sink = null, _speaker = null, _notice = null, _lang = null, _echo = null;

  var _want = false;        /* the player asked for the mic to be on */
  var _rec = null;
  var _suppressedUntil = 0;
  var _restarts = 0;
  var _startedAt = 0;
  var _now = function () { return Date.now(); };

  function emit(text) { if (_sink) { try { _sink(text); } catch (e) {} } }
  function notice(msg, isErr) { if (_notice) { try { _notice(msg, !!isErr); } catch (e) {} } }
  function speaking() {
    if (!_speaker) return false;
    try { return !!_speaker(); } catch (e) { return false; }
  }

  function Ctor() {
    return global.SpeechRecognition || global.webkitSpeechRecognition || null;
  }

  function armCooldown() { _suppressedUntil = _now() + COOLDOWN_MS; }

  /* Decided once per transcript, in this order: her speech in the room beats
     everything, then the cooldown, then the text-level echo check. */
  function accept(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return false;
    if (speaking()) { armCooldown(); return false; }
    if (_now() < _suppressedUntil) return false;
    if (_echo && _echo.looksLikeEcho && _echo.looksLikeEcho(t, _now())) return false;
    emit(t);
    return true;
  }

  function build() {
    var R = Ctor();
    if (!R) return null;
    var rec = new R();
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    try {
      rec.lang = LANG_TAG[(_lang && _lang()) || 'ja'] || 'ja-JP';
    } catch (e) { /* some engines reject an unknown tag; the default is fine */ }

    rec.onresult = function (ev) {
      var res = ev && ev.results;
      if (!res) return;
      for (var i = (ev.resultIndex || 0); i < res.length; i++) {
        var r = res[i];
        if (!r || !r.isFinal) continue;
        accept(r[0] && (r[0].transcript != null ? r[0].transcript : r[0]));
      }
    };
    rec.onerror = function (ev) {
      var code = (ev && ev.error) || '';
      if (code === 'no-speech' || code === 'aborted') return;   /* normal */
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        Voice._want = _want = false;
        notice('mic.denied', true);
        return;
      }
      notice('mic.error:' + code, true);
    };
    rec.onend = function () {
      if (!_want) { Voice._emitState(); return; }
      /* Web Speech ends on its own after silence; keep listening unless that
         keeps happening instantly, which means it is not actually working. */
      var ranFor = _now() - _startedAt;
      if (ranFor < 400) _restarts++; else _restarts = 0;
      if (_restarts > MAX_RAPID_RESTARTS) {
        _want = false;
        notice('mic.unstable', true);
        Voice._emitState();
        return;
      }
      try { rec.start(); _startedAt = _now(); } catch (e) { _want = false; Voice._emitState(); }
    };
    return rec;
  }

  var Voice = {
    COOLDOWN_MS: COOLDOWN_MS,
    MAX_RAPID_RESTARTS: MAX_RAPID_RESTARTS,

    /* ------------------------------------------------------------- ports */
    setSink: function (fn) { _sink = (typeof fn === 'function') ? fn : null; },
    setSpeaker: function (fn) { _speaker = (typeof fn === 'function') ? fn : null; },
    setNotice: function (fn) { _notice = (typeof fn === 'function') ? fn : null; },
    setLang: function (fn) { _lang = (typeof fn === 'function') ? fn : null; },
    setEcho: function (mod) { _echo = mod || null; },
    setClock: function (fn) { _now = (typeof fn === 'function') ? fn : _now; },

    /* ------------------------------------------------------------- state */
    available: function () { return !!Ctor(); },
    isListening: function () { return !!_want; },
    suppressedUntil: function () { return _suppressedUntil; },

    start: function () {
      if (!Ctor()) { notice('mic.unsupported', true); return false; }
      if (_want) return true;
      _want = true;
      _restarts = 0;
      try {
        _rec = _rec || build();
        _rec.start();
        _startedAt = _now();
      } catch (e) {
        _want = false;
        notice('mic.error:' + (e && e.message || e), true);
      }
      Voice._emitState();
      return _want;
    },

    stop: function () {
      _want = false;
      try { if (_rec) _rec.stop(); } catch (e) { /* already stopped */ }
      Voice._emitState();
      return true;
    },

    toggle: function () { return Voice.isListening() ? Voice.stop() : Voice.start(); },

    /* She finished a line: keep the microphone deaf for a moment. App calls
       this from its Turn subscription — the turn layer must not know about
       microphones, and this module must not know about turns. */
    noteAssistantSpeechEnded: function () {
      if (_want) armCooldown();
      Voice._emitState();
    },

    /* Block input for a while (UI asking, or a manual mute window). */
    suppressFor: function (ms) {
      var until = _now() + Math.max(0, Number(ms) || 0);
      if (until > _suppressedUntil) _suppressedUntil = until;
    },

    /* ---------------------------------------------------------- internals
       Exposed for the regression: the gate decision has to be testable without
       a real microphone, and a recogniser stub has no business re-implementing
       it. */
    _accept: accept,
    _stateListeners: [],
    _emitState: function () {
      Voice._stateListeners.slice().forEach(function (f) {
        try { f(Voice.isListening()); } catch (e) {}
      });
    },
    onState: function (fn) {
      if (typeof fn !== 'function') return function () {};
      Voice._stateListeners.push(fn);
      return function () {
        var i = Voice._stateListeners.indexOf(fn);
        if (i >= 0) Voice._stateListeners.splice(i, 1);
      };
    },
    _reset: function () {
      _rec = null; _want = false; _suppressedUntil = 0; _restarts = 0;
    }
  };

  global.Voice = Voice;
})(typeof window !== 'undefined' ? window : globalThis);

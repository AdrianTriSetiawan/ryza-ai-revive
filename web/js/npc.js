/* NPC dialogue: a second, third, fourth speaker in a reply that used to belong
   to Ryza alone.

   Why it exists
   -------------
   The world already knows 34 islanders, where each one is on a given day, who
   travels with whom (companions) and who the player has already met
   (Game.s.met_charas) — and the prompt only ever got their *names*. Meanwhile
   the portraits for 33 of them were sitting unused in assets/images/chara_icons.
   Nothing about the character is missing; what was missing is the protocol that
   lets another islander actually speak.

   The protocol (borrowed from AgentAtelierR's, which is the cheapest thing that
   can work without tool calling):
     * a line starting with "角色[<id>]：" belongs to that NPC
     * a line starting with "莱莎：" / "ライザ：" / "ryza：" belongs to her
     * a line starting with "旁白：" / "ナレーション：" / "narrator：" is narration
     * any other line continues whoever spoke last
   A reply with no such prefix is exactly what it was before: one Ryza segment,
   so every existing behaviour (and every existing regression) is unchanged.

   Hard rules, taken from how AgentAtelierR keeps this honest — NPC lines never
   reach TTS, expression or action tags, and no NPC may speak on the player's
   behalf:
     * the prompt asks for at most 1-2 islanders per turn;
     * they may only use the name and the one-line note the pack ships (the full
       per-character setting lived on the official server and is NOT in the APK,
       so inventing it would be fabrication);
     * being mentioned is not the same as being present.

   Layer: features. It reads core (World / Game) but never writes state — who
   met whom is still Game.applyDelta's business.
*/
(function (global) {
  'use strict';

  var FREQ = {
    restrained: 'NPCの参加は控えめに。本当に必要な時だけ1人まで。',
    normal:     '話題に関係するNPCがいる時は、1人だけ自然に会話に加わってよい。',
    frequent:   '適切なNPCを1人、2〜3ターンに一度は自然に会話に加える。',
    lively:     '多くの返答で、最も関係のあるNPC1人（必要な時は2人）が自分から話しかける。'
  };

  /* id shapes accepted from the model, normalised to the placement ids. */
  var SPEAKER = [
    { kind: 'narrator', re: /^\s*(?:旁白|ナレーション|narrator)\s*[:：]\s*/i },
    { kind: 'ryza',     re: /^\s*(?:莱莎(?:琳)?|ライザ(?:リン)?|ryza|ryza(?:lin)?)\s*[:：]\s*/i },
    { kind: 'npc',      re: /^\s*角色\s*\[\s*([^\]\r\n]+?)\s*\]\s*[:：]\s*/ }
  ];

  function world() { return global.World || null; }

  function npcList() {
    var w = world();
    return (w && w.npcs && w.npcs.npcs) || [];
  }

  /* "tao" / "npc_tao" / "TAO" all resolve to the placement id. Unknown stays
     unknown rather than being silently attributed to somebody else. */
  function resolveId(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return '';
    var want = s.indexOf('npc_') === 0 ? s : 'npc_' + s;
    var list = npcList();
    for (var i = 0; i < list.length; i++) if (list[i].id === want) return want;
    for (var j = 0; j < list.length; j++) if (list[j].id === s) return s;
    return '';
  }

  function nameOf(id, fallback) {
    var w = world();
    if (id && w && typeof w.npcName === 'function') {
      try {
        var n = w.npcName(id);
        if (n) return n;
      } catch (e) { /* fall through to the label the model wrote */ }
    }
    return fallback || id || '';
  }

  /* Split a reply into speaker beats. A line that matches no speaker continues
     the previous beat, so multi-line paragraphs survive. */
  function split(text) {
    var body = String(text == null ? '' : text);
    if (!body.trim()) return [];
    var lines = body.split(/\r?\n/);
    var beats = [];
    var current = null;

    function push(kind, id, label, chunk) {
      if (current) beats.push(current);
      current = { speaker: kind, id: id || '', name: label || '', text: chunk || '' };
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var matched = null, m = null;
      for (var s = 0; s < SPEAKER.length; s++) {
        m = SPEAKER[s].re.exec(line);
        if (m) { matched = SPEAKER[s].kind; break; }
      }
      if (matched === 'narrator') { push('narrator', '', '', line.replace(SPEAKER[0].re, '')); continue; }
      if (matched === 'ryza') { push('ryza', '', '', line.replace(SPEAKER[1].re, '')); continue; }
      if (matched === 'npc') {
        var raw = m[1];
        var id = resolveId(raw);
        push('npc', id, nameOf(id, String(raw).trim()), line.replace(SPEAKER[2].re, ''));
        continue;
      }
      if (!current) push('ryza', '', '', line);
      else current.text += (current.text ? '\n' : '') + line;
    }
    if (current) beats.push(current);
    return beats.filter(function (b) { return b.text.trim() !== ''; });
  }

  /* Only her own words go to the synthesizer and to the emotion/action path.
     NPC and narration beats are text on screen, nothing else. */
  function spokenText(beats) {
    return beats.filter(function (b) { return b.speaker === 'ryza'; })
                .map(function (b) { return b.text; })
                .join('\n')
                .trim();
  }

  function labelFor(beat) {
    if (beat.speaker === 'ryza') return '';
    if (beat.speaker === 'narrator') return '';
    return beat.name || beat.id || '';
  }

  /* ------------------------------------------------------------- candidates
     Score a placement against where the player is standing, the way the pack's
     own data can support: an islander scheduled into this very stage is the
     strongest signal, then the same field, then the same area, each scaled by
     that base's own probability. Mirrors AgentAtelierR's scoring so the same
     roster behaves the same way in both clients. */
  function scoreOf(npc, st, day) {
    var w = world();
    var here = null;
    if (w && typeof w.placement === 'function') {
      try { here = (w.placement(day) || {})[npc.id] || null; } catch (e) { here = null; }
    }
    var score = 0;
    if (here && here === st.stageId) score = 120;   /* already in the room */
    (npc.bases || []).forEach(function (b) {
      var pct = Number(b.pct) || 0;
      var bs = null;
      if (w && typeof w.find === 'function') {
        try { bs = w.find(b.stageId); } catch (e) { bs = null; }
      }
      if (b.stageId === st.stageId) score = Math.max(score, pct * 100);
      else if (bs && st.fieldId && bs.fieldId === st.fieldId) score = Math.max(score, pct * 50);
      else if (bs && st.areaId && bs.areaId === st.areaId) score = Math.max(score, pct * 25);
    });
    /* an islander who wanders a lot is likelier to be somewhere near */
    var mv = npc.move || {};
    score += (Number(mv.stage) || 0) * 3 + (Number(mv.field) || 0) * 2 + (Number(mv.area) || 0);
    return score;
  }

  var Npc = {
    FREQ: FREQ,
    /* A candidate is anyone with a base that touches the current stage, field or
       area — the ranking, not this cutoff, is what decides who actually speaks.
       (The multipliers below put an in-stage base at pct×100, same field at ×50
       and same area at ×25, so this only excludes an islander with no base
       anywhere near.) */
    MIN_SCORE: 1,
    MAX_CANDIDATES: 6,

    split: split,
    spokenText: spokenText,
    labelFor: labelFor,
    resolveId: resolveId,
    nameOf: nameOf,

    /* [{id, name, note}] — the islanders worth mentioning this turn, best
       first, never Ryza herself. */
    candidates: function (stageId, day, limit) {
      var w = world();
      if (!w || !stageId) return [];
      var st = null;
      try { st = w.find(stageId); } catch (e) { st = null; }
      if (!st) return [];
      var out = [];
      npcList().forEach(function (n) {
        if (!n || !n.id) return;
        if (String(n.id).toLowerCase() === 'npc_ryza') return;
        var sc = scoreOf(n, st, day);
        if (sc > Npc.MIN_SCORE) {
          out.push({
            id: n.id, name: nameOf(n.id, n.name), note: n.note || '',
            score: sc, order: n.resolveOrder || 999
          });
        }
      });
      out.sort(function (a, b) { return (b.score - a.score) || (a.order - b.order); });
      return out.slice(0, limit || Npc.MAX_CANDIDATES);
    },

    frequency: function (appCfg) {
      var key = (appCfg && appCfg.npcFrequency) || 'normal';
      return FREQ[key] || FREQ.normal;
    },

    /* The prompt block. Facts first (who is here / who has been met), then the
       candidates, then the protocol — the model cannot use a roster it was never
       shown, and must not invent one it was. */
    promptBlock: function (st, opts) {
      opts = opts || {};
      var w = world();
      if (!w || !st || !st.stage) return '';
      var cand = Npc.candidates(st.stage, st.day || 1);
      if (!cand.length) return '';
      var L = ['## この場面に登場しうる人物（ライザ以外）'];
      cand.forEach(function (c) {
        L.push('- ' + c.id + '：' + c.name + (c.note ? '（' + c.note + '）' : ''));
      });
      L.push('');
      L.push(Npc.frequency(opts.appCfg));
      L.push('この回に登場する場合だけ、行頭に「角色[ID]：」を付けて本人の台詞を書く（IDは上の一覧のまま）。');
      L.push('あなた自身（ライザ）の台詞は「莱莎：」、地の文は「旁白：」で始める。前置きのない行はライザの台詞として扱われる。');
      L.push('NPCや旁白には表情・動作・音声のタグを付けない（それらの資源は存在しない）。一度に登場させるのは1人、多くても2人まで。');
      L.push('上の一覧に無い人物の設定を創作しない。名前と立場以上の細かい設定は渡されていない。');
      L.push('話題に挙がっただけの人物を、その場にいることにしない。');
      return L.join('\n');
    },

    /* exposed for the regression */
    _scoreOf: scoreOf
  };

  global.Npc = Npc;
})(typeof window !== 'undefined' ? window : globalThis);

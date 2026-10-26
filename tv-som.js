/* =====================================================================
 * StackOS — Som da TV (alerta de troca de blinds)
 * ---------------------------------------------------------------------
 * Módulo independente, usado por:
 *   - tv.html  → StackTvSom.attachTv()  (toca os alertas na TV)
 *   - app.html → Configurações › Som da TV (testes e preview)
 *
 * NÃO altera nada da TV: só LÊ o timer exibido na tela e as mensagens
 * que a TV já recebe. Sons gerados via Web Audio (sem arquivos).
 * ===================================================================== */
(function () {
  'use strict';

  var DEFAULTS = { ativo: false, contagem: 'half', troca: 'long', aviso1min: true, volume: 80 };
  var FREQ = 1050; // mesmo tom do exemplo de referência (~1050 Hz)

  function norm(cfg) {
    var out = {};
    for (var k in DEFAULTS) out[k] = DEFAULTS[k];
    if (cfg && typeof cfg === 'object') {
      for (var k2 in DEFAULTS) if (cfg[k2] !== undefined && cfg[k2] !== null) out[k2] = cfg[k2];
    }
    out.volume = Math.max(0, Math.min(100, Number(out.volume) || 0));
    return out;
  }

  // Bipe: onda quadrada suavizada, envelope curto (sem estalo)
  function beep(ctx, at, dur, freq, gain, cfg) {
    if (!ctx) return;
    try {
      var v = (cfg.volume / 100) * gain;
      var t = ctx.currentTime + at;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      var f = ctx.createBiquadFilter();
      o.type = 'square';
      o.frequency.value = freq;
      f.type = 'lowpass';
      f.frequency.value = 3200;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.006);
      g.gain.setValueAtTime(v, t + Math.max(0.01, dur - 0.02));
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f); f.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* silencioso */ }
  }

  // Bipes curtos de 1 segundo da contagem final (sec = 5..1)
  function countSecond(ctx, cfg, sec) {
    cfg = norm(cfg);
    if (cfg.contagem === 'one') {
      beep(ctx, 0, 0.07, FREQ, 0.45, cfg);
    } else if (cfg.contagem === 'accel') {
      var n = ({ 5: 1, 4: 2, 3: 2, 2: 3, 1: 4 })[sec] || 1;
      for (var i = 0; i < n; i++) beep(ctx, i / n, 0.055, FREQ, 0.45, cfg);
    } else { // 'half' — 2 por segundo (igual ao exemplo)
      beep(ctx, 0, 0.06, FREQ, 0.45, cfg);
      beep(ctx, 0.5, 0.06, FREQ, 0.45, cfg);
    }
  }

  // Bipe da troca de nível
  function troca(ctx, cfg) {
    cfg = norm(cfg);
    if (cfg.troca === 'long2') {
      beep(ctx, 0, 1.5, FREQ, 0.4, cfg);
      beep(ctx, 0, 1.5, FREQ * 1.26, 0.3, cfg);
    } else if (cfg.troca === 'triple') {
      beep(ctx, 0, 0.4, FREQ, 0.55, cfg);
      beep(ctx, 0.55, 0.4, FREQ, 0.55, cfg);
      beep(ctx, 1.1, 0.4, FREQ, 0.55, cfg);
    } else { // 'long'
      beep(ctx, 0, 1.5, FREQ, 0.55, cfg);
    }
  }

  // Aviso de 1 minuto
  function aviso1min(ctx, cfg) {
    cfg = norm(cfg);
    beep(ctx, 0, 0.18, 880, 0.4, cfg);
    beep(ctx, 0.3, 0.18, 880, 0.4, cfg);
  }

  // ===================================================================
  // TV — liga os alertas automaticamente (chamado só pelo tv.html)
  // ===================================================================
  function attachTv() {
    if (window.__stackTvSomAttached) return;
    window.__stackTvSomAttached = true;

    var st = {
      cfg: norm(null), ctx: null, lastSec: null,
      lastNivel: null, lastNome: null, lastTrocaAt: 0, overlay: null
    };

    function openerApp() {
      try {
        if (window.opener && !window.opener.closed && window.opener.sbClube) return window.opener;
      } catch (e) { }
      return null;
    }

    // ---- Configuração do clube ----
    function carregarCfg() {
      var op = openerApp();
      if (op) { // Modo "Abrir TV" (popup): lê direto do app aberto
        try { aplicarCfg(op.sbClube && op.sbClube.tv_som); } catch (e) { }
        return;
      }
      var ps = window.pubState;
      if (!ps || !ps.clubeId || !ps.token || !window.sb || !window.sb.rpc) return;
      try {
        window.sb.rpc('tv_som_config', { p_clube_id: ps.clubeId, p_token: ps.token })
          .then(function (r) { if (r && !r.error) aplicarCfg(r.data); })
          .catch(function () { });
      } catch (e) { }
    }
    function aplicarCfg(raw) {
      st.cfg = norm(raw);
      if (st.cfg.ativo) getCtx();
      atualizarUI();
    }

    // ---- Áudio ----
    function getCtx() {
      if (st.ctx) return st.ctx;
      var AC = null;
      // No modo popup, usa o áudio da janela do app: ela já teve o clique do
      // operador ("Abrir TV"), então o navegador libera o som sem pedir clique na TV.
      var op = openerApp();
      if (op) { try { AC = op.AudioContext || op.webkitAudioContext; } catch (e) { AC = null; } }
      try { if (AC) st.ctx = new AC(); } catch (e) { st.ctx = null; }
      if (!st.ctx) {
        AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { st.ctx = new AC(); } catch (e) { return null; }
      }
      try { st.ctx.onstatechange = atualizarUI; } catch (e) { }
      try { if (st.ctx.state === 'suspended') st.ctx.resume(); } catch (e) { }
      setTimeout(atualizarUI, 1500);
      return st.ctx;
    }
    function destravar() {
      // Qualquer toque/OK já libera o áudio, mesmo que a configuração ainda não tenha
      // chegado (a TV busca a config alguns segundos depois de abrir).
      var c = getCtx();
      if (!c) return;
      try { if (c.state !== 'running') c.resume().then(atualizarUI, atualizarUI); } catch (e) { }
    }
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (ev) {
      document.addEventListener(ev, destravar, { capture: true, passive: true });
    });
    window.addEventListener('pagehide', function () {
      try { if (st.ctx && st.ctx.close) st.ctx.close(); } catch (e) { }
    });

    // Aviso discreto no canto: só aparece se o som estiver ligado E o navegador bloqueou
    function atualizarOverlay() {
      var precisa = st.cfg.ativo && st.ctx && st.ctx.state !== 'running';
      if (precisa && !st.overlay) {
        var el = document.createElement('div');
        el.id = 'stack-tv-som-aviso';
        el.textContent = '🔊 Toque na tela (ou OK no controle) para ativar o som';
        el.setAttribute('style',
          'position:fixed;right:16px;bottom:16px;z-index:2147483000;' +
          'background:rgba(0,0,0,.78);color:#fbbf24;border:1px solid rgba(251,191,36,.45);' +
          'padding:10px 16px;border-radius:999px;font:700 15px/1.2 Manrope,system-ui,sans-serif;' +
          'cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.4);');
        (document.body || document.documentElement).appendChild(el);
        st.overlay = el;
      } else if (!precisa && st.overlay) {
        try { st.overlay.remove(); } catch (e) { }
        st.overlay = null;
      }
    }

    function tocar(fn, arg) {
      if (!st.cfg.ativo) return;
      var c = getCtx();
      if (!c) return;
      if (c.state === 'running') { fn(c, st.cfg, arg); return; }
      // Navegador suspendeu o áudio (ex.: Fire Stick depois de um tempo parado):
      // tenta reativar — funciona quando já houve um toque na página — e toca em seguida.
      try { c.resume().then(function () { if (c.state === 'running') fn(c, st.cfg, arg); atualizarUI(); }, atualizarUI); } catch (e) { }
    }

    // Mantém o áudio "acordado": um sinal silencioso a cada 20s evita que o navegador
    // ou a saída HDMI desliguem o áudio entre um nível e outro (e cortem o 1º bipe).
    setInterval(function () {
      if (!st.cfg.ativo || !st.ctx) return;
      try {
        if (st.ctx.state !== 'running') { st.ctx.resume().then(atualizarUI, atualizarUI); return; }
        var o = st.ctx.createOscillator(), g = st.ctx.createGain();
        g.gain.value = 0.00001; o.connect(g); g.connect(st.ctx.destination);
        o.start(); o.stop(st.ctx.currentTime + 0.05);
      } catch (e) { }
    }, 20000);

    // ---- Botão de som ao lado do zoom (mostra o estado + libera com bipe) ----
    function criarBotao() {
      if (st.btn) return st.btn;
      var barra = document.getElementById('tv-zoom-controls');
      if (!barra) return null;
      var b = document.createElement('button');
      b.id = 'stack-tv-som-btn';
      b.type = 'button';
      b.setAttribute('style',
        'background:transparent;border:none;color:#fff;height:2rem;padding:0 .55rem;border-radius:.3rem;cursor:pointer;' +
        'font-size:.72rem;font-weight:700;line-height:1;display:none;align-items:center;gap:.3rem;font-family:inherit;' +
        'border-right:1px solid rgba(255,255,255,.15);margin-right:.15rem;white-space:nowrap;');
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var c = getCtx();
        if (!c) { b.textContent = '🔇 Sem áudio'; return; }
        var confirmar = function () {
          atualizarUI();
          if (c.state === 'running') aviso1min(c, st.cfg.ativo ? st.cfg : norm({ volume: 80 })); // bipe de confirmação
        };
        try { if (c.state !== 'running') c.resume().then(confirmar, confirmar); else confirmar(); } catch (e) { confirmar(); }
      });
      barra.insertBefore(b, barra.firstChild);
      st.btn = b;
      return b;
    }
    function atualizarBotao() {
      var b = criarBotao();
      if (!b) return;
      if (!st.cfg.ativo) { b.style.display = 'none'; return; }
      b.style.display = 'inline-flex';
      if (st.ctx && st.ctx.state === 'running') {
        b.textContent = '🔊 Som ativo';
        b.style.color = '#4ade80';
        b.title = 'Som ligado — clique para ouvir um bipe de teste';
      } else {
        b.textContent = '🔇 Ativar som';
        b.style.color = '#fbbf24';
        b.title = 'Clique (ou OK no controle) para liberar o som da TV';
      }
    }
    function atualizarUI() { atualizarOverlay(); atualizarBotao(); }
    setInterval(atualizarBotao, 1000);
    function dispararTroca() {
      var agora = Date.now();
      if (agora - st.lastTrocaAt < 5000) return; // evita tocar 2x na mesma troca
      st.lastTrocaAt = agora;
      tocar(troca);
    }

    // ---- Leitura do timer exibido (todos os layouts) ----
    var IDS = ['timer', 'pw-timer', 'mz-timer', 'feltro-timer', 'break-timer'];
    function lerSegundos() {
      for (var i = 0; i < IDS.length; i++) {
        var el = document.getElementById(IDS[i]);
        if (!el || !el.getClientRects().length) continue; // ignora elementos ocultos
        var m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{2})\s*$/.exec(el.textContent || '');
        if (m) return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
      }
      return null;
    }
    function tick() {
      var sec = lerSegundos();
      if (sec === null) { st.lastSec = null; return; }
      var last = st.lastSec;
      st.lastSec = sec;
      if (last === null || sec === last || !st.cfg.ativo) return;

      if (sec < last && last - sec <= 3) {           // contagem normal
        if (st.cfg.aviso1min && last > 60 && sec <= 60 && sec > 55) tocar(aviso1min);
        if (sec >= 1 && sec <= 5) tocar(countSecond, sec);
        if (sec === 0) dispararTroca();
      } else if (last <= 3 && sec > last + 15) {     // timer reiniciou = nível novo
        dispararTroca();
      }
    }
    setInterval(tick, 250);

    // ---- Troca manual de nível (operador avançou) — vem nas mensagens da TV ----
    window.addEventListener('message', function (e) {
      var d = e && e.data;
      if (!d || !d.timer) return;
      var nome = d.tournamentName || '';
      var nv = Number(d.nivel) || 0;
      if (st.lastNome === nome && st.lastNivel !== null && nv > st.lastNivel) dispararTroca();
      st.lastNome = nome;
      st.lastNivel = nv;
    });

    carregarCfg();
    setTimeout(carregarCfg, 3000);           // TV pública: aguarda o boot resolver clube/token
    setInterval(carregarCfg, openerApp() ? 5000 : 60000);
  }

  window.StackTvSom = {
    DEFAULTS: DEFAULTS, norm: norm,
    countSecond: countSecond, troca: troca, aviso1min: aviso1min,
    attachTv: attachTv
  };
})();

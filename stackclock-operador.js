/* =====================================================================
 * StackClock — Operador (alertas em tempo real dentro do StackOS)
 * INTEGRADO AO APP.HTML EXISTENTE
 * =====================================================================
 *
 * COMO INSTALAR:
 *   1) Coloque este arquivo na raiz do repo (junto com app.html)
 *   2) No app.html, adicione UMA LINHA antes do </body> final:
 *
 *        <script src="stackclock-operador.js" defer></script>
 *
 * COMO FUNCIONA (integração com seu app.html):
 *   - Usa o mesmo cliente Supabase (window.sb) e variáveis globais
 *     (sbClube, currentUser) que o app.html já cria.
 *   - Aparece automaticamente depois do login.
 *   - Lê papel do currentUser e filtra alertas via stackclock_config.roteamento
 * ===================================================================== */

(function () {
  'use strict';

  let alertasPendentes = [];
  let papelUsuario = null;
  let clubeIdUsuario = null;
  let roteamento = null;
  let scChannel = null;
  let audioCtx = null;
  let inicializado = false;

  const CSS = `
    #sc-bell-wrap{position:fixed;bottom:20px;right:20px;z-index:99998;font-family:'Manrope','Inter',system-ui,sans-serif;display:none;}
    #sc-bell{width:52px;height:52px;border-radius:50%;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(124,58,237,.5);display:flex;align-items:center;justify-content:center;position:relative;transition:transform .15s;padding:0;}
    #sc-bell:hover{transform:scale(1.05);}
    #sc-bell:active{transform:scale(.95);}
    #sc-bell-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:999px;font-size:11px;font-weight:700;min-width:22px;height:22px;padding:0 6px;display:none;align-items:center;justify-content:center;border:2px solid #0f172a;animation:scpulse 1.5s ease-in-out infinite;line-height:1;}
    @keyframes scpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    #sc-panel{position:absolute;bottom:65px;right:0;width:380px;max-width:calc(100vw - 40px);max-height:70vh;background:#0c1223;border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.5);display:none;flex-direction:column;overflow:hidden;color:#e4e4e7;}
    #sc-panel.open{display:flex;}
    #sc-panel-header{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(135deg,rgba(124,58,237,.18),transparent);}
    #sc-panel-header strong{color:#a855f7;font-size:14px;}
    #sc-panel-close{background:rgba(255,255,255,.08);border:none;color:#fff;width:28px;height:28px;border-radius:8px;font-size:16px;cursor:pointer;line-height:1;}
    #sc-panel-empty{padding:30px 16px;text-align:center;color:#71717a;font-size:13px;}
    #sc-panel-list{overflow-y:auto;max-height:calc(70vh - 60px);}
    .sc-alert-item{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;gap:12px;align-items:flex-start;animation:scslide .3s ease;}
    @keyframes scslide{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
    .sc-alert-icon{width:38px;height:38px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;}
    .sc-alert-icon.reentry{background:rgba(245,158,11,.18);color:#f59e0b;}
    .sc-alert-icon.floor{background:rgba(59,130,246,.18);color:#3b82f6;}
    .sc-alert-icon.bar{background:rgba(249,115,22,.18);color:#f97316;}
    .sc-alert-icon.position{background:rgba(168,85,247,.18);color:#a855f7;}
    .sc-alert-body{flex:1;min-width:0;}
    .sc-alert-title{font-size:14px;font-weight:700;margin-bottom:2px;color:#e4e4e7;}
    .sc-alert-meta{font-size:12px;color:#9ca3af;}
    .sc-alert-time{font-size:11px;color:#6b7280;margin-top:2px;}
    .sc-alert-btn{background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;align-self:center;font-family:inherit;}
    .sc-alert-btn:active{transform:scale(.95);}
    #sc-toast{position:fixed;bottom:90px;right:20px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;padding:14px 20px;border-radius:12px;font-weight:600;font-size:14px;font-family:'Manrope','Inter',system-ui,sans-serif;box-shadow:0 10px 30px rgba(124,58,237,.5);opacity:0;transform:translateX(20px);transition:opacity .3s,transform .3s;z-index:99999;pointer-events:none;max-width:360px;}
    #sc-toast.show{opacity:1;transform:translateX(0);}
  `;

  function montarHTML() {
    if (document.getElementById('sc-bell-wrap')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'sc-style';
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    const wrap = document.createElement('div');
    wrap.id = 'sc-bell-wrap';
    wrap.innerHTML = `
      <button id="sc-bell" aria-label="Alertas StackClock" type="button" title="Alertas StackClock">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
          <path d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-12 0v5l-2 2v1h16v-1l-2-2z"/>
        </svg>
        <span id="sc-bell-badge">0</span>
      </button>
      <div id="sc-panel" role="dialog" aria-label="Alertas StackClock">
        <div id="sc-panel-header">
          <strong>Alertas StackClock</strong>
          <button id="sc-panel-close" type="button" aria-label="Fechar">×</button>
        </div>
        <div id="sc-panel-empty">Nenhum alerta pendente.</div>
        <div id="sc-panel-list"></div>
      </div>
    `;
    document.body.appendChild(wrap);

    const toast = document.createElement('div');
    toast.id = 'sc-toast';
    document.body.appendChild(toast);
  }

  function pronto() {
    return typeof window.sb !== 'undefined' && window.sb && window.sb.rpc &&
           typeof window.sbClube !== 'undefined' && window.sbClube && window.sbClube.id &&
           typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.papel;
  }

  function tentarInicializar() {
    if (inicializado) return;
    if (!pronto()) {
      setTimeout(tentarInicializar, 1000);
      return;
    }
    inicializado = true;
    inicializar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tentarInicializar, 800));
  } else {
    setTimeout(tentarInicializar, 800);
  }

  async function inicializar() {
    try {
      const cli = window.sb;
      papelUsuario   = (window.currentUser.papel || '').toLowerCase();
      clubeIdUsuario = window.sbClube.id;

      const { data: cfg } = await cli
        .from('stackclock_config')
        .select('roteamento')
        .eq('clube_id', clubeIdUsuario)
        .maybeSingle();

      roteamento = (cfg && cfg.roteamento) || {
        admin:    ['reentry','floor','bar','position'],
        gerente:  ['reentry','floor','bar','position'],
        caixa:    ['reentry','position'],
        bar:      ['bar'],
        operador: ['floor','bar','position'],
        administrador: ['reentry','floor','bar','position']
      };

      const tipos = roteamento[papelUsuario] || [];
      if (tipos.length === 0) {
        console.log('[StackClock] papel "' + papelUsuario + '" sem alertas configurados.');
        return;
      }

      montarHTML();
      document.getElementById('sc-bell-wrap').style.display = 'block';
      document.getElementById('sc-bell').onclick = togglePanel;
      document.getElementById('sc-panel-close').onclick = togglePanel;

      await carregarPendentes();
      assinarRealtime();

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') carregarPendentes();
      });

      console.log('[StackClock] operador ativo. Papel:', papelUsuario, '| Tipos:', tipos);
    } catch (err) {
      console.error('[StackClock] erro init:', err);
    }
  }

  async function carregarPendentes() {
    try {
      const { data, error } = await window.sb.rpc('stackclock_listar_alertas_pendentes', { p_limite: 50 });
      if (error) throw error;
      alertasPendentes = (data || []).filter(filtroPapel);
      renderPanel();
    } catch (err) {
      console.error('[StackClock] erro carregar pendentes:', err);
    }
  }

  function assinarRealtime() {
    const cli = window.sb;
    if (scChannel) { try { cli.removeChannel(scChannel); } catch(_){} }

    scChannel = cli
      .channel('sc_alertas_' + clubeIdUsuario)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'stackclock_alertas',
        filter: 'clube_id=eq.' + clubeIdUsuario
      }, (payload) => {
        const novo = payload.new;
        if (!filtroPapel(novo)) return;
        if (alertasPendentes.some(a => a.id === novo.id)) return;
        alertasPendentes.unshift(novo);
        renderPanel();
        notificar(novo);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'stackclock_alertas',
        filter: 'clube_id=eq.' + clubeIdUsuario
      }, (payload) => {
        const upd = payload.new;
        if (upd.status !== 'pendente') {
          alertasPendentes = alertasPendentes.filter(a => a.id !== upd.id);
          renderPanel();
        }
      })
      .subscribe((status) => {
        console.log('[StackClock] realtime:', status);
      });
  }

  function filtroPapel(alerta) {
    const tipos = roteamento[papelUsuario] || [];
    return tipos.includes(alerta.tipo);
  }

  function renderPanel() {
    const list  = document.getElementById('sc-panel-list');
    const empty = document.getElementById('sc-panel-empty');
    const badge = document.getElementById('sc-bell-badge');
    if (!list || !empty || !badge) return;

    const n = alertasPendentes.length;
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';

    if (n === 0) {
      empty.style.display = 'block';
      list.innerHTML = '';
      return;
    }

    empty.style.display = 'none';
    list.innerHTML = alertasPendentes.map(renderItem).join('');
    list.querySelectorAll('[data-atender]').forEach(btn => {
      btn.onclick = () => marcarAtendido(btn.dataset.atender);
    });
  }

  function renderItem(a) {
    let icon = '🔔', titulo = '';
    if (a.tipo === 'reentry') {
      icon = '🃏';
      titulo = 'Rebuy ' + (a.variante ? a.variante.toUpperCase() : '') + ' — Pos ' + (a.posicao || '?');
    } else if (a.tipo === 'floor') {
      icon = '👮'; titulo = 'Floor chamado';
    } else if (a.tipo === 'bar') {
      icon = '🍻'; titulo = 'Bar chamado';
    } else if (a.tipo === 'position') {
      icon = '🪑'; titulo = 'Posição ' + (a.posicao || '?') + ' vagou';
    }
    const meta = 'Mesa ' + a.mesa + (a.torneio_nome ? ' • ' + esc(a.torneio_nome) : '');
    const time = formatTime(a.criado_em);
    return `
      <div class="sc-alert-item">
        <div class="sc-alert-icon ${a.tipo}">${icon}</div>
        <div class="sc-alert-body">
          <div class="sc-alert-title">${esc(titulo)}</div>
          <div class="sc-alert-meta">${meta}</div>
          <div class="sc-alert-time">${time}</div>
        </div>
        <button class="sc-alert-btn" data-atender="${a.id}" type="button">✓ Atendido</button>
      </div>`;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diffSec = Math.floor((new Date() - d) / 1000);
    if (diffSec < 60)  return 'agora mesmo';
    if (diffSec < 3600) return 'há ' + Math.floor(diffSec/60) + ' min';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function togglePanel() {
    document.getElementById('sc-panel').classList.toggle('open');
  }

  async function marcarAtendido(id) {
    try {
      const { error } = await window.sb.rpc('stackclock_marcar_atendido', { p_alerta_id: id });
      if (error) throw error;
      alertasPendentes = alertasPendentes.filter(a => a.id !== id);
      renderPanel();
    } catch (err) {
      console.error('[StackClock] erro marcar atendido:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('❌ Erro ao marcar como atendido');
      } else {
        alert('Erro ao marcar como atendido');
      }
    }
  }

  function notificar(alerta) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.4);
    } catch(_){}

    if (navigator.vibrate) navigator.vibrate([100,50,100]);

    let txt = '';
    if (alerta.tipo === 'reentry') {
      txt = '🃏 Mesa ' + alerta.mesa + ' — Rebuy ' + (alerta.variante||'').toUpperCase() + ' Pos ' + alerta.posicao;
    } else if (alerta.tipo === 'floor') {
      txt = '👮 Floor — Mesa ' + alerta.mesa;
    } else if (alerta.tipo === 'bar') {
      txt = '🍻 Bar — Mesa ' + alerta.mesa;
    } else if (alerta.tipo === 'position') {
      txt = '🪑 Mesa ' + alerta.mesa + ' — Posição ' + alerta.posicao + ' vagou';
    }
    if (alerta.torneio_nome) txt += ' (' + alerta.torneio_nome + ')';

    const toast = document.getElementById('sc-toast');
    if (toast) {
      toast.textContent = txt;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4500);
    }
  }

})();

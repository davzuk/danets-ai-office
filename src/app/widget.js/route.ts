import { NextRequest } from "next/server";
import { appOrigin } from "@/lib/public-cors";
import { RULE_MATCHER_JS } from "@/lib/widget-rules";

// Serves an embeddable, self-contained JavaScript widget.
// Usage: <script src="/widget.js?pk=BUSINESS_PUBLIC_KEY" async></script>
export async function GET(req: NextRequest) {
  const pk = req.nextUrl.searchParams.get("pk") || "";
  // The API lives wherever this script was served from, not on the page that
  // embeds it. The script works that out from its own src; the app URL is the
  // fallback for loaders that hide document.currentScript.
  const apiBase = appOrigin();

  const script = `(() => {
  if (window.__danetsWidget) return;
  window.__danetsWidget = true;

  const PK = ${JSON.stringify(pk)};
  const API = (() => { try { const s = document.currentScript; if (s && s.src) return new URL(s.src).origin; } catch(_) {} return ${JSON.stringify(apiBase)}; })();
  // Origin + path only: query strings can carry personal data.
  const pageContext = () => ({ url: location.origin + location.pathname, title: document.title || null });
  const VISITOR_ID = (() => {
    try {
      let v = localStorage.getItem('danets_vid');
      if (!v) { v = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('danets_vid', v); }
      return v;
    } catch(_) { return 'v_' + Math.random().toString(36).slice(2); }
  })();

  // ── Attribution ──────────────────────────────────────────────
  // First touch (danets_ft) is kept forever; the session touch (danets_lt)
  // starts a new session after 30 min of inactivity or when the visitor
  // arrives on a new campaign link. Sites that need consent first embed with
  // data-consent="required" and call window.Danets.consent(true) later.
  const SCRIPT = document.currentScript;
  const CONSENT_REQUIRED = !!(SCRIPT && SCRIPT.getAttribute('data-consent') === 'required');
  const SESSION_MS = 30 * 60 * 1000;
  const CLICK_IDS = ['gclid','gbraid','wbraid','dclid','msclkid','fbclid','li_fat_id','ttclid','twclid'];
  let consented = !CONSENT_REQUIRED;
  let attribution = null;
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} };
  function captureTouch(){
    let q = null; try { q = new URLSearchParams(location.search); } catch(_) {}
    const g = (k) => (q && q.get(k)) || null;
    let clickId = null, clickIdType = null;
    for (const k of CLICK_IDS) { if (g(k)) { clickId = g(k); clickIdType = k; break; } }
    return { sessionId: 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36), source: g('utm_source'), medium: g('utm_medium'), campaign: g('utm_campaign'), term: g('utm_term'), content: g('utm_content'), clickId, clickIdType, referrer: document.referrer || null, landingUrl: location.href, at: new Date().toISOString() };
  }
  function initAttribution(){
    if (!consented) return;
    const now = Date.now();
    const fresh = captureTouch();
    const tagged = !!(fresh.source || fresh.clickId);
    let last = lsGet('danets_lt');
    const isNew = !last || !last.touch || now - (last.ts || 0) > SESSION_MS || (tagged && (fresh.campaign !== last.touch.campaign || fresh.source !== last.touch.source || fresh.clickId !== last.touch.clickId));
    if (isNew) last = { touch: fresh };
    last.ts = now;
    lsSet('danets_lt', last);
    let first = lsGet('danets_ft');
    if (!first || !first.sessionId) { first = last.touch; lsSet('danets_ft', first); }
    attribution = { first, last: last.touch };
    if (isNew) {
      fetch(API + '/api/public/track', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pk: PK, visitorId: VISITOR_ID, attribution }), keepalive: true }).catch(() => {});
    }
  }
  window.Danets = window.Danets || {};
  window.Danets.consent = function(granted){
    consented = granted !== false;
    if (consented) { initAttribution(); startRules(); }
    else { attribution = null; try { localStorage.removeItem('danets_ft'); localStorage.removeItem('danets_lt'); } catch(_) {} }
  };
  initAttribution();

  let cfg = null;
  let session = { id: null, leadIntent: false, leadCaptured: false };
  let messages = [];
  let open = false;
  let typing = false;

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Proactive message matcher (shared with the server tests; src/lib/widget-rules.ts).
  ${RULE_MATCHER_JS}

  // Inject styles
  const style = document.createElement('style');
  style.textContent = \`
  .dn-btn{position:fixed;bottom:20px;right:20px;z-index:99998;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;color:#fff;transition:transform .2s,box-shadow .2s;}
  .dn-btn:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(0,0,0,.3);}
  .dn-btn svg{width:28px;height:28px;}
  .dn-btn .dn-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;border-radius:10px;padding:1px 6px;display:none;}
  .dn-win{position:fixed;bottom:20px;right:20px;z-index:99999;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 48px);background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}
  .dn-win.open{display:flex;animation:dnPop .2s ease;}
  @keyframes dnPop{from{opacity:0;transform:translateY(12px) scale(.98);}to{opacity:1;transform:none;}}
  .dn-head{padding:14px 16px;color:#fff;display:flex;align-items:center;gap:10px;}
  .dn-avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;}
  .dn-head-info{flex:1;min-width:0;}
  .dn-head-name{font-weight:600;font-size:15px;line-height:1.2;}
  .dn-head-sub{font-size:11px;opacity:.85;}
  .dn-close{background:none;border:none;color:#fff;cursor:pointer;opacity:.8;padding:4px;border-radius:6px;}
  .dn-close:hover{opacity:1;background:rgba(255,255,255,.15);}
  .dn-body{flex:1;overflow-y:auto;padding:14px;background:#f7f8fa;display:flex;flex-direction:column;gap:10px;}
  .dn-msg{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;word-wrap:break-word;}
  .dn-msg.bot{align-self:flex-start;background:#fff;border:1px solid #e8eaed;border-bottom-left-radius:4px;}
  .dn-msg.user{align-self:flex-end;color:#fff;border-bottom-right-radius:4px;}
  .dn-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #e8eaed;border-radius:14px;border-bottom-left-radius:4px;}
  .dn-typing span{width:7px;height:7px;border-radius:50%;background:#9aa0a6;animation:dnBlink 1.2s infinite;}
  .dn-typing span:nth-child(2){animation-delay:.2s;}
  .dn-typing span:nth-child(3){animation-delay:.4s;}
  @keyframes dnBlink{0%,60%,100%{opacity:.3;}30%{opacity:1;}}
  .dn-handover{align-self:flex-start;background:#fff;border:1px solid #e8eaed;border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;width:82%;}
  .dn-handover a{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;text-decoration:none;color:#1d4ed8;font-size:13px;font-weight:500;}
  .dn-handover a:hover{background:#eef2ff;}
  .dn-input{padding:10px 12px;border-top:1px solid #e8eaed;background:#fff;display:flex;gap:8px;align-items:flex-end;}
  .dn-input textarea{flex:1;border:1px solid #d8dadf;border-radius:10px;padding:9px 12px;font-size:14px;font-family:inherit;resize:none;max-height:90px;outline:none;line-height:1.4;}
  .dn-input textarea:focus{border-color:#1d4ed8;}
  .dn-send{width:40px;height:40px;border-radius:10px;border:none;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .dn-send:disabled{opacity:.5;cursor:not-allowed;}
  .dn-form{padding:14px;background:#f7f8fa;display:flex;flex-direction:column;gap:8px;}
  .dn-form h4{margin:0 0 4px;font-size:14px;font-weight:600;color:#222;}
  .dn-form input,.dn-form textarea{border:1px solid #d8dadf;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none;}
  .dn-form input:focus,.dn-form textarea:focus{border-color:#1d4ed8;}
  .dn-form button{background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:9px;font-weight:600;font-size:13px;cursor:pointer;}
  .dn-quick{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0;}
  .dn-quick button{background:#eef2ff;color:#1d4ed8;border:1px solid #c7d2fe;border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:500;cursor:pointer;transition:all .15s;font-family:inherit;}
  .dn-quick button:hover{background:#1d4ed8;color:#fff;border-color:#1d4ed8;transform:translateY(-1px);}
  .dn-powered{text-align:center;padding:6px 0 2px;font-size:10px;color:#9aa0a6;}
  .dn-powered a{color:#1d4ed8;text-decoration:none;font-weight:600;}
  .dn-teaser{position:fixed;bottom:92px;right:20px;z-index:99998;max-width:280px;background:#fff;color:#222;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px 34px 12px 14px;font-size:14px;line-height:1.45;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;animation:dnPop .2s ease;}
  .dn-teaser-x{position:absolute;top:6px;right:6px;width:22px;height:22px;border:none;background:none;color:#6b7280;cursor:pointer;border-radius:6px;font-size:16px;line-height:1;}
  .dn-teaser-x:hover{background:#f3f4f6;color:#111;}
  .dn-book{align-self:stretch;background:#fff;border:1px solid #e8eaed;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;}
  .dn-book h4{margin:0;font-size:14px;font-weight:600;color:#222;}
  .dn-book p.dn-intro{margin:0;font-size:13px;color:#555;}
  .dn-book p.dn-err{margin:0;font-size:12px;color:#b91c1c;}
  .dn-book .dn-day{font-size:12px;color:#555;font-weight:600;margin-top:2px;}
  .dn-book .dn-times{display:flex;flex-wrap:wrap;gap:6px;}
  .dn-book .dn-times button{background:#eef2ff;color:#1d4ed8;border:1px solid #c7d2fe;border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer;font-family:inherit;}
  .dn-book .dn-times button:hover{background:#1d4ed8;color:#fff;}
  .dn-book input{border:1px solid #d8dadf;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none;}
  .dn-book input:focus{border-color:#1d4ed8;}
  .dn-book button.dn-primary{background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:9px;font-weight:600;font-size:13px;cursor:pointer;}
  .dn-book button.dn-primary:disabled{opacity:.6;cursor:default;}
  .dn-book a{color:#1d4ed8;font-size:12.5px;}
  .dn-form label.dn-consent{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#444;line-height:1.4;}
  .dn-form label.dn-consent input{margin-top:2px;}
  .dn-form p.dn-intro{margin:0;font-size:13px;color:#555;}
  .dn-form p.dn-err{margin:0;font-size:12px;color:#b91c1c;}
  .dn-input textarea:disabled{background:#f3f4f6;}
  @media (max-width:520px){
    .dn-teaser{bottom:84px;right:16px;max-width:calc(100vw - 32px);}
    .dn-win{width:100vw;height:100vh;max-height:100vh;border-radius:0;bottom:0;right:0;}
    .dn-btn{bottom:16px;right:16px;}
  }
  \`;
  document.head.appendChild(style);

  // Floating button
  const btn = el('button','dn-btn'); btn.type='button'; btn.setAttribute('aria-label','Open chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span class="dn-badge"></span>';
  document.body.appendChild(btn);

  // Chat window
  const win = el('div','dn-win');
  win.innerHTML = \`
    <div class="dn-head">
      <div class="dn-avatar"></div>
      <div class="dn-head-info">
        <div class="dn-head-name">Assistant</div>
        <div class="dn-head-sub"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ade80;margin-right:4px;"></span>Online · Typically replies instantly</div>
      </div>
      <button class="dn-close" aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="dn-body"></div>
    <div class="dn-input">
      <textarea rows="1" placeholder="Type a message..." aria-label="Message"></textarea>
      <button class="dn-send" aria-label="Send"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
    </div>
    <div class="dn-powered">Powered by <a href="https://danetstecpro.com" target="_blank" rel="noopener">Danets AI</a></div>
  \`;
  document.body.appendChild(win);

  const body = win.querySelector('.dn-body');
  const ta = win.querySelector('textarea');
  const sendBtn = win.querySelector('.dn-send');
  const closeBtn = win.querySelector('.dn-close');
  const avatar = win.querySelector('.dn-avatar');
  const headName = win.querySelector('.dn-head-name');

  btn.onclick = () => toggle(true);
  closeBtn.onclick = () => toggle(false);
  function toggle(o){
    open = o; win.classList.toggle('open', o); btn.style.display = o ? 'none' : 'flex';
    if(o){ hideTeaser(); const b = btn.querySelector('.dn-badge'); b.style.display='none'; }
    if(o && messages.length===0 && cfg){
      // A proactive message the visitor saw replaces the welcome message.
      addBot(shownRule ? shownRule.message : cfg.agent.welcomeMessage);
      const replies = shownRule ? shownRule.quickReplies : agentQuickReplies();
      if(needsPreChat()) showPreChat(replies);
    else { showQuickReplies(replies); if (shownRule && shownRule.action === 'booking') showBookingStep(); }
    }
    if(o && !preChatOpen) ta.focus();
  }

  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 90) + 'px';
  });
  ta.addEventListener('keydown', (e) => { if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
  sendBtn.onclick = send;

  function addBot(text){ addMsg(text, 'bot'); }
  function addUser(text){ addMsg(text, 'user'); }
  function agentQuickReplies(){
    if(!cfg || !cfg.agent.quickReplies) return [];
    try { const r = JSON.parse(cfg.agent.quickReplies || '[]'); return Array.isArray(r) ? r : []; } catch(_) { return []; }
  }
  function showQuickReplies(replies){
    if(!Array.isArray(replies) || replies.length === 0) return;
    const existing = document.getElementById('dn-quick');
    if(existing) existing.remove();
    const wrap = el('div','dn-quick'); wrap.id='dn-quick';
    replies.slice(0,6).forEach((q) => {
      const b = el('button'); b.type='button'; b.textContent = q;
      b.onclick = () => { wrap.remove(); ta.value = q; send(); };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }
  function addMsg(text, cls){
    const m = el('div','dn-msg ' + cls);
    m.innerHTML = esc(text).replace(/\\n/g,'<br>');
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    messages.push({role: cls==='user'?'user':'bot', text});
    if(cls!=='user' && !open){ const b = btn.querySelector('.dn-badge'); b.textContent = String(messages.filter(m=>m.role==='bot').length); b.style.display='block'; }
  }
  function showTyping(){ const t = el('div','dn-typing'); t.innerHTML='<span></span><span></span><span></span>'; t.id='dn-typing'; body.appendChild(t); body.scrollTop = body.scrollHeight; }
  function hideTyping(){ const t = document.getElementById('dn-typing'); if(t) t.remove(); }

  function showHandover(h){
    if(!h || (!h.phone && !h.whatsapp && !h.email)) return;
    const c = el('div','dn-handover');
    let html = '';
    if(h.whatsapp){ const n = h.whatsapp.replace(/[^0-9]/g,''); html += '<a href="https://wa.me/'+n+'" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 .9-2.2.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.4.6c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.6-.1l.7-.8c.2-.2.4-.3.7-.2l1.8.9c.3.1.5.2.5.4.1.1.1.6-.1 1.1z"/></svg>WhatsApp</a>'; }
    if(h.phone){ html += '<a href="tel:'+h.phone+'" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>Call: '+esc(h.phone)+'</a>'; }
    if(h.email){ html += '<a href="mailto:'+h.email+'" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>Email</a>'; }
    c.innerHTML = html;
    body.appendChild(c);
    body.scrollTop = body.scrollHeight;
  }

  // ── Storage helpers (functional only: frequency caps and "already asked") ──
  // Nothing is stored while the site still waits for the visitor's consent.
  const store = {
    get: (s, k) => { if (!consented) return null; try { return s.getItem(k); } catch(_) { return null; } },
    set: (s, k, v) => { if (!consented) return; try { s.setItem(k, v); } catch(_) {} },
  };
  const LS = (() => { try { return window.localStorage; } catch(_) { return null; } })();
  const SS = (() => { try { return window.sessionStorage; } catch(_) { return null; } })();

  // ── Pre-chat form ──────────────────────────────────────────────
  let preChatOpen = false;
  const PRECHAT_KEY = 'dn_pc_' + PK;
  function needsPreChat(){ return !!(cfg && cfg.preChatForm && !session.id && !(LS && store.get(LS, PRECHAT_KEY))); }
  function setInputEnabled(on){ ta.disabled = !on; sendBtn.disabled = !on; ta.placeholder = on ? 'Type a message...' : 'Fill in the form above to start'; }
  function showPreChat(replies){
    const pc = cfg.preChatForm;
    preChatOpen = true;
    setInputEnabled(false);
    const f = el('div','dn-form dn-prechat');
    const fieldHtml = (name, type, label, mode) => mode === 'off' ? '' : '<input name="'+name+'" type="'+type+'" autocomplete="'+(name==='company'?'organization':name==='phone'?'tel':name)+'" aria-label="'+esc(label)+'" placeholder="'+esc(label + (mode==='required' ? ' *' : ''))+'" />';
    f.innerHTML = '<h4>'+esc(pc.intro || 'Before we start')+'</h4>'
      + '<input name="name" autocomplete="name" aria-label="Your name" placeholder="Your name *" />'
      + fieldHtml('email','email','Email', pc.fields.email)
      + fieldHtml('phone','tel','Phone', pc.fields.phone)
      + fieldHtml('company','text','Company', pc.fields.company)
      + (pc.consentText ? '<label class="dn-consent"><input type="checkbox" name="consent" /><span>'+esc(pc.consentText)+'</span></label>' : '')
      + '<p class="dn-err" role="alert" style="display:none"></p><button type="button">Start chat</button>';
    body.appendChild(f); body.scrollTop = body.scrollHeight;
    const val = (n) => { const i = f.querySelector('[name='+n+']'); return i ? i.value.trim() : ''; };
    const err = f.querySelector('.dn-err');
    const fail = (msg, field) => { err.textContent = msg; err.style.display='block'; const i = field && f.querySelector('[name='+field+']'); if(i) i.focus(); };
    const submit = f.querySelector('button');
    setTimeout(() => { const n = f.querySelector('[name=name]'); if(n) n.focus(); }, 50);
    submit.onclick = async () => {
      const d = { name: val('name'), email: val('email'), phone: val('phone'), company: val('company') };
      if (d.name.length < 2) return fail('Please enter your name.', 'name');
      for (const k of ['email','phone','company']) { if (pc.fields[k] === 'required' && !d[k]) return fail('Please enter your ' + (k==='phone'?'phone number':k) + '.', k); }
      if (d.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(d.email)) return fail('Please enter a valid email address.', 'email');
      const consentBox = f.querySelector('[name=consent]');
      if (consentBox && !consentBox.checked) return fail('Please tick the box to continue.', 'consent');
      submit.disabled = true; err.style.display='none';
      try {
        const r = await fetch(API + '/api/public/session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pk: PK, visitorId: VISITOR_ID, attribution, page: pageContext(), ruleId: shownRule ? shownRule.id : null, name: d.name, email: d.email, phone: d.phone, company: d.company }) });
        const res = await r.json();
        if (!r.ok) { submit.disabled = false; return fail(res.error || 'Something went wrong. Please try again.', res.field); }
        session.id = res.sessionId;
        if (d.email || d.phone) {
          // The lead exists before the AI replies, so a visitor who leaves still reached the team.
          fetch(API + '/api/public/lead', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pk: PK, sessionId: session.id, visitorId: VISITOR_ID, attribution, name: d.name, email: d.email, phone: d.phone, company: d.company, consentText: consentBox ? pc.consentText : undefined }) })
            .then((lr) => { if (lr.ok) session.leadCaptured = true; }).catch(() => {});
        }
        if (LS) store.set(LS, PRECHAT_KEY, '1');
        known.name = d.name; known.email = d.email; known.phone = d.phone;
        f.remove(); preChatOpen = false; setInputEnabled(true); ta.focus();
        showQuickReplies(replies);
        if (shownRule && shownRule.action === 'booking') showBookingStep();
      } catch(_) { submit.disabled = false; fail('Sorry, we could not connect. Please try again.'); }
    };
  }

  // ── Proactive messages ─────────────────────────────────────────
  let shownRule = null;
  let teaser = null;
  let rulesStarted = false;
  const isMobile = () => { try { return window.innerWidth <= 768 || (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024); } catch(_) { return window.innerWidth <= 768; } };
  const capKey = (r) => 'dn_r_' + r.id;
  function ruleCapped(r){
    if (r.frequency === 'session') return !!(SS && store.get(SS, capKey(r)));
    const at = Number(LS && store.get(LS, capKey(r)));
    if (!at) return false;
    return r.frequency === 'once' ? true : Date.now() - at < 24 * 60 * 60 * 1000;
  }
  function markShown(r){
    if (r.frequency === 'session') { if (SS) store.set(SS, capKey(r), '1'); }
    else if (LS) store.set(LS, capKey(r), String(Date.now()));
  }
  function hideTeaser(){ if (teaser) { teaser.remove(); teaser = null; } }
  function showRule(r){
    // Never interrupt a visitor who is already chatting.
    if (open || messages.length > 0 || shownRule) return;
    shownRule = r;
    markShown(r);
    fetch(API + '/api/public/widget/event', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pk: PK, ruleId: r.id, visitorId: VISITOR_ID, event: 'show' }), keepalive: true }).catch(() => {});
    if (r.action === 'open' && !isMobile()) { toggle(true); return; }
    teaser = el('div','dn-teaser'); teaser.setAttribute('role','button'); teaser.tabIndex = 0;
    teaser.innerHTML = '<span></span><button type="button" class="dn-teaser-x" aria-label="Dismiss">&times;</button>';
    teaser.querySelector('span').textContent = r.message;
    teaser.onclick = (e) => { if (e.target.closest('.dn-teaser-x')) { e.stopPropagation(); hideTeaser(); return; } toggle(true); };
    teaser.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(true); } };
    document.body.appendChild(teaser);
    const b = btn.querySelector('.dn-badge'); b.textContent = '1'; b.style.display = 'block';
  }
  function armTrigger(r){
    const c = r.conditions || {};
    const fire = () => showRule(r);
    if (c.trigger === 'load') { setTimeout(fire, 1500); return; }
    if (c.trigger === 'time') { setTimeout(fire, Math.max(0, Number(c.seconds) || 0) * 1000); return; }
    if (c.trigger === 'scroll') {
      const pct = Number(c.scrollPercent) || 50;
      const check = () => {
        const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight;
        const seen = h <= 0 ? 100 : (window.scrollY / h) * 100;
        if (seen >= pct) { window.removeEventListener('scroll', check); fire(); }
      };
      window.addEventListener('scroll', check, { passive: true });
      setTimeout(check, 1000);
      return;
    }
    if (c.trigger === 'exit') {
      const startedAt = Date.now();
      if (!isMobile()) {
        // Desktop: the pointer leaves through the top of the window (towards the tabs or the back button).
        const onOut = (e) => { if (!e.relatedTarget && e.clientY <= 0 && Date.now() - startedAt > 3000) { document.removeEventListener('mouseout', onOut); fire(); } };
        document.addEventListener('mouseout', onOut);
      } else {
        // Phones: a fast scroll back up after 15 seconds on the page.
        let lastY = window.scrollY, lastT = Date.now();
        const onScroll = () => {
          const y = window.scrollY, t = Date.now();
          if (t - startedAt > 15000 && lastY - y > window.innerHeight * 0.3 && t - lastT < 400) { window.removeEventListener('scroll', onScroll); fire(); return; }
          if (t - lastT > 400) { lastY = y; lastT = t; }
        };
        window.addEventListener('scroll', onScroll, { passive: true });
      }
    }
  }
  function startRules(){
    if (rulesStarted || !consented || !cfg || !Array.isArray(cfg.rules) || cfg.rules.length === 0) return;
    rulesStarted = true;
    const seenKey = 'dn_seen_' + PK;
    const firstSeen = Number(LS && store.get(LS, seenKey));
    if (!firstSeen && LS) store.set(LS, seenKey, String(Date.now()));
    const rule = __dnPickRule(cfg.rules, { path: location.pathname, returning: !!firstSeen && Date.now() - firstSeen > 30 * 60 * 1000, device: isMobile() ? 'mobile' : 'desktop', capped: ruleCapped });
    if (rule) armTrigger(rule);
  }

  // ── Booking step ───────────────────────────────────────────────
  // Offered when the visitor asks to book (the chat API flags it) or a
  // proactive message's action is "booking". Asks only for details the chat
  // doesn't already have.
  let bookingShown = false;
  const known = { name: '', email: '', phone: '' };
  const visitorTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch(_) { return 'UTC'; } };
  function bookingPageUrl(t){
    return API + '/book/' + encodeURIComponent(PK) + '/' + encodeURIComponent(t.slug) + (known.email ? '?name=' + encodeURIComponent(known.name) + '&email=' + encodeURIComponent(known.email) : '');
  }
  function canBook(){ return !!(cfg && cfg.booking && Array.isArray(cfg.booking.types) && cfg.booking.types.length); }
  function showBookingStep(){
    if (!canBook()) return;
    bookingShown = true;
    const old = document.getElementById('dn-book'); if (old) old.remove();
    const card = el('div','dn-book'); card.id = 'dn-book';
    body.appendChild(card);
    const types = cfg.booking.types;
    if (types.length === 1) { loadTimes(card, types[0]); return; }
    card.innerHTML = '<h4>Book a time</h4><div class="dn-times"></div>';
    types.forEach((t) => {
      const b = el('button'); b.type = 'button'; b.textContent = t.name + ' (' + t.durationMin + ' min)';
      b.onclick = () => loadTimes(card, t);
      card.querySelector('.dn-times').appendChild(b);
    });
    body.scrollTop = body.scrollHeight;
  }
  function bookingLink(t, text){ const a = el('a'); a.href = bookingPageUrl(t); a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; return a; }
  async function loadTimes(card, t){
    card.innerHTML = '<h4></h4><p class="dn-intro">Loading times...</p>';
    card.querySelector('h4').textContent = 'Book a ' + t.name;
    const tz = visitorTz();
    const from = new Date(), to = new Date(from.getTime() + 14 * 86400000);
    try {
      const r = await fetch(API + '/api/public/booking/slots?pk=' + encodeURIComponent(PK) + '&type=' + encodeURIComponent(t.slug) + '&from=' + encodeURIComponent(from.toISOString()) + '&to=' + encodeURIComponent(to.toISOString()) + '&tz=' + encodeURIComponent(tz));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      renderTimes(card, t, d.days || [], tz);
    } catch(_) {
      const p = card.querySelector('.dn-intro');
      p.textContent = 'Sorry, we could not load times. ';
      p.appendChild(bookingLink(t, 'Open the booking page'));
    }
  }
  function renderTimes(card, t, days, tz){
    const fmtDay = (iso) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
    const fmtTime = (iso) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    card.innerHTML = '<h4></h4>';
    card.querySelector('h4').textContent = 'Book a ' + t.name + ' (' + t.durationMin + ' min)';
    if (!days.length) { const p = el('p','dn-intro'); p.textContent = 'No free times in the next two weeks.'; card.appendChild(p); }
    days.slice(0, 3).forEach((day) => {
      const lab = el('div','dn-day'); lab.textContent = fmtDay(day.slots[0]); card.appendChild(lab);
      const row = el('div','dn-times');
      day.slots.slice(0, 6).forEach((s) => {
        const b = el('button'); b.type = 'button'; b.textContent = fmtTime(s);
        b.onclick = () => pickTime(card, t, s, tz, fmtDay(s) + ', ' + fmtTime(s));
        row.appendChild(b);
      });
      card.appendChild(row);
    });
    card.appendChild(bookingLink(t, days.length ? 'More times' : 'See later dates'));
    body.scrollTop = body.scrollHeight;
  }
  function pickTime(card, t, start, tz, label){
    card.innerHTML = '<h4></h4><p class="dn-intro"></p>';
    card.querySelector('h4').textContent = t.name;
    card.querySelector('.dn-intro').textContent = label + ' (' + tz + ')';
    const fields = [];
    if (!known.name) fields.push(['name', 'text', 'Your name *', 'name']);
    if (!known.email) fields.push(['email', 'email', 'Email *', 'email']);
    if (!known.phone) fields.push(['phone', 'tel', 'Phone (optional)', 'tel']);
    fields.forEach((f) => { const i = el('input'); i.name = f[0]; i.type = f[1]; i.placeholder = f[2]; i.autocomplete = f[3]; i.setAttribute('aria-label', f[2]); card.appendChild(i); });
    const qs = Array.isArray(t.questions) ? t.questions : [];
    qs.forEach((q) => { const i = el('input'); i.type = 'text'; i.maxLength = 1000; i.setAttribute('data-q', q.key); i.placeholder = q.label + ' *'; i.setAttribute('aria-label', q.label); card.appendChild(i); });
    const err = el('p','dn-err'); err.setAttribute('role','alert'); err.style.display = 'none'; card.appendChild(err);
    const ok = el('button','dn-primary'); ok.type = 'button'; ok.textContent = 'Confirm booking';
    if (cfg && cfg.agent && cfg.agent.brandColor) ok.style.background = cfg.agent.brandColor;
    card.appendChild(ok);
    const back = el('a'); back.href = '#'; back.textContent = 'Choose another time';
    back.onclick = (e) => { e.preventDefault(); loadTimes(card, t); };
    card.appendChild(back);
    body.scrollTop = body.scrollHeight;
    const first = card.querySelector('input'); if (first) setTimeout(() => first.focus(), 50);
    const val = (n) => { const i = card.querySelector('[name=' + n + ']'); return i ? i.value.trim() : known[n]; };
    ok.onclick = async () => {
      const name = val('name'), email = val('email'), phone = val('phone');
      const fail = (m) => { err.textContent = m; err.style.display = 'block'; };
      if (!name || name.length < 2) return fail('Please enter your name.');
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email || '')) return fail('Please enter a valid email address.');
      const answers = {};
      for (const q of qs) {
        const qi = card.querySelector('[data-q="' + q.key + '"]');
        const v = qi ? qi.value.trim() : '';
        if (!v) { if (qi) qi.focus(); return fail('Please answer: ' + q.label); }
        answers[q.key] = v;
      }
      ok.disabled = true; err.style.display = 'none';
      try {
        const r = await fetch(API + '/api/public/bookings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pk: PK, type: t.slug, start, name, email, phone, answers, timezone: tz, source: 'widget', sessionId: session.id, visitorId: VISITOR_ID, attribution }) });
        const d = await r.json();
        if (r.status === 409) { addBot(d.error || 'Sorry, that time was just taken.'); loadTimes(card, t); return; }
        if (!r.ok) { ok.disabled = false; fail(d.error || 'Something went wrong. Please try again.'); return; }
        known.name = name; known.email = email; if (phone) known.phone = phone;
        session.leadCaptured = true;
        card.remove();
        addBot('You are booked for ' + label + '. A confirmation with a calendar invite is on its way to ' + email + '.');
      } catch(_) { ok.disabled = false; fail('Sorry, we could not connect. Please try again.'); }
    };
  }

  function showLeadForm(){
    if(session.leadCaptured) return;
    const f = el('div','dn-form');
    f.innerHTML = '<h4>Let our team reach you</h4><input name="name" placeholder="Your name *" /><input name="phone" placeholder="Phone" /><input name="email" placeholder="Email" /><input name="service" placeholder="Service interested in" /><button type="button">Submit</button>';
    body.appendChild(f); body.scrollTop = body.scrollHeight;
    f.querySelector('button').onclick = async () => {
      const name = f.querySelector('[name=name]').value.trim();
      if(!name){ f.querySelector('[name=name]').focus(); return; }
      const data = { pk: PK, sessionId: session.id, visitorId: VISITOR_ID, attribution, name, phone: f.querySelector('[name=phone]').value, email: f.querySelector('[name=email]').value, service: f.querySelector('[name=service]').value };
      try{
        const r2 = await fetch(API + '/api/public/lead', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
        const d = await r2.json();
        if(!r2.ok) throw new Error(d.error||'Failed');
        session.leadCaptured = true;
        known.name = name; known.email = data.email.trim(); known.phone = data.phone.trim();
        f.remove();
        addBot('Thank you, ' + name + '! Our team will reach out to you shortly.');
      }catch(e){ addBot('Sorry, something went wrong. Please try again or contact us directly.'); }
    };
  }

  async function send(){
    const text = ta.value.trim();
    if(!text || typing || preChatOpen) return;
    ta.value=''; ta.style.height='auto';
    addUser(text);
    sendBtn.disabled = true;
    showTyping();
    typing = true;
    try{
      const r = await fetch(API + '/api/public/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pk: PK, sessionId: session.id, visitorId: VISITOR_ID, attribution: session.id ? undefined : attribution, page: pageContext(), ruleId: session.id ? undefined : (shownRule ? shownRule.id : undefined), message: text }) });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error||'Failed');
      hideTyping();
      if(d.sessionId) session.id = d.sessionId;
      addBot(d.reply);
      if(d.booking && canBook() && !bookingShown){ setTimeout(showBookingStep, 600); }
      else if(d.leadIntent && cfg && cfg.agent.leadCaptureEnabled){ session.leadIntent = true; setTimeout(showLeadForm, 600); }
      if(d.handover) showHandover(d.handover);
    }catch(e){
      hideTyping();
      addBot('Sorry, I could not connect right now. Please try again in a moment.');
    }finally{
      typing = false;
      sendBtn.disabled = false;
    }
  }

  async function init(){
    try{
      const r = await fetch(API + '/api/public/widget?pk=' + encodeURIComponent(PK));
      cfg = await r.json();
      if(!cfg || cfg.error){ btn.style.display='none'; return; }
      const a = cfg.agent;
      const color = a.brandColor || '#1d4ed8';
      btn.style.background = color;
      win.querySelector('.dn-head').style.background = color;
      sendBtn.style.background = color;
      headName.textContent = a.botName || 'Assistant';
      avatar.textContent = (a.botName||'A').charAt(0).toUpperCase();
      startRules();
    }catch(e){ console.warn('Danets widget init failed', e); }
  }

  init();
})();`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

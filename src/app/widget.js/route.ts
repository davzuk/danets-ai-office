import { NextRequest } from "next/server";

// Serves an embeddable, self-contained JavaScript widget.
// Usage: <script src="/widget.js?pk=BUSINESS_PUBLIC_KEY" async></script>
export async function GET(req: NextRequest) {
  const pk = req.nextUrl.searchParams.get("pk") || "";
  const apiBase = ""; // relative — same origin via gateway

  const script = `(() => {
  if (window.__danetsWidget) return;
  window.__danetsWidget = true;

  const PK = ${JSON.stringify(pk)};
  const API = ${JSON.stringify(apiBase)};
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
    if (consented) { initAttribution(); }
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
  @media (max-width:520px){
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
  function toggle(o){ open = o; win.classList.toggle('open', o); btn.style.display = o ? 'none' : 'flex'; if(o && messages.length===0 && cfg){ addBot(cfg.agent.welcomeMessage); showQuickReplies(); } if(o) ta.focus(); }

  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 90) + 'px';
  });
  ta.addEventListener('keydown', (e) => { if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
  sendBtn.onclick = send;

  function addBot(text){ addMsg(text, 'bot'); }
  function addUser(text){ addMsg(text, 'user'); }
  function showQuickReplies(){
    if(!cfg || !cfg.agent.quickReplies) return;
    let replies = [];
    try { replies = JSON.parse(cfg.agent.quickReplies || '[]'); } catch(_) { return; }
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
        f.remove();
        addBot('Thank you, ' + esc(name) + '! Our team will reach out to you shortly.');
      }catch(e){ addBot('Sorry, something went wrong. Please try again or contact us directly.'); }
    };
  }

  async function send(){
    const text = ta.value.trim();
    if(!text || typing) return;
    ta.value=''; ta.style.height='auto';
    addUser(text);
    sendBtn.disabled = true;
    showTyping();
    typing = true;
    try{
      const r = await fetch(API + '/api/public/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pk: PK, sessionId: session.id, visitorId: VISITOR_ID, attribution: session.id ? undefined : attribution, message: text }) });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error||'Failed');
      hideTyping();
      if(d.sessionId) session.id = d.sessionId;
      addBot(d.reply);
      if(d.leadIntent && cfg && cfg.agent.leadCaptureEnabled){ session.leadIntent = true; setTimeout(showLeadForm, 600); }
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

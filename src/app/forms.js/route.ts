import { appOrigin } from "@/lib/public-cors";

// Embeddable lead forms (Phase 2, workstream S).
// Usage on any website:
//   <div data-danets-form="FORM_ID"></div>
//   <script src="https://app.example.com/forms.js" async></script>
// widget.js loads this script by itself when the page has a form. Hidden
// fields can be filled with data-<key>="value" on the div, or from the
// page's query string. A lead magnet uses <div data-danets-magnet="MAGNET_ID">:
// its title and points are shown above the gate form, and the download
// link is emailed after submitting. Everything is built with DOM APIs (no innerHTML), so
// tenant-entered labels can't inject markup into the host page.
export async function GET() {
  const apiBase = appOrigin();
  const script = `(() => {
  if (window.__danetsForms) { window.__danetsForms.scan(); return; }
  const API = (() => { try { const s = document.currentScript; if (s && s.src) return new URL(s.src).origin; } catch(_) {} return ${JSON.stringify(apiBase)}; })();
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(_) { return null; } };
  const visitorId = () => { try { return localStorage.getItem('danets_vid'); } catch(_) { return null; } };
  // Attribution the chat widget stored (it honours data-consent itself).
  const attribution = () => { const f = lsGet('danets_ft'), l = lsGet('danets_lt'); return f && l && l.touch ? { first: f, last: l.touch } : undefined; };

  const css = '.dnf{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:560px}'
    + '.dnf *{box-sizing:border-box}.dnf-f{margin:0 0 14px}.dnf-l{display:block;font-weight:600;margin:0 0 6px}.dnf-r{color:#dc2626}'
    + '.dnf input[type=text],.dnf input[type=email],.dnf input[type=tel],.dnf input[type=date],.dnf select,.dnf textarea{width:100%;padding:9px 11px;border:1px solid #d1d5db;border-radius:8px;font:inherit;background:#fff;color:inherit}'
    + '.dnf textarea{min-height:96px;resize:vertical}.dnf-o{display:flex;align-items:center;gap:8px;margin:4px 0;font-weight:400}'
    + '.dnf-c{display:flex;align-items:flex-start;gap:8px;color:#4b5563;margin:0 0 14px}.dnf-e{color:#dc2626;margin:0 0 12px}'
    + '.dnf-b{width:100%;border:0;border-radius:8px;padding:11px 16px;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}.dnf-b:disabled{opacity:.7;cursor:default}'
    + '.dnf-ok{padding:24px 8px;text-align:center;font-size:15px}.dnf-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}'
    + '.dnf-m h3{font:700 20px/1.3 system-ui,sans-serif;margin:0 0 8px}.dnf-m p{margin:0 0 10px;color:#4b5563}.dnf-m ul{margin:0 0 16px;padding:0;list-style:none}.dnf-m li{display:flex;gap:8px;margin:0 0 6px}.dnf-m li:before{content:"✓";font-weight:700;color:var(--dnf-accent)}';
  function addStyle(){ if (document.getElementById('dnf-style')) return; const s = document.createElement('style'); s.id = 'dnf-style'; s.textContent = css; document.head.appendChild(s); }
  function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render(host, form, magnet){
    const startedAt = Date.now();
    const accent = form.brandColor || '#1d4ed8';
    let q = null; try { q = new URLSearchParams(location.search); } catch(_) {}
    const f = el('form', 'dnf'); f.noValidate = true;
    let head = null;
    if (magnet) {
      head = el('div', 'dnf dnf-m'); head.style.setProperty('--dnf-accent', accent);
      head.appendChild(el('h3', null, magnet.title));
      if (magnet.description) head.appendChild(el('p', null, magnet.description));
      if (magnet.bullets && magnet.bullets.length) { const ul = el('ul'); magnet.bullets.forEach((b) => ul.appendChild(el('li', null, b))); head.appendChild(ul); }
    }
    const inputs = {};
    form.fields.forEach((fd) => {
      if (fd.type === 'hidden') return;
      const wrap = el('div', 'dnf-f');
      const id = 'dnf-' + form.id + '-' + fd.key;
      const lab = el(fd.type === 'radio' || fd.type === 'checkbox' ? 'div' : 'label', 'dnf-l', fd.label);
      if (lab.tagName === 'LABEL') lab.htmlFor = id;
      if (fd.required) lab.appendChild(el('span', 'dnf-r', ' *'));
      wrap.appendChild(lab);
      if (fd.type === 'radio' || fd.type === 'checkbox') {
        const boxes = [];
        (fd.options || []).forEach((o) => {
          const row = el('label', 'dnf-o'); const i = document.createElement('input');
          i.type = fd.type; i.name = id; i.value = o; i.style.accentColor = accent; boxes.push(i);
          row.appendChild(i); row.appendChild(document.createTextNode(o)); wrap.appendChild(row);
        });
        inputs[fd.key] = () => boxes.filter((b) => b.checked).map((b) => b.value).join(', ');
      } else {
        let i;
        if (fd.type === 'textarea') { i = document.createElement('textarea'); i.maxLength = 4000; }
        else if (fd.type === 'select') {
          i = document.createElement('select');
          i.appendChild(new Option(fd.placeholder || 'Choose…', ''));
          (fd.options || []).forEach((o) => i.appendChild(new Option(o, o)));
        } else {
          i = document.createElement('input'); i.maxLength = 500;
          i.type = fd.type === 'phone' ? 'tel' : fd.type === 'email' ? 'email' : fd.type === 'date' ? 'date' : 'text';
          if (fd.type === 'email') i.autocomplete = 'email'; if (fd.type === 'phone') i.autocomplete = 'tel';
        }
        i.id = id; if (fd.placeholder && fd.type !== 'select') i.placeholder = fd.placeholder;
        wrap.appendChild(i); inputs[fd.key] = () => i.value;
      }
      f.appendChild(wrap);
    });
    const hp = el('div', 'dnf-hp'); hp.setAttribute('aria-hidden', 'true');
    const hpi = document.createElement('input'); hpi.type = 'text'; hpi.name = 'website'; hpi.tabIndex = -1; hpi.autocomplete = 'off';
    hp.appendChild(hpi); f.appendChild(hp);
    let consentBox = null;
    if (form.consentText) {
      const c = el('label', 'dnf-c'); consentBox = document.createElement('input'); consentBox.type = 'checkbox'; consentBox.style.accentColor = accent;
      c.appendChild(consentBox); c.appendChild(el('span', null, form.consentText)); f.appendChild(c);
    }
    const err = el('div', 'dnf-e'); err.setAttribute('role', 'alert'); err.style.display = 'none'; f.appendChild(err);
    const btn = el('button', 'dnf-b', form.submitLabel || 'Submit'); btn.type = 'submit'; btn.style.background = accent; f.appendChild(btn);
    const fail = (m) => { err.textContent = m; err.style.display = 'block'; };

    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.style.display = 'none';
      const answers = {};
      for (const fd of form.fields) {
        if (fd.type === 'hidden') { answers[fd.key] = host.getAttribute('data-' + fd.key.replace(/_/g, '-')) || (q && q.get(fd.key)) || ''; continue; }
        const v = inputs[fd.key] ? String(inputs[fd.key]()).trim() : '';
        if (fd.required && !v) return fail(fd.label + ' is required.');
        answers[fd.key] = v;
      }
      if (consentBox && !consentBox.checked) return fail('Please tick the consent box to continue.');
      btn.disabled = true;
      try {
        const r = await fetch(API + '/api/public/forms/' + encodeURIComponent(form.id), { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers, website: hpi.value, startedAt, consent: !!(consentBox && consentBox.checked), pageUrl: location.origin + location.pathname, visitorId: visitorId(), attribution: attribution(), magnetId: magnet ? magnet.id : undefined }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.');
        if (!magnet && form.redirectUrl && /^https?:\\/\\//.test(form.redirectUrl)) { location.assign(form.redirectUrl); return; }
        const ok = el('div', 'dnf dnf-ok', magnet ? 'Thanks! Check your inbox: we have emailed you the download link.' : form.successMessage); ok.setAttribute('role', 'status');
        f.replaceWith(ok);
      } catch (x) { fail(x && x.message ? x.message : 'Something went wrong. Try again.'); btn.disabled = false; }
    });
    host.textContent = ''; if (head) host.appendChild(head); host.appendChild(f);
  }

  async function mount(host){
    const id = host.getAttribute('data-danets-form');
    if (!id || host.__dnf) return; host.__dnf = true;
    try {
      const r = await fetch(API + '/api/public/forms/' + encodeURIComponent(id));
      const d = await r.json();
      if (!r.ok || !d.form) { console.warn('Danets form ' + id + ': ' + (d.error || r.status)); return; }
      addStyle(); render(host, d.form);
    } catch (e) { console.warn('Danets form failed to load', e); }
  }
  async function mountMagnet(host){
    const id = host.getAttribute('data-danets-magnet');
    if (!id || host.__dnf) return; host.__dnf = true;
    try {
      const r = await fetch(API + '/api/public/magnets/' + encodeURIComponent(id));
      const d = await r.json();
      if (!r.ok || !d.magnet) { console.warn('Danets lead magnet ' + id + ': ' + (d.error || r.status)); return; }
      addStyle(); render(host, d.magnet.form, d.magnet);
    } catch (e) { console.warn('Danets lead magnet failed to load', e); }
  }
  function scan(){ document.querySelectorAll('[data-danets-form]').forEach(mount); document.querySelectorAll('[data-danets-magnet]').forEach(mountMagnet); }
  window.__danetsForms = { scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * stats-view.js
 * Renders statistics panel from result text.
 */
(() => {
  const App = (window.App = window.App || {});

  function topN(map, n = 15) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  }

  function render(text) {
    const container = document.getElementById('statsContent');
    if (!container) return;

    if (!text || !text.trim()) {
      container.innerHTML = '<div class="stats-placeholder">no results to analyse</div>';
      return;
    }

    const lines = text.split('\n').filter(l => l.trim());
    const total = lines.length;

    // ── domain extraction ─────────────────────────────────
    const domainMap  = new Map();
    const tldMap     = new Map();
    const passLenMap = new Map();
    let   emailCount = 0;
    let   urlCount   = 0;

    const emailRe = /^[^\s@:]+@([^\s@:]+\.[^\s@:]+)/;
    const urlRe   = /https?:\/\/([^\s/:?#]+)/i;

    for (const line of lines) {
      // URL domains
      const urlM = line.match(urlRe);
      if (urlM) {
        urlCount++;
        const domain = urlM[1].toLowerCase();
        domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
        const parts = domain.split('.');
        const tld   = parts.slice(-2).join('.');
        tldMap.set(tld, (tldMap.get(tld) || 0) + 1);
      }

      // email domains from login part (url:email:pass or email:pass)
      const parts   = line.split(':');
      const loginIdx = parts.length >= 3 ? 1 : 0;
      const loginStr = parts[loginIdx] || '';
      const emailM  = loginStr.match(emailRe);
      if (emailM) {
        emailCount++;
        const dom = emailM[1].toLowerCase();
        domainMap.set(dom, (domainMap.get(dom) || 0) + 1);
        const tld = dom.split('.').slice(-2).join('.');
        tldMap.set(tld, (tldMap.get(tld) || 0) + 1);
      }

      // password length distribution
      if (parts.length >= 2) {
        const pass = parts[parts.length - 1];
        const bucket = pass.length <= 6  ? '≤6'
                     : pass.length <= 8  ? '7–8'
                     : pass.length <= 12 ? '9–12'
                     : pass.length <= 16 ? '13–16'
                     :                     '17+';
        passLenMap.set(bucket, (passLenMap.get(bucket) || 0) + 1);
      }
    }

    // ── build cards ───────────────────────────────────────
    container.innerHTML = '';

    // Summary card
    appendCard(container, 'summary', [
      ['total lines', total.toLocaleString()],
      ['email lines', emailCount.toLocaleString()],
      ['url lines',   urlCount.toLocaleString()],
      ['unique (est)', new Set(lines.map(l => l.trim())).size.toLocaleString()],
    ]);

    // Top domains
    if (domainMap.size > 0) {
      appendBarCard(container, 'top domains', topN(domainMap));
    }

    // Top TLDs
    if (tldMap.size > 0) {
      appendBarCard(container, 'top mail domains', topN(tldMap, 10));
    }

    // Password length
    if (passLenMap.size > 0) {
      const bucketOrder = ['≤6', '7–8', '9–12', '13–16', '17+'];
      const sorted = bucketOrder
        .filter(k => passLenMap.has(k))
        .map(k => [k, passLenMap.get(k)]);
      appendBarCard(container, 'password length', sorted);
    }
  }

  function appendCard(container, title, rows) {
    const card = document.createElement('div');
    card.className = 'stats-card-block';

    const h = document.createElement('div');
    h.className = 'stats-card-title';
    h.textContent = title;
    card.appendChild(h);

    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'stats-card-row';
      row.innerHTML = `<span class="stats-card-key">${k}</span><span class="stats-card-val">${v}</span>`;
      card.appendChild(row);
    }
    container.appendChild(card);
  }

  function appendBarCard(container, title, entries) {
    if (!entries.length) return;
    const max = entries[0][1];
    const card = document.createElement('div');
    card.className = 'stats-card-block';

    const h = document.createElement('div');
    h.className = 'stats-card-title';
    h.textContent = title;
    card.appendChild(h);

    for (const [k, v] of entries) {
      const row = document.createElement('div');
      row.className = 'stats-card-row';
      row.innerHTML = `<span class="stats-card-key" title="${k}">${k}</span><span class="stats-card-val">${v.toLocaleString()}</span>`;
      card.appendChild(row);

      const bar = document.createElement('div');
      bar.className = 'stats-card-bar';
      bar.style.width = `${Math.round((v / max) * 100)}%`;
      card.appendChild(bar);
    }
    container.appendChild(card);
  }

  App.statsView = { render };
})();

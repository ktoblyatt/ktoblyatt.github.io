/* ── Results Analysis ─────────────────────────────────
   Shown when user clicks "Analyze" in results panel.
   Extracts: top domains, top passwords, line count,
   unique count, email ratio, login:pass ratio.
   ───────────────────────────────────────────────────── */
(() => {
  const App = (window.App = window.App || {});

  function topN(map, n) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  function analyze(text) {
    if (!text || !text.trim()) return null;

    const lines = text.split('\n').filter(l => l.trim());
    const total = lines.length;
    const unique = new Set(lines).size;

    // Domain extraction from email:pass or url:login:pass lines
    const domainMap = new Map();
    const passMap   = new Map();
    const tldMap    = new Map();
    let emailCount  = 0;

    const emailRe  = /([a-zA-Z0-9._%+\-]+@([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}))/;
    const domainRe = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9\-]+\.[a-zA-Z]{2,})(?:[\/:?]|$)/;

    for (const line of lines) {
      // password: last segment after last colon
      const colonIdx = line.lastIndexOf(':');
      if (colonIdx !== -1 && colonIdx < line.length - 1) {
        const pass = line.slice(colonIdx + 1).trim();
        if (pass && pass.length > 0 && pass.length <= 64) {
          passMap.set(pass, (passMap.get(pass) || 0) + 1);
        }
      }

      // email
      const em = line.match(emailRe);
      if (em) {
        emailCount++;
        const domain = em[2].toLowerCase();
        domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
        // TLD
        const parts = domain.split('.');
        const tld = parts[parts.length - 1];
        tldMap.set(tld, (tldMap.get(tld) || 0) + 1);
      } else {
        // try URL domain
        const dm = line.match(domainRe);
        if (dm) {
          const domain = dm[1].toLowerCase();
          domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
        }
      }
    }

    return {
      total,
      unique,
      duplicates: total - unique,
      emailCount,
      topDomains:   topN(domainMap, 8),
      topPasswords: topN(passMap, 8),
      topTLDs:      topN(tldMap, 6),
    };
  }

  function renderSection(title, items, maxVal, suffix = '') {
    if (!items.length) return '';
    const rows = items.map(([key, val]) => {
      const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
      return `
        <div class="stats-item">
          <span class="stats-item-key" title="${key}">${key}</span>
          <span class="stats-item-val">${val.toLocaleString()}${suffix}</span>
        </div>
        <div class="stats-bar-wrap">
          <div class="stats-bar-bg"><div class="stats-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
    return `<div class="stats-section"><div class="stats-section-title">${title}</div>${rows}</div>`;
  }

  function show(text) {
    const refs = App.refs;
    if (!refs || !refs.statsPanel) return;
    const data = analyze(text);
    if (!data) return;

    const overview = `
      <div class="stats-section">
        <div class="stats-section-title">Overview</div>
        <div class="stats-item"><span class="stats-item-key">Total lines</span><span class="stats-item-val">${data.total.toLocaleString()}</span></div>
        <div class="stats-item"><span class="stats-item-key">Unique lines</span><span class="stats-item-val">${data.unique.toLocaleString()}</span></div>
        <div class="stats-item"><span class="stats-item-key">Duplicates</span><span class="stats-item-val">${data.duplicates.toLocaleString()}</span></div>
        <div class="stats-item"><span class="stats-item-key">Emails found</span><span class="stats-item-val">${data.emailCount.toLocaleString()}</span></div>
      </div>`;

    const maxDom  = data.topDomains[0]?.[1]   || 1;
    const maxPass = data.topPasswords[0]?.[1]  || 1;
    const maxTld  = data.topTLDs[0]?.[1]       || 1;

    refs.statsGrid.innerHTML =
      overview +
      renderSection('Top domains',   data.topDomains,   maxDom) +
      renderSection('Top passwords', data.topPasswords, maxPass) +
      renderSection('Top TLDs',      data.topTLDs,      maxTld);

    refs.statsPanel.classList.add('visible');
  }

  App.stats = { analyze, show };
})();

/* ── NOT filter post-processing ──────────────────────
   Applied on-demand after search or when typing in
   the exclude field while results are visible.
   ───────────────────────────────────────────────────── */
(() => {
  const App = (window.App = window.App || {});

  function applyNotFilter() {
    const refs = App.refs;
    const state = App.state;
    if (!refs || !state) return;
    if (state.searching) return;
    if (!refs.notFilter || !refs.notFilter.checked) return;

    const raw = (refs.notFilterInput.value || '').trim();
    if (!raw) return;

    const ci = !refs.caseSensitiveEl?.checked;
    const terms = [];
    const regexes = [];

    for (const part of raw.split('|').map(s => s.trim()).filter(Boolean)) {
      const rm = part.match(/^\/(.+)\/([gimsuy]*)$/);
      if (rm) {
        try { regexes.push(new RegExp(rm[1], rm[2])); }
        catch (_) { terms.push(part); }
      } else {
        terms.push(ci ? part.toLowerCase() : part);
      }
    }

    if (!terms.length && !regexes.length) return;

    const source = state.originalResults || refs.bigInput.value;
    if (!source) return;

    const filtered = source.split('\n').filter(line => {
      if (!line.trim()) return true;
      const haystack = ci ? line.toLowerCase() : line;
      for (const t of terms)  if (haystack.includes(t)) return false;
      for (const re of regexes) if (re.test(line)) return false;
      return true;
    }).join('\n');

    refs.bigInput.value = filtered;
    if (App.ui) {
      App.ui.updateLineNumbers();
      App.ui.updateDownloadState();
    }
    if (App.filters) App.filters.updateLinesFoundDisplay();
  }

  // Live update as user types exclude terms
  document.addEventListener('DOMContentLoaded', () => {});
  const attachLater = () => {
    const refs = App.refs;
    if (!refs) return;
    if (refs.notFilterInput) {
      let debounce;
      refs.notFilterInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(applyNotFilter, 400);
      });
    }
    if (refs.notFilter) {
      refs.notFilter.addEventListener('change', () => {
        if (!refs.notFilter.checked) {
          // Restore original if filter was turned off
          const state = App.state;
          if (state && state.originalResults !== undefined) {
            refs.bigInput.value = state.originalResults;
            if (App.ui) App.ui.updateLineNumbers();
            if (App.filters) App.filters.updateLinesFoundDisplay();
          }
        }
      });
    }
  };

  // Attach after state.js initializes refs
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachLater);
  } else {
    setTimeout(attachLater, 0);
  }

  App.notFilter = { apply: applyNotFilter };
})();

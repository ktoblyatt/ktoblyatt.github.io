(() => {
  const App = (window.App = window.App || {});

  const countNonEmpty = text => {
    let c = 0;
    for (const l of text.split('\n')) if (l.trim()) c++;
    return c;
  };

  const updateLinesFoundDisplay = () => {
    const { refs, state } = App;
    if (!refs?.linesFoundEl) return;
    if (!refs.bigInput.value.trim()) { refs.linesFoundEl.textContent = '—'; return; }
    const filterActive = refs.loginpass?.checked || refs.mailpass?.checked;
    if (filterActive) {
      const total    = countNonEmpty(state.originalResults || refs.bigInput.value);
      const filtered = countNonEmpty(refs.bigInput.value);
      refs.linesFoundEl.textContent = `${total} (${filtered})`;
    } else {
      refs.linesFoundEl.textContent = String(countNonEmpty(refs.bigInput.value));
    }
  };

  const handleEditorInput = () => {
    const { refs, state } = App;
    if (!refs || !state) return;
    if (!refs.loginpass.checked && !refs.mailpass.checked) state.originalResults = refs.bigInput.value;
    if (App.ui) { App.ui.updateLineNumbers(); App.ui.updateDownloadState(); }
    updateLinesFoundDisplay();
  };

  const formatLine = line => {
    const m = line.match(/.*:([^:]+):([^:]+)$/);
    return m ? m[1] + ':' + m[2] : null;
  };

  const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const filterLoginPass = text =>
    text.split('\n').map(formatLine).filter(v => v !== null).join('\n');

  const filterMailPass = text =>
    text.split('\n').map(l => {
      const m = l.match(/.*:([^:]+):([^:]+)$/);
      return m && isEmail(m[1]) ? `${m[1]}:${m[2]}` : null;
    }).filter(v => v !== null).join('\n');

  const dedupeLines = text => {
    const seen = new Set(), out = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out.join('\n');
  };

  const applyFilters = () => {
    const { refs, state } = App;
    if (!refs || !state) return;
    const anyFilter = refs.loginpass?.checked || refs.mailpass?.checked;
    if (anyFilter) {
      if (!state.originalResults) state.originalResults = refs.bigInput.value;
      let filtered = state.originalResults;
      if (refs.mailpass?.checked)       filtered = filterMailPass(filtered);
      else if (refs.loginpass?.checked) filtered = filterLoginPass(filtered);
      filtered = dedupeLines(filtered);
      refs.bigInput.value = filtered;
    } else {
      if (state.originalResults !== '') refs.bigInput.value = state.originalResults;
    }
    if (App.ui) { App.ui.updateLineNumbers(); App.ui.updateDownloadState(); }
    updateLinesFoundDisplay();
  };

  App.filters = {
    countNonEmpty, updateLinesFoundDisplay, handleEditorInput,
    formatLine, filterLoginPass, isEmail, filterMailPass, dedupeLines, applyFilters,
  };
})();

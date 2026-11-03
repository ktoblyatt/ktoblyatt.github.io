(() => {
  const App = (window.App = window.App || {});
  const MAX_HISTORY = 100;

  const normalize = q => q.trim().replace(/\s+/g, ' ');

  const read = () => {
    try {
      const arr = JSON.parse(localStorage.getItem('ulpr_history') || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };

  const write = arr => {
    try { localStorage.setItem('ulpr_history', JSON.stringify(arr.slice(-MAX_HISTORY))); }
    catch (_) {}
  };

  const saveSearchQuery = () => {
    const refs = App.refs;
    if (!refs?.requestInput) return;
    const raw = refs.requestInput.value.trim();
    if (!raw) return;
    const arr = read();
    const norm = normalize(raw);
    if (arr.some(x => normalize(String(x)) === norm)) return;
    arr.push(raw);
    write(arr);
  };

  const removeFromHistory = value => {
    const norm = normalize(String(value || ''));
    write(read().filter(x => normalize(String(x)) !== norm));
  };

  const close = () => {
    const refs = App.refs;
    if (!refs) return;
    refs.historyDropdown.classList.remove('open');
    if (App.state) App.state.historyOpen = false;
  };

  const open = (filter = '') => {
    const refs = App.refs;
    const state = App.state;
    if (!refs || !state || state.searching) return;
    state.currentHistoryFilter = String(filter || '');
    const data = read();
    const q = state.currentHistoryFilter.trim().toLowerCase();
    let list = (q ? data.filter(x => String(x).toLowerCase().includes(q)) : data)
      .slice().reverse().slice(0, 50);
    if (!list.length) { close(); return; }

    refs.historyDropdown.innerHTML = '';
    for (const item of list) {
      const div  = document.createElement('div');
      div.className = 'history-item';
      div.title = item;

      const text = document.createElement('div');
      text.className = 'history-item-text';
      text.textContent = item;

      const btn = document.createElement('div');
      btn.className = 'history-item-remove';
      btn.title = 'Remove';
      btn.textContent = '×';

      div.addEventListener('mousedown', e => {
        if (e.target === btn) return;
        e.preventDefault();
        refs.requestInput.value = item;
        if (App.ui) App.ui.updateSearchState();
      });
      div.addEventListener('click', e => {
        if (e.target === btn) return;
        close();
        refs.requestInput.focus();
      });
      btn.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        removeFromHistory(item);
        open(state.currentHistoryFilter);
      });
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

      div.append(text, btn);
      refs.historyDropdown.appendChild(div);
    }
    refs.historyDropdown.classList.add('open');
    state.historyOpen = true;
  };

  App.history = { saveSearchQuery, removeFromHistory, openDropdown: open, closeDropdown: close };
})();

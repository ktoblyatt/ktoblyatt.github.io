(() => {
  const App = (window.App = window.App || {});
  App.downloadResults = () => {
    const refs = App.refs || {};
    if (!refs.downloadResultsButton || refs.downloadResultsButton.disabled) return;
    const req  = (refs.requestInput?.value || '').trim();
    const safe = req.replace(/[^a-zA-Z0-9@._-]+/g, '_');
    const name = safe ? `result_${safe}.txt` : 'result.txt';
    const blob = new Blob([refs.bigInput?.value || ''], { type: 'text/plain;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: name,
    });
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  };
})();

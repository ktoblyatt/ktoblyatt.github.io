/**
 * worker-bridge.js
 * Thin factory wrapper — keeps worker management out of search.js
 */
(() => {
  const App = (window.App = window.App || {});

  App.createWorker = function () {
    return new Worker('js/worker.js');
  };
})();

(() => {
  const app = window.App;
  const r   = app.refs;

  /* ── Utilities ───────────────────────────────── */
  const encUtils = {
    formatDuration(ms) {
      if (ms < 1000) return Math.round(ms) + " ms";
      const s = ms / 1000;
      if (s < 60) return s.toFixed(2) + " s";
      const m = Math.floor(s / 60);
      return m + " min " + (s - m * 60).toFixed(1) + " s";
    },
    sanitizeText(s) {
      return s.includes("\uFFFD") ? s.replace(/\uFFFD/g, "") : s;
    },
    async readHead(file, n) {
      return new Uint8Array(await file.slice(0, Math.min(n, file.size)).arrayBuffer());
    },
    async readRange(file, start, end) {
      const s = Math.max(0, Math.min(start, file.size));
      const e = Math.max(s, Math.min(end,   file.size));
      return new Uint8Array(await file.slice(s, e).arrayBuffer());
    },
    detectBOM(bytes) {
      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
        return { enc: "utf-8",    skip: 3 };
      if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
        return { enc: "utf-16le", skip: 2 };
      if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
        return { enc: "utf-16be", skip: 2 };
      return { enc: "utf-8", skip: 0 };
    },
    makeThrottled(fn, interval) {
      let last = 0, timer = null, pendingArgs = null;
      const run = () => { timer = null; last = performance.now(); fn(...pendingArgs); };
      return (...args) => {
        pendingArgs = args;
        const now = performance.now();
        if (now - last >= interval) { if (timer) { clearTimeout(timer); timer = null; } run(); }
        else if (!timer)             timer = setTimeout(run, Math.max(0, interval - (now - last)));
      };
    },
    isAscii(str) {
      for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) > 0x7F) return false;
      return true;
    },
  };

  function getWorker() {
    return new Worker("js/worker.js");
  }

  /* ── Search controller ───────────────────────── */
  function createController() {
    let token = 0;
    let activeWorkers = [];

    function killAll() {
      activeWorkers.forEach(w => { try { w.terminate(); } catch (_) {} });
      activeWorkers = [];
    }

    function makeFlusher(displayRef) {
      let pending = false, last = 0;
      const INTERVAL = 120;
      return function () {
        if (pending) return;
        pending = true;
        const delay = Math.max(0, INTERVAL - (performance.now() - last));
        setTimeout(() => {
          r.bigInput.value = displayRef.text;
          app.ui.updateLineNumbers();
          app.ui.updateDownloadState();
          pending = false;
          last = performance.now();
        }, delay);
      };
    }

    return {
      async start(params) {
        killAll();
        token++;
        const myToken = token;
        app.state.searching = true;
        app.ui.updateSearchState();
        r.bigInput.value = "";
        app.ui.updateLineNumbers();

        const files = params.files ? Array.from(params.files) : params.file ? [params.file] : [];
        const rawQuery     = String(params.query || "");
        const caseInsens   = !!params.caseInsensitive;
        const showLabels   = !!params.showLabels;
        const isRegex      = !!params.regexMode;
        const notTerms     = params.notTerms || [];   // array of strings
        const notRegexes   = params.notRegexes || []; // array of RegExp

        // Parse queries: split by | unless regex mode (keep full string as one)
        const queries = isRegex
          ? rawQuery.split("|").map(s => s.trim()).filter(Boolean)
          : rawQuery.split("|").map(s => s.trim()).filter(Boolean);

        if (!files.length || !queries.length) {
          app.state.searching = false;
          app.ui.updateSearchState();
          return;
        }

        const OUT_CHUNK     = 4 * 1024 * 1024;
        const overallStart  = performance.now();
        const displayRef    = { text: "" };
        const flush         = makeFlusher(displayRef);
        const setSpeed      = encUtils.makeThrottled(t => { r.currentSpeedEl.textContent = t; }, 160);

        let overallHits  = 0;
        let overallBytes = 0;

        function applyNotFilter(chunk) {
          if (!notTerms.length && !notRegexes.length) return chunk;
          return chunk.split("\n").filter(line => {
            if (!line) return true; // keep empty (trailing newline)
            for (const t of notTerms) {
              const haystack = caseInsens ? line.toLowerCase() : line;
              const needle   = caseInsens ? t.toLowerCase()    : t;
              if (haystack.includes(needle)) return false;
            }
            for (const re of notRegexes) {
              if (re.test(line)) return false;
            }
            return true;
          }).join("\n");
        }

        function appendText(s) {
          let clean = encUtils.sanitizeText(s || "");
          if (!clean) return;
          clean = applyNotFilter(clean);
          if (!clean) return;
          displayRef.text += clean;
          flush();
        }

        function prefixLabel(file) {
          if (!showLabels) return "";
          const label = file.webkitRelativePath || file.name;
          return "[" + label + "] ";
        }

        function updateStatus() {
          const elapsed = performance.now() - overallStart;
          const speed   = elapsed > 0
            ? ((overallBytes / (1024 * 1024)) / (elapsed / 1000)).toFixed(0)
            : "0";
          setSpeed(speed + " MB/s");
          r.timeSpentEl.textContent = encUtils.formatDuration(elapsed);
          r.linesFoundEl.textContent = String(overallHits);
        }

        async function buildTasks(file, base, size, chunkSize) {
          const tasks = [];
          let cur = base;
          const end = base + size;
          const PROBE = 131072;
          while (cur < end) {
            let idealEnd = Math.min(cur + chunkSize, end);
            if (idealEnd < end) {
              const probe = await encUtils.readRange(file, idealEnd, Math.min(idealEnd + PROBE, end));
              const nl = probe.indexOf(0x0A);
              if (nl !== -1) idealEnd += nl + 1;
            }
            tasks.push({ start: cur, end: idealEnd });
            cur = idealEnd;
          }
          return tasks;
        }

        /* scan one file with one query */
        const scanOne = (file, query) => new Promise(async (resolve, reject) => {
          const prefix = prefixLabel(file);
          let bytesDone = 0;
          const started = performance.now();

          const head = await encUtils.readHead(file, 4096);
          const { enc, skip } = encUtils.detectBOM(head);

          /* For regex mode, always use generic (text) scanner */
          if (isRegex) {
            const w = getWorker();
            activeWorkers.push(w);
            w.onmessage = ev => {
              if (myToken !== token) return;
              const d = ev.data || {};
              if (d.type === "error")  return reject(new Error(d.error));
              if (d.type === "chunk")  appendText(d.text);
              if (d.type === "done") {
                overallHits  += d.count || 0;
                overallBytes += file.size;
                try { w.terminate(); } catch (_) {}
                activeWorkers = activeWorkers.filter(x => x !== w);
                resolve();
              }
            };
            w.postMessage({
              cmd: "scan-regex",
              file, enc, skip, query,
              outChunk: OUT_CHUNK,
              ci: caseInsens,
              labelPrefix: prefix,
            });
            return;
          }

          const qAscii = encUtils.isAscii(query);
          const asciiCI = !!(caseInsens && qAscii);
          const useFast = enc === "utf-8" && (!caseInsens || asciiCI);

          if (!useFast) {
            const w = getWorker();
            activeWorkers.push(w);
            w.onmessage = ev => {
              if (myToken !== token) return;
              const d = ev.data || {};
              if (d.type === "error") return reject(new Error(d.error));
              if (d.type === "chunk") appendText(d.text);
              if (d.type === "done") {
                overallHits  += d.count || 0;
                overallBytes += file.size;
                try { w.terminate(); } catch (_) {}
                activeWorkers = activeWorkers.filter(x => x !== w);
                resolve();
              }
            };
            w.postMessage({
              cmd: "scan-generic",
              file, enc, skip, query,
              outChunk: OUT_CHUNK,
              ci: caseInsens,
              everyOccurrence: false,
              labelPrefix: prefix,
            });
            return;
          }

          /* ── Multi-worker UTF-8 fast path ─────── */
          const totalSize = Math.max(0, file.size - skip);
          if (totalSize <= 0) return resolve();

          const cores = navigator.hardwareConcurrency || 4;
          let workerCount = Math.min(Math.max((cores * 3) | 0, 6), 24);

          let chunkSize = Math.max(32 * 1024 * 1024,
                          Math.min(256 * 1024 * 1024,
                                   Math.ceil(totalSize / Math.max(1, workerCount))));

          const tasks = await buildTasks(file, skip, totalSize, chunkSize);
          if (tasks.length < workerCount) workerCount = tasks.length;

          let nextTask = 0, doneWorkers = 0;
          const taskBufs = tasks.map(() => ({ chunks: [], done: false, count: 0 }));
          let nextFlush = 0;

          const statusThrottle = encUtils.makeThrottled(() => {
            const el = performance.now() - started;
            const sp = el > 0 ? ((bytesDone / (1024*1024)) / (el / 1000)).toFixed(0) : "0";
            setSpeed(sp + " MB/s");
            updateStatus();
          }, 160);

          function flushInOrder() {
            while (nextFlush < taskBufs.length && taskBufs[nextFlush].done) {
              appendText(taskBufs[nextFlush].chunks.join(""));
              overallHits += taskBufs[nextFlush].count;
              nextFlush++;
            }
            r.linesFoundEl.textContent = String(overallHits);
          }

          function assign(w) {
            if (nextTask >= tasks.length) return false;
            const idx = nextTask++;
            const t = tasks[idx];
            w.__taskIdx = idx;
            w.postMessage({
              cmd: "scan-utf8-fast",
              file, start: t.start, end: t.end,
              leftOverlap: 0, rightOverlap: 0,
              query, outChunk: OUT_CHUNK,
              everyOccurrence: false,
              labelPrefix: prefix,
              asciiCI,
            });
            return true;
          }

          const workers = Array.from({ length: workerCount }, () => {
            const w = getWorker();
            activeWorkers.push(w);
            return w;
          });

          workers.forEach(w => {
            w.onmessage = ev => {
              if (myToken !== token) return;
              const d = ev.data || {};
              if (d.type === "error") {
                killAll();
                return reject(new Error(d.error));
              }
              const idx = w.__taskIdx;
              if (d.type === "chunk")    taskBufs[idx].chunks.push(encUtils.sanitizeText(d.text || ""));
              else if (d.type === "progress") {
                const b = d.bytes | 0;
                bytesDone  += b;
                overallBytes += b;
                statusThrottle();
              } else if (d.type === "done") {
                taskBufs[idx].done   = true;
                taskBufs[idx].count += d.count || 0;
                if (!assign(w)) {
                  try { w.terminate(); } catch (_) {}
                  activeWorkers = activeWorkers.filter(x => x !== w);
                  doneWorkers++;
                  if (doneWorkers === workers.length) {
                    flushInOrder();
                    setSpeed("");
                    resolve();
                  }
                } else {
                  flushInOrder();
                }
              }
            };
            assign(w);
          });
        });

        /* ── Main loop ───────────────────────────── */
        try {
          for (const query of queries) {
            for (const file of files) {
              if (myToken !== token) return;
              await scanOne(file, query);
            }
          }
        } catch (_) {
          // swallow — worker errors handled inside
        } finally {
          if (myToken === token) {
            const totalElapsed = performance.now() - overallStart;
            let finalText = displayRef.text.replace(/\r?\n$/, "").replace(/\u2026$/, "");
            displayRef.text = finalText;
            r.bigInput.value  = finalText;
            r.timeSpentEl.textContent  = encUtils.formatDuration(totalElapsed);
            r.linesFoundEl.textContent = finalText.trim()
              ? String(finalText.split(/\r?\n/).length) : "0";
            r.currentSpeedEl.textContent = "";
            app.ui.updateLineNumbers();
            app.ui.updateDownloadState();
            app.state.searching = false;
            app.ui.updateSearchState();
            if (App.filters) App.filters.applyFilters();
          }
        }
      },

      cancel() {
        token++;
        killAll();
        app.state.searching = false;
        app.ui.updateSearchState();
      },
    };
  }

  const controller = createController();

  function startSearch() {
    const refs = app.refs;
    const state = app.state;
    if (!state.selectedFiles.length) return;
    const query = (refs.requestInput.value || "").trim();
    if (!query) return;

    const caseInsensitive = !refs.caseSensitiveEl.checked;
    const isMultiFile = state.selectedFiles.length > 1 ||
      !!(state.selectedFiles[0]?.webkitRelativePath?.includes("/"));
    const showLabels = refs.showFileNamesEl.checked && isMultiFile;
    const regexMode  = state.regexMode;

    // NOT filter
    let notTerms   = [];
    let notRegexes = [];
    if (refs.notFilter && refs.notFilter.checked && refs.notFilterInput.value.trim()) {
      for (const raw of refs.notFilterInput.value.split("|").map(s => s.trim()).filter(Boolean)) {
        const regexMatch = raw.match(/^\/(.+)\/([gimsuy]*)$/);
        if (regexMatch) {
          try { notRegexes.push(new RegExp(regexMatch[1], regexMatch[2])); }
          catch (_) { notTerms.push(raw); }
        } else {
          notTerms.push(raw);
        }
      }
    }

    controller.start({
      files: state.selectedFiles,
      query,
      caseInsensitive,
      showLabels,
      regexMode,
      notTerms,
      notRegexes,
    });
  }

  r.searchButton.addEventListener("click", () => {
    if (!r.searchButton.classList.contains("ready")) return;
    if (!r.inputPanel.classList.contains("visible")) app.ui.openInputPanel();
    app.ui.resetAfterSearch();
    startSearch();
  });
})();

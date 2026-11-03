(() => {
  const App = (window.App = window.App || {});

  const refs = {
    fileInput:             document.getElementById("fileInput"),
    uploadFileButton:      document.getElementById("uploadFileButton"),
    uploadFolderButton:    document.getElementById("uploadFolderButton"),
    searchButton:          document.getElementById("searchButton"),
    downloadResultsButton: document.getElementById("downloadResultsButton"),
    fileNameEl:            document.getElementById("fileName"),
    requestInput:          document.getElementById("requestInput"),
    inputPanel:            document.getElementById("inputPanel"),
    bigInput:              document.getElementById("bigInput"),
    lineNumbers:           document.getElementById("lineNumbers"),
    timeSpentEl:           document.getElementById("timeSpent"),
    linesFoundEl:          document.getElementById("fileSize"),
    currentSpeedEl:        document.getElementById("CurrentSpeed"),
    showFileNamesEl:       document.getElementById("showFileNames"),
    caseSensitiveEl:       document.getElementById("caseSensitive"),
    loginpass:             document.getElementById("loginpass"),
    mailpass:              document.getElementById("mailpass"),
    historyDropdown:       document.getElementById("historyDropdown"),
    requestCell:           document.getElementById("requestCell"),
    regexToggle:           document.getElementById("regexToggle"),
    progressBar:           document.getElementById("progressBar"),
    headerStatus:          document.getElementById("headerStatus"),
    notFilter:             document.getElementById("notFilter"),
    notFilterRow:          document.getElementById("notFilterRow"),
    notFilterInput:        document.getElementById("notFilterInput"),
    analyzeBtn:            document.getElementById("analyzeBtn"),
    copyAllBtn:            document.getElementById("copyAllBtn"),
    clearBtn:              document.getElementById("clearBtn"),
    statsPanel:            document.getElementById("statsPanel"),
    statsGrid:             document.getElementById("statsGrid"),
  };
  App.refs = refs;

  const state = {
    hasDatabase:          false,
    selectedFiles:        [],
    searching:            false,
    originalResults:      "",
    historyOpen:          false,
    currentHistoryFilter: "",
    allowShowFileNames:   false,
    regexMode:            false,
  };
  App.state = state;

  /* ── Helpers ─────────────────────────────────── */
  const hasRequestText = () => refs.requestInput.value.trim().length > 0;

  const setSearchButtonState = () => {
    const filtersActive =
      (refs.loginpass && refs.loginpass.checked) ||
      (refs.mailpass  && refs.mailpass.checked);

    const enabled = hasRequestText() && state.hasDatabase && !state.searching && !filtersActive;

    refs.searchButton.classList.toggle("ready", enabled);
    refs.searchButton.disabled = !enabled;
    document.body.classList.toggle("searching", state.searching);

    if (refs.headerStatus) {
      refs.headerStatus.className = "header-status" + (state.searching ? " searching" : "");
      refs.headerStatus.textContent = state.searching ? "SEARCHING…" : "";
    }

    // progress bar
    const pb = refs.progressBar;
    if (pb) {
      if (state.searching) {
        pb.classList.add("indeterminate");
        pb.closest(".progress-bar-wrap").style.display = "block";
      } else {
        pb.classList.remove("indeterminate");
        pb.closest(".progress-bar-wrap").style.display = "none";
        pb.style.width = "0%";
      }
    }

    const disabled = state.searching;
    const disableShowFileNames = disabled || !state.allowShowFileNames;
    refs.showFileNamesEl.disabled = disableShowFileNames;
    const showLabel = refs.showFileNamesEl.closest(".toggle-chip");
    if (showLabel) showLabel.classList.toggle("disabled", disableShowFileNames);

    refs.caseSensitiveEl.disabled = disabled;
    refs.requestInput.disabled = disabled;
    refs.bigInput.disabled = disabled;

    [refs.loginpass, refs.mailpass].forEach(cb => {
      if (!cb) return;
      cb.disabled = disabled || cb.disabled;
      const label = cb.closest(".toggle-chip");
      if (label) label.classList.toggle("disabled", disabled || cb.disabled);
    });

    if (disabled && App.history && App.history.closeDropdown) App.history.closeDropdown();
  };

  const setDownloadButtonState = () => {
    const hasLines = refs.bigInput.value.split("\n").some(l => l.trim().length > 0);
    refs.downloadResultsButton.disabled = !hasLines;

    const filterActive =
      (refs.loginpass && refs.loginpass.checked) ||
      (refs.mailpass  && refs.mailpass.checked);
    const disableFiltersBase = state.searching || (!hasLines && !filterActive);

    [refs.loginpass, refs.mailpass].forEach(cb => {
      if (!cb) return;
      const other = cb === refs.loginpass ? refs.mailpass : refs.loginpass;
      const dis = disableFiltersBase || (other && other.checked);
      cb.disabled = dis;
      const label = cb.closest(".toggle-chip");
      if (label) label.classList.toggle("disabled", dis);
    });
  };

  /* ── File description ────────────────────────── */
  const extractFolderName = files => {
    const rel = files[0].webkitRelativePath || "";
    if (rel.includes("/")) return rel.split("/")[0];
    const name = files[0].name || "";
    return name.includes(".") ? null : name;
  };

  const formatSize = bytes => {
    const kb = 1024, mb = kb * 1024, gb = mb * 1024;
    if (bytes >= gb) return (bytes / gb).toFixed(1) + " GB";
    if (bytes >= mb) return (bytes / mb).toFixed(1) + " MB";
    if (bytes >= kb) return (bytes / kb).toFixed(1) + " KB";
    return bytes + " B";
  };

  const describeFiles = files => {
    const arr = Array.from(files || []);
    if (!arr.length) return { label: "", hasDb: false, allowShowFileNames: false };
    const folder = extractFolderName(arr);
    const totalSize = arr.reduce((s, f) => s + (f.size || 0), 0);
    let label = folder
      ? `${folder}/ — ${arr.length} files, ${formatSize(totalSize)}`
      : arr.length === 1
        ? `${arr[0].name} (${formatSize(totalSize)})`
        : `${arr.length} files (${formatSize(totalSize)})`;
    return { label, hasDb: true, allowShowFileNames: !!folder || arr.length > 1 };
  };

  const applySelectedFiles = files => {
    state.selectedFiles = Array.from(files || []);
    const { label, hasDb, allowShowFileNames } = describeFiles(state.selectedFiles);
    state.hasDatabase = hasDb;
    state.allowShowFileNames = allowShowFileNames;
    refs.fileNameEl.textContent = label || "No file loaded";
    refs.fileNameEl.classList.toggle("loaded", hasDb);
    setSearchButtonState();
    setDownloadButtonState();
  };

  /* ── Line numbers ────────────────────────────── */
  const renderLineNumbers = () => {
    const val = refs.bigInput.value;
    // Fast path: count \n occurrences
    let count = 1;
    for (let i = 0; i < val.length; i++) if (val[i] === '\n') count++;
    // Build in chunks to avoid huge string concat
    const CHUNK = 500;
    let out = "";
    for (let i = 1; i <= count; i++) {
      out += i + "\n";
      if (i % CHUNK === 0) {
        // yield; but we're sync — just keep building
      }
    }
    refs.lineNumbers.textContent = out.trimEnd();
  };

  /* ── Panel management ────────────────────────── */
  const openResultsPanel = () => {
    refs.inputPanel.classList.add("visible");
    renderLineNumbers();
    setDownloadButtonState();
  };

  const resetAfterSearch = () => {
    refs.bigInput.value = "";
    refs.timeSpentEl.textContent = "—";
    refs.linesFoundEl.textContent = "—";
    refs.currentSpeedEl.textContent = "—";
    state.originalResults = "";
    renderLineNumbers();
    setDownloadButtonState();
    openResultsPanel();
  };

  /* ── Regex toggle ────────────────────────────── */
  if (refs.regexToggle) {
    refs.regexToggle.addEventListener("click", () => {
      if (state.searching) return;
      state.regexMode = !state.regexMode;
      refs.regexToggle.classList.toggle("active", state.regexMode);
      refs.requestInput.placeholder = state.regexMode
        ? "^pattern$ | another.*"
        : "query1 | query2 | query3…";
    });
  }

  /* ── NOT filter toggle ───────────────────────── */
  if (refs.notFilter) {
    refs.notFilter.addEventListener("change", () => {
      refs.notFilterRow.classList.toggle("visible", refs.notFilter.checked);
    });
  }

  /* ── Copy all / Clear ────────────────────────── */
  if (refs.copyAllBtn) {
    refs.copyAllBtn.addEventListener("click", () => {
      const val = refs.bigInput.value;
      if (!val) return;
      // Use line-copy fallback so it works on HTTP too
      if (App.lineCopy && App.lineCopy.writeClipboard) {
        App.lineCopy.writeClipboard(val);
      } else if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(val).catch(() => {});
      }
    });
  }
  if (refs.clearBtn) {
    refs.clearBtn.addEventListener("click", () => {
      refs.bigInput.value = "";
      state.originalResults = "";
      renderLineNumbers();
      setDownloadButtonState();
      if (App.filters) App.filters.updateLinesFoundDisplay();
    });
  }

  /* ── Analyze button ──────────────────────────── */
  if (refs.analyzeBtn) {
    refs.analyzeBtn.addEventListener("click", () => {
      if (App.stats && App.stats.show) App.stats.show(refs.bigInput.value);
    });
  }
  if (document.getElementById("closeStatsBtn")) {
    document.getElementById("closeStatsBtn").addEventListener("click", () => {
      refs.statsPanel.classList.remove("visible");
    });
  }

  /* ── Events ──────────────────────────────────── */
  refs.downloadResultsButton.addEventListener("click", () => {
    if (App.downloadResults) App.downloadResults();
  });

  refs.requestInput.addEventListener("input", () => {
    setSearchButtonState();
    if (App.history && App.history.openDropdown) App.history.openDropdown(refs.requestInput.value);
  });

  refs.requestInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && refs.searchButton.classList.contains("ready")) {
      e.preventDefault();
      refs.searchButton.click();
      if (App.history) App.history.closeDropdown();
    }
    if (e.key === "Escape" && App.history) App.history.closeDropdown();
  });

  refs.requestInput.addEventListener("focus", () => {
    if (App.history) App.history.openDropdown("");
  });

  document.addEventListener("click", e => {
    if (!refs.requestCell.contains(e.target) && App.history) App.history.closeDropdown();
  });

  refs.bigInput.addEventListener("input", () => {
    if (App.filters) App.filters.handleEditorInput();
  });
  refs.bigInput.addEventListener("scroll", () => {
    refs.lineNumbers.scrollTop = refs.bigInput.scrollTop;
  });

  if (refs.loginpass) {
    refs.loginpass.addEventListener("change", () => {
      if (App.filters) App.filters.applyFilters();
      setSearchButtonState();
    });
  }
  if (refs.mailpass) {
    refs.mailpass.addEventListener("change", () => {
      if (App.filters) App.filters.applyFilters();
      setSearchButtonState();
    });
  }
  if (refs.searchButton) {
    refs.searchButton.addEventListener("click", () => {
      if (!refs.searchButton.classList.contains("ready")) return;
      if (App.history) App.history.saveSearchQuery();
      if (App.history) App.history.closeDropdown();
    });
  }

  // Guard text selection
  document.addEventListener("selectstart", e => {
    let t = e.target;
    if (!t || t.nodeType !== 1) t = t?.parentElement;
    if (!t) return;
    if ((t.closest("#") && !t.closest(".db-actions")) ||
        t.closest("input, textarea, select")) return;
    e.preventDefault();
  });

  /* ── Expose UI api ───────────────────────────── */
  App.ui = {
    updateSearchState:  () => { setSearchButtonState(); setDownloadButtonState(); },
    updateDownloadState: setDownloadButtonState,
    handleFiles:        applySelectedFiles,
    openInputPanel:     openResultsPanel,
    resetAfterSearch,
    updateLineNumbers:  renderLineNumbers,
    applyFilters:       () => { if (App.filters) App.filters.applyFilters(); },
  };

  setSearchButtonState();
  setDownloadButtonState();
})();

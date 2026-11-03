'use strict';
let textDecoder;
const decode = b => { if (!textDecoder) textDecoder = new TextDecoder('utf-8'); return textDecoder.decode(b); };
const encode = s => new TextEncoder().encode(s);

/* ── BMH exact ───────────────────────────────────── */
function buildBMH(needle) {
  const m = needle.length, t = new Uint32Array(256).fill(m);
  for (let i = 0; i < m - 1; i++) t[needle[i]] = m - 1 - i;
  return t;
}
function indexBMH(hay, needle, t, i) {
  const n = hay.length, m = needle.length;
  while (i <= n - m) {
    let j = m - 1;
    while (j >= 0 && hay[i + j] === needle[j]) j--;
    if (j < 0) return i;
    i += t[hay[i + m - 1]];
  }
  return -1;
}

/* ── BMH case-insensitive ASCII ──────────────────── */
const LOWER = new Uint8Array(256);
for (let i = 0; i < 256; i++) LOWER[i] = (i >= 65 && i <= 90) ? i + 32 : i;
function buildBMH_CI(qL) {
  const m = qL.length, t = new Uint32Array(256).fill(m);
  for (let i = 0; i < m - 1; i++) t[qL[i]] = m - 1 - i;
  return t;
}
function indexBMH_CI(hay, qL, t, i) {
  const n = hay.length, m = qL.length;
  while (i <= n - m) {
    let j = m - 1;
    while (j >= 0 && LOWER[hay[i + j]] === qL[j]) j--;
    if (j < 0) return i;
    i += t[LOWER[hay[i + m - 1]]];
  }
  return -1;
}

/* ── Emit line ───────────────────────────────────── */
function emit(outObj, line, outChunk, labelPrefix) {
  if (line.includes('\uFFFD')) line = line.replace(/\uFFFD/g, '');
  outObj.out += labelPrefix + line + '\n';
  if (outObj.out.length >= outChunk) {
    self.postMessage({ type: 'chunk', text: outObj.out });
    outObj.out = '';
  }
}

/* ── Fast UTF-8 scanner ──────────────────────────── */
function scanUtf8(file, start, end, query, outChunk, everyOccurrence, labelPrefix, asciiCI) {
  return file.slice(start, end).arrayBuffer().then(buf => {
    const bytes = new Uint8Array(buf);
    const n = bytes.length;
    const outObj = { out: '' };
    let totalMatches = 0;
    let lastSolAbs = -1;

    const isNL = b => b === 10 || b === 13;
    const prevLF = pos => { for (let i = pos; i >= 0; i--) if (isNL(bytes[i])) return i; return -1; };
    const nextLF = pos => { for (let i = pos; i < n;   i++) if (isNL(bytes[i])) return i; return -1; };

    function onHit(posAbs) {
      if (posAbs < start || posAbs >= end) return;
      const local = posAbs - start;
      const lfL = prevLF(local);
      const lfR = nextLF(local);
      let sol = lfL + 1;
      let eol = lfR === -1 ? n : lfR;
      if (eol > sol && bytes[eol - 1] === 13) eol--;
      const solAbs = sol + start;
      const truncL = lfL === -1 && start > 0;
      const truncR = lfR === -1 && end < file.size;
      if (solAbs === lastSolAbs) return;
      lastSolAbs = solAbs;
      let line = decode(bytes.subarray(sol, eol));
      if (truncL) line = '… ' + line;
      if (truncR) line = line + ' …';
      emit(outObj, line, outChunk, labelPrefix);
      totalMatches++;
    }

    const qBytes = encode(query);
    const qLen = qBytes.length;
    if (qLen === 0) {
      self.postMessage({ type: 'progress', bytes: end - start });
      self.postMessage({ type: 'done', count: 0 });
      return;
    }

    if (asciiCI) {
      const qL = new Uint8Array(qLen);
      for (let i = 0; i < qLen; i++) qL[i] = LOWER[qBytes[i]];
      if (qLen === 1) {
        const cl = qL[0];
        for (let i = 0; i < n; i++) if (LOWER[bytes[i]] === cl) onHit(start + i);
      } else {
        const t = buildBMH_CI(qL);
        for (let i = 0;;) { const p = indexBMH_CI(bytes, qL, t, i); if (p === -1) break; onHit(start + p); i = p + 1; }
      }
    } else {
      if (qLen === 1) {
        const q0 = qBytes[0];
        for (let i = bytes.indexOf(q0, 0); i !== -1; i = bytes.indexOf(q0, i + 1)) onHit(start + i);
      } else if (qLen <= 8) {
        for (let i = bytes.indexOf(qBytes[0], 0); i !== -1; i = bytes.indexOf(qBytes[0], i + 1)) {
          let ok = true;
          for (let k = 1; k < qLen; k++) if (bytes[i + k] !== qBytes[k]) { ok = false; break; }
          if (ok) onHit(start + i);
        }
      } else {
        const t = buildBMH(qBytes);
        for (let i = 0;;) { const p = indexBMH(bytes, qBytes, t, i); if (p === -1) break; onHit(start + p); i = p + 1; }
      }
    }

    if (outObj.out) self.postMessage({ type: 'chunk', text: outObj.out });
    self.postMessage({ type: 'progress', bytes: end - start });
    self.postMessage({ type: 'done', count: totalMatches });
  }).catch(err => self.postMessage({ type: 'error', error: String(err?.message || err) }));
}

/* ── Generic (streaming, any encoding) ──────────── */
async function scanGeneric(file, enc, skip, query, outChunk, ci, labelPrefix) {
  const sliced = skip ? file.slice(skip) : file;
  const stream = sliced.stream().pipeThrough(new TextDecoderStream(enc));
  const reader = stream.getReader();
  const Q = ci ? query.toLocaleLowerCase() : query;
  let carry = '', out = '', count = 0;

  function pushLine(line) {
    line = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (line.includes('\uFFFD')) line = line.replace(/\uFFFD/g, '');
    out += labelPrefix + line + '\n';
    count++;
    if (out.length >= outChunk) { self.postMessage({ type: 'chunk', text: out }); out = ''; }
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let block = carry + (value || '');
    const safeEnd = block.lastIndexOf('\n');
    if (safeEnd === -1) { carry = block; continue; }
    const search = ci ? block.toLocaleLowerCase() : block;
    let from = 0;
    while (true) {
      const pos = search.indexOf(Q, from);
      if (pos === -1 || pos > safeEnd) break;
      const st = block.lastIndexOf('\n', pos) + 1;
      let en = block.indexOf('\n', pos);
      if (en === -1 || en > safeEnd) en = safeEnd;
      pushLine(block.slice(st, en));
      from = en + 1;
    }
    carry = block.slice(safeEnd + 1);
  }

  if (carry) {
    const s = ci ? carry.toLocaleLowerCase() : carry;
    if (s.includes(Q)) pushLine(carry);
  }
  if (out) self.postMessage({ type: 'chunk', text: out });
  self.postMessage({ type: 'done', count });
}

/* ── Regex scanner ───────────────────────────────── */
async function scanRegex(file, enc, skip, pattern, outChunk, ci, labelPrefix) {
  let re;
  try {
    re = new RegExp(pattern, ci ? 'i' : '');
  } catch (err) {
    self.postMessage({ type: 'error', error: 'Invalid regex: ' + err.message });
    return;
  }
  const sliced = skip ? file.slice(skip) : file;
  const stream = sliced.stream().pipeThrough(new TextDecoderStream(enc));
  const reader = stream.getReader();
  let carry = '', out = '', count = 0;

  function pushLine(line) {
    line = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (line.includes('\uFFFD')) line = line.replace(/\uFFFD/g, '');
    out += labelPrefix + line + '\n';
    count++;
    if (out.length >= outChunk) { self.postMessage({ type: 'chunk', text: out }); out = ''; }
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let block = carry + (value || '');
    const safeEnd = block.lastIndexOf('\n');
    if (safeEnd === -1) { carry = block; continue; }
    let from = 0;
    while (from <= safeEnd) {
      const nl = block.indexOf('\n', from);
      const lineEnd = nl === -1 || nl > safeEnd ? safeEnd : nl;
      const line = block.slice(from, lineEnd);
      if (re.test(line)) pushLine(line);
      from = lineEnd + 1;
      if (from > safeEnd) break;
    }
    carry = block.slice(safeEnd + 1);
  }
  if (carry && re.test(carry)) pushLine(carry);
  if (out) self.postMessage({ type: 'chunk', text: out });
  self.postMessage({ type: 'done', count });
}

/* ── Message router ──────────────────────────────── */
self.onmessage = ({ data: d }) => {
  if (!d) return;
  if (d.cmd === 'scan-utf8-fast') {
    scanUtf8(d.file, d.start, d.end, d.query, d.outChunk, d.everyOccurrence, d.labelPrefix, d.asciiCI);
  } else if (d.cmd === 'scan-generic') {
    scanGeneric(d.file, d.enc, d.skip, d.query, d.outChunk, d.ci, d.labelPrefix)
      .catch(err => self.postMessage({ type: 'error', error: String(err?.message || err) }));
  } else if (d.cmd === 'scan-regex') {
    scanRegex(d.file, d.enc, d.skip, d.query, d.outChunk, d.ci, d.labelPrefix)
      .catch(err => self.postMessage({ type: 'error', error: String(err?.message || err) }));
  }
};

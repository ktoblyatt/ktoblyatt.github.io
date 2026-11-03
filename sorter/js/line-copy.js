/**
 * line-copy.js
 *
 * Ctrl+C / Ctrl+X на строке в textarea — копирование и вырезание.
 *
 * Решённые проблемы:
 *  1. Раскладка — используем e.code ('KeyC', 'KeyX'), не e.key.
 *     e.code всегда латинский, независимо от языка системы.
 *
 *  2. HTTP без SSL — navigator.clipboard недоступен.
 *     Фоллбэк: создаём временный <textarea>, execCommand('copy').
 *     Работает на любом протоколе.
 *
 * Поведение (как в Notepad++):
 *  - Если есть выделение — стандартный Ctrl+C/X, не перехватываем.
 *  - Если выделения нет — копируем/вырезаем всю строку под курсором.
 *  - После копирования кратко подсвечиваем строку.
 */
(() => {
  const App = (window.App = window.App || {});

  // ── clipboard helper ──────────────────────────────────────
  async function writeClipboard(text) {
    // Secure context (HTTPS / localhost)
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) { /* fall through */ }
    }

    // HTTP fallback — execCommand
    try {
      const tmp = document.createElement('textarea');
      tmp.value = text;
      tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      const ok = document.execCommand('copy');
      tmp.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  // ── get line bounds at caret position ─────────────────────
  function getLineBounds(textarea) {
    const val   = textarea.value;
    const caret = textarea.selectionStart;

    const lineStart = val.lastIndexOf('\n', caret - 1) + 1;
    let   lineEnd   = val.indexOf('\n', caret);
    if (lineEnd === -1) lineEnd = val.length;

    return { lineStart, lineEnd };
  }

  // ── brief highlight feedback ──────────────────────────────
  function flashLine(textarea, lineStart, lineEnd) {
    // Save current selection
    const selStart = textarea.selectionStart;
    const selEnd   = textarea.selectionEnd;

    // Briefly select the line
    textarea.setSelectionRange(lineStart, lineEnd);

    setTimeout(() => {
      // Restore original caret
      if (document.activeElement === textarea) {
        textarea.setSelectionRange(selStart, selEnd);
      }
    }, 180);
  }

  // ── main handler ──────────────────────────────────────────
  function handleKeydown(e) {
    // Only intercept Ctrl+C and Ctrl+X (Cmd on Mac)
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    if (e.code !== 'KeyC' && e.code !== 'KeyX') return;

    const textarea = e.target;
    if (textarea.tagName !== 'TEXTAREA') return;

    // If there's an active selection — don't interfere, let browser handle it
    if (textarea.selectionStart !== textarea.selectionEnd) return;

    e.preventDefault();

    const { lineStart, lineEnd } = getLineBounds(textarea);
    const lineText = textarea.value.slice(lineStart, lineEnd);

    writeClipboard(lineText).then(ok => {
      if (!ok) return; // couldn't write — bail silently

      flashLine(textarea, lineStart, lineEnd);

      // Cut: remove the line
      if (e.code === 'KeyX') {
        const val = textarea.value;

        // Remove line + its trailing newline (if any)
        let removeEnd = lineEnd;
        if (removeEnd < val.length && val[removeEnd] === '\n') {
          removeEnd++;
        } else if (lineStart > 0 && lineEnd === val.length) {
          // Last line without trailing newline — remove preceding newline
          const newStart = lineStart - 1;
          const newVal   = val.slice(0, newStart) + val.slice(lineEnd);
          textarea.value = newVal;
          textarea.setSelectionRange(newStart, newStart);
          triggerInputEvent(textarea);
          return;
        }

        const newVal = val.slice(0, lineStart) + val.slice(removeEnd);
        textarea.value = newVal;
        // Place caret at start of where line was
        const newCaret = Math.min(lineStart, newVal.length);
        textarea.setSelectionRange(newCaret, newCaret);
        triggerInputEvent(textarea);
      }
    });
  }

  // Notify App of textarea change (updates line numbers, download button etc.)
  function triggerInputEvent(textarea) {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── attach ────────────────────────────────────────────────
  // Use capture phase so we catch it before any other handler
  document.addEventListener('keydown', handleKeydown, true);

  App.lineCopy = { writeClipboard };
})();

'use strict';

// Just enough Markdown for chat replies: fenced code, inline code, bold, italics, headings,
// bullets. Everything is HTML-escaped first, so model output can never inject markup.
// Tolerates an unterminated fence while a reply is still streaming.

(function (root) {
  const escapeHtml = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function inline(text) {
    return text
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  }

  function prose(text) {
    return escapeHtml(text)
      .split('\n')
      .map((line) => {
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) return `<strong class="h">${inline(heading[1])}</strong>`;
        const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
        if (bullet) return `${bullet[1]}• ${inline(bullet[2])}`;
        return inline(line);
      })
      .join('\n');
  }

  function render(src) {
    // Even parts are prose, odd parts are inside ``` fences.
    return src
      .split('```')
      .map((part, i) => {
        if (i % 2 === 0) return prose(i > 0 ? part.replace(/^\n/, '') : part);
        const newline = part.indexOf('\n');
        const lang = newline >= 0 ? part.slice(0, newline).trim() : '';
        const code = newline >= 0 ? part.slice(newline + 1).replace(/\n$/, '') : '';
        const label = lang ? `<span class="lang">${escapeHtml(lang)}</span>` : '';
        return `<pre>${label}<code>${escapeHtml(code)}</code></pre>`;
      })
      .join('')
      .replace(/<\/pre>\n/g, '</pre>');
  }

  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Markdown = api;
})(typeof window !== 'undefined' ? window : globalThis);

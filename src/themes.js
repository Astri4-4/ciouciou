'use strict';

// Island themes. The look itself lives in island.html under body[data-theme="<id>"].
// Loaded both by main (require) and by the island page (<script>).

(function (root) {
  const THEMES = [
    { id: 'midnight', label: 'Midnight' },
    { id: 'cybercore', label: 'Cybercore' },
    { id: 'futuristic', label: 'Futuristic' },
    { id: 'glass', label: 'Glassmorphism' },
    { id: 'neumorphism', label: 'Neumorphism' },
    { id: 'flat', label: 'Flat' },
  ];
  const DEFAULT_THEME = 'midnight';
  const isTheme = (id) => THEMES.some((t) => t.id === id);

  const api = { THEMES, DEFAULT_THEME, isTheme };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Themes = api;
})(typeof window !== 'undefined' ? window : globalThis);

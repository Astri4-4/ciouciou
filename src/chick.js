'use strict';

// The ciouciou chick: a 12×13 pixel sprite, one colour per service. Used as inline SVG by the
// island (state shown by toggling layers with CSS) and as a bitmap for the tray icon.
// Loaded both by main (require) and by the island page (<script>), hence the wrapper.

(function (root) {
  const WIDTH = 12;
  const HEIGHT = 13;

  // o outline, b body, h highlight, c cheek, k beak, f feet.
  const BIRD = [
    '......o.....',
    '.....o......',
    '...oooooo...',
    '..obhhbbbo..',
    '.obhbbbbbbo.',
    '.obbbbbbbbo.',
    '.obbbbbbbbo.',
    '.obcbkkbcbo.',
    'obbbbbbbbbbo',
    'obbbbbbbbbbo',
    '.obbbbbbbbo.',
    '..oooooooo..',
    '...ff..ff...',
  ];

  // E shell, S shell highlight.
  const EGG = [
    '............',
    '....oooo....',
    '...oEEEEo...',
    '..oESSEEEo..',
    '..oESEEEEo..',
    '.oEEEEEEEEo.',
    '.oEEEEEEEEo.',
    '.oEEEEEEEEo.',
    '.oEEEEEEEEo.',
    '.oEEEEEEEEo.',
    '..oEEEEEEo..',
    '...oooooo...',
    '............',
  ];

  // Overlays drawn on top of BIRD; the island shows the ones matching the state.
  const LAYERS = {
    'wings-down': [[1, 8, 'w'], [1, 9, 'w'], [2, 9, 'w'], [10, 8, 'w'], [10, 9, 'w'], [9, 9, 'w']],
    'wings-up': [[0, 6, 'w'], [0, 7, 'w'], [1, 7, 'w'], [1, 8, 'w'], [11, 6, 'w'], [11, 7, 'w'], [10, 7, 'w'], [10, 8, 'w']],
    'eyes-open': [[3, 5, 'e'], [3, 6, 'e'], [8, 5, 'e'], [8, 6, 'e']],
    'eyes-closed': [[2, 6, 'e'], [3, 6, 'e'], [8, 6, 'e'], [9, 6, 'e']],
    'eyes-happy': [[2, 6, 'e'], [3, 5, 'e'], [4, 6, 'e'], [7, 6, 'e'], [8, 5, 'e'], [9, 6, 'e']],
    'eyes-x': [[2, 4, 'e'], [4, 4, 'e'], [3, 5, 'e'], [2, 6, 'e'], [4, 6, 'e'], [7, 4, 'e'], [9, 4, 'e'], [8, 5, 'e'], [7, 6, 'e'], [9, 6, 'e']],
    sweat: [[10, 2, 'd'], [10, 3, 'd'], [11, 3, 'd']],
  };

  const COMMON = {
    o: '#141417',
    e: '#141417',
    k: '#ff9f1c',
    f: '#f28c0f',
    d: '#7fd1ff',
    E: '#f4efe6',
    S: '#ffffff',
  };

  const PALETTES = {
    ollama: { b: '#f6eedc', h: '#fffdf6', w: '#ddd0b3', c: '#ff9eb0' },
    openwebui: { b: '#a8d8ff', h: '#e2f2ff', w: '#7fbdf0', c: '#ff9eb0' },
    n8n: { b: '#ff9aae', h: '#ffd0da', w: '#ef7590', c: '#e2506f' },
    tray: { b: '#ffd84a', h: '#fff2a8', w: '#f0bd2a', c: '#ff8f8f' },
  };

  const DOWN = { b: '#8e8e93', h: '#b0b0b5', w: '#6c6c70', c: '#8e8e93', k: '#a5a5aa', f: '#7c7c80' };

  function mapPixels(map) {
    const out = [];
    map.forEach((row, y) => [...row].forEach((key, x) => key !== '.' && out.push([x, y, key])));
    return out;
  }

  const rects = (pixels) =>
    pixels.map(([x, y, key]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="var(--${key})"/>`).join('');

  // Colours are CSS variables so the island can recolour (e.g. grey when down) without re-rendering.
  function svg(scale) {
    const layers = Object.entries(LAYERS)
      .map(([name, pixels]) => `<g class="${name}">${rects(pixels)}</g>`)
      .join('');
    return (
      `<svg class="sprite" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH * scale}" height="${HEIGHT * scale}" shape-rendering="crispEdges">` +
      `<g class="bird">${rects(mapPixels(BIRD))}${layers}</g>` +
      `<g class="egg">${rects(mapPixels(EGG))}</g></svg>`
    );
  }

  // Inline style for a chick element: the service palette as --p* variables, which the
  // island's CSS maps onto the --b/--h/... the SVG uses (and overrides when down).
  function paletteVars(service) {
    const palette = { ...COMMON, ...(PALETTES[service] || PALETTES.tray) };
    return Object.entries(palette)
      .map(([key, color]) => `--p${key}:${color}`)
      .join(';');
  }

  // Flat list of {x, y, color} for a static frame, used to paint the tray bitmap.
  function pixels(service, state) {
    if (state === 'unknown') {
      return mapPixels(EGG).map(([x, y, key]) => ({ x, y, color: COMMON[key] }));
    }
    const palette = { ...COMMON, ...(PALETTES[service] || PALETTES.tray), ...(state === 'down' ? DOWN : {}) };
    const eyes = { busy: 'eyes-happy', down: 'eyes-x' }[state] || 'eyes-open';
    const layers = [mapPixels(BIRD), LAYERS['wings-down'], LAYERS[eyes], state === 'degraded' ? LAYERS.sweat : []];
    return layers.flat().map(([x, y, key]) => ({ x, y, color: palette[key] }));
  }

  const api = { WIDTH, HEIGHT, svg, paletteVars, pixels };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Chick = api;
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  nativeImage,
  ipcMain,
  shell,
  screen,
  globalShortcut,
} = require('electron');
const { loadConfig, saveConfig, merge } = require('./config');
const { Monitor, describeError } = require('./monitor');
const { listModels, streamChat } = require('./openwebui');
const Chick = require('./chick');
const Themes = require('./themes');

// The island window has a fixed size big enough for the largest view (home / chat);
// everything outside the island is transparent and click-through.
const WINDOW_WIDTH = 880;
const WINDOW_HEIGHT = 780;

const COLORS = {
  up: [52, 199, 89],
  busy: [10, 132, 255],
  degraded: [255, 159, 10],
  down: [255, 69, 58],
  unknown: [142, 142, 147],
};

let tray = null;
let island = null;
let monitor = null;
let configFile = null;
let config = null;
let chatAbort = null;
let chatOpen = false;
let shortcutActive = null;
let theme = Themes.DEFAULT_THEME;

// Tried in order when chat.shortcut is already owned by another app.
const SHORTCUT_FALLBACKS = ['CommandOrControl+Alt+O', 'CommandOrControl+Shift+O', 'Alt+Shift+O', 'CommandOrControl+Alt+K'];

// Must match build.appId in package.json: Windows ties toast notifications to it.
const APP_ID = 'fr.sachaguerin.ciouciou';

// A second launch exits immediately (app.quit() would still let whenReady run); the running
// copy gets 'second-instance' and opens Settings instead.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.setAppUserModelId(APP_ID);

let settingsWindow = null;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// The chick sprite painted into a BGRA bitmap, so no icon files are needed. With `badge`,
// a status dot is added in the corner unless everything is simply up.
function chickIcon(service, state, { badge = false } = {}) {
  const size = 32;
  const scale = 2;
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
    buf[i + 3] = 255;
  };
  const ox = Math.floor((size - Chick.WIDTH * scale) / 2);
  const oy = Math.floor((size - Chick.HEIGHT * scale) / 2);
  for (const { x, y, color } of Chick.pixels(service, state)) {
    const rgb = hexToRgb(color);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(ox + x * scale + dx, oy + y * scale + dy, rgb);
  }
  if (badge && state !== 'up') {
    const cx = size - 6;
    const cy = size - 6;
    for (let y = cy - 6; y <= cy + 6; y++) {
      for (let x = cx - 6; x <= cx + 6; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= 5.5) put(x, y, d > 4 ? [20, 20, 23] : COLORS[state] || COLORS.unknown);
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

// UI choices made from the app (currently just the theme) live in userData/state.json,
// separate from the hand-edited config.json.
const statePath = () => path.join(app.getPath('userData'), 'state.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch (err) {
    console.warn(`ciouciou: could not save state: ${err.message}`);
  }
}

function setTheme(id, { persist = true } = {}) {
  theme = Themes.isTheme(id) ? id : Themes.DEFAULT_THEME;
  if (persist) writeState({ theme });
  if (island && !island.isDestroyed()) island.webContents.send('theme', theme);
  if (tray) updateTray(monitor.snapshot);
}

function setInteractive(on) {
  // While chatting the whole window takes input; otherwise only while hovered.
  island.setIgnoreMouseEvents(!(on || chatOpen), { forward: true });
}

function createIsland() {
  island = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  island.loadFile(path.join(__dirname, 'island.html'));
  // Clicks pass through the transparent area; mouse moves are still forwarded so the
  // page can tell when the pointer reaches the island.
  island.setIgnoreMouseEvents(true, { forward: true });
  island.webContents.on('did-finish-load', () => {
    // Forwarding stops when the page reloads, so re-arm it on every load.
    setInteractive(false);
    island.webContents.send('theme', theme);
    island.webContents.send('island:position', config.island.position);
    island.webContents.send('snapshot', monitor.snapshot);
    if (config.island.enabled) island.showInactive();
  });
  placeIsland();
}

function placeIsland() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(WINDOW_WIDTH, area.width);
  const height = Math.min(WINDOW_HEIGHT, area.height);
  // "center" hangs from the top edge like a notch; left/right sit in the corners
  // (the page aligns the island inside the window to match).
  const x = {
    left: area.x,
    right: area.x + area.width - width,
  }[config.island.position] ?? area.x + (area.width - width) / 2;
  island.setBounds({ x: Math.round(x), y: area.y, width, height });
}

function setIslandVisible(visible) {
  config.island.enabled = visible;
  if (visible) island.showInactive();
  else if (!chatOpen) island.hide();
  updateTray(monitor.snapshot);
}

// The island normally never takes focus; it becomes focusable only while the chat is open.
function setChatOpen(open) {
  chatOpen = open;
  island.setFocusable(open);
  setInteractive(open);
  if (open) {
    island.show();
    island.focus();
    island.webContents.focus();
  } else {
    chatAbort?.abort();
    if (!config.island.enabled) island.hide();
  }
  island.webContents.send('chat:open', open);
}

function chatConfigError() {
  const cfg = config.services.openwebui;
  if (!cfg.enabled) return 'Open WebUI is disabled in config.';
  if (!cfg.apiKey) return 'Set services.openwebui.apiKey (or OPENWEBUI_API_KEY) to chat.';
  return null;
}

function chatErrorMessage(err) {
  if (err.status) return `${err.message}${err.message.startsWith('HTTP') ? '' : ` (HTTP ${err.status})`}`;
  return describeError(err);
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  shortcutActive = null;
  if (!config.chat.shortcut) return;
  const candidates = [config.chat.shortcut, ...SHORTCUT_FALLBACKS.filter((a) => a !== config.chat.shortcut)];
  shortcutActive = candidates.find((a) => globalShortcut.register(a, () => setChatOpen(!chatOpen))) || null;
  if (shortcutActive !== config.chat.shortcut) {
    console.warn(`ciouciou: ${config.chat.shortcut} is taken by another app, using ${shortcutActive || 'no shortcut'}`);
  }
}

function openService(id) {
  const url = config.services[id]?.url;
  if (url) shell.openExternal(url);
}

function editConfig() {
  if (!configFile) {
    // No config yet: seed one in userData from the example so there's something to edit.
    configFile = path.join(app.getPath('userData'), 'config.json');
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'config.example.json'), configFile);
  }
  shell.openPath(configFile);
}

// Start with Windows. Only for the installed app: registering a dev run would point the
// login item at node_modules' electron.exe. CIOUCIOU_NO_LOGIN_ITEM disables it for test builds.
const canLaunchAtStartup = () => app.isPackaged && !process.env.CIOUCIOU_NO_LOGIN_ITEM;
const launchAtStartup = () => canLaunchAtStartup() && app.getLoginItemSettings().openAtLogin;

function setLaunchAtStartup(on) {
  if (!canLaunchAtStartup()) return;
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath });
  if (tray) updateTray(monitor.snapshot);
}

const readConfig = () => loadConfig(app.getPath('userData'), { packaged: app.isPackaged });

function openSettings() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    resizable: false,
    maximizable: false,
    title: 'ciouciou settings',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: chickIcon('tray', 'up'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Only the service fields the settings window edits, so a stray value can't land in config.
function pickServices(services = {}) {
  const pick = (s = {}, keys) => Object.fromEntries(keys.filter((k) => k in s).map((k) => [k, s[k]]));
  return {
    ollama: pick(services.ollama, ['enabled', 'url']),
    openwebui: pick(services.openwebui, ['enabled', 'url', 'apiKey']),
    n8n: pick(services.n8n, ['enabled', 'url', 'apiKey']),
  };
}

function reloadConfig() {
  ({ config, file: configFile } = readConfig());
  monitor.setConfig(config);
  monitor.tick();
  island.webContents.send('island:position', config.island.position);
  placeIsland();
  setIslandVisible(config.island.enabled);
  registerShortcut();
  updateTray(monitor.snapshot);
}

function updateTray(snapshot) {
  tray.setImage(chickIcon('tray', snapshot.overall, { badge: true }));
  tray.setToolTip(
    ['ciouciou', ...snapshot.services.map((s) => `${s.name}: ${s.summary}`)].join('\n').slice(0, 127),
  );

  const statusItems = snapshot.services.map((s) => ({
    label: `${s.name} — ${s.summary}`,
    icon: chickIcon(s.id, s.state),
    enabled: Boolean(s.webUrl),
    click: () => openService(s.id),
  }));

  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...statusItems,
      { type: 'separator' },
      { label: 'Ask Open WebUI…', accelerator: shortcutActive || undefined, click: () => setChatOpen(true) },
      {
        label: 'Theme',
        submenu: Themes.THEMES.map((t) => ({
          label: t.label,
          type: 'radio',
          checked: t.id === theme,
          click: () => setTheme(t.id),
        })),
      },
      { label: 'Show island', type: 'checkbox', checked: config.island.enabled, click: (i) => setIslandVisible(i.checked) },
      { label: 'Refresh now', click: () => monitor.tick() },
      { type: 'separator' },
      { label: 'Settings…', click: openSettings },
      ...(canLaunchAtStartup()
        ? [{ label: 'Launch at startup', type: 'checkbox', checked: launchAtStartup(), click: (i) => setLaunchAtStartup(i.checked) }]
        : []),
      { label: 'Edit config file…', click: editConfig },
      { label: 'Reload config', click: reloadConfig },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]),
  );
}

function notify(event) {
  if (!config.notifications[event.kind] || !Notification.isSupported()) return;
  new Notification({ title: event.title, body: event.body, silent: event.kind === 'modelLoaded' }).show();
}

app.whenReady().then(() => {
  ({ config, file: configFile } = readConfig());

  // First launch of the installed app: start with Windows by default (toggle in the tray).
  if (canLaunchAtStartup() && !readState().startupConfigured) {
    setLaunchAtStartup(true);
    writeState({ startupConfigured: true });
  }
  monitor = new Monitor(config);
  setTheme(readState().theme || config.island.theme, { persist: false });

  tray = new Tray(chickIcon('tray', 'unknown'));
  tray.on('click', () => setIslandVisible(!config.island.enabled));
  createIsland();
  updateTray(monitor.snapshot);

  monitor.on('update', (snapshot) => {
    updateTray(snapshot);
    if (!island.isDestroyed()) island.webContents.send('snapshot', snapshot);
  });
  monitor.on('event', (event) => {
    notify(event);
    if (!island.isDestroyed()) island.webContents.send('event', event);
  });
  monitor.start();

  ipcMain.on('island:interactive', (_e, on) => setInteractive(Boolean(on)));
  ipcMain.on('theme:set', (_e, id) => setTheme(id));
  ipcMain.on('open', (_e, id) => openService(id));
  ipcMain.on('refresh', () => monitor.tick());

  ipcMain.handle('n8n:run', async (_e, id) => {
    const result = await monitor.runWorkflow(String(id));
    const name = monitor.snapshot.launcher.workflows.find((w) => w.id === id)?.name || 'Workflow';
    notify({ kind: 'workflowStarted', title: 'n8n', body: `${result.ok ? 'Started' : 'Failed to start'}: ${name}` });
    return result;
  });
  ipcMain.on('n8n:edit', (_e, id) => {
    if (/^[A-Za-z0-9_-]+$/.test(String(id))) shell.openExternal(`${config.services.n8n.url.replace(/\/+$/, '')}/workflow/${id}`);
  });

  ipcMain.handle('settings:get', () => ({
    values: { services: config.services },
    launchAtStartup: launchAtStartup(),
    canLaunchAtStartup: canLaunchAtStartup(),
    firstRun: !configFile,
  }));
  ipcMain.handle('settings:test', async (_e, values) => {
    const probe = new Monitor(merge(config, { services: pickServices(values.services) }));
    const snapshot = await probe.tick();
    return snapshot.services.map(({ id, state, summary }) => ({ id, state, summary }));
  });
  ipcMain.handle('settings:save', (_e, values) => {
    try {
      const target = configFile || path.join(app.getPath('userData'), 'config.json');
      saveConfig(target, { services: pickServices(values.services) });
      setLaunchAtStartup(Boolean(values.launchAtStartup));
      reloadConfig();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('n8n:execution', (_e, { workflowId, id } = {}) => {
    const safe = (v) => /^[A-Za-z0-9_-]+$/.test(String(v));
    if (!safe(workflowId) || !safe(id)) return;
    shell.openExternal(`${config.services.n8n.url.replace(/\/+$/, '')}/workflow/${workflowId}/executions/${id}`);
  });

  ipcMain.on('chat:mode', (_e, open) => setChatOpen(open));
  ipcMain.handle('chat:models', async () => {
    const problem = chatConfigError();
    if (problem) return { error: problem };
    try {
      return { models: await listModels(config.services.openwebui) };
    } catch (err) {
      return { error: chatErrorMessage(err) };
    }
  });
  ipcMain.on('chat:send', async (event, { id, model, messages }) => {
    const sender = event.sender;
    const problem = chatConfigError();
    if (problem) return sender.send('chat:error', { id, message: problem });

    chatAbort?.abort();
    const abort = new AbortController();
    chatAbort = abort;
    const { systemPrompt } = config.chat;
    const full = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
    try {
      await streamChat(config.services.openwebui, {
        model,
        messages: full,
        signal: abort.signal,
        onDelta: (text) => sender.send('chat:delta', { id, text }),
      });
      sender.send('chat:done', { id });
    } catch (err) {
      if (abort.signal.aborted) sender.send('chat:done', { id, stopped: true });
      else sender.send('chat:error', { id, message: chatErrorMessage(err) });
    } finally {
      if (chatAbort === abort) chatAbort = null;
    }
  });
  ipcMain.on('chat:stop', () => chatAbort?.abort());

  registerShortcut();

  if (!configFile) openSettings();
  app.on('second-instance', openSettings);

  screen.on('display-metrics-changed', placeIsland);
});

// Living in the tray: hiding the island must not quit the app.
app.on('window-all-closed', () => {});
app.on('will-quit', () => globalShortcut.unregisterAll());

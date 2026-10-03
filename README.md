# ciouciou

A tray icon + floating "island" (à la [Coucou](https://github.com/Louis-CFM/coucou)) that watches the
self-hosted AI side of a homelab instead of local coding agents:

| Service    | What it shows                                                        | Needs a key?           |
|------------|----------------------------------------------------------------------|------------------------|
| Ollama     | Up/down, loaded models, VRAM/GPU split, **busy** when a model is used | No                     |
| Open WebUI | Up/down, version, available models                                    | Optional (models list) |
| n8n        | Up/down, **running workflows**, recent failures                       | Optional (executions)  |

Each service has its own pixel chick (*cui-cui*): cream = Ollama, blue = Open WebUI, pink = n8n.

| Chick                         | Means                                   |
|-------------------------------|-----------------------------------------|
| bobbing, blinking             | up and idle                             |
| hopping, flapping, `^ ^` eyes | busy (model generating, workflow running) |
| sweat drop, shivering         | degraded (e.g. API key rejected)        |
| grey, tipped over, `x x` eyes | down                                    |
| wobbling egg                  | not checked yet                         |

On a notification the chick jumps and the message takes over the headline for a few seconds. The tray
icon is a yellow chick with a coloured status badge whenever something isn't simply up.
Hover the island to expand it; click Open WebUI / n8n rows to open them in the browser.

Notifications: service down / back up, Ollama model loaded, n8n workflow failed (each can be toggled).
A service only counts as down after `downAfterFailures` (default 2) failed checks in a row, so a single
DNS hiccup doesn't flash red.

## Home: services + workflow launcher

Hovering the island opens the home view: two cards side by side.

- **Services** (left): each service's chick, state, summary and details.
- **Right card: a carousel of panels.** Switch with the ‹ › arrows, the dots, or a horizontal touchpad
  swipe (Shift+wheel with a mouse); the last panel you viewed is remembered.
  - **Activity**: the latest n8n executions with status, age and duration, plus a 24 h ok/failed count.
    Click one to open it in n8n.
  - **Models**: what Ollama has in memory (size, % on GPU, when it unloads) and every installed model
    with its parameter count, quantization and size on disk.
  - To add a panel: a `.panel` block in `src/island.html` and a render function in `src/panels.js`.
- **Workflows** (first carousel panel): start n8n workflows with one button. Click **Run**, then **Confirm?** within
  3 seconds — the double click keeps a stray hover-click from firing a workflow. The result (n8n's reply
  or the HTTP error) shows under the name, the n8n chick cheers, and a notification is sent
  (`notifications.workflowStarted`). Each row also shows the last run's status and age; click the name
  to open the workflow in the n8n editor.

n8n's public API has no "run workflow" endpoint, so the launcher calls each workflow's **Webhook
trigger** (`<n8n url>/webhook/<path>`, with `source=ciouciou` and `triggeredAt` as query parameters for
GET or a JSON body otherwise). Only workflows with an enabled Webhook node are listed; they show as
unavailable when the workflow is inactive, the path has `:parameters`, or the webhook requires
authentication. For header-auth webhooks, give the header per workflow id:

```json
"n8n": { "webhookHeaders": { "v0m3cXEKjyv0LYx1": { "X-Api-Key": "…" } } }
```

The id is the last part of the workflow's URL in the n8n editor.

## Chat with Open WebUI

Press **Ctrl+Alt+O** (or tray → *Ask Open WebUI…*, or the *Ask* button on the expanded island) to open
the chat panel, which grows into a large 720 px panel while focused: pick a model, type, **Enter** to send
(Shift+Enter for a new line). Replies stream in with Markdown rendered (code blocks, inline code, bold,
lists); follow-ups keep the conversation until you hit *New*. **Esc** closes the panel. The last model
is remembered.

- Needs `services.openwebui.apiKey` (or `OPENWEBUI_API_KEY`) — it uses Open WebUI's OpenAI-compatible
  `/api/chat/completions`, so every model Open WebUI exposes (Ollama, OpenAI, pipelines…) is selectable.
- These chats are **not** saved in Open WebUI's history — that API is stateless.
- `chat.systemPrompt` is prepended to every conversation if set.
- `chat.shortcut` takes an [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator).
  If another app already owns it, ciouciou falls back to Ctrl+Shift+O, Alt+Shift+O, then Ctrl+Alt+K; the
  tray menu shows whichever one is active. (Ctrl+Alt+Space is taken by the Claude desktop app's quick entry.)

## Themes

Six looks, switchable live from the colour swatches in the expanded view's footer or tray → *Theme*
(the choice is remembered in the app's `state.json`; `island.theme` in config sets the default):

| Theme         | Look                                                                    |
|---------------|-------------------------------------------------------------------------|
| Midnight      | Solid black notch (default)                                             |
| Cybercore     | Neon cyan/magenta, monospace, cut corners, scanlines, glitchy alerts    |
| Futuristic    | Deep navy gradient, hairline glow, a light sweeping along the edge      |
| Glassmorphism | Frosted panes over soft colour blobs, bright edge highlights            |
| Neumorphism   | Soft light-grey extruded UI; pressed states sink in                     |
| Flat          | Bright, bold solid colours, no shadows or gradients                     |

Themes only override CSS variables (see the tokens at the top of `src/island.html`), so adding one
is a block of variables plus an entry in `src/themes.js`.

## Animations

The island window has a fixed size and is transparent and click-through outside the island; it only
takes the mouse while the pointer is over the island. All motion — the spring-eased width change, the
sections unfolding, content fading in, the chicks — is pure CSS on the compositor, so it runs at the
display's frame rate instead of waiting on native window resizes.

## Island position

`island.position`: `"center"` (default) hangs from the top edge like a notch — solid black, square top,
curved shoulders. `"left"` / `"right"` float in a corner instead, e.g. if another notch app such as
Coucou already sits at the top centre.

## Install (Windows)

```sh
npm run build      # -> dist/ciouciou Setup <version>.exe
```

Send that one file. Double-clicking it installs ciouciou for the current user (no admin rights),
adds Start-menu and desktop shortcuts, and starts it. On first launch:

- a **Welcome** settings window opens with your homelab addresses already filled in (taken from
  your `config.json` at build time by `scripts/make-preset.js` — **API keys are never included in the
  installer**). Paste the Open WebUI and n8n keys, click *Test connection*, then *Save*.
- ciouciou registers itself to **start with Windows**; toggle it in tray → *Launch at startup* or in
  Settings.

Tray → *Settings…* reopens that window any time. Installed copies keep their settings in
`%APPDATA%ciouciouconfig.json`. The installer isn't code-signed, so Windows SmartScreen shows
"Windows protected your PC" the first time: *More info* → *Run anyway*.

## Run

```sh
npm install
cp config.example.json config.json   # then edit URLs/keys
npm start                            # tray + island
npm run status                       # one-shot headless check (exit 1 if anything is down)
npm run watch                        # headless, keeps polling
```

Config is looked up in: `$CIOUCIOU_CONFIG`, `./config.json`, the app folder, then the Electron user-data
folder (tray → *Edit config…* creates one there). Env vars override the file, so keys can stay out of it:
`OLLAMA_URL`, `OPENWEBUI_URL`, `OPENWEBUI_API_KEY`, `N8N_URL`, `N8N_API_KEY`.

## Homelab setup notes

- **Ollama** listens on `127.0.0.1` by default. On the server set `OLLAMA_HOST=0.0.0.0`
  (systemd: `systemctl edit ollama` → `Environment="OLLAMA_HOST=0.0.0.0"`) and allow TCP 11434 from your
  LAN in pfSense if the box is on another subnet.
- **Open WebUI** key: *Settings → Account → API keys* (API keys must be enabled by an admin in
  *Admin Panel → Settings → General*).
- **n8n** key: *Settings → n8n API → Create an API key*. The running-executions list needs a recent n8n;
  older versions still get health + failures.
- Going through Nginx Proxy Manager works too — just put the proxied URL in the config.

## How "busy" works

- **Ollama** has no "request in flight" endpoint, but every request pushes a loaded model's `expires_at`
  forward. A changed expiry between two polls (or a newly loaded model) = busy for that poll.
  With `keep_alive: -1` the expiry never moves, so activity can't be detected.
- **n8n** is busy while `/api/v1/executions?status=running` returns anything.

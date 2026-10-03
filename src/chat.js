'use strict';

// Chat panel: pick an Open WebUI model and stream replies. Shares `island`, `makeChick` and `setChickState` with island.js.

const chat = window.ciouciou.chat;
const modelSelect = document.getElementById('model');
const log = document.getElementById('log');
const notice = document.getElementById('notice');
const composer = document.getElementById('composer');
const promptBox = document.getElementById('prompt');
const sendButton = document.getElementById('send');

const MODEL_KEY = 'ciouciou.model';

// Open WebUI's chick sits in the chat header and hops while a reply streams in.
const chatChick = makeChick('openwebui', 2);
document.getElementById('chat-chick').replaceWith(chatChick);
setChickState(chatChick, 'up');
const emptyState = document.getElementById('empty');
const emptyChick = makeChick('openwebui', 5);
document.getElementById('empty-chick').replaceWith(emptyChick);
setChickState(emptyChick, 'up');

let messages = [];
let streaming = null; // { id, bubble, text, started }
let nextId = 1;

function storage(fn) {
  try {
    return fn(window.localStorage);
  } catch {
    return null;
  }
}

function showNotice(text) {
  notice.hidden = !text;
  notice.textContent = text || '';
}

async function loadModels() {
  const current = modelSelect.value || storage((s) => s.getItem(MODEL_KEY));
  showNotice('Loading models…');
  const { models, error } = await chat.models();
  if (error) {
    showNotice(error);
    modelSelect.innerHTML = '';
    updateComposer();
    return;
  }
  modelSelect.innerHTML = '';
  for (const m of models) modelSelect.add(new Option(m.name, m.id));
  if (models.some((m) => m.id === current)) modelSelect.value = current;
  showNotice(models.length ? '' : 'Open WebUI returned no models.');
  updateComposer();
}

function addBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `msg ${role}`;
  bubble.textContent = text;
  emptyState.hidden = true;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

function updateComposer() {
  setChickState(chatChick, streaming ? 'busy' : 'up');
  sendButton.textContent = streaming ? 'Stop' : 'Send';
  sendButton.classList.toggle('stop', Boolean(streaming));
  sendButton.disabled = !streaming && (!modelSelect.value || !promptBox.value.trim());
}

function autosize() {
  promptBox.style.height = 'auto';
  promptBox.style.height = `${Math.max(44, promptBox.scrollHeight + 2)}px`;
  updateComposer();
}

function send() {
  const content = promptBox.value.trim();
  const model = modelSelect.value;
  if (!content || !model || streaming) return;

  messages.push({ role: 'user', content });
  addBubble('user', content);
  promptBox.value = '';
  autosize();

  const id = nextId++;
  const bubble = addBubble('assistant pending', '');
  streaming = { id, bubble, text: '', model, started: performance.now() };
  updateComposer();
  chat.send(id, model, messages);
}

function finish(meta) {
  const { bubble, text, model, started } = streaming;
  bubble.classList.remove('pending');
  const info = document.createElement('span');
  info.className = 'meta';
  info.textContent = `${modelSelect.querySelector(`option[value="${CSS.escape(model)}"]`)?.text || model} · ${((performance.now() - started) / 1000).toFixed(1)}s${meta ? ` · ${meta}` : ''}`;
  bubble.appendChild(info);
  streaming = null;
  updateComposer();
  return text;
}

chat.onDelta(({ id, text }) => {
  if (streaming?.id !== id) return;
  streaming.text += text;
  streaming.bubble.innerHTML = Markdown.render(streaming.text);
  log.scrollTop = log.scrollHeight;
});

chat.onDone(({ id, stopped }) => {
  if (streaming?.id !== id) return;
  const text = finish(stopped ? 'stopped' : '');
  if (text) messages.push({ role: 'assistant', content: text });
  else messages.pop(); // Nothing came back: drop the prompt so a retry doesn't send it twice.
});

chat.onError(({ id, message }) => {
  if (streaming?.id !== id) return;
  streaming.bubble.classList.add('error');
  streaming.bubble.textContent = message;
  finish('');
  messages.pop();
});

chat.onOpen((open) => {
  island.classList.toggle('chatting', open);
  if (open) {
    loadModels();
    promptBox.focus();
  } else {
    // Still hovering after closing? Keep taking clicks; mouseenter won't fire again.
    window.ciouciou.setInteractive(island.matches(':hover'));
  }
});

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  if (streaming) chat.stop();
  else send();
});
promptBox.addEventListener('input', autosize);
promptBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
modelSelect.addEventListener('change', () => {
  storage((s) => s.setItem(MODEL_KEY, modelSelect.value));
  updateComposer();
});
document.getElementById('new-chat').addEventListener('click', () => {
  if (streaming) chat.stop();
  messages = [];
  log.replaceChildren(emptyState);
  emptyState.hidden = false;
  promptBox.focus();
});
document.getElementById('close-chat').addEventListener('click', () => chat.setOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && island.classList.contains('chatting')) chat.setOpen(false);
});

updateComposer();

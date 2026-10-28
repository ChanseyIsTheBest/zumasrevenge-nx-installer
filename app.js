import { findGames, identifyGames, programPath } from './lib/installer.js';
import { FLAGS } from './lib/flags.js';
import { LANGUAGES, formatSize, getLanguage, preferredLanguage, setLanguage, t } from './lib/i18n.js';

const chosenBox = document.getElementById('chosen');
const create = document.getElementById('create');
const update = document.getElementById('update');
const bar = document.getElementById('bar');
const logBox = document.getElementById('log');
const detected = document.getElementById('detected');
const status = document.getElementById('status');
const detail = document.getElementById('detail');
const fingerprint = document.getElementById('fingerprint');
const languages = document.getElementById('languages');
const sourceLink = document.getElementById('sourceLink');
const TITLE = 'Zuma’s Revenge';
const manifest = fetch('./release/manifest.json').then((r) => r.json());
const LANGUAGE_KEY = 'zumasrevenge-nx.language';
// the files the player chose ([{ path, file }]) and what was found in them
let source = null;
let check = 0;
// what the page shows about the chosen game, kept as data so it can be drawn again in another language
let chosenView = null;
let detectedView = null;
// the frame that opened the last download
let downloadFrame = null;
let busy = false;
// whether the full package can be made (the game, as tested)
let complete = false;

// On GitHub Pages (<owner>.github.io/<repository>) the source code is the owner's zumasrevenge-nx repository.
if (location.hostname.endsWith('.github.io')) {
  sourceLink.href = `https://github.com/${location.hostname.split('.')[0]}/zumasrevenge-nx`;
} else {
  sourceLink.removeAttribute('href');
}

function log(text, error = false) {
  const line = document.createElement('div');
  line.textContent = text;
  if (error) {
    line.className = 'error';
  }
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function renderChosen() {
  chosenBox.textContent = '';
  if (!chosenView) {
    chosenBox.textContent = t('nothingChosen');
    return;
  }
  const lines = [];
  const { game } = chosenView;
  lines.push(game ? t('chosenGame', { name: game.name || 'default.xex' }) : t('chosenNoGame'));
  for (const line of lines) {
    const div = document.createElement('div');
    div.textContent = line;
    chosenBox.appendChild(div);
  }
}

function showDetected(state, statusText, detailText = '', hash = '') {
  detected.hidden = false;
  detected.className = `detected ${state}`;
  status.textContent = statusText;
  detail.textContent = detailText;
  detail.hidden = !detailText;
  fingerprint.textContent = hash;
  fingerprint.hidden = !hash;
}

function renderDetected() {
  const v = detectedView;
  if (!v) {
    detected.hidden = true;
    return;
  }
  switch (v.kind) {
    case 'checking':
      showDetected('', t('checking'));
      break;
    case 'supported':
      showDetected('good', TITLE, t('supported'));
      break;
    case 'unsupported':
      showDetected('bad', TITLE, t('unsupported'), v.hash);
      break;
    case 'notGame':
      showDetected('bad', t('notGame'), v.other ? t('otherTitle', { name: v.other }) : t(v.code || 'noGame'));
      break;
    case 'error':
      showDetected('bad', t('notGame'), v.message);
      break;
  }
}

function applyLanguage(code) {
  setLanguage(code);
  document.documentElement.lang = getLanguage();
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  // our own texts, with <strong>, <code> and the Sphaira link
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  languages.setAttribute('aria-label', t('languageBar'));
  for (const button of languages.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === getLanguage()));
  }
  renderChosen();
  renderDetected();
}

for (const { code, name, flag } of LANGUAGES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.lang = code;
  button.title = name;
  button.setAttribute('aria-label', name);
  button.setAttribute('lang', code);
  button.innerHTML = FLAGS[flag];
  button.addEventListener('click', () => {
    applyLanguage(code);
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch {
      // private windows and blocked storage: the choice just lasts for this visit
    }
  });
  languages.appendChild(button);
}
languages.hidden = LANGUAGES.length < 2;
let saved = null;
try {
  saved = localStorage.getItem(LANGUAGE_KEY);
} catch {
  saved = null;
}
applyLanguage(preferredLanguage(saved, navigator.languages || [navigator.language]));

function asFiles(entries) {
  return entries.map(({ path, file }) => ({
    path,
    size: file.size,
    read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  }));
}

// Every file chosen so far ([{ path, file }]): the game may come from several choices.
let entriesSoFar = [];

// Finds the games in everything chosen so far and identifies them.
async function choose(added) {
  const id = ++check;
  const seen = new Set(entriesSoFar.map((e) => e.path));
  entriesSoFar = entriesSoFar.concat(added.filter((e) => !seen.has(e.path)));
  source = null;
  setButtons(false);
  detectedView = { kind: 'checking' };
  renderDetected();
  try {
    const found = await findGames(asFiles(entriesSoFar));
    if (id !== check) {
      return;
    }
    chosenView = { game: found.game };
    renderChosen();
    if (!found.game) {
      detectedView = { kind: 'notGame', other: found.others[0] };
    } else {
      const games = await identifyGames(found, await manifest);
      if (id !== check) {
        return;
      }
      if (games.build) {
        complete = !games.problems.length;
        source = complete ? entriesSoFar : null;
        detectedView = games.problems.length
          ? { kind: 'error', message: t(games.problems[0]) }
          : { kind: 'supported' };
        setButtons(complete);
        // the program is kept by the browser now, so the package can be made even if the connection drops
        const url = new URL(programPath(games.build), location.href).href;
        helper.then((controller) => controller.postMessage({ type: 'keep-program', url }), () => {});
      } else {
        detectedView = { kind: 'unsupported', hash: games.xexHash };
      }
    }
  } catch (error) {
    if (id !== check) {
      return;
    }
    detectedView = error.code ? { kind: 'notGame', code: error.code } : { kind: 'error', message: error.message };
  }
  renderDetected();
}

document.getElementById('package').addEventListener('change', async (event) => {
  const list = [...event.target.files];
  event.target.value = '';
  if (list.length) {
    await choose(list.map((file) => ({ path: file.name, file })));
  }
});

document.getElementById('folder').addEventListener('change', async (event) => {
  const list = [...event.target.files];
  event.target.value = '';
  if (list.length) {
    await choose(list.map((file) => ({ path: file.webkitRelativePath, file })));
  }
});

document.getElementById('clear').addEventListener('click', () => {
  check++;
  entriesSoFar = [];
  source = null;
  chosenView = null;
  detectedView = null;
  setButtons(false);
  renderChosen();
  renderDetected();
});

// The zip is served by sw.js as a normal browser download, streamed while it is being generated.
async function downloadHelper() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('noStreaming');
  }
  // the browser checks sw.js itself with the server on every visit, not with its own cache (see fetchFresh in sw.js)
  await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  const registration = await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) {
    // a new version of the page brings a new sw.js, which takes over this page while it is open: the files of this
    // visit came through the old one, so the page loads again once, unless the player has already chosen a game
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!chosenView && !reloading) {
        reloading = true;
        location.reload();
      }
    });
  }
  if (!navigator.serviceWorker.controller) {
    const claimed = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    // a forced reload (Ctrl+F5) opens the page without its service worker, which then has to take it back
    registration.active.postMessage({ type: 'claim' });
    await claimed;
  }
  // a copy of every page file, so the page can be used again without a connection
  navigator.serviceWorker.controller.postMessage({ type: 'keep-page' });
  return navigator.serviceWorker.controller;
}
let reloading = false;
if ('serviceWorker' in navigator) {
  // sw.js asks every open page which version it is when a new version takes over: this one answers, so it is not
  // reloaded under the player (see refreshOldPages in sw.js)
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'version' && event.ports[0]) {
      event.ports[0].postMessage('current');
    }
  });
  navigator.serviceWorker.startMessages();
}
const helper = downloadHelper();
helper.catch(() => {});

function setButtons(enabled) {
  create.disabled = !enabled || busy || !complete;
  update.disabled = !enabled || busy;
}

// update: only the program, for a folder that is already on the SD card.
async function makePackage(onlyUpdate) {
  if (!source || busy) {
    return;
  }
  let controller;
  try {
    controller = await helper;
  } catch (error) {
    log(t('error', { message: error.message === 'noStreaming' ? t('noStreaming') : error.message }), true);
    return;
  }
  const filename = onlyUpdate ? 'zumasrevenge-nx-update.zip' : 'zumasrevenge-nx.zip';
  busy = true;
  setButtons(false);
  bar.hidden = false;
  bar.value = 0;
  logBox.textContent = '';
  const started = Date.now();
  const channel = new MessageChannel();
  const keepAlive = setInterval(() => controller.postMessage({ type: 'ping' }), 10000);
  const worker = new Worker('./worker.js', { type: 'module' });
  const finish = () => {
    clearInterval(keepAlive);
    worker.terminate();
    busy = false;
    setButtons(Boolean(source));
  };
  worker.onmessage = async ({ data }) => {
    if (data.type === 'log') {
      log(data.text);
    } else if (data.type === 'progress') {
      bar.value = data.fraction;
    } else if (data.type === 'size') {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ack = new MessageChannel();
      const registered = new Promise((resolve) => (ack.port1.onmessage = resolve));
      controller.postMessage({ type: 'download', id, filename, size: data.size }, [channel.port2, ack.port2]);
      await registered;
      // a hidden frame opens the download: its request is a navigation, which always reaches the service worker
      // (Chrome sends the request of an <a download> link straight to the network, where the file does not exist)
      downloadFrame?.remove();
      downloadFrame = document.createElement('iframe');
      downloadFrame.hidden = true;
      downloadFrame.src = `./download/${id}/${filename}`;
      document.body.appendChild(downloadFrame);
      log(t('downloadStarted', { size: formatSize(data.size) }));
    } else if (data.type === 'done') {
      bar.value = 1;
      log(t('finished', { seconds: Math.round((Date.now() - started) / 1000) }));
      finish();
    } else if (data.type === 'error') {
      log(t('error', { message: data.message }), true);
      finish();
    }
  };
  worker.onerror = (event) => {
    log(t('error', { message: event.message }), true);
    finish();
  };
  worker.postMessage({ entries: source, lang: getLanguage(), update: onlyUpdate, port: channel.port1 }, [channel.port1]);
}

create.addEventListener('click', () => makePackage(false));
update.addEventListener('click', () => makePackage(true));

// Runs the whole package build off the main thread and streams the zip to the download service worker.
// From bejeweled3-nx-installer's worker.js, without the shader step's WebAssembly modules.
import { createPackage, findGames, identifyGames, releasePath, sha256 } from './lib/installer.js';
import { setLanguage, t } from './lib/i18n.js';

const log = (text) => postMessage({ type: 'log', text });
const progress = (fraction) => postMessage({ type: 'progress', fraction });

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(t('downloadFailed', { url, status: response.status }));
  }
  return new Uint8Array(await response.arrayBuffer());
}

// A release file, checked against the SHA-256 the manifest gives for it.
async function fetchChecked(name, hash) {
  const bytes = await fetchBytes(releasePath(name, hash));
  const got = await sha256(bytes);
  if (got !== hash) {
    throw new Error(t('buildMismatch', { name, hash: got }));
  }
  return bytes;
}

// Sends every write as one chunk, and only when the download has asked for more ("pull").
function portSink(port) {
  let credits = 0;
  let cancelled = false;
  let waiting = null;
  port.onmessage = ({ data }) => {
    if (data.type === 'pull') {
      credits++;
    } else if (data.type === 'cancel') {
      cancelled = true;
    }
    if (waiting) {
      const wake = waiting;
      waiting = null;
      wake();
    }
  };
  return {
    async write(bytes) {
      while (!credits) {
        if (cancelled) {
          throw new Error(t('cancelled'));
        }
        await new Promise((resolve) => (waiting = resolve));
      }
      if (cancelled) {
        throw new Error(t('cancelled'));
      }
      credits--;
      const copy = bytes.slice();
      port.postMessage({ type: 'chunk', buffer: copy.buffer }, [copy.buffer]);
    },
    async close() {
      port.postMessage({ type: 'end' });
    },
    fail(message) {
      port.postMessage({ type: 'error', message });
    },
  };
}

// The files the page received from the player, in the form lib/installer.js reads them.
function chosenFiles(entries) {
  return entries.map(({ path, file }) => ({
    path,
    size: file.size,
    read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  }));
}

self.onmessage = async ({ data }) => {
  setLanguage(data.lang);
  const sink = portSink(data.port);
  try {
    log(t('readingFiles'));
    const chosen = await findGames(chosenFiles(data.entries));
    if (!chosen.game) {
      throw new Error(t('noGame'));
    }
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('./release/manifest.json')));
    const { build, xexHash } = await identifyGames(chosen, manifest);
    if (!build) {
      throw new Error(t('notSupportedYet', { hash: xexHash }));
    }
    log(t('downloadingBuild'));
    const [nro, licenses] = await Promise.all([
      fetchChecked(build.nro, build.nro_sha256),
      fetchBytes('./release/LICENSES.txt'),
    ]);
    const release = { manifest, nro, licenses };
    const result = await createPackage(chosen, release, sink, log, progress,
      (size) => postMessage({ type: 'size', size }), { update: Boolean(data.update) });
    postMessage({ type: 'done', result });
  } catch (error) {
    const message = error.message || String(error);
    sink.fail(message);
    postMessage({ type: 'error', message });
  }
};

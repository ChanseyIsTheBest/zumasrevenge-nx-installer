// Builds the zumasrevenge-nx.zip package from the player's own copy of Zuma's Revenge (Xbox Live Arcade, title 584111E9):
// the game's content package (read in place) or a folder it was extracted into. The game has no title update and no
// add-on.
//
// The zip holds the Switch build (zumasrevenge.nro) and its licenses, and the game's files as the asset pack the console
// mounts (game_root.nxpack + .nxidx). The NRO carries all 75 of the game's shaders (71 stored in its executable and
// 4 it compiles while it runs), so the page has none to make. The settings file, zumasrevenge.toml, is written by the game at its first start, so
// an update never replaces the player's settings.
//
// From feedingfrenzy-nx-installer (2026-10-28), itself from bejeweled3-nx-installer without its shader step, with the
// game's subfolders (the pack keeps them, as tools/build_asset_pack.py does).

import { StfsPackage, readStfsHeader } from './from_sa2/stfs_package.js';
import { Fnv64, packChunks, packIndex, planPack } from './nxpack.js';
import { ZipWriter, zipSize } from './zip.js';
import { t } from './i18n.js';

const CHUNK = 16 * 1024 * 1024;
const ROOT = 'zumasrevenge-nx';
const NRO = 'zumasrevenge.nro';
const TITLE_ID = 0x584111e9;
const CONTENT_GAME = 0x000d0000;
// An extracted game: default.xex with this file beside it (lower case).
const MARKER = 'main.rsb';
// files whose header is read to find the packages among the chosen files
const MAX_CANDIDATES = 256;
const JUNK = /(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/i;

export async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function* chunksOf(file) {
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    yield await file.read(offset, Math.min(CHUNK, file.size - offset));
  }
}

function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function folderOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

// Where a release file is downloaded from. Its SHA-256 is part of the address, so every version is a different
// address and a copy kept by the browser is never mistaken for a newer one.
export function releasePath(name, hash) {
  return `./release/${name}?sha256=${hash}`;
}

export function programPath(build) {
  return releasePath(build.nro, build.nro_sha256);
}

// Sorts out what the player chose (files [{ path, size, read }] from the "Files" button or every file under the
// "Folder"). Returns { game, others }:
//   game = { kind: 'package' | 'folder', name, files } (the game's files, paths relative to the game) or null;
//   others = names of packages of other games.
export async function findGames(chosen) {
  let game = null;
  const others = [];
  // An extracted game: the shallowest default.xex with the marker file beside it; every file under its folder.
  const paths = new Set(chosen.map((f) => f.path.toLowerCase()));
  const folders = [...new Set(chosen.filter((f) => baseName(f.path).toLowerCase() === 'default.xex').map((f) => folderOf(f.path)))]
    .sort((a, b) => a.split('/').length - b.split('/').length);
  for (const folder of folders) {
    if (paths.has(`${folder}${MARKER}`.toLowerCase())) {
      const files = chosen.filter((f) => f.path.startsWith(folder))
        .map((f) => ({ ...f, path: f.path.slice(folder.length) }))
        .filter((f) => !JUNK.test(f.path));
      game = { kind: 'folder', name: folder ? baseName(folder.slice(0, -1)) : '', files };
      break;
    }
  }
  // Packages, by their header (Xbox 360 content packages have no extension; the game's own file types are left out).
  const inside = (f) => game && game.kind === 'folder' && game.files.some((h) => h.read === f.read);
  const candidates = chosen.filter((f) => f.size >= 0xa000 && !inside(f)
    && !/\.(xpr|xwb|xsb|xgs|png|jpg|jpeg|xml|info|wmv|xex|bin|zip|nro|toml|txt|db|ini)$/i.test(f.path)).slice(0, MAX_CANDIDATES);
  for (const file of candidates) {
    const header = readStfsHeader(await file.read(0, 0x600));
    if (!header) {
      continue;
    }
    const name = baseName(file.path);
    if (header.titleId !== TITLE_ID) {
      others.push(header.displayName || name);
    } else if (header.contentType === CONTENT_GAME && !game) {
      const pkg = await StfsPackage.open(file);
      game = { kind: 'package', name, files: pkg.files() };
    }
  }
  return { game, others };
}

function fileNamed(files, name) {
  return files.find((f) => f.path.toLowerCase() === name);
}

// Identifies the build: default.xex by its SHA-256, the game's other files by their sizes. Returns
// { xexHash, build, problems }.
export async function identifyGames(chosen, manifest) {
  const { game } = chosen;
  if (!game) {
    const error = new Error(t('noGame'));
    error.code = 'noGame';
    throw error;
  }
  const xexFile = fileNamed(game.files, 'default.xex');
  const xexHash = await sha256(await xexFile.read(0, xexFile.size));
  const build = manifest.builds.find((b) => b.xex_sha256 === xexHash) || null;
  const problems = [];
  if (build) {
    for (const want of build.game_files) {
      const f = fileNamed(game.files, want.path.toLowerCase());
      if (!f || f.size !== want.size) {
        problems.push('gameDifferent');
        break;
      }
    }
  }
  return { xexHash, build, problems };
}

// chosen: findGames(); release: { manifest, nro, licenses } (bytes)
// sink: { write(Uint8Array), close() } receiving the zip file
// onSize(bytes) is called with the exact size of the zip before the first byte is written.
// update: only the program and its licenses, for a folder already on the SD card.
export async function createPackage(chosen, release, sink, log = () => {}, progress = () => {},
  onSize = () => {}, { update = false } = {}) {
  const id = await identifyGames(chosen, release.manifest);
  const { build } = id;
  if (!build) {
    throw new Error(t('notSupportedYet', { hash: id.xexHash }));
  }
  if (id.problems.length) {
    throw new Error(t(id.problems[0]));
  }
  log(t('logBuild', { version: build.version }));
  if (update) {
    log(t('logUpdate'));
  }

  const stage = (from, to) => (f) => progress(from + (to - from) * Math.min(Math.max(f, 0), 1));
  let gameIndex = null;
  let plan = null;
  let dataChecksum = 0n;
  if (!update) {
    // The game pack: the game's files as the console mounts them.
    plan = planPack(chosen.game.files);
    log(t('checksumming', { count: plan.items.length }));
    const sum = stage(0, 0.4);
    const fnv = new Fnv64();
    let seen = 0;
    for (const item of plan.items) {
      for await (const chunk of chunksOf(item.file)) {
        fnv.update(chunk);
        seen += chunk.length;
        sum(seen / plan.packSize);
      }
    }
    dataChecksum = fnv.value();
    gameIndex = packIndex(plan, dataChecksum);
  }

  const entries = [
    { path: `${ROOT}/${NRO}`, size: release.nro.length },
    { path: `${ROOT}/LICENSES.txt`, size: release.licenses.length },
    ...(update ? [] : [
      { path: `${ROOT}/game_root.nxidx`, size: gameIndex.length },
      { path: `${ROOT}/game_root.nxpack`, size: plan.packSize },
    ]),
  ];
  onSize(zipSize(entries));
  log(t('packing'));
  const total = update ? 1 : plan.packSize;
  const write = stage(update ? 0 : 0.4, 1);
  let done = 0;
  const onChunk = (chunk) => {
    done += chunk.length;
    write(done / total);
  };
  const zip = new ZipWriter(sink);
  await zip.addBytes(`${ROOT}/${NRO}`, release.nro);
  await zip.addBytes(`${ROOT}/LICENSES.txt`, release.licenses);
  if (!update) {
    await zip.addBytes(`${ROOT}/game_root.nxidx`, gameIndex);
    await zip.addFile(`${ROOT}/game_root.nxpack`, plan.packSize,
      packChunks(plan, dataChecksum, (item) => chunksOf(item.file)), onChunk);
  }
  await zip.finish();
  progress(1);
  log(t('done'));
  return { version: build.version, update };
}

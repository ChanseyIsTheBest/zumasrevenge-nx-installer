// Writes the build's entry of release/manifest.json from the tested files: the player's game (its package or the folder
// it was extracted into) and the NRO in release/. From bejeweled3-nx-installer's test/bj3_manifest_node.mjs without the
// shaders (the NRO carries all of the game's).
// Usage: node test/manifest_node.mjs <game package or folder> <version> [--write]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chosenOnDisk, root } from './node_files.mjs';
import { findGames, identifyGames } from '../lib/installer.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const [input, version] = args.filter((a) => a !== '--write');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const chosen = await findGames(chosenOnDisk([input]));
if (!chosen.game) {
  throw new Error(`no Zuma's Revenge game in ${input}`);
}
const { xexHash } = await identifyGames(chosen, { builds: [] });
const nro = fs.readFileSync(path.join(root, 'release', 'zumasrevenge.nro'));
const build = {
  edition: 'Xbox Live Arcade (title 584111E9)',
  version,
  xex_sha256: xexHash,
  game_files: chosen.game.files.map((f) => ({ path: f.path, size: f.size })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  nro: 'zumasrevenge.nro',
  nro_sha256: sha(nro),
  nro_size: nro.length,
};
const manifest = { version: 1, builds: [build] };
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (write) {
  fs.writeFileSync(path.join(root, 'release', 'manifest.json'), text);
  console.log(`wrote release/manifest.json (${build.game_files.length} game files, NRO ${build.nro_sha256})`);
} else {
  process.stdout.write(text);
}

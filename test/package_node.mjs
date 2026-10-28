// Builds zumasrevenge-nx.zip (or zumasrevenge-nx-update.zip) in Node from the player's files, with the same code the page runs.
// The NRO is taken from release/ (put it there first: the deployment downloads it from the zumasrevenge-nx release).
// Usage: node test/package_node.mjs <output zip> <packages or folders ...> [--update]
import fs from 'node:fs';
import path from 'node:path';
import { chosenOnDisk, root } from './node_files.mjs';
import { createPackage, findGames } from '../lib/installer.js';

const args = process.argv.slice(2);
const update = args.includes('--update');
const [output, ...inputs] = args.filter((a) => a !== '--update');
if (!output || !inputs.length) {
  console.error('usage: node test/package_node.mjs <output zip> <packages or folders ...> [--update]');
  process.exit(1);
}

const chosen = await findGames(chosenOnDisk(inputs));
const describe = (game) => (game ? `${game.kind} ${game.name} (${game.files.length} files)` : 'not found');
console.log(`game: ${describe(chosen.game)}`);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release/manifest.json'), 'utf8'));
const build = manifest.builds[0];
const release = {
  manifest,
  nro: new Uint8Array(fs.readFileSync(path.join(root, 'release', build.nro))),
  licenses: new Uint8Array(fs.readFileSync(path.join(root, 'release/LICENSES.txt'))),
};
const fd = fs.openSync(output, 'w');
const sink = {
  async write(bytes) {
    fs.writeSync(fd, bytes);
  },
  async close() {},
};
const started = Date.now();
let last = -1;
let expected = 0;
const result = await createPackage(chosen, release, sink,
  (text) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)} s] ${text}`),
  (f) => {
    const pct = Math.floor(f * 100);
    if (pct !== last && pct % 10 === 0) {
      last = pct;
      console.log(`  ${pct} %`);
    }
  },
  (size) => {
    expected = size;
    console.log(`zip: ${size} bytes`);
  }, { update });
fs.closeSync(fd);
const actual = fs.statSync(output).size;
console.log(`${output}: ${actual} bytes (${actual === expected ? 'the announced size' : `announced ${expected}`}), ` +
  `build ${result.version}, ${((Date.now() - started) / 1000).toFixed(0)} s`);

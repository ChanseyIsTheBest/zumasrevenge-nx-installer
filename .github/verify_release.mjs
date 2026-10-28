// Checks that every NRO named in release/manifest.json is in release/ and has the SHA-256 the list expects.
// Usage: node .github/verify_release.mjs (from the root of the repository)
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(fs.readFileSync('release/manifest.json', 'utf8'));
let bad = 0;
for (const build of manifest.builds) {
  const files = [[build.nro, build.nro_sha256]];
  if (build.hd_recipe) {
    files.push([build.hd_recipe.file, build.hd_recipe.sha256]);
  }
  for (const [name, want] of files) {
    const path = `release/${name}`;
    if (!fs.existsSync(path)) {
      console.error(`missing: ${name} (${build.edition} ${build.version})`);
      bad++;
      continue;
    }
    const hash = createHash('sha256').update(fs.readFileSync(path)).digest('hex');
    if (hash !== want) {
      console.error(`wrong SHA-256: ${name} is ${hash}, the list expects ${want}`);
      bad++;
    } else {
      console.log(`ok: ${name} (${build.edition} ${build.version})`);
    }
  }
}
if (bad) {
  process.exit(1);
}

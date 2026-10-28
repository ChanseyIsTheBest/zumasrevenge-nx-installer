// The asset cache of the game files: game_root.nxpack + game_root.nxidx, the format of the SDK's PackDevice
// (sdk/include/rex/filesystem/devices/pack_device.h of sa2-nx, Fruit Ninja NX's asset pack version 2), byte for byte
// what tools/build_asset_pack.py writes. The console mounts the pack instead of opening thousands of files on the SD
// card, and does not have to build it on its first start.
//
// Pack: a 40-byte header, then every file 16-byte aligned, in path order (byte order of the UTF-8 '/'-separated
// relative path). Index: a 56-byte header, one 24-byte entry per file and the NUL-terminated paths. Checksums are
// 64-bit FNV-1a; the pack header and the index both carry the checksum of all the file data, so it is computed
// (a first reading of the files) before the pack is written.

// The SDK's basis, 1469598103934665603 (0x14650fb0739d0383), in 16-bit limbs, low first. It is the standard 64-bit FNV
// offset basis (14695981039346656037) without its last digit, as Fruit Ninja NX's asset_pack.c has it: the console
// compares these checksums with its own, so the pack must use the same constant.
const FNV_BASIS = [0x0383, 0x739d, 0x0fb0, 0x1465];
const FOUR_GB = 2 ** 32;
const encoder = new TextEncoder();

// 64-bit FNV-1a (the SDK's basis) in four 16-bit limbs (the prime is 2^40 + 0x1b3), about 350 MB/s in V8.
export class Fnv64 {
  constructor() {
    this.h = FNV_BASIS.slice();
  }

  update(data) {
    let [h0, h1, h2, h3] = this.h;
    for (let i = 0, n = data.length; i < n; i++) {
      h0 ^= data[i];
      const t0 = h0 * 0x1b3;
      const t1 = h1 * 0x1b3 + (t0 >>> 16);
      const t2 = h2 * 0x1b3 + ((h0 & 0xff) << 8) + (t1 >>> 16);
      const t3 = h3 * 0x1b3 + ((h1 & 0xff) << 8) + (h0 >>> 8) + (t2 >>> 16);
      h0 = t0 & 0xffff;
      h1 = t1 & 0xffff;
      h2 = t2 & 0xffff;
      h3 = t3 & 0xffff;
    }
    this.h = [h0, h1, h2, h3];
    return this;
  }

  value() {
    const [h0, h1, h2, h3] = this.h;
    return (BigInt(h3) << 48n) | (BigInt(h2) << 32n) | (BigInt(h1) << 16n) | BigInt(h0);
  }
}

function u64le(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

function compareBytes(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}

function validPath(path) {
  return path && !path.startsWith('/') && !path.endsWith('/') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..' && !part.includes('\\') && !part.includes(':'));
}

// The layout of the pack for these files ([{ path, size, read }]): { items (in pack order, with their offset), packSize,
// packId }. Throws when a path cannot go into a pack or the pack would not fit in one FAT32 file.
export function planPack(files, nonce = randomNonce()) {
  const items = files.map((f) => ({ file: f, name: encoder.encode(f.path) }));
  for (const item of items) {
    if (!validPath(item.file.path)) {
      throw new Error(`invalid path for the pack: ${item.file.path}`);
    }
  }
  items.sort((a, b) => compareBytes(a.name, b.name));
  if (!items.length || items.length > 100000) {
    throw new Error('no files, or too many files, to pack');
  }
  let packSize = 40;
  const id = new Fnv64();
  for (const item of items) {
    packSize = Math.ceil(packSize / 16) * 16;
    item.offset = packSize;
    packSize += item.file.size;
    id.update(item.name).update(u64le(item.file.size));
  }
  if (packSize >= FOUR_GB) {
    throw new Error('the pack would not fit in one FAT32 file (4 GB)');
  }
  id.update(u64le(nonce));
  const packId = id.value() || 1n;
  return { items, packSize, packId };
}

function randomNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return new DataView(bytes.buffer).getBigUint64(0, true);
}

function packHeader(plan, dataChecksum) {
  const bytes = new Uint8Array(40);
  bytes.set(encoder.encode('SSNXPAK1'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 2, true);
  view.setUint32(12, 0, true);
  view.setBigUint64(16, plan.packId, true);
  view.setBigUint64(24, BigInt(plan.packSize), true);
  view.setBigUint64(32, dataChecksum, true);
  return bytes;
}

// The bytes of the pack, as chunks: the header, then each file at its offset (zeros in between). readFile(item) yields
// the chunks of one file (so the caller can count them for its progress).
export async function* packChunks(plan, dataChecksum, readFile) {
  yield packHeader(plan, dataChecksum);
  let position = 40;
  for (const item of plan.items) {
    if (item.offset > position) {
      yield new Uint8Array(item.offset - position);
      position = item.offset;
    }
    for await (const chunk of readFile(item)) {
      yield chunk;
      position += chunk.length;
    }
  }
  if (position !== plan.packSize) {
    throw new Error('the game files changed while the pack was written');
  }
}

// The index file (game_root.nxidx) of a planned pack.
export function packIndex(plan, dataChecksum) {
  const entries = new Uint8Array(plan.items.length * 24);
  const entryView = new DataView(entries.buffer);
  const pathsSize = plan.items.reduce((sum, item) => sum + item.name.length + 1, 0);
  const paths = new Uint8Array(pathsSize);
  let at = 0;
  plan.items.forEach((item, i) => {
    entryView.setBigUint64(i * 24, BigInt(item.offset), true);
    entryView.setBigUint64(i * 24 + 8, BigInt(item.file.size), true);
    entryView.setUint32(i * 24 + 16, at, true);
    entryView.setUint32(i * 24 + 20, item.name.length, true);
    paths.set(item.name, at);
    at += item.name.length + 1;
  });
  const checksum = new Fnv64().update(entries).update(paths).value();
  const index = new Uint8Array(56 + entries.length + paths.length);
  index.set(encoder.encode('SSNXIDX1'), 0);
  const view = new DataView(index.buffer);
  view.setUint32(8, 2, true);
  view.setUint32(12, plan.items.length, true);
  view.setBigUint64(16, plan.packId, true);
  view.setBigUint64(24, BigInt(plan.packSize), true);
  view.setBigUint64(32, BigInt(pathsSize), true);
  view.setBigUint64(40, checksum, true);
  view.setBigUint64(48, dataChecksum, true);
  index.set(entries, 56);
  index.set(paths, 56 + entries.length);
  return index;
}

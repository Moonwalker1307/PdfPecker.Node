#!/usr/bin/env node
'use strict';
// Downloads the native libraries from the pdfpecker wheels on PyPI into native/<platform>/.
//
//   node scripts/fetch-native.js                  all eight platforms
//   node scripts/fetch-native.js --only current   the platform this runs on (for tests)
//   node scripts/fetch-native.js --only linux-x64,win32-x64
//
// The version is the one in package.json, which is also the PdfPecker library version. Each wheel is checked against
// the SHA-256 that PyPI lists for it before the library is taken out.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const platforms = require('./platforms');

const root = path.join(__dirname, '..');

function currentKey() {
  const { platform, arch } = process;
  if (platform !== 'linux') return `${platform}-${arch}`;
  let musl = false;
  try { musl = !process.report.getReport().header.glibcVersionRuntime; } catch { /* treat as glibc */ }
  return `linux-${arch}${musl ? '-musl' : ''}`;
}

function parseArgs(argv) {
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only' && i + 1 < argv.length) only = argv[++i].split(',');
    else {
      process.stderr.write('usage: fetch-native.js [--only current|<platform>,...]\n');
      process.exit(2);
    }
  }
  if (!only) return platforms;
  const keys = only.map((k) => k === 'current' ? currentKey() : k);
  const chosen = platforms.filter((p) => keys.includes(p.key));
  const unknown = keys.filter((k) => !platforms.some((p) => p.key === k));
  if (unknown.length) {
    process.stderr.write(`unknown platform: ${unknown.join(', ')}\n`);
    process.exit(2);
  }
  return chosen;
}

// Reads one file out of a zip archive (a wheel). Wheels are far below 4 GB, so there is no ZIP64 to handle.
function unzipEntry(zip, wanted) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    const out = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    if (!out) throw new Error(`${name} uses zip method ${method}`);
    if (out.length !== size) throw new Error(`${name} has the wrong size`);
    return out;
  }
  throw new Error(`${wanted} is not in the wheel`);
}

async function main() {
  const chosen = parseArgs(process.argv.slice(2));
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const response = await fetch(`https://pypi.org/pypi/pdfpecker/${version}/json`);
  if (!response.ok) throw new Error(`PyPI has no pdfpecker ${version} (HTTP ${response.status})`);
  const files = (await response.json()).urls.filter((f) => f.packagetype === 'bdist_wheel');
  for (const platform of chosen) {
    const target = path.join(root, 'native', platform.key, platform.library);
    const stamp = path.join(root, 'native', platform.key, 'VERSION');
    if (fs.existsSync(target) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === version) {
      console.log(`${platform.key}: ${version} already there`);
      continue;
    }
    const wheels = files.filter((f) => platform.wheel.test(f.filename));
    if (wheels.length !== 1) throw new Error(`${platform.key}: expected one wheel, PyPI lists ${wheels.length}`);
    const wheel = wheels[0];
    const download = await fetch(wheel.url);
    if (!download.ok) throw new Error(`${wheel.filename}: HTTP ${download.status}`);
    const zip = Buffer.from(await download.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
    if (sha256 !== wheel.digests.sha256) throw new Error(`${wheel.filename}: SHA-256 ${sha256} is not PyPI's`);
    const library = unzipEntry(zip, `pdfpecker/${platform.library}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, library);
    fs.writeFileSync(stamp, version);
    console.log(`${platform.key}: ${wheel.filename} -> ${path.relative(root, target)} (${library.length} bytes)`);
  }
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});

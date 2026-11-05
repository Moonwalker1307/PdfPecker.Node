#!/usr/bin/env node
'use strict';
// Builds the npm packages from this repository and native/ into dist/, and packs each into a tarball:
//
//   dist/pdfpecker-<version>.tgz                       the package people install
//   dist/pdfpecker-<platform>-<version>.tgz            @pdfpecker/<platform>, one per library in native/
//
//   node scripts/pack.js            needs all eight libraries (scripts/fetch-native.js), for a release
//   node scripts/pack.js --partial  packs the libraries that are there, for tests
//
// The main package lists every platform package as an optional dependency of the same version; npm installs only
// the one whose os, cpu and libc match the machine.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const platforms = require('./platforms');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const args = process.argv.slice(2);
if (args.some((a) => a !== '--partial')) {
  process.stderr.write('usage: pack.js [--partial]\n');
  process.exit(2);
}
const partial = args.includes('--partial');

const main = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { version } = main;

function stage(name, files, manifest) {
  const dir = path.join(dist, 'packages', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, to] of files) fs.copyFileSync(from, path.join(dir, to));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const tarball = execFileSync(npm, ['pack', '--pack-destination', dist], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' })
    .trim().split('\n').pop();
  console.log(`${manifest.name}@${manifest.version}: dist/${tarball}`);
}

fs.mkdirSync(dist, { recursive: true });
const common = [[path.join(root, 'LICENSE'), 'LICENSE'], [path.join(root, 'THIRD-PARTY-NOTICES.md'), 'THIRD-PARTY-NOTICES.md']];
const packed = [];
for (const platform of platforms) {
  const library = path.join(root, 'native', platform.key, platform.library);
  const stamp = path.join(root, 'native', platform.key, 'VERSION');
  if (!fs.existsSync(library)) {
    if (partial) continue;
    process.stderr.write(`native/${platform.key}/${platform.library} is missing; run scripts/fetch-native.js\n`);
    process.exit(1);
  }
  if (fs.readFileSync(stamp, 'utf8') !== version) {
    process.stderr.write(`native/${platform.key} holds another version than ${version}; run scripts/fetch-native.js\n`);
    process.exit(1);
  }
  const name = `@pdfpecker/${platform.key}`;
  fs.writeFileSync(path.join(dist, 'README.md'), `# ${name}\n\nThe ${platform.key} native library of ` +
    '[pdfpecker](https://www.npmjs.com/package/pdfpecker). Install `pdfpecker`, which installs this package on ' +
    'machines it fits.\n');
  stage(platform.key, [...common, [library, platform.library], [path.join(dist, 'README.md'), 'README.md']], {
    name,
    version,
    description: `PdfPecker's native library for ${platform.key}, used by the pdfpecker package.`,
    homepage: main.homepage,
    repository: main.repository,
    license: main.license,
    os: [platform.os],
    cpu: [platform.cpu],
    ...(platform.libc ? { libc: [platform.libc] } : {}),
    files: [platform.library, 'THIRD-PARTY-NOTICES.md'],
    preferUnplugged: true,
  });
  packed.push(name);
}
fs.rmSync(path.join(dist, 'README.md'), { force: true });

const manifest = { ...main };
delete manifest.scripts;
delete manifest.devDependencies;
manifest.optionalDependencies = Object.fromEntries(platforms.map((p) => [`@pdfpecker/${p.key}`, version]));
stage('pdfpecker', [...common, ...['index.js', 'index.d.ts', 'README.md'].map((f) => [path.join(root, f), f])], manifest);
if (packed.length < platforms.length) console.log(`packed ${packed.length} of ${platforms.length} platforms (--partial)`);

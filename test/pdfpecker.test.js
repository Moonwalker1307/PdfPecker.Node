'use strict';
// Runs against this checkout, which finds its library in PDFPECKER_NATIVE_LIB, an installed @pdfpecker/<platform>
// package or native/ from scripts/fetch-native.js, in that order; or, with PDFPECKER_TEST_PACKAGE, against an
// installed pdfpecker package (ci/test.sh).

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const zlib = require('node:zlib');
const ROOT = path.resolve(process.env.PDFPECKER_TEST_PACKAGE || path.join(__dirname, '..'));
const pdfpecker = require(ROOT);

function pngSize(png) {
  assert.equal(png.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function crc32(data) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function tinyPng() {
  const chunk = (kind, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(4, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from([200, 30, 30, 200, 30, 30, 200, 30, 30, 200, 30, 30])]);
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat([row, row, row, row]))), chunk('IEND', Buffer.alloc(0))]);
}

function longHtml(rows = 2000) {
  let html = '<table>';
  for (let i = 0; i < rows; i++) html += `<tr><td>Row ${i}</td><td>${i * 3}</td></tr>`;
  return html + '</table>';
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpecker-'));
}

test('the library version is the package version', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pdfpecker.libraryVersion(), version);
});

test('html to pdf, async and sync', async () => {
  const pdf = await pdfpecker.htmlToPdf('<h1>Hello</h1><p>Grüße, ünïcode — “quotes”</p>');
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(await pdfpecker.pdfPageCount(pdf), 1);
  assert.equal(await pdfpecker.pdfToText(pdf), 'Hello\n\nGrüße, ünïcode — “quotes”');
  const sync = pdfpecker.htmlToPdfSync('<h1>Hello</h1>');
  assert.equal(pdfpecker.pdfToTextSync(sync), 'Hello');
  assert.equal(pdfpecker.pdfPageCountSync(sync), 1);
});

test('bytes input and a fixed date are byte-identical', async () => {
  const html = new TextEncoder().encode('<p>same</p>');
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.deepEqual(await pdfpecker.htmlToPdf(html, { creationDate: date }),
    pdfpecker.htmlToPdfSync('<p>same</p>', { creationDate: date }));
  assert.deepEqual(await pdfpecker.htmlToPdf(html, { creationDate: '2026-01-02T00:00:00Z' }),
    await pdfpecker.htmlToPdf(html, { creationDate: 1767312000000 }));
});

test('page size, landscape and margin', async () => {
  const size = async (options) => pngSize((await pdfpecker.pdfToImages(await pdfpecker.htmlToPdf('<p>x', options),
    { dpi: 72 }))[0]);
  assert.deepEqual(await size({ pageSize: 'Letter' }), [612, 792]);
  assert.deepEqual(await size({ pageSize: 'A5', landscape: true }), [595, 420]);
  assert.deepEqual(await size({ pageSize: [100, 50], margin: [5, 5, 5, 5] }), [283, 142]);
});

test('document properties', async () => {
  const pdf = await pdfpecker.htmlToPdf('<p>x', { title: 'My title', author: 'Me', compress: false });
  assert.ok(pdf.includes('My title') || pdf.includes(Buffer.from('﻿My title', 'utf16le').swap16()));
});

test('baseDir loads images, and nothing loads without it', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'dot.png'), tinyPng());
  const html = '<img src="dot.png" style="width:100px;height:100px">';
  const without = await pdfpecker.htmlToPdf(html);
  const withDir = await pdfpecker.htmlToPdf(html, { baseDir: dir });
  assert.ok(withDir.length > without.length);
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  const outside = '<img src="../dot.png" style="width:100px;height:100px">';
  assert.ok((await pdfpecker.htmlToPdf(outside, { baseDir: sub, allowFileAccess: true })).length >
    (await pdfpecker.htmlToPdf(outside, { baseDir: sub })).length);
});

test('html and markdown files resolve images next to them', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'dot.png'), tinyPng());
  fs.writeFileSync(path.join(dir, 'doc.html'), '<h1>File</h1><img src="dot.png" width=40 height=40>');
  const pdf = await pdfpecker.htmlFileToPdf(path.join(dir, 'doc.html'), { title: 'File' });
  assert.match(await pdfpecker.pdfToText(pdf), /File/);
  assert.ok(pdf.length > (await pdfpecker.htmlToPdf('<h1>File</h1><img src="dot.png" width=40 height=40>')).length);
  fs.writeFileSync(path.join(dir, 'doc.md'), '# Heading\n\n- [x] done\n- [ ] todo\n\n![dot](dot.png)\n');
  assert.match(await pdfpecker.pdfToText(await pdfpecker.markdownFileToPdf(path.join(dir, 'doc.md'))), /Heading/);
  assert.match(pdfpecker.pdfToTextSync(pdfpecker.markdownFileToPdfSync(path.join(dir, 'doc.md'))), /Heading/);
  assert.match(pdfpecker.pdfToTextSync(pdfpecker.htmlFileToPdfSync(path.join(dir, 'doc.html'))), /File/);
});

test('markdown to pdf', async () => {
  const pdf = await pdfpecker.markdownToPdf('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', { pageSize: 'Letter' });
  const text = pdfpecker.pdfToTextSync(pdfpecker.markdownToPdfSync('# Title'));
  assert.equal(text, 'Title');
  assert.match(await pdfpecker.pdfToText(pdf), /Title[\s\S]*1/);
});

test('footer text and page numbers', async () => {
  const pdf = await pdfpecker.htmlToPdf(longHtml(300), { footerText: 'Page {page} of {pages}' });
  const count = await pdfpecker.pdfPageCount(pdf);
  assert.ok(count > 1);
  assert.match((await pdfpecker.pdfToTextPages(pdf))[1], new RegExp(`Page 2 of ${count}`));
});

test('pdf to images: formats, pages and size', async () => {
  const pdf = await pdfpecker.htmlToPdf(longHtml(300));
  const count = await pdfpecker.pdfPageCount(pdf);
  assert.equal((await pdfpecker.pdfToImages(pdf, { dpi: 20 })).length, count);
  assert.equal((await pdfpecker.pdfToImages(pdf, { dpi: 20, pages: '1-2' })).length, 2);
  assert.equal((await pdfpecker.pdfToImages(pdf, { dpi: 20, pages: [1, 1, 2] })).length, 3);
  assert.equal(pdfpecker.pdfToImagesSync(pdf, { dpi: 20, pages: 1 }).length, 1);
  assert.deepEqual(await pdfpecker.pdfToImages(pdf, { dpi: 20, pages: 'last' }),
    await pdfpecker.pdfToImages(pdf, { dpi: 20, pages: count }));
  assert.equal(pngSize((await pdfpecker.pdfToImages(pdf, { width: 300, pages: 1 }))[0])[0], 300);
  const [jpeg] = await pdfpecker.pdfToImages(pdf, { format: 'jpeg', quality: 60, pages: 1, dpi: 30 });
  assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const [webp] = await pdfpecker.pdfToImages(pdf, { format: 'webp', pages: 1, dpi: 30 });
  assert.equal(webp.toString('latin1', 0, 4) + webp.toString('latin1', 8, 12), 'RIFFWEBP');
});

test('pdf paths and file URLs are accepted', async () => {
  const file = path.join(tempDir(), 'a.pdf');
  fs.writeFileSync(file, await pdfpecker.htmlToPdf('<p>path'));
  assert.equal(await pdfpecker.pdfPageCount(file), 1);
  assert.equal(pdfpecker.pdfToTextSync(file), 'path');
  assert.equal(await pdfpecker.pdfToText(require('node:url').pathToFileURL(file)), 'path');
});

test('text pages', async () => {
  const pdf = await pdfpecker.htmlToPdf(
    "<p>one</p><p style='break-before:page'>two</p><p style='break-before:page'>three</p>");
  assert.deepEqual(await pdfpecker.pdfToTextPages(pdf), ['one', 'two', 'three']);
  assert.deepEqual(await pdfpecker.pdfToTextPages(pdf, { pages: '2-3' }), ['two', 'three']);
  assert.equal(await pdfpecker.pdfToText(pdf), 'one\ftwo\fthree');
});

test('merge pdfs', async () => {
  const a = await pdfpecker.htmlToPdf('<p>first');
  const file = path.join(tempDir(), 'b.pdf');
  fs.writeFileSync(file, await pdfpecker.htmlToPdf('<p>second'));
  assert.deepEqual(await pdfpecker.pdfToTextPages(await pdfpecker.mergePdfs([a, file], { title: 'Both' })),
    ['first', 'second']);
  assert.deepEqual(pdfpecker.pdfToTextPagesSync(pdfpecker.mergePdfsSync([a, a])), ['first', 'first']);
});

test('pdf to markdown', async () => {
  const pdf = await pdfpecker.htmlToPdf("<h1>Report</h1><p>See <a href='https://example.com'>the site</a>.</p>" +
    '<ul><li>one</li><li>two</li></ul>', { accessibility: 'tagged' });
  const markdown = await pdfpecker.pdfToMarkdown(pdf);
  assert.ok(markdown.startsWith('# Report'));
  assert.ok(markdown.includes('](https://example.com/)'));
  assert.ok(markdown.includes('- one') && markdown.includes('- two'));
  assert.ok(pdfpecker.pdfToMarkdownSync(pdf, { includeLinks: false, pageComments: true }).startsWith('<!-- page 1 -->'));
  await assert.rejects(pdfpecker.pdfToMarkdown(pdf, { pages: 3 }), pdfpecker.PdfPeckerArgumentError);
});

test('pdf to PDF/A', async () => {
  const pdf = await pdfpecker.htmlToPdf('<p>archive me', { creationDate: 0 });
  const result = await pdfpecker.pdfToPdfA(pdf, { conformance: 'PDF/A-3u' });
  assert.ok(result.pdf.includes('pdfaid'));
  assert.ok(result.isConformant, result.problems.join('\n'));
  assert.ok(Array.isArray(result.changes));
  assert.equal(await pdfpecker.pdfToText(result.pdf), 'archive me');
  assert.deepEqual(pdfpecker.pdfToPdfASync(pdf).pdf, (await pdfpecker.pdfToPdfA(pdf)).pdf);
  await assert.rejects(pdfpecker.pdfToPdfA(pdf, { conformance: 'PDF/A-4' }),
    { name: 'PdfPeckerArgumentError', message: /conformance/ });
  await assert.rejects(pdfpecker.pdfToPdfA(Buffer.from('not a pdf')), pdfpecker.PdfReadError);
});

test('errors', async () => {
  await assert.rejects(pdfpecker.htmlToPdf('x', { pageSize: 'B9' }),
    { name: 'PdfPeckerArgumentError', status: 1, message: /page_size/ });
  await assert.rejects(pdfpecker.htmlToPdf('x', { margin: 'wide' }), pdfpecker.PdfPeckerArgumentError);
  await assert.rejects(pdfpecker.htmlToPdf('x', { conformance: 'PDF/X' }), pdfpecker.PdfPeckerArgumentError);
  await assert.rejects(pdfpecker.htmlToPdf('x', { nope: 1 }), { name: 'TypeError', message: 'unknown option: nope' });
  assert.throws(() => pdfpecker.markdownToPdfSync('x', { page_size: 'A4' }), TypeError);
  await assert.rejects(pdfpecker.htmlToPdf(42), TypeError);
  await assert.rejects(pdfpecker.pdfPageCount(Buffer.from('this is not a PDF')), pdfpecker.PdfReadError);
  await assert.rejects(pdfpecker.pdfToImages(Buffer.from('%PDF-1.7\n%%EOF')), pdfpecker.PdfReadError);
  const pdf = await pdfpecker.htmlToPdf('<p>x');
  await assert.rejects(pdfpecker.pdfToImages(pdf, { pages: 5 }), { message: /out of range/ });
  await assert.rejects(pdfpecker.pdfToImages(pdf, { format: 'gif' }), { message: /format/ });
  await assert.rejects(pdfpecker.htmlToPdf('x', { timeout: 1e300 }), { name: 'PdfPeckerArgumentError', message: /timeout/ });
  await assert.rejects(pdfpecker.htmlToPdf(longHtml(), { maxPages: 2 }), pdfpecker.PdfLimitError);
  await assert.rejects(pdfpecker.htmlToPdf(longHtml(20000), { timeout: 1 }), { name: 'PdfTimeoutError', status: 5 });
  await assert.rejects(pdfpecker.htmlToPdf('x', { fonts: ['/no/such/font.ttf'] }), pdfpecker.PdfFileError);
  assert.throws(() => pdfpecker.htmlToPdfSync('x', { creationDate: 'never' }), pdfpecker.PdfPeckerArgumentError);
  // Every error of the library is a PdfPeckerError, so one check catches them all.
  assert.ok(new pdfpecker.PdfLimitError('x') instanceof pdfpecker.PdfPeckerError);
});

test('conversions run in parallel with identical results', async () => {
  const html = longHtml(400);
  const expected = pdfpecker.htmlToPdfSync(html, { creationDate: 0 });
  const results = await Promise.all(Array.from({ length: 16 }, () => pdfpecker.htmlToPdf(html, { creationDate: 0 })));
  for (const result of results) assert.deepEqual(result, expected);
});

test('the event loop keeps running during a conversion', async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  await pdfpecker.htmlToPdf(longHtml(6000));
  clearInterval(timer);
  assert.ok(ticks > 0);
});

test('hostile input fails cleanly', async () => {
  // Damaged PDFs are either repaired or rejected with a PdfPeckerError; nothing else may escape.
  for (const data of ['%PDF-1.7\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
    Buffer.concat(Array.from({ length: 50 }, () => Buffer.from(Array.from({ length: 256 }, (_, i) => i)))), '']) {
    await pdfpecker.pdfToImages(Buffer.from(data)).catch((e) => assert.ok(e instanceof pdfpecker.PdfPeckerError, e));
  }
  for (const html of ['<'.repeat(10000), '<div>'.repeat(5000), '&#xFFFFFFFF;']) {
    await pdfpecker.htmlToPdf(html, { timeout: 30000 }).catch((e) => assert.ok(e instanceof pdfpecker.PdfPeckerError, e));
  }
});

test('ES module imports and a clean exit after async conversions', () => {
  // The process must exit with 0 after work on libuv's threads, which once crashed in the native runtime's
  // thread clean-up when the library was unloaded first.
  const script = `import { htmlToPdf, pdfToText } from ${JSON.stringify(require('node:url').pathToFileURL(path.join(ROOT, 'index.js')).href)};
const pdfs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => htmlToPdf('<p>' + i)));
console.log((await pdfToText(pdfs[5])).trim());`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(run.stderr, '');
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), '6');
});

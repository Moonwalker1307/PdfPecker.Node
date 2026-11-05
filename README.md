# pdfpecker for Node.js

Fast HTML and Markdown to PDF, and PDF to images, text and Markdown, for Node.js. No browser, no Chromium download,
no .NET to install.

```
npm install pdfpecker
```

```js
const pdfpecker = require('pdfpecker');            // or: import { htmlToPdf } from 'pdfpecker';
const fs = require('node:fs/promises');

const pdf = await pdfpecker.htmlToPdf('<h1>Invoice 42</h1><p>Total: <b>1,250.00 EUR</b></p>');
await fs.writeFile('invoice.pdf', pdf);

await pdfpecker.htmlFileToPdf('templates/invoice.html');      // images and CSS resolve next to the file
await pdfpecker.markdownFileToPdf('README.md', { pageSize: 'Letter' });

const pngs = await pdfpecker.pdfToImages(pdf, { dpi: 96 });  // one PNG per page (or format 'jpeg'/'webp')
const text = await pdfpecker.pdfToText(pdf);                 // pages separated by \f
const both = await pdfpecker.mergePdfs([pdf, 'terms.pdf']);
```

This is the [PdfPecker](https://github.com/Moonwalker1307/PdfPecker) .NET library, compiled ahead of time into a
native library; it is the same library the [Python package](https://pypi.org/project/pdfpecker/) ships. PdfPecker has
its own HTML parser, CSS engine, layout engine, PDF writer and PDF renderer, so a conversion takes about a millisecond
for a one-page invoice and never starts a browser. It runs no JavaScript in the documents and never goes online:
images, stylesheets and fonts load from `baseDir`. The package version is the library version it holds.
Documentation of what PdfPecker renders, its CSS support and its limitations:
[pdfpecker.net/docs](https://pdfpecker.net/docs/).

## Platforms

Node.js 20 or later on Linux (glibc 2.28+ and musl, x64 and arm64), macOS (Apple Silicon and Intel) and Windows (x64
and arm64). npm installs the native library for the machine from one of the `@pdfpecker/<platform>` packages (about
9 MB to download), and [koffi](https://koffi.dev) calls it.

If npm says the library is missing, it skipped the optional dependency: that happens with `--omit=optional`, or with a
lock file made on another platform (for example on a Mac, for a Linux container). Install the package for the target,
such as `npm install @pdfpecker/linux-x64` (`linux-x64-musl` on Alpine), or set `PDFPECKER_NATIVE_LIB` to a
`pdfpecker_native` library.

## Speed

From Node.js 22 on a 4-core Linux cloud VM, median time per document after warm-up; the documents are the benchmark
pages of the PdfPecker repository:

| | Invoice, 1 page | Feature tour, 5 pages | Report, 29 pages | Start-up and first PDF | Peak memory, one PDF |
|---|---:|---:|---:|---:|---:|
| **pdfpecker** | **0.76 ms** | **2.6 ms** | **29 ms** | **80 ms** | **70 MB** |
| Chromium via Playwright 1.64 | 26 ms | 47 ms | 276 ms | 667 ms | 527 MB |
| Chromium via Puppeteer 25.16 | 24 ms | 56 ms | 439 ms | 381 ms | 538 MB |

## API

Every function returns a `Promise` and runs on libuv's thread pool, so the event loop keeps running and several
conversions run in parallel. Each also has a `Sync` twin (`htmlToPdfSync`, ...) that returns the result directly.
PDFs are given as a `Buffer` or `Uint8Array`, or as a path or file URL; failures reject with a subclass of
`PdfPeckerError`, and an unknown option throws a `TypeError`.

| Function | Resolves to |
|---|---|
| `htmlToPdf(html, options)` | a PDF `Buffer` from an HTML string or UTF-8 bytes |
| `htmlFileToPdf(file, options)` | the same for a file; `baseDir` is the file's folder |
| `markdownToPdf(markdown, options)` | a PDF from CommonMark with GitHub tables, task lists, strikethrough and footnotes |
| `markdownFileToPdf(file, options)` | as `htmlFileToPdf` |
| `pdfToImages(pdf, { dpi, format, pages, width, height, transparent, quality, password })` | an array of encoded images, one per page |
| `pdfToText(pdf, { pages, password })` | the text in reading order, pages separated by `\f` |
| `pdfToTextPages(pdf, { pages, password })` | an array with the text of each page |
| `pdfToMarkdown(pdf, { pages, includeLinks, includeAnnotations, includeImages, pageComments, maxPages, password })` | GitHub Flavored Markdown of any PDF: headings, lists and tables in reading order, for search indexes and language models |
| `pdfPageCount(pdf, { password })` | the number of pages |
| `mergePdfs(pdfs, { title, author, bookmarks, creationDate })` | one PDF from several |
| `pdfToPdfA(pdf, { conformance })` | any PDF converted to PDF/A-2b (default), -2u, -3b or -3u, as `{ pdf, changes, problems, isConformant }` |
| `libraryVersion()` | the version of the PdfPecker library inside (synchronous) |

`pages` takes a page number, an array of numbers, or a range such as `'1-3,5'`, `'8-'` or `'last'`, numbered from 1.
Every function also takes `timeout` in milliseconds.

Options of the HTML and Markdown functions:

| Option | Meaning |
|---|---|
| `baseDir` | The folder relative image, stylesheet and font paths resolve against. Without it, a document from a string loads no local files. |
| `allowFileAccess` | Let the document read files outside `baseDir` too. Only for HTML you trust. |
| `pageSize`, `landscape` | `'A3'`, `'A4'` (default), `'A5'`, `'Letter'`, `'Legal'` or `[widthMm, heightMm]`. A CSS `@page { size }` rule wins. |
| `margin` | In points (72 per inch): one number or `[top, right, bottom, left]`. Default 36. CSS `@page { margin }` wins. |
| `scale`, `shrinkToFit` | Zoom the content; shrink content wider than the page (on by default). |
| `headerText`, `footerText` | A line of text in the top or bottom margin; `{page}` and `{pages}` are replaced. CSS margin boxes (`@top-center`, ...) do more. |
| `fonts`, `useSystemFonts` | TrueType/OpenType files or folders that CSS `font-family` can name; or look families up among the installed fonts. Without fonts, text uses the standard PDF fonts, which cover Western European characters only. |
| `title`, `author`, `subject`, `keywords`, `language` | Document properties. |
| `userStyleSheet` | CSS applied after the document's own. |
| `compress`, `bookmarks` | Compress the streams; make bookmarks from the headings (both on by default). |
| `maxPages` | Fail with `PdfLimitError` beyond this many pages (default 100,000). |
| `creationDate` | A fixed date (`Date`, milliseconds or an ISO string): the output is then byte-identical from run to run. |
| `conformance` | `'PDF/A-2b'`, `'PDF/A-3b'`, `'PDF/A-2u'`, `'PDF/A-3u'`, `'PDF/A-4'` or `'PDF/A-4f'`. |
| `accessibility` | `'tagged'`, `'PDF/UA-1'` or `'PDF/UA-2'`. |

Errors: `PdfPeckerArgumentError` (a bad option value, a page past the end), `PdfReadError` (not a readable PDF, image
or font), `PdfPasswordError`, `PdfLimitError`, `PdfTimeoutError` and `PdfFileError` (a font or image file that could
not be read), all subclasses of `PdfPeckerError` with the native `status` code.

TypeScript types are included.

## Building from this repository

The packages hold the native libraries of the [Python package](https://github.com/Moonwalker1307/PdfPecker.Python)'s
wheels on PyPI, which are built from the released PdfPecker NuGet package; nothing is compiled here.

```
npm install
node scripts/fetch-native.js --only current     # this machine's library from the PyPI wheel, into native/
npm test
node scripts/fetch-native.js && node scripts/pack.js   # all eight, packed into dist/
```

## Releasing

After a PdfPecker release reaches PyPI (the Python package follows each NuGet release), a pull request here changes
`version` in `package.json` and adds functions or options for what the release added. The owner then publishes a
GitHub release tagged `v<version>`; the Release workflow downloads the eight libraries from PyPI, checks their SHA-256,
tests the packed packages on every platform and publishes them to npm.

## License

MIT. The platform packages also contain the .NET runtime, zlib-ng and the fonts and data PdfPecker bundles, each under
its own license: see `THIRD-PARTY-NOTICES.md`.

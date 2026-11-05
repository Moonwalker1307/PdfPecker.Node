'use strict';
// PdfPecker for Node.js: HTML and Markdown to PDF, and PDF to images and text, with no browser.
//
// The work is done by PdfPecker's .NET library compiled ahead of time into a native library (the same one the Python
// package ships), which the matching @pdfpecker/<platform> package holds. koffi calls its one C entry point,
// pdfpecker_invoke; the asynchronous functions run it on libuv's thread pool, so conversions never block the event
// loop and several run in parallel.

const fs = require('node:fs');
const path = require('node:path');

const ABI_VERSION = 1;

class PdfPeckerError extends Error {
  constructor(message, status) {
    super(message);
    this.name = new.target.name;
    // The native library's status code, so callers can tell failures apart without matching messages.
    this.status = status ?? 6;
  }
}
/** An argument or option is not valid: an unknown page size, a page past the end, an unknown option. */
class PdfPeckerArgumentError extends PdfPeckerError {}
/** The input is not a readable PDF, image or font. */
class PdfReadError extends PdfPeckerError {}
/** The PDF is encrypted and no password, or a wrong one, was given. */
class PdfPasswordError extends PdfPeckerError {}
/** A page, size or resource limit was reached, such as maxPages. */
class PdfLimitError extends PdfPeckerError {}
/** The conversion took longer than its timeout. */
class PdfTimeoutError extends PdfPeckerError {}
/** A file the document needs (a font, an image) could not be read. */
class PdfFileError extends PdfPeckerError {}

const ERRORS = [null, PdfPeckerArgumentError, PdfReadError, PdfPasswordError, PdfLimitError, PdfTimeoutError,
  PdfPeckerError, PdfFileError, PdfPeckerError];

function errorFor(status, message) {
  const Type = ERRORS[status] ?? PdfPeckerError;
  return new Type(message, status);
}

// ---- Loading the native library ----

function isMusl() {
  // Node reports the glibc version it runs on; on musl (Alpine) there is none.
  try {
    return !process.report.getReport().header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

function platformPackage() {
  const { platform, arch } = process;
  return platform === 'linux' ? `linux-${arch}${isMusl() ? '-musl' : ''}` : `${platform}-${arch}`;
}

const LIBRARY_NAME = process.platform === 'win32' ? 'pdfpecker_native.dll'
  : process.platform === 'darwin' ? 'pdfpecker_native.dylib' : 'pdfpecker_native.so';

function libraryPath() {
  if (process.env.PDFPECKER_NATIVE_LIB) return process.env.PDFPECKER_NATIVE_LIB;
  const key = platformPackage();
  try {
    return path.join(path.dirname(require.resolve(`@pdfpecker/${key}/package.json`)), LIBRARY_NAME);
  } catch {
    // A checkout of this repository keeps the libraries that scripts/fetch-native.js downloaded in native/.
    const local = path.join(__dirname, 'native', key, LIBRARY_NAME);
    if (fs.existsSync(local)) return local;
    throw new Error(
      `PdfPecker's native library for ${key} is missing: the package @pdfpecker/${key} is not installed. npm skips ` +
      'it when optional dependencies are turned off or the lock file was made on another platform; install it with ' +
      `"npm install @pdfpecker/${key}", or set PDFPECKER_NATIVE_LIB to a pdfpecker_native library. PdfPecker runs on ` +
      'Linux (glibc and musl), macOS and Windows, on x64 and arm64.');
  }
}

// The .NET runtime inside the library registers a destructor for each thread that has called into it. Node unloads
// libraries that koffi loaded when it exits, before libuv's worker threads end, and those destructors would then run
// code that is gone. Loading the library a second time, and never unloading it, keeps it in memory until the process
// itself ends.
function pin(koffi, file) {
  try {
    if (process.platform === 'win32') {
      const getModuleHandleEx = koffi.load('kernel32.dll')
        .func('bool __stdcall GetModuleHandleExW(uint32_t flags, const char16_t* name, _Out_ void** module)');
      const GET_MODULE_HANDLE_EX_FLAG_PIN = 1;
      getModuleHandleEx(GET_MODULE_HANDLE_EX_FLAG_PIN, file, [null]);
    } else {
      const RTLD_NOW = 2;
      koffi.load(null).func('void* dlopen(const char* file, int mode)')(file, RTLD_NOW);
    }
  } catch {
    // musl never unloads libraries, and a process that does not exit after async calls is not affected.
  }
}

// koffi runs native calls on stacks of its own, 128 KiB for asynchronous calls by default, which PdfPecker's recursive
// layout of deeply nested HTML overflows. 4 MiB is above what .NET gives its own threads; the memory is only
// committed as it is used. koffi accepts this only before its first call, so a process that used it already keeps its
// sizes.
const STACK_SIZE = 4 * 1024 * 1024;

function configure(koffi) {
  try {
    const config = koffi.config();
    koffi.config({
      ...config,
      sync_stack_size: Math.max(config.sync_stack_size, STACK_SIZE),
      async_stack_size: Math.max(config.async_stack_size, STACK_SIZE),
    });
  } catch {
    // Too late to change; the defaults stay.
  }
}

let native;

function load() {
  if (native) return native;
  const koffi = require('koffi');
  configure(koffi);
  const file = libraryPath();
  const lib = koffi.load(file);
  pin(koffi, file);
  const abi = lib.func('int pdfpecker_abi_version()')();
  if (abi !== ABI_VERSION) {
    throw new Error(`PdfPecker's native library (${file}) speaks ABI ${abi}, this package expects ${ABI_VERSION}`);
  }
  native = {
    koffi,
    invoke: lib.func('int pdfpecker_invoke(const char* op, const uint8_t* input, int64_t input_len, ' +
      'const char* options, _Out_ void** output, _Out_ int64_t* output_len, _Out_ void** error)'),
    free: lib.func('void pdfpecker_free(void* p)'),
    version: lib.func('const char* pdfpecker_version()'),
  };
  return native;
}

function result(n, status, output, outputLength, error) {
  if (status !== 0) {
    let message = 'PdfPecker failed';
    if (error[0]) {
      message = n.koffi.decode(error[0], 'char', -1);
      n.free(error[0]);
    }
    throw errorFor(status, message);
  }
  try {
    // Copies the bytes out of the native buffer before it is freed.
    return Buffer.from(new Uint8Array(n.koffi.view(output[0], Number(outputLength[0]))));
  } finally {
    n.free(output[0]);
  }
}

function invokeSync(op, input, options) {
  const n = load();
  const output = [null], outputLength = [0], error = [null];
  const status = n.invoke(op, input, input.length, JSON.stringify(options), output, outputLength, error);
  return result(n, status, output, outputLength, error);
}

function invoke(op, input, options) {
  const n = load();
  const output = [null], outputLength = [0], error = [null];
  return new Promise((resolve, reject) => {
    n.invoke.async(op, input, input.length, JSON.stringify(options), output, outputLength, error, (failure, status) => {
      // input stays referenced by this closure until the native call is done with it.
      void input;
      if (failure) return reject(failure);
      try {
        resolve(result(n, status, output, outputLength, error));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Lists (several PDFs in, several images or pages out) are an int32 count and an int64 length before each item,
// little-endian.
function frame(items) {
  let total = 4;
  for (const item of items) total += 8 + item.length;
  const out = Buffer.alloc(total);
  out.writeInt32LE(items.length, 0);
  let at = 4;
  for (const item of items) {
    out.writeBigInt64LE(BigInt(item.length), at);
    out.set(item, at + 8);
    at += 8 + item.length;
  }
  return out;
}

function unframe(data) {
  const count = data.readInt32LE(0);
  const items = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    const length = Number(data.readBigInt64LE(at));
    at += 8;
    items.push(data.subarray(at, at + length));
    at += length;
  }
  return items;
}

// ---- Options ----

// The native side takes the Python package's option names; these map the camelCase names of this package to them
// and convert the values JavaScript callers use (milliseconds, Date) to what it expects.
const identity = (v) => v;
const resolvePath = (v) => path.resolve(String(v));
// The native timer takes at most 2^31 - 1 milliseconds (about 24.8 days).
const seconds = (ms) => {
  if (typeof ms !== 'number' || !(ms > 0 && ms <= 2147483000)) {
    throw new PdfPeckerArgumentError(`timeout must be a number of milliseconds, above 0 and at most 2,147,483,000: ${ms}`, 1);
  }
  return ms / 1000;
};
const unixSeconds = (v) => {
  const date = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(date.getTime())) throw new PdfPeckerArgumentError(`creationDate is not a valid date: ${v}`, 1);
  return Math.floor(date.getTime() / 1000);
};
const pageList = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map((p) => String(Math.trunc(p))).join(',')
  : String(Math.trunc(v));

const PDF_OPTIONS = {
  baseDir: ['base_dir', resolvePath],
  allowFileAccess: ['allow_file_access', identity],
  pageSize: ['page_size', identity],
  landscape: ['landscape', identity],
  margin: ['margin', identity],
  scale: ['scale', identity],
  shrinkToFit: ['shrink_to_fit', identity],
  title: ['title', identity],
  author: ['author', identity],
  subject: ['subject', identity],
  keywords: ['keywords', identity],
  language: ['language', identity],
  headerText: ['header_text', identity],
  footerText: ['footer_text', identity],
  userStyleSheet: ['user_style_sheet', identity],
  fonts: ['fonts', (v) => Array.from(v, resolvePath)],
  useSystemFonts: ['use_system_fonts', identity],
  compress: ['compress', identity],
  bookmarks: ['bookmarks', identity],
  maxPages: ['max_pages', identity],
  creationDate: ['creation_date', unixSeconds],
  conformance: ['conformance', identity],
  accessibility: ['accessibility', identity],
  timeout: ['timeout', seconds],
};

const IMAGE_OPTIONS = {
  dpi: ['dpi', identity],
  format: ['format', identity],
  pages: ['pages', pageList],
  width: ['width', identity],
  height: ['height', identity],
  transparent: ['transparent', identity],
  quality: ['quality', identity],
  password: ['password', identity],
  timeout: ['timeout', seconds],
};

const TEXT_OPTIONS = {
  pages: ['pages', pageList],
  password: ['password', identity],
  timeout: ['timeout', seconds],
};

const MARKDOWN_OUT_OPTIONS = {
  pages: ['pages', pageList],
  includeLinks: ['include_links', identity],
  includeAnnotations: ['include_annotations', identity],
  includeImages: ['include_images', identity],
  pageComments: ['page_comments', identity],
  maxPages: ['max_pages', identity],
  password: ['password', identity],
  timeout: ['timeout', seconds],
};

const COUNT_OPTIONS = { password: ['password', identity] };

const MERGE_OPTIONS = {
  title: ['title', identity],
  author: ['author', identity],
  bookmarks: ['bookmarks', identity],
  creationDate: ['creation_date', unixSeconds],
  timeout: ['timeout', seconds],
};

const PDFA_OPTIONS = {
  conformance: ['conformance', identity],
  timeout: ['timeout', seconds],
};

function nativeOptions(options, known) {
  const out = {};
  if (options == null) return out;
  if (typeof options !== 'object') throw new TypeError('options must be an object');
  for (const [name, value] of Object.entries(options)) {
    const entry = Object.hasOwn(known, name) ? known[name] : undefined;
    if (!entry) throw new TypeError(`unknown option: ${name}`);
    if (value !== undefined && value !== null) out[entry[0]] = entry[1](value);
  }
  return out;
}

// ---- Inputs ----

function textBytes(value, what) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`${what} must be a string, a Buffer or a Uint8Array`);
}

function pdfBytesSync(pdf) {
  if (pdf instanceof Uint8Array) return pdf;
  if (typeof pdf === 'string' || pdf instanceof URL) return fs.readFileSync(pdf);
  throw new TypeError('a PDF must be a Buffer, a Uint8Array or a path');
}

async function pdfBytes(pdf) {
  if (pdf instanceof Uint8Array) return pdf;
  if (typeof pdf === 'string' || pdf instanceof URL) return fs.promises.readFile(pdf);
  throw new TypeError('a PDF must be a Buffer, a Uint8Array or a path');
}

function fileOptions(file, options) {
  // Relative image, stylesheet and font paths resolve next to the file unless the caller says otherwise.
  const dir = path.dirname(path.resolve(file instanceof URL ? require('node:url').fileURLToPath(file) : String(file)));
  return { baseDir: dir, ...options };
}

function pdfAResult(raw) {
  const [pdf, report] = unframe(raw);
  const { changes, problems } = JSON.parse(report.toString('utf8'));
  return { pdf, changes, problems, isConformant: problems.length === 0 };
}

const texts = (raw) => unframe(raw).map((page) => page.toString('utf8'));

// ---- The API ----

/** The version of the PdfPecker .NET library inside this package. */
function libraryVersion() {
  return load().version();
}

async function htmlToPdf(html, options) {
  return invoke('html_to_pdf', textBytes(html, 'html'), nativeOptions(options, PDF_OPTIONS));
}

function htmlToPdfSync(html, options) {
  return invokeSync('html_to_pdf', textBytes(html, 'html'), nativeOptions(options, PDF_OPTIONS));
}

async function htmlFileToPdf(file, options) {
  return htmlToPdf(await fs.promises.readFile(file), fileOptions(file, options));
}

function htmlFileToPdfSync(file, options) {
  return htmlToPdfSync(fs.readFileSync(file), fileOptions(file, options));
}

async function markdownToPdf(markdown, options) {
  return invoke('markdown_to_pdf', textBytes(markdown, 'markdown'), nativeOptions(options, PDF_OPTIONS));
}

function markdownToPdfSync(markdown, options) {
  return invokeSync('markdown_to_pdf', textBytes(markdown, 'markdown'), nativeOptions(options, PDF_OPTIONS));
}

async function markdownFileToPdf(file, options) {
  return markdownToPdf(await fs.promises.readFile(file), fileOptions(file, options));
}

function markdownFileToPdfSync(file, options) {
  return markdownToPdfSync(fs.readFileSync(file), fileOptions(file, options));
}

async function pdfToImages(pdf, options) {
  return unframe(await invoke('pdf_to_images', await pdfBytes(pdf), nativeOptions(options, IMAGE_OPTIONS)));
}

function pdfToImagesSync(pdf, options) {
  return unframe(invokeSync('pdf_to_images', pdfBytesSync(pdf), nativeOptions(options, IMAGE_OPTIONS)));
}

async function pdfPageCount(pdf, options) {
  return Number((await invoke('pdf_page_count', await pdfBytes(pdf), nativeOptions(options, COUNT_OPTIONS))).toString());
}

function pdfPageCountSync(pdf, options) {
  return Number(invokeSync('pdf_page_count', pdfBytesSync(pdf), nativeOptions(options, COUNT_OPTIONS)).toString());
}

async function pdfToTextPages(pdf, options) {
  return texts(await invoke('pdf_to_text', await pdfBytes(pdf), nativeOptions(options, TEXT_OPTIONS)));
}

function pdfToTextPagesSync(pdf, options) {
  return texts(invokeSync('pdf_to_text', pdfBytesSync(pdf), nativeOptions(options, TEXT_OPTIONS)));
}

async function pdfToText(pdf, options) {
  return (await pdfToTextPages(pdf, options)).join('\f');
}

function pdfToTextSync(pdf, options) {
  return pdfToTextPagesSync(pdf, options).join('\f');
}

async function pdfToMarkdown(pdf, options) {
  return (await invoke('pdf_to_markdown', await pdfBytes(pdf), nativeOptions(options, MARKDOWN_OUT_OPTIONS)))
    .toString('utf8');
}

function pdfToMarkdownSync(pdf, options) {
  return invokeSync('pdf_to_markdown', pdfBytesSync(pdf), nativeOptions(options, MARKDOWN_OUT_OPTIONS)).toString('utf8');
}

async function pdfToPdfA(pdf, options) {
  return pdfAResult(await invoke('pdf_to_pdfa', await pdfBytes(pdf), nativeOptions(options, PDFA_OPTIONS)));
}

function pdfToPdfASync(pdf, options) {
  return pdfAResult(invokeSync('pdf_to_pdfa', pdfBytesSync(pdf), nativeOptions(options, PDFA_OPTIONS)));
}

async function mergePdfs(pdfs, options) {
  const items = await Promise.all(Array.from(pdfs, pdfBytes));
  return invoke('merge_pdfs', frame(items), nativeOptions(options, MERGE_OPTIONS));
}

function mergePdfsSync(pdfs, options) {
  return invokeSync('merge_pdfs', frame(Array.from(pdfs, pdfBytesSync)), nativeOptions(options, MERGE_OPTIONS));
}

module.exports = {
  htmlToPdf,
  htmlToPdfSync,
  htmlFileToPdf,
  htmlFileToPdfSync,
  markdownToPdf,
  markdownToPdfSync,
  markdownFileToPdf,
  markdownFileToPdfSync,
  pdfToImages,
  pdfToImagesSync,
  pdfPageCount,
  pdfPageCountSync,
  pdfToText,
  pdfToTextSync,
  pdfToTextPages,
  pdfToTextPagesSync,
  pdfToMarkdown,
  pdfToMarkdownSync,
  pdfToPdfA,
  pdfToPdfASync,
  mergePdfs,
  mergePdfsSync,
  libraryVersion,
  PdfPeckerError,
  PdfPeckerArgumentError,
  PdfReadError,
  PdfPasswordError,
  PdfLimitError,
  PdfTimeoutError,
  PdfFileError,
};

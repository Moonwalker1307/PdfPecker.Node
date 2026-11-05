/// <reference types="node" />

/** A PDF as bytes, or the path or file URL of a PDF file. */
export type PdfInput = Uint8Array | string | URL;

/** Pages numbered from 1: a number, a list of numbers, or a range such as "1-3,5", "8-" or "last". */
export type Pages = number | readonly number[] | string;

export interface PdfOptions {
  /** The folder relative image, stylesheet and font paths resolve against. Without it, a document from a string loads
   * no local files. The file functions use the file's folder. */
  baseDir?: string;
  /** Let the document read files outside baseDir too. Only for HTML you trust. */
  allowFileAccess?: boolean;
  /** "A3", "A4" (default), "A5", "Letter", "Legal" or [widthMm, heightMm]. A CSS @page size rule wins. */
  pageSize?: 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | (string & {}) | readonly [number, number];
  /** Turns pageSize sideways. */
  landscape?: boolean;
  /** Page margins in points (72 per inch): one number or [top, right, bottom, left]. Default 36. */
  margin?: number | readonly [number, number, number, number];
  /** Zooms the content. */
  scale?: number;
  /** Shrinks content wider than the page (on by default). */
  shrinkToFit?: boolean;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** The document language, such as "en-GB". */
  language?: string;
  /** A line of text at the top of every page; {page} and {pages} are replaced. */
  headerText?: string;
  /** A line of text at the bottom of every page, such as "Page {page} of {pages}". */
  footerText?: string;
  /** CSS applied after the document's own. */
  userStyleSheet?: string;
  /** TrueType/OpenType files or folders that CSS font-family can name. Without fonts, text uses the standard PDF
   * fonts, which cover Western European characters only. */
  fonts?: Iterable<string>;
  /** Also look font families up among the fonts installed on this machine. */
  useSystemFonts?: boolean;
  /** Compress the PDF's streams (default true). */
  compress?: boolean;
  /** Make bookmarks from the headings (default true). */
  bookmarks?: boolean;
  /** Fail with PdfLimitError beyond this many pages (default 100,000). */
  maxPages?: number;
  /** A fixed creation date (a Date, milliseconds since 1970 or an ISO string): the output is then byte-identical from
   * run to run. */
  creationDate?: Date | number | string;
  conformance?: 'PDF/A-2b' | 'PDF/A-3b' | 'PDF/A-2u' | 'PDF/A-3u' | 'PDF/A-4' | 'PDF/A-4f';
  accessibility?: 'tagged' | 'PDF/UA-1' | 'PDF/UA-2';
  /** Milliseconds before the conversion stops with PdfTimeoutError. */
  timeout?: number;
}

export interface ImageOptions {
  /** Resolution (default 150). */
  dpi?: number;
  /** "png" (default), "jpeg" or "webp". */
  format?: 'png' | 'jpeg' | 'webp';
  /** Which pages; default all. */
  pages?: Pages;
  /** A width in pixels instead of dpi, keeping the aspect ratio. */
  width?: number;
  /** A height in pixels instead of dpi, keeping the aspect ratio. */
  height?: number;
  /** Leave the page background transparent (png and webp). */
  transparent?: boolean;
  /** 1-100, for jpeg and webp. */
  quality?: number;
  password?: string;
  /** Milliseconds before the work stops with PdfTimeoutError. */
  timeout?: number;
}

export interface TextOptions {
  pages?: Pages;
  password?: string;
  /** Milliseconds before the work stops with PdfTimeoutError. */
  timeout?: number;
}

export interface MarkdownOptions {
  pages?: Pages;
  /** Text that links to a web or email address becomes a Markdown link (default true). */
  includeLinks?: boolean;
  /** Include the text of annotations, such as form field values (default true). */
  includeAnnotations?: boolean;
  /** Include pictures as data: URI images where they sit in the text (default false: they are long). */
  includeImages?: boolean;
  /** Start each page with a comment such as <!-- page 3 -->. */
  pageComments?: boolean;
  /** Fail with PdfLimitError beyond this many pages (default 10,000). */
  maxPages?: number;
  password?: string;
  /** Milliseconds before the work stops with PdfTimeoutError. */
  timeout?: number;
}

export interface PageCountOptions {
  password?: string;
}

export interface MergeOptions {
  title?: string;
  author?: string;
  /** Keep the documents' bookmarks (default true). */
  bookmarks?: boolean;
  creationDate?: Date | number | string;
  /** Milliseconds before the work stops with PdfTimeoutError. */
  timeout?: number;
}

export interface PdfAOptions {
  /** "PDF/A-2b" (default), "PDF/A-2u", "PDF/A-3b" or "PDF/A-3u". */
  conformance?: 'PDF/A-2b' | 'PDF/A-2u' | 'PDF/A-3b' | 'PDF/A-3u';
  /** Milliseconds before the work stops with PdfTimeoutError. */
  timeout?: number;
}

export interface PdfAResult {
  /** The converted PDF. */
  pdf: Buffer;
  /** What the conversion changed. */
  changes: string[];
  /** What still breaks the PDF/A rules. */
  problems: string[];
  /** True when nothing is left that breaks the rules the conversion checks; veraPDF has the final word. */
  isConformant: boolean;
}

/** Converts HTML (a string or UTF-8 bytes) to a PDF, on libuv's thread pool. */
export function htmlToPdf(html: string | Uint8Array, options?: PdfOptions): Promise<Buffer>;
export function htmlToPdfSync(html: string | Uint8Array, options?: PdfOptions): Buffer;
/** Converts an HTML file; relative paths resolve against its folder. */
export function htmlFileToPdf(file: string | URL, options?: PdfOptions): Promise<Buffer>;
export function htmlFileToPdfSync(file: string | URL, options?: PdfOptions): Buffer;
/** Converts Markdown (CommonMark with GitHub tables, task lists, strikethrough and footnotes) to a PDF. */
export function markdownToPdf(markdown: string | Uint8Array, options?: PdfOptions): Promise<Buffer>;
export function markdownToPdfSync(markdown: string | Uint8Array, options?: PdfOptions): Buffer;
/** Converts a Markdown file; images resolve against its folder. */
export function markdownFileToPdf(file: string | URL, options?: PdfOptions): Promise<Buffer>;
export function markdownFileToPdfSync(file: string | URL, options?: PdfOptions): Buffer;
/** Renders PDF pages to images, one encoded image per page. */
export function pdfToImages(pdf: PdfInput, options?: ImageOptions): Promise<Buffer[]>;
export function pdfToImagesSync(pdf: PdfInput, options?: ImageOptions): Buffer[];
/** The number of pages of a PDF. */
export function pdfPageCount(pdf: PdfInput, options?: PageCountOptions): Promise<number>;
export function pdfPageCountSync(pdf: PdfInput, options?: PageCountOptions): number;
/** The text of a PDF in reading order, pages separated by a form feed (\f). */
export function pdfToText(pdf: PdfInput, options?: TextOptions): Promise<string>;
export function pdfToTextSync(pdf: PdfInput, options?: TextOptions): string;
/** The text of each page. */
export function pdfToTextPages(pdf: PdfInput, options?: TextOptions): Promise<string[]>;
export function pdfToTextPagesSync(pdf: PdfInput, options?: TextOptions): string[];
/** Converts any PDF to GitHub Flavored Markdown: headings, lists and tables in reading order. */
export function pdfToMarkdown(pdf: PdfInput, options?: MarkdownOptions): Promise<string>;
export function pdfToMarkdownSync(pdf: PdfInput, options?: MarkdownOptions): string;
/** Converts any PDF to PDF/A for long-term archiving. */
export function pdfToPdfA(pdf: PdfInput, options?: PdfAOptions): Promise<PdfAResult>;
export function pdfToPdfASync(pdf: PdfInput, options?: PdfAOptions): PdfAResult;
/** Merges PDFs into one, keeping links, bookmarks and form fields. */
export function mergePdfs(pdfs: Iterable<PdfInput>, options?: MergeOptions): Promise<Buffer>;
export function mergePdfsSync(pdfs: Iterable<PdfInput>, options?: MergeOptions): Buffer;
/** The version of the PdfPecker .NET library inside this package. */
export function libraryVersion(): string;

/** Base class of every PdfPecker error. */
export class PdfPeckerError extends Error {
  constructor(message: string, status?: number);
  /** The native library's status code: 1 argument, 2 unreadable input, 3 password, 4 limit, 5 timeout, 6 other,
   * 7 file, 8 unexpected. */
  status: number;
}
/** An argument or option is not valid: an unknown page size, a page past the end. */
export class PdfPeckerArgumentError extends PdfPeckerError {}
/** The input is not a readable PDF, image or font. */
export class PdfReadError extends PdfPeckerError {}
/** The PDF is encrypted and no password, or a wrong one, was given. */
export class PdfPasswordError extends PdfPeckerError {}
/** A page, size or resource limit was reached, such as maxPages. */
export class PdfLimitError extends PdfPeckerError {}
/** The conversion took longer than its timeout. */
export class PdfTimeoutError extends PdfPeckerError {}
/** A file the document needs (a font, an image) could not be read. */
export class PdfFileError extends PdfPeckerError {}

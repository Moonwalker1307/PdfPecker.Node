# AGENTS.md

Guidance for coding agents (and people) working in this repository. `CLAUDE.md` imports this file, so Claude Code and
other agents read the same rules.

PdfPecker.Node is the `pdfpecker` package on npm: the [PdfPecker](https://github.com/Moonwalker1307/PdfPecker) .NET
library, compiled with NativeAOT into a shared library with a C ABI, and a small JavaScript binding over it that calls
it through [koffi](https://koffi.dev). The native library is not built here: it is the one inside the wheels of
[PdfPecker.Python](https://github.com/Moonwalker1307/PdfPecker.Python) on PyPI, which builds it from the released
PdfPecker NuGet package. Each platform's library ships in its own package, `@pdfpecker/<platform>`, which the main
package lists as optional dependencies, so npm installs only the one that fits.

## Core rules

- **The libraries come from PyPI.** `scripts/fetch-native.js` downloads the pdfpecker wheels of the version in
  `package.json`, checks them against PyPI's SHA-256 and takes the library out. Never build, copy or commit a native
  library here; when the package needs something the library cannot do, fix PdfPecker (or the C ABI in
  PdfPecker.Python) in its own repository first.
- **The version is the library version.** `version` in `package.json` is the PdfPecker and pdfpecker (PyPI) version
  the package holds, and all nine npm packages share it.
- **One runtime dependency.** The main package depends on koffi and nothing else; the platform packages have none.
- **The C ABI is PdfPecker.Python's.** `pdfpecker_invoke(op, input, input_len, options_json, &output, &output_len,
  &error)`, `pdfpecker_free`, `pdfpecker_version` and `pdfpecker_abi_version` (`native/Exports.cs` there). Options
  reach the native side under the Python keyword names; `index.js` maps the camelCase names to them and rejects names
  it does not know. A new ABI version there needs `ABI_VERSION` here bumped in the same release.
- **Asynchronous first.** Every function returns a Promise and runs on libuv's thread pool, with a `Sync` twin.
- **No breaking API changes before 2.0**: add functions and options, don't rename or remove them.
- **Never name a user's private application or employer** in code, tests, commits, the README or PR descriptions.

## Repo map

- `index.js` – the whole binding: loading the library, the option mapping, the API. `index.d.ts` – its types.
- `scripts/platforms.js` – the eight platforms and the wheel each one's library comes from.
- `scripts/fetch-native.js` – downloads libraries into `native/<platform>/` (git-ignored).
- `scripts/pack.js` – builds the nine packages in `dist/packages/` and their tarballs in `dist/`.
- `test/` – `node:test`; `PDFPECKER_TEST_PACKAGE` points the tests at an installed package.
- `ci/test.sh` – tests the source tree, then the packed packages installed into a fresh project.
- `.github/workflows/ci.yml` – the eight platforms on every PR, and the npm publish on a published release.
- `.github/workflows/vulnerability-scan.yml` – daily: OSV-Scanner on `package-lock.json` (results in Security → Code
  scanning), and an issue for each new .NET security release, since the library from the wheels carries the runtime.

## Build and verify

```
npm install
node scripts/fetch-native.js --only current
npm test
ci/test.sh               # also packs and tests the installed packages
```

## Wisdom

- koffi runs native calls on stacks of its own, 128 KiB for asynchronous calls by default; PdfPecker's layout of
  deeply nested HTML overflows that, so `index.js` raises both stack sizes to 4 MiB before the first call.
- The .NET runtime registers a destructor for each thread that calls into it. Node unloads koffi's libraries at exit
  before libuv's threads end, so the library is loaded a second time and never unloaded (`pin` in `index.js`);
  without it a process crashes on exit after an asynchronous call.

## Releasing

After a PdfPecker release reaches PyPI, a PR changes `version` in `package.json` (and `package-lock.json`) and adds
functions or options for what the release added. The owner publishes the GitHub release `v<version>`; the workflow
publishes the eight platform packages and then `pdfpecker`, with Trusted Publishing (workflow `ci.yml`, environment
`npm`) or, until that is set up, the `NPM_TOKEN` secret. Never publish, tag or create a release yourself.

## Commit guidance

- Branch from the latest `origin/main`, one branch per piece of work, named after the work with a `claude/` prefix
  when an agent creates it. Never reuse a branch name after its PR is merged or closed.
- Commit subjects are short imperative or descriptive sentences without prefixes; the body explains why.
- Fill in `.github/pull_request_template.md`, and update `README.md` in the same PR when a function or option changes.

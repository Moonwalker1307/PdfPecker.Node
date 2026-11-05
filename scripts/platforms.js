'use strict';
// The eight platforms, with the wheel of the Python package that holds each one's native library. The npm package
// ships the very libraries that are on PyPI, so both languages run the same build.

module.exports = [
  { key: 'linux-x64', os: 'linux', cpu: 'x64', libc: 'glibc', wheel: /-manylinux_[0-9_]+_x86_64\.whl$/, library: 'pdfpecker_native.so' },
  { key: 'linux-arm64', os: 'linux', cpu: 'arm64', libc: 'glibc', wheel: /-manylinux_[0-9_]+_aarch64\.whl$/, library: 'pdfpecker_native.so' },
  { key: 'linux-x64-musl', os: 'linux', cpu: 'x64', libc: 'musl', wheel: /-musllinux_[0-9_]+_x86_64\.whl$/, library: 'pdfpecker_native.so' },
  { key: 'linux-arm64-musl', os: 'linux', cpu: 'arm64', libc: 'musl', wheel: /-musllinux_[0-9_]+_aarch64\.whl$/, library: 'pdfpecker_native.so' },
  { key: 'darwin-arm64', os: 'darwin', cpu: 'arm64', wheel: /-macosx_[0-9_]+_arm64\.whl$/, library: 'pdfpecker_native.dylib' },
  { key: 'darwin-x64', os: 'darwin', cpu: 'x64', wheel: /-macosx_[0-9_]+_x86_64\.whl$/, library: 'pdfpecker_native.dylib' },
  { key: 'win32-x64', os: 'win32', cpu: 'x64', wheel: /-win_amd64\.whl$/, library: 'pdfpecker_native.dll' },
  { key: 'win32-arm64', os: 'win32', cpu: 'arm64', wheel: /-win_arm64\.whl$/, library: 'pdfpecker_native.dll' },
];

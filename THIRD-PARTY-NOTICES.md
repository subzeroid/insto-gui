# Third-party notices

This application is distributed as a bundle: it ships a Python runtime and compiled Rust
dependencies alongside its own code. Their licences require their text and
copyright notices to travel with the binary. This file lists every dependency
the lockfiles pin, with the licence each one declares.

Regenerate with `python3 -B -m scripts.third_party_notices`.

## Bundled Python runtime

CPython 3.12.14, redistributed as a standalone build from
astral-sh/python-build-standalone. CPython itself is under the Python Software
Foundation License; the build scripts are under the Mozilla Public License 2.0;
and the build embeds further components under their own terms, notably OpenSSL,
SQLite (public domain), libffi, zlib, bzip2, XZ Utils and ncurses. The upstream
release carries the full texts:

- arm64: https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-aarch64-apple-darwin-install_only_stripped.tar.gz
- x86_64: https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-x86_64-apple-darwin-install_only_stripped.tar.gz

## What these obligations amount to

Nearly every entry below is MIT, Apache-2.0, BSD or ISC: permissive licences
that ask for the licence text and the copyright notice to be distributed with
the binary, which is what this file and the upstream archives provide. Two
groups need a further word:

- **MPL-2.0** (the CSS parsing crates Tauri pulls in) is file-level copyleft.
  Shipping them unmodified only requires this notice and a way to obtain their
  source, which crates.io provides at the pinned versions. Modifying one of
  those files would oblige us to publish the modified files under MPL-2.0.
- **Apache-2.0** carries a patent grant and requires that its NOTICE file, where
  a project ships one, be reproduced. The upstream archives carry theirs.

No dependency here is GPL or AGPL, so nothing obliges the application itself to
adopt a copyleft licence.

## Rust dependencies (application)

436 packages, 27 distinct licence expressions.

### (MIT OR Apache-2.0) AND Unicode-3.0

unicode-ident 1.0.24

### 0BSD OR MIT OR Apache-2.0

adler2 2.0.1

### Apache-2.0

sync_wrapper 1.0.2, tao 0.35.3

### Apache-2.0 / MIT

fnv 1.0.7

### Apache-2.0 AND MIT

dpi 0.1.2

### Apache-2.0 OR MIT

atomic-waker 1.1.2, autocfg 1.5.1, bit-set 0.8.0, bit-vec 0.8.0, cargo_toml 0.22.3, ctor 0.8.0, ctor-proc-macro 0.0.7, dtor 0.3.0, dtor-proc-macro 0.0.6, equivalent 1.0.2, fastrand 2.5.0, idna_adapter 1.2.2, indexmap 1.9.3, indexmap 2.14.2, libappindicator 0.9.0, libappindicator-sys 0.9.0, muda 0.19.3, pin-project-lite 0.2.17, portable-atomic 1.15.0, portable-atomic-util 0.2.8, rustc-hash 2.1.3, tauri 2.11.5, tauri-build 2.6.3, tauri-codegen 2.6.3, tauri-macros 2.6.3, tauri-runtime 2.11.3, tauri-runtime-wry 2.11.4, tauri-utils 2.9.3, utf8_iter 1.0.4, uuid 1.26.0, window-vibrancy 0.6.0, wry 0.55.1

### Apache-2.0 WITH LLVM-exception

target-lexicon 0.12.16

### Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT

linux-raw-sys 0.12.1, rustix 1.1.4, wasi 0.11.1+wasi-snapshot-preview1, wasip2 1.0.4+wasi-0.2.12, wit-bindgen 0.57.1

### Apache-2.0/MIT

cesu8 1.1.0, dbus 0.9.12, libdbus-sys 0.2.7

### BSD-3-Clause

alloc-no-stdlib 2.0.4, alloc-stdlib 0.2.4

### BSD-3-Clause AND MIT

brotli 8.0.4

### BSD-3-Clause OR MIT OR Apache-2.0

num_enum 0.7.6, num_enum_derive 0.7.6

### BSD-3-Clause/MIT

brotli-decompressor 5.0.3

### CC0-1.0 OR MIT-0 OR Apache-2.0

dunce 1.0.5

### ISC

libloading 0.7.4

### MIT

atk 0.18.2, atk-sys 0.18.2, block2 0.6.2, bytes 1.12.1, cairo-rs 0.18.5, cairo-sys-rs 0.18.2, cargo_metadata 0.19.2, cfb 0.7.3, combine 4.6.8, darling 0.23.0, darling_core 0.23.0, darling_macro 0.23.0, derive_more 2.1.1, derive_more-impl 2.1.1, dlopen2 0.8.2, dlopen2_derive 0.4.3, dom_query 0.27.0, embed-resource 3.0.11, gdk 0.18.2, gdk-pixbuf 0.18.5, gdk-pixbuf-sys 0.18.0, gdk-sys 0.18.2, gdkwayland-sys 0.18.2, gdkx11 0.18.2, gdkx11-sys 0.18.2, generic-array 0.14.7, gio 0.18.4, gio-sys 0.18.1, glib 0.18.5, glib-macros 0.18.5, glib-sys 0.18.1, gobject-sys 0.18.0, gtk 0.18.2, gtk-sys 0.18.2, gtk3-macros 0.18.2, http-body 1.1.0, http-body-util 0.1.5, hyper 1.11.1, hyper-util 0.1.20, ico 0.5.0, infer 0.19.0, javascriptcore-rs 1.1.2, javascriptcore-rs-sys 1.1.1, libredox 0.1.23, memoffset 0.9.1, mio 1.2.3, new_debug_unreachable 1.0.6, objc2 0.6.4, objc2-encode 4.1.0, objc2-foundation 0.3.2, pango 0.18.3, pango-sys 0.18.0, phf 0.13.1, phf_codegen 0.13.1, phf_generator 0.13.1, phf_macros 0.13.1, phf_shared 0.13.1, plist 1.10.0, precomputed-hash 0.1.1, quick-xml 0.41.0, redox_syscall 0.5.18, redox_users 0.5.2, schemars 0.8.22, schemars 0.9.0, schemars 1.2.2, schemars_derive 0.8.22, simd-adler32 0.3.10, slab 0.4.12, soup3 0.5.0, soup3-sys 0.5.0, strsim 0.11.1, synstructure 0.13.2, tauri-winres 0.3.6, tokio 1.53.1, tokio-macros 2.7.2, tokio-util 0.7.19, tower 0.5.3, tower-http 0.6.11, tower-layer 0.3.3, tower-service 0.3.3, tracing 0.1.44, tracing-core 0.1.36, try-lock 0.2.5, urlpattern 0.3.0, version-compare 0.2.1, vswhom 0.1.0, vswhom-sys 0.1.3, want 0.3.1, webkit2gtk 2.0.2, webkit2gtk-sys 2.0.2, webview2-com 0.38.2, webview2-com-macros 0.8.1, webview2-com-sys 0.38.2, winnow 0.5.40, winnow 0.7.15, winnow 1.0.4, winreg 0.55.0, x11 2.21.0, x11-dl 2.21.0, zmij 1.0.23

### MIT OR Apache-2.0

android_system_properties 0.1.6, anyhow 1.0.104, base64 0.21.7, base64 0.22.1, bitflags 2.13.1, block-buffer 0.10.4, bumpalo 3.20.3, camino 1.2.5, cargo-platform 0.1.9, cc 1.4.5, cfg-expr 0.15.8, cfg-if 1.0.4, chrono 0.4.45, cookie 0.18.2, core-foundation 0.10.1, core-foundation-sys 0.8.7, core-graphics 0.25.0, core-graphics-types 0.2.0, cpufeatures 0.2.17, crc32fast 1.5.1, crossbeam-channel 0.5.16, crossbeam-utils 0.8.22, crypto-common 0.1.7, defmt 1.1.1, defmt-macros 1.1.1, defmt-parser 1.0.0, deranged 0.5.8, digest 0.10.7, dirs 6.0.0, dirs-sys 0.5.0, displaydoc 0.2.7, dtoa 1.0.11, dyn-clone 1.0.20, embed_plist 1.2.2, erased-serde 0.4.10, errno 0.3.14, fdeflate 0.3.7, field-offset 0.3.6, find-msvc-tools 0.1.12, flate2 1.1.10, form_urlencoded 1.2.2, futures-channel 0.3.34, futures-core 0.3.34, futures-executor 0.3.34, futures-io 0.3.34, futures-macro 0.3.34, futures-sink 0.3.34, futures-task 0.3.34, futures-util 0.3.34, getrandom 0.2.17, getrandom 0.3.4, getrandom 0.4.3, glob 0.3.4, hashbrown 0.12.3, hashbrown 0.17.1, heck 0.4.1, heck 0.5.0, hex 0.4.3, html5ever 0.38.0, http 1.5.0, httparse 1.10.1, iana-time-zone 0.1.65, iana-time-zone-haiku 0.1.2, idna 1.1.0, ipnet 2.12.1, itoa 1.0.18, jni-sys 0.3.1, jni-sys 0.4.1, jni-sys-macros 0.4.1, js-sys 0.3.105, jsonptr 0.6.3, keyboard-types 0.7.0, libc 0.2.189, lock_api 0.4.14, log 0.4.34, markup5ever 0.38.0, mime 0.3.17, ndk 0.9.0, ndk-sys 0.6.0+11769913, num-conv 0.2.2, num-traits 0.2.19, once_cell 1.21.4, parking_lot 0.12.5, parking_lot_core 0.9.12, percent-encoding 2.3.2, pkg-config 0.3.34, png 0.17.16, png 0.18.1, powerfmt 0.2.0, proc-macro-crate 1.3.1, proc-macro-crate 2.0.2, proc-macro-crate 3.5.0, proc-macro-error 1.0.4, proc-macro-error-attr 1.0.4, proc-macro2 1.0.107, quote 1.0.47, ref-cast 1.0.27, ref-cast-impl 1.0.27, regex 1.13.1, regex-automata 0.4.18, regex-syntax 0.8.11, reqwest 0.13.4, rustc_version 0.4.1, rustversion 1.0.23, scopeguard 1.2.0, semver 1.0.28, serde 1.0.229, serde-untagged 0.1.9, serde_core 1.0.229, serde_derive 1.0.229, serde_derive_internals 0.29.1, serde_json 1.0.151, serde_repr 0.1.21, serde_spanned 0.6.9, serde_spanned 1.1.1, serde_with 3.22.0, serde_with_macros 3.22.0, serialize-to-javascript 0.1.2, serialize-to-javascript-impl 0.1.2, servo_arc 0.4.3, sha2 0.10.9, shlex 2.0.1, signal-hook-registry 1.4.8, smallvec 1.16.0, socket2 0.6.5, softbuffer 0.4.8, stable_deref_trait 1.2.1, string_cache 0.9.0, string_cache_codegen 0.6.1, swift-rs 1.0.8, syn 1.0.109, syn 2.0.119, syn 3.0.5, system-deps 6.2.2, tao-macros 0.1.4, tempfile 3.27.0, tendril 0.5.1, thiserror 1.0.69, thiserror 2.0.20, thiserror-impl 1.0.69, thiserror-impl 2.0.20, time 0.3.55, time-core 0.1.9, time-macros 0.2.32, toml 0.8.2, toml 0.9.12+spec-1.1.0, toml 1.1.5+spec-1.1.0, toml_datetime 0.6.3, toml_datetime 0.7.5+spec-1.1.0, toml_datetime 1.1.1+spec-1.1.0, toml_edit 0.19.15, toml_edit 0.20.2, toml_edit 0.25.13+spec-1.1.0, toml_parser 1.1.3+spec-1.1.0, toml_writer 1.1.2+spec-1.1.0, tray-icon 0.24.2, typeid 1.0.3, typenum 1.20.1, unicode-segmentation 1.13.3, url 2.5.8, wasm-bindgen 0.2.128, wasm-bindgen-futures 0.4.78, wasm-bindgen-macro 0.2.128, wasm-bindgen-macro-support 0.2.128, wasm-bindgen-shared 0.2.128, wasm-streams 0.5.0, web-sys 0.3.105, web_atoms 0.2.6, windows 0.61.3, windows-collections 0.2.0, windows-core 0.61.2, windows-core 0.62.2, windows-future 0.2.1, windows-implement 0.60.2, windows-interface 0.59.3, windows-link 0.1.3, windows-link 0.2.1, windows-numerics 0.2.0, windows-result 0.3.4, windows-result 0.4.1, windows-strings 0.4.2, windows-strings 0.5.1, windows-sys 0.45.0, windows-sys 0.59.0, windows-sys 0.61.2, windows-targets 0.42.2, windows-targets 0.52.6, windows-threading 0.1.0, windows-version 0.1.7, windows_aarch64_gnullvm 0.42.2, windows_aarch64_gnullvm 0.52.6, windows_aarch64_msvc 0.42.2, windows_aarch64_msvc 0.52.6, windows_i686_gnu 0.42.2, windows_i686_gnu 0.52.6, windows_i686_gnullvm 0.52.6, windows_i686_msvc 0.42.2, windows_i686_msvc 0.52.6, windows_x86_64_gnu 0.42.2, windows_x86_64_gnu 0.52.6, windows_x86_64_gnullvm 0.42.2, windows_x86_64_gnullvm 0.52.6, windows_x86_64_msvc 0.42.2, windows_x86_64_msvc 0.52.6

### MIT OR Apache-2.0 OR LGPL-2.1-or-later

r-efi 5.3.0, r-efi 6.0.0

### MIT OR Apache-2.0 OR Zlib

raw-window-handle 0.6.2, tinyvec_macros 0.1.1

### MIT OR Zlib OR Apache-2.0

miniz_oxide 0.8.9, miniz_oxide 0.9.1

### MIT/Apache-2.0

bitflags 1.3.2, bs58 0.5.1, foreign-types 0.5.0, foreign-types-macros 0.2.4, foreign-types-shared 0.3.1, ident_case 1.0.1, jni 0.21.1, json-patch 3.0.1, siphasher 1.0.3, unic-char-property 0.9.0, unic-char-range 0.9.0, unic-common 0.9.0, unic-ucd-ident 0.9.0, unic-ucd-version 0.9.0, version_check 0.9.5, winapi 0.3.9, winapi-i686-pc-windows-gnu 0.4.0, winapi-x86_64-pc-windows-gnu 0.4.0

### MPL-2.0

cssparser 0.36.0, cssparser-macros 0.6.1, dtoa-short 0.3.5, option-ext 0.2.0, selectors 0.36.1

### Unicode-3.0

icu_collections 2.3.0, icu_locale_core 2.3.0, icu_normalizer 2.3.0, icu_normalizer_data 2.3.0, icu_properties 2.3.0, icu_properties_data 2.3.0, icu_provider 2.3.1, litemap 0.8.3, potential_utf 0.1.6, tinystr 0.8.4, writeable 0.6.4, yoke 0.8.3, yoke-derive 0.8.2, zerofrom 0.1.8, zerofrom-derive 0.1.7, zerotrie 0.2.5, zerovec 0.11.8, zerovec-derive 0.11.6

### Unlicense OR MIT

aho-corasick 1.1.5, byteorder 1.5.0, jiff 0.2.35, jiff-core 0.1.0, jiff-static 0.2.35, jiff-tzdb 0.1.8, jiff-tzdb-platform 0.1.3, memchr 2.8.3, winapi-util 0.1.11

### Unlicense/MIT

same-file 1.0.6, walkdir 2.5.0

### Zlib

foldhash 0.2.0, zlib-rs 0.6.7

### Zlib OR Apache-2.0 OR MIT

bytemuck 1.25.2, dispatch2 0.3.1, objc2-app-kit 0.3.2, objc2-cloud-kit 0.3.2, objc2-core-data 0.3.2, objc2-core-foundation 0.3.2, objc2-core-graphics 0.3.2, objc2-core-image 0.3.2, objc2-core-location 0.3.2, objc2-core-text 0.3.2, objc2-exception-helper 0.1.1, objc2-io-surface 0.3.2, objc2-quartz-core 0.3.2, objc2-ui-kit 0.3.2, objc2-user-notifications 0.3.2, objc2-web-kit 0.3.2, tinyvec 1.13.2


## Rust dependencies (host crate)

39 packages, 8 distinct licence expressions.

### (MIT OR Apache-2.0) AND Unicode-3.0

unicode-ident 1.0.24

### Apache-2.0 OR MIT

fastrand 2.5.0, pin-project-lite 0.2.17

### Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT

linux-raw-sys 0.12.1, rustix 1.1.4, wasi 0.11.1+wasi-snapshot-preview1

### MIT

bytes 1.12.1, generic-array 0.14.7, mio 1.2.3, tokio 1.53.1, tokio-macros 2.7.2, zmij 1.0.23

### MIT OR Apache-2.0

bitflags 2.13.1, block-buffer 0.10.4, cfg-if 1.0.4, cpufeatures 0.2.17, crypto-common 0.1.7, digest 0.10.7, errno 0.3.14, getrandom 0.4.3, itoa 1.0.18, libc 0.2.189, once_cell 1.21.4, proc-macro2 1.0.107, quote 1.0.47, serde 1.0.229, serde_core 1.0.229, serde_derive 1.0.229, serde_json 1.0.151, sha2 0.10.9, signal-hook-registry 1.4.8, syn 3.0.5, tempfile 3.27.0, typenum 1.20.1, windows-link 0.2.1, windows-sys 0.61.2

### MIT OR Apache-2.0 OR LGPL-2.1-or-later

r-efi 6.0.0

### MIT/Apache-2.0

version_check 0.9.5

### Unlicense OR MIT

memchr 2.8.3


## JavaScript dependencies

175 packages, 8 distinct licence expressions.

### Apache-2.0

detect-libc 2.1.2, expect-type 1.4.0, playwright 1.63.0, playwright-core 1.63.0, typescript 5.9.3

### Apache-2.0 OR MIT

@tauri-apps/api 2.11.1, @tauri-apps/cli 2.11.4, @tauri-apps/cli-darwin-arm64 2.11.4, @tauri-apps/cli-darwin-x64 2.11.4, @tauri-apps/cli-linux-arm-gnueabihf 2.11.4, @tauri-apps/cli-linux-arm64-gnu 2.11.4, @tauri-apps/cli-linux-arm64-musl 2.11.4, @tauri-apps/cli-linux-riscv64-gnu 2.11.4, @tauri-apps/cli-linux-x64-gnu 2.11.4, @tauri-apps/cli-linux-x64-musl 2.11.4, @tauri-apps/cli-win32-arm64-msvc 2.11.4, @tauri-apps/cli-win32-ia32-msvc 2.11.4, @tauri-apps/cli-win32-x64-msvc 2.11.4

### BSD-2-Clause

entities 7.0.1

### BSD-3-Clause

source-map-js 1.2.1

### BlueOak-1.0.0

jackspeak 3.4.3, minipass 7.1.3, package-json-from-dist 1.0.1, path-scurry 1.11.1

### ISC

@isaacs/cliui 8.0.2, abbrev 2.0.0, foreground-child 3.3.1, glob 10.5.0, ini 1.3.8, isexe 2.0.0, lru-cache 10.4.3, minimatch 9.0.9, nopt 7.2.1, picocolors 1.1.1, proto-list 1.2.4, semver 7.8.5, siginfo 2.0.0, signal-exit 4.1.0, which 2.0.2

### MIT

@babel/helper-string-parser 7.29.7, @babel/helper-validator-identifier 7.29.7, @babel/parser 7.29.8, @babel/types 7.29.8, @jridgewell/sourcemap-codec 1.6.0, @one-ini/wasm 0.1.1, @oxc-project/types 0.148.0, @pkgjs/parseargs 0.11.0, @rolldown/binding-android-arm-eabi 1.2.7, @rolldown/binding-android-arm64 1.2.7, @rolldown/binding-darwin-arm64 1.2.7, @rolldown/binding-darwin-x64 1.2.7, @rolldown/binding-freebsd-x64 1.2.7, @rolldown/binding-linux-arm-gnueabihf 1.2.7, @rolldown/binding-linux-arm64-gnu 1.2.7, @rolldown/binding-linux-arm64-musl 1.2.7, @rolldown/binding-linux-ppc64-gnu 1.2.7, @rolldown/binding-linux-s390x-gnu 1.2.7, @rolldown/binding-linux-x64-gnu 1.2.7, @rolldown/binding-linux-x64-musl 1.2.7, @rolldown/binding-openharmony-arm64 1.2.7, @rolldown/binding-win32-arm64-msvc 1.2.7, @rolldown/binding-win32-x64-msvc 1.2.7, @rolldown/pluginutils 1.0.1, @standard-schema/spec 1.1.0, @types/chai 5.2.3, @types/deep-eql 4.0.2, @types/estree 1.0.9, @types/node 26.4.1, @types/whatwg-mimetype 3.0.2, @types/ws 8.18.1, @vitejs/plugin-vue 6.0.8, @vitest/expect 4.1.11, @vitest/mocker 4.1.11, @vitest/pretty-format 4.1.11, @vitest/runner 4.1.11, @vitest/snapshot 4.1.11, @vitest/spy 4.1.11, @vitest/utils 4.1.11, @volar/language-core 2.4.28, @volar/source-map 2.4.28, @volar/typescript 2.4.28, @vue/compiler-core 3.5.42, @vue/compiler-dom 3.5.42, @vue/compiler-sfc 3.5.42, @vue/compiler-ssr 3.5.42, @vue/language-core 3.3.11, @vue/reactivity 3.5.42, @vue/runtime-core 3.5.42, @vue/runtime-dom 3.5.42, @vue/server-renderer 3.5.42, @vue/shared 3.5.42, @vue/test-utils 2.4.6, alien-signals 3.2.1, ansi-regex 5.0.1, ansi-regex 5.0.1, ansi-regex 5.0.1, ansi-regex 6.3.0, ansi-styles 4.3.0, ansi-styles 6.2.3, assertion-error 2.0.1, balanced-match 1.0.2, brace-expansion 2.1.4, buffer-image-size 0.6.4, chai 6.2.2, color-convert 2.0.1, color-name 1.1.4, commander 10.0.1, config-chain 1.1.13, convert-source-map 2.0.0, cross-spawn 7.0.6, csstype 3.2.3, eastasianwidth 0.2.0, editorconfig 1.0.7, emoji-regex 8.0.0, emoji-regex 8.0.0, emoji-regex 9.2.2, es-module-lexer 2.3.2, estree-walker 2.0.2, estree-walker 2.0.2, estree-walker 3.0.3, fdir 6.5.0, fsevents 2.3.3, happy-dom 20.14.0, is-fullwidth-code-point 3.0.0, js-beautify 1.15.4, js-cookie 3.0.8, magic-string 0.30.21, muggle-string 0.4.1, nanoid 3.3.18, obug 2.1.4, path-browserify 1.0.1, path-key 3.1.1, pathe 2.0.3, picomatch 4.0.7, postcss 8.5.28, rolldown 1.2.7, shebang-command 2.0.0, shebang-regex 3.0.0, stackback 0.0.2, std-env 4.2.0, string-width 4.2.3, string-width 5.1.2, string-width-cjs 4.2.3, strip-ansi 6.0.1, strip-ansi 6.0.1, strip-ansi 7.2.0, strip-ansi-cjs 6.0.1, tinybench 2.9.0, tinyexec 1.3.0, tinyglobby 0.2.17, tinyrainbow 3.1.1, undici-types 8.3.0, vite 8.2.2, vitest 4.1.11, vscode-uri 3.2.0, vue 3.5.42, vue-component-type-helpers 2.2.12, vue-tsc 3.3.11, whatwg-mimetype 3.0.0, why-is-node-running 2.3.0, wrap-ansi 8.1.0, wrap-ansi-cjs 7.0.0, ws 8.21.3

### MPL-2.0

lightningcss 1.33.0, lightningcss-android-arm64 1.33.0, lightningcss-darwin-arm64 1.33.0, lightningcss-darwin-x64 1.33.0, lightningcss-freebsd-x64 1.33.0, lightningcss-linux-arm-gnueabihf 1.33.0, lightningcss-linux-arm64-gnu 1.33.0, lightningcss-linux-arm64-musl 1.33.0, lightningcss-linux-x64-gnu 1.33.0, lightningcss-linux-x64-musl 1.33.0, lightningcss-win32-arm64-msvc 1.33.0, lightningcss-win32-x64-msvc 1.33.0


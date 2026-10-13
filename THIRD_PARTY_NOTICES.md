# Third-party notices

The CrediTAD desktop client is MIT-licensed (see [LICENSE](LICENSE)). The built
application also contains the third-party components listed here. Exact versions are
pinned in `package-lock.json`; after `npm ci` each package's own licence file is under
`node_modules/<package>/`.

## Bundled into the renderer (`dist/`)

| component | licence | copyright | full text |
|---|---|---|---|
| Vue (`vue`, `@vue/reactivity`, `@vue/runtime-core`, `@vue/runtime-dom`, `@vue/shared`) | MIT | (c) 2018-present, Yuxi (Evan) You | [licenses/vue.txt](licenses/vue.txt) |
| Pinia | MIT | (c) 2019-present Eduardo San Martin Morote | [licenses/pinia.txt](licenses/pinia.txt) |
| Font Awesome Free 7.2.0 (CSS and web fonts) | icons CC BY 4.0, fonts SIL OFL 1.1, code MIT | (c) 2026 Fonticons, Inc. | [licenses/font-awesome-free-7.2.0.txt](licenses/font-awesome-free-7.2.0.txt) |
| Source Serif 4, Source Sans 3, Source Code Pro (via `@fontsource`) | SIL OFL 1.1 | Adobe, Reserved Font Name "Source" | [licenses/OFL-1.1_Source-fonts.txt](licenses/OFL-1.1_Source-fonts.txt) |

The Font Awesome attribution comment is kept in the bundled stylesheet.

## Bundled into the Electron main process (`dist-electron/main.js`)

| component | licence |
|---|---|
| electron-updater, builder-util-runtime | MIT, (c) 2015 Loopline Systems ([licenses/electron-updater.txt](licenses/electron-updater.txt)) |
| tree-kill | MIT |
| fs-extra, jsonfile, universalify, graceful-fs | MIT; graceful-fs ISC |
| js-yaml, lazy-val, lodash.escaperegexp, lodash.isequal | MIT |
| debug, ms, supports-color, has-flag | MIT |
| semver | ISC |
| sax | Blue Oak Model License 1.0.0 ([licenses/sax-BlueOak-1.0.0.md](licenses/sax-BlueOak-1.0.0.md)) |

The auto-update code path is compiled in but is inert: it runs only when
`TAD_ENABLE_AUTO_UPDATE=1` is set, and the packaging configuration publishes no update
feed (`publish: null`).

## Runtime shipped by the packager

electron-builder places Electron's own licence (`LICENSE.electron.txt`, MIT) and the
Chromium licences (`LICENSES.chromium.html`) next to the executable of every packaged
build.

## Python runtime of the Linux AppImage (`resources/runtime`), from 1.0.2

Built by `scripts/build_linux_runtime.sh`; the exact files are pinned in
`scripts/linux-runtime/`.

- 128 conda-forge packages (`conda-linux-64.lock`): CPython 3.11 (Python-2.0) and the
  libraries it links, NumPy, SciPy, pandas, h5py, scikit-learn, scikit-image, hmmlearn and
  OpenBLAS (BSD-3-Clause), aiohttp (MIT and Apache-2.0), SQLAlchemy (MIT), OpenSSL
  (Apache-2.0), libcurl (curl licence), and others. The licence files the packages carry
  are copied to `resources/runtime/share/licenses/conda/<name>-<version>/`. Ten packages
  carry none in their archive: the GCC runtime libraries `libgcc`, `libgcc-ng`,
  `libgfortran`, `libgfortran5`, `libgomp`, `libstdcxx`, `libstdcxx-ng` (GPL-3.0 with the
  GCC Runtime Library Exception 3.1), `libfreetype` and `libfreetype6` (FreeType licence
  or GPL-2.0), and `libsqlite` (public domain, with the SQLite blessing).
- From PyPI (`pip-requirements.txt`), each with its licence file in its
  `lib/python3.11/site-packages/<name>-<version>.dist-info/` directory: cooler 0.10.4,
  click 8.5.0, cytoolz 1.2.0, dill 0.4.1, multiprocess 0.70.19, pyfaidx 0.9.0.4 and
  toolz 1.2.0 (BSD-3-Clause); pyBigWig 0.3.25, asciitree 0.3.3 and PyYAML 6.0.3 (MIT);
  simplejson 4.2.0 (MIT or AFL-2.1).

The runtimes of the v1.0.1 builds came from an unpinned conda-forge environment and are
not described here.

## Images in `public/`

`CrediTAD.svg`, `CrediTAD.ico` and the `CrediTAD-*.png` files are the project's own
mark, drawn by `scripts/make_brand_icon.py`. `TAD-TAG.ico` is a byte-identical copy of
`CrediTAD.ico` under an older file name, which the main process tries as a fallback
window icon. `TAD-TAG.svg` is the project's earlier mark; no page displays it.
`vite.svg`, `electron-vite.svg` and `electron-vite.animate.svg` are logos left over from
the Vite/Electron project template; no page displays them either. All of these are
copied into `dist/` and so are present in the v1.0.1 builds.

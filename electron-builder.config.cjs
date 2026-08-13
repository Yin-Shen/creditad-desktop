const { readFileSync, existsSync } = require('node:fs')
const path = require('node:path')
const { resolvePackageInputs } = require('./scripts/package-preflight.cjs')

const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
)

const packageProfile = process.env.TAD_PACKAGE_PROFILE === 'lite' ? 'lite' : 'full'
const artifactSuffix = packageProfile === 'lite' ? '-Lite' : ''
const packageInputs = resolvePackageInputs()

// The brand icon is not optional and must not degrade silently: TAD-TAG.ico is the
// legacy mark, and a build that quietly ships it looks successful while carrying the
// wrong branding into the installer, the exe resources and every shortcut.
const brandIcon = path.join(__dirname, 'public', 'CrediTAD.ico')
if (!existsSync(brandIcon)) {
  throw new Error(`electron-builder.config: brand icon missing at ${brandIcon}`)
}
const iconIco = 'public/CrediTAD.ico'
// Linux rejects .ico: electron-builder requires a >=256x256 raster, and pointing the
// linux target at CrediTAD.ico failed the build outright
// ("must be at least 256x256"). CrediTAD-512.png is the same mark at 512x512.
const iconPng = 'public/CrediTAD-512.png'
if (!existsSync(path.join(__dirname, iconPng))) {
  throw new Error(`electron-builder.config: linux brand icon missing at ${iconPng}`)
}

// Exclusion rules live in one file shared with scripts/stage_windows_package.sh and
// scripts/verify_win_package.py; three hand-maintained copies had already drifted apart.
const excludes = require('../scripts/package_excludes.json')
const backendFilters = [
  '**/*',
  ...excludes.dir_names.map((d) => `!**/${d}/**`),
  ...excludes.file_names.map((f) => `!**/${f}`),
  ...excludes.file_patterns.map((p) => `!**/${p}`),
  // Path-specific rules that only make sense here.
  '!sql_db/tad_tokens.db',
  // Full-genome BigWigs are multi-hundred-MB; the chr7 demo tracks live in
  // extra_mode/chr7_tracks/ and are kept.
  '!extra_mode/*.bigWig',
]

// The embedded Python tree is the bulk of the installer, and every megabyte and
// every file is paid for three times: download, install, uninstall. Everything
// excluded here is a build-time or debugging artefact that the running app never
// opens. Verified against the tree with `wine python.exe` before being added.
// The target OS decides which runtime-pruning rules apply. These lists are NOT
// interchangeable: the Windows list drops `lib/**` because the win-64 staging step
// merges lib/python3.11/site-packages into Lib/site-packages and the duplicate costs
// 131 MB — but on Linux `lib/python3.11/site-packages` IS the only site-packages, so
// applying the Windows list to an AppImage would ship a runtime with no dependencies
// at all, and the failure would only appear when a user launched it.
const packageOs = process.env.CREDITAD_PACKAGE_OS === 'linux' ? 'linux' : 'win'

const runtimeFiltersLinux = [
  '**/*',
  '!**/__pycache__/**',
  '!**/*.pyc',
  '!lib/python3.*/site-packages/**/tests/**',
  '!lib/python3.*/site-packages/**/test/**',
  '!pkgs/**',
  '!conda-meta/**',
  '!include/**',
  '!share/doc/**',
  '!share/info/**',
  '!share/man/**',
  // Static archives and CMake/pkg-config metadata: needed to COMPILE against these
  // libraries, never to run them.
  '!lib/**/*.a',
  '!lib/cmake/**',
  '!lib/pkgconfig/**',
]

const runtimeFiltersWin = [
  '**/*',
  '!**/__pycache__/**',
  '!**/*.pyc',
  '!Lib/site-packages/**/tests/**',
  '!Lib/site-packages/**/test/**',
  '!pkgs/**',
  '!conda-meta/**',
  // Debug symbols (~78 MB).
  '!**/*.pdb',
  // Duplicate of Lib/site-packages: the staging step merges the noarch packages
  // from lib/python3.11/site-packages into Lib/site-packages, and Windows treats
  // the two names as one directory anyway (~131 MB).
  '!lib/**',
  // C headers and import libraries — needed to COMPILE extensions, never to run
  // them (~64 MB).
  '!include/**',
  '!Library/include/**',
  '!Library/lib/**',
  '!Library/cmake/**',
  // Documentation and shell completions.
  '!Library/share/doc/**',
  '!Library/share/info/**',
  '!Library/share/man/**',
  '!Library/share/bash-completion/**',
  '!share/doc/**',
  '!Tools/demo/**',
]

const extraResources = [
  {
    from: packageInputs.backendDir,
    to: 'backend/',
    filter: backendFilters,
  },
  {
    from: packageInputs.runtimeDir,
    to: 'runtime/',
    filter: packageOs === 'linux' ? runtimeFiltersLinux : runtimeFiltersWin,
  },
  {
    from: packageInputs.exampleDataDir,
    to: 'example_data/',
    filter: ['**/*', '!**/.DS_Store'],
  },
]

// Artifact names intentionally omit the package.json version, so a filename never
// carries a build number. The version that IS stamped into the exe and into
// Add/Remove Programs comes from package.json and must be a release version:
// a pre-release string like "0.5.0-dev.0" is visible to every user in the
// installer and the properties page.
module.exports = {
  appId: 'com.noesisthink.creditad',
  asar: true,
  productName: 'CrediTAD',
  executableName: 'CrediTAD',
  directories: {
    // Stable output dir name — not versioned folders. Per-platform so a Linux build
    // never overwrites win-unpacked/ (and so the two deliverables can coexist).
    output: process.env.CREDITAD_RELEASE_DIR || 'release/windows',
  },
  // vite bundles every renderer and main-process dependency into dist/ and
  // dist-electron/ (the built main.js has exactly one runtime `require`, of the node
  // built-in `stream`), so electron-builder's default "ship every production
  // dependency" behaviour added ~57 MB / 8,700 files of node_modules to app.asar that
  // nothing opens — fontawesome's icon metadata alone was 25 MB. package.json must stay:
  // electron/main.ts reads the version out of it.
  files: ['dist', 'dist-electron', 'package.json', '!node_modules/**'],
  extraResources,
  // 'maximum' is solid LZMA at the highest preset: it shaves a little off the
  // download and costs the user minutes of CPU on every install, on a ~1.6 GB
  // payload. 'normal' is the right trade for a scientific desktop tool that is
  // downloaded once and installed once.
  compression: 'normal',
  // rcedit needs wine on Linux, so `signAndEditExecutable` stays off and the icon
  // + version resources are written by scripts/patch-win-exe.cjs (pure JS) instead.
  afterPack: 'scripts/patch-win-exe.cjs',
  win: {
    icon: iconIco,
    signAndEditExecutable: false,
    // Default deliverable: NSIS installer with choosable install directory.
    // Also build portable via: npm run build:win:portable
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    artifactName: '${productName}-Windows-Setup' + artifactSuffix + '.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'CrediTAD',
    deleteAppDataOnUninstall: false,
    installerIcon: iconIco,
    uninstallerIcon: iconIco,
    installerHeaderIcon: iconIco,
    // Do not surface internal npm version strings in the wizard title.
    displayLanguageSelector: false,
  },
  portable: {
    artifactName: '${productName}-Windows-Portable' + artifactSuffix + '.${ext}',
  },
  mac: {
    target: ['dmg'],
    icon: iconIco,
    artifactName: '${productName}-Mac-Installer' + artifactSuffix + '.${ext}',
  },
  linux: {
    target: ['AppImage'],
    icon: iconPng,
    category: 'Science',
    synopsis: 'Evidence cards for already-called TAD boundaries',
    artifactName: '${productName}-Linux' + artifactSuffix + '.${ext}',
  },
  extraMetadata: {
    // Keep package.json version for internal builds, but product branding is name-only.
    name: 'CrediTAD',
    productName: 'CrediTAD',
    description:
      'CrediTAD — evidence cards for already-called TAD boundaries.',
    author: 'NoesisThink',
  },
}

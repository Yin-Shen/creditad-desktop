/**
 * Stamp the brand icon and version metadata into the packaged Windows executable.
 *
 * electron-builder normally does this with `rcedit`, which is a Windows binary and
 * therefore needs wine when packaging from Linux. This host has no wine (and no
 * root to install it), so `win.signAndEditExecutable` is off and the exe came out
 * of the packer still carrying Electron's own icon and version resources: in
 * Explorer, on the taskbar and in the file properties the app looked like
 * "Electron".
 *
 * `resedit` is a pure-JavaScript PE resource editor, so the same edit runs
 * natively here. Wired into electron-builder as an `afterPack` hook, which fires
 * after win-unpacked is assembled and before any target (NSIS / portable) packs
 * it, so both deliverables pick the change up.
 */
const fs = require('node:fs')
const path = require('node:path')

// One name, no fallback: TAD-TAG.ico is the legacy mark, and falling back to it would
// stamp the wrong brand into the exe without failing the build.
const ICON_NAME = 'CrediTAD.ico'

/** "0.5.0-dev.0" → [0, 5, 0, 0]; Windows FILEVERSION is four plain numbers. */
function toFileVersion(version) {
  const nums = String(version)
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  while (nums.length < 4) nums.push(0)
  return nums.slice(0, 4)
}

async function patchWindowsExecutable(context) {
  if (context.electronPlatformName !== 'win32') return

  const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit')

  const frontendDir = path.resolve(__dirname, '..')
  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  if (!fs.existsSync(exePath)) {
    throw new Error(`patch-win-exe: ${exePath} not found`)
  }

  const iconPath = path.join(frontendDir, 'public', ICON_NAME)
  if (!fs.existsSync(iconPath)) {
    throw new Error(`patch-win-exe: brand icon missing at ${iconPath}`)
  }

  const exe = NtExecutable.from(fs.readFileSync(exePath))
  const res = NtExecutableResource.from(exe)

  // Replace every icon in the group so small sizes come from our own renders
  // rather than from a downscale of the 256 px image.
  const iconFile = Data.IconFile.from(fs.readFileSync(iconPath))
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033, // en-US; Electron ships its resources under this language id
    iconFile.icons.map((i) => i.data),
  )

  const version = context.packager.appInfo.version
  const fileVersion = toFileVersion(version)
  const vi = Resource.VersionInfo.createEmpty()
  vi.setFileVersion(...fileVersion)
  vi.setProductVersion(...fileVersion)
  vi.lang = 1033
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: 'CrediTAD',
      FileDescription: 'CrediTAD — evidence cards for already-called TAD boundaries',
      CompanyName: 'NoesisThink',
      LegalCopyright: 'MIT licence',
      OriginalFilename: exeName,
      InternalName: 'CrediTAD',
      FileVersion: version,
      ProductVersion: version,
    },
  )
  vi.outputToResourceEntries(res.entries)

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))

  console.log(
    `  • patched ${exeName}  icon=${path.basename(iconPath)} ` +
      `version=${version} (${fileVersion.join('.')})`,
  )
}

module.exports = patchWindowsExecutable
module.exports.patchWindowsExecutable = patchWindowsExecutable

#!/usr/bin/env bash
# Build the Python runtime of the Linux AppImage from the two pinned lists in
# scripts/linux-runtime/:
#   conda-linux-64.lock    128 conda-forge packages, exact builds, sha256 per archive
#   pip-requirements.txt   cooler, pyBigWig and the rest of cooler's dependencies, sha256 per file
#
#   scripts/build_linux_runtime.sh OUT_DIR [MANIFEST_DIR]
#
# OUT_DIR must not exist yet; it becomes CREDITAD_PACKAGE_RUNTIME. MANIFEST_DIR (default
# OUT_DIR.manifest) receives the versions and hashes of everything that went in.
#
# The environment is created at a fixed neutral prefix and then copied to OUT_DIR. conda
# writes its install prefix into scripts and some binaries, so building directly inside a
# working directory would ship that directory's name in the AppImage.
#
# Environment:
#   CREDITAD_CONDA            conda executable (default: conda on PATH; needs >= 23.10 for
#                             sha256 fragments in an explicit file)
#   CREDITAD_RUNTIME_PREFIX   build prefix (default /tmp/creditad-linux-runtime; must not exist)
#   CONDA_PKGS_DIRS           package cache (default OUT_DIR.pkgs)
#   pip's own variables (PIP_INDEX_URL, ...) choose the index; the hashes fix the files.
set -euo pipefail

usage() { echo "usage: $0 OUT_DIR [MANIFEST_DIR]" >&2; exit 64; }
[[ $# -ge 1 && $# -le 2 ]] || usage

HERE="$(cd "$(dirname "$0")" && pwd)"
CONDA_LOCK="$HERE/linux-runtime/conda-linux-64.lock"
PIP_LOCK="$HERE/linux-runtime/pip-requirements.txt"
OUT="$(realpath -m "$1")"
MANIFEST="$(realpath -m "${2:-$OUT.manifest}")"
PREFIX="${CREDITAD_RUNTIME_PREFIX:-/tmp/creditad-linux-runtime}"
CONDA_BIN="${CREDITAD_CONDA:-conda}"
export CONDA_PKGS_DIRS="${CONDA_PKGS_DIRS:-$OUT.pkgs}"
# Keep the build interpreter away from the host's Python: with a user site-packages
# visible, pip treats packages there as already installed (and uninstalls them when
# it upgrades), so the runtime silently ends up without them.
export PYTHONNOUSERSITE=1
unset PYTHONPATH PYTHONHOME

for p in "$OUT" "$PREFIX"; do
  if [[ -e "$p" ]]; then
    echo "[runtime] ERROR: $p already exists; remove it first" >&2
    exit 1
  fi
done
[[ "$(uname -s)-$(uname -m)" == "Linux-x86_64" ]] || { echo "[runtime] ERROR: linux-64 host required" >&2; exit 1; }
mkdir -p "$MANIFEST" "$CONDA_PKGS_DIRS" "$(dirname "$OUT")"

echo "[runtime] conda: $(command -v "$CONDA_BIN") ($("$CONDA_BIN" --version))"
echo "[runtime] package cache: $CONDA_PKGS_DIRS"
echo "[runtime] build prefix: $PREFIX"

echo "[runtime] conda create from $(basename "$CONDA_LOCK")"
"$CONDA_BIN" create --prefix "$PREFIX" --file "$CONDA_LOCK" --yes --quiet

PY="$PREFIX/bin/python"
[[ -x "$PY" ]] || { echo "[runtime] ERROR: no $PY after conda create" >&2; exit 1; }

# The installed set must be the locked set, and every archive in the cache must still
# hash to the locked value.
echo "[runtime] checking installed conda packages against the lock"
"$PY" -I - "$PREFIX" "$CONDA_LOCK" "$CONDA_PKGS_DIRS" <<'PYCHECK'
import hashlib, json, sys
from pathlib import Path
prefix, lock, cache = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3].split(":")[0])
want = {}
for line in lock.read_text().splitlines():
    if line.startswith("http"):
        url, _, frag = line.partition("#")
        want[url.rsplit("/", 1)[1]] = frag.removeprefix("sha256:")
have = {}
for meta in (prefix / "conda-meta").glob("*.json"):
    rec = json.loads(meta.read_text())
    have[rec["fn"]] = rec
errors = [f"not installed: {fn}" for fn in sorted(set(want) - set(have))]
errors += [f"not in the lock: {fn}" for fn in sorted(set(have) - set(want))]
for fn, sha in sorted(want.items()):
    archive = cache / fn
    if not archive.is_file():
        errors.append(f"archive missing from cache: {archive}")
        continue
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != sha:
        errors.append(f"sha256 mismatch: {fn} {digest} != {sha}")
if errors:
    print("[runtime] ERROR:\n  " + "\n  ".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"[runtime] {len(want)} conda packages installed, archives match the lock")
PYCHECK

# conda keeps each package's licence texts in the package cache (info/licenses/), not in
# the environment, so without this the AppImage would ship the binaries without them.
echo "[runtime] copying licence files of the conda packages to share/licenses/conda/"
"$PY" -I - "$PREFIX" "$CONDA_PKGS_DIRS" <<'PYLIC'
import json, shutil, sys
from pathlib import Path
prefix, cache = Path(sys.argv[1]), Path(sys.argv[2].split(":")[0])
dest = prefix / "share" / "licenses" / "conda"
copied, none = 0, []
for meta in sorted((prefix / "conda-meta").glob("*.json")):
    rec = json.loads(meta.read_text())
    stem = rec["fn"].removesuffix(".conda").removesuffix(".tar.bz2")
    src = cache / stem / "info" / "licenses"
    if src.is_dir():
        shutil.copytree(src, dest / f"{rec['name']}-{rec['version']}")
        copied += 1
    else:
        none.append(f"{rec['name']} ({rec.get('license', '?')})")
print(f"[runtime] licence files of {copied} conda packages copied; the package archive "
      f"carries none for: {', '.join(none) or '-'}")
PYLIC

"$PY" -I - "$PREFIX" <<'PYCHECK'
import sys
from pathlib import Path
prefix = Path(sys.argv[1]).resolve()
outside = [p for p in sys.path if p and prefix not in Path(p).resolve().parents and Path(p).resolve() != prefix]
if outside:
    print(f"[runtime] ERROR: build interpreter sees paths outside {prefix}: {outside}", file=sys.stderr)
    sys.exit(1)
PYCHECK
echo "[runtime] pip install from $(basename "$PIP_LOCK")"
"$PY" -I -m pip install --no-input --disable-pip-version-check --no-cache-dir \
  --no-deps --require-hashes --no-build-isolation \
  --report "$MANIFEST/pip_install_report.json" \
  -r "$PIP_LOCK"
"$PY" -I -m pip check

# pip replaces files conda owns without complaint, after which conda-meta describes an
# environment that is no longer on disk.
echo "[runtime] checking for pip-over-conda overwrites"
"$PY" -I - "$PREFIX" <<'PYCHECK'
import json, sys
from pathlib import Path
prefix = Path(sys.argv[1])
site = next(prefix.glob("lib/python3.*/site-packages"))
conda_names = {json.loads(m.read_text())["name"].lower() for m in (prefix / "conda-meta").glob("*.json")}
clash = []
for info in site.glob("*.dist-info"):
    installer = info / "INSTALLER"
    name = info.name.rsplit("-", 1)[0].replace("_", "-").lower()
    if installer.is_file() and installer.read_text().strip() == "pip" and name in conda_names:
        clash.append(name)
if clash:
    print(f"[runtime] ERROR: pip overwrote conda packages: {sorted(clash)}", file=sys.stderr)
    sys.exit(1)
print("[runtime] no pip-over-conda overwrites")
PYCHECK

# Every file conda recorded must be on disk at the recorded size. Skipped: .pyc, files
# rewritten at link time (prefix_placeholder / file_mode, or sha256_in_prefix != sha256),
# and the size of symlinks, which conda records inconsistently; links must still resolve.
# noarch: python packages record site-packages/ and python-scripts/ paths, which conda
# places under lib/python3.X/site-packages/ and bin/ when it links them.
echo "[runtime] verifying linked files against conda-meta"
"$PY" -I - "$PREFIX" <<'PYCHECK'
import json, os, sys
from pathlib import Path
prefix = Path(sys.argv[1])
site = next(prefix.glob("lib/python3.*/site-packages")).relative_to(prefix).as_posix()
bad, checked = [], 0
for meta in sorted((prefix / "conda-meta").glob("*.json")):
    rec = json.loads(meta.read_text())
    noarch_python = rec.get("noarch") == "python"
    for entry in rec.get("paths_data", {}).get("paths", []):
        rel = entry.get("_path")
        if noarch_python and rel:
            if rel.startswith("site-packages/"):
                rel = site + rel[len("site-packages"):]
            elif rel.startswith("python-scripts/"):
                rel = "bin" + rel[len("python-scripts"):]
        if not rel or rel.endswith(".pyc") or "__pycache__" in rel:
            continue
        if entry.get("prefix_placeholder") or entry.get("file_mode"):
            continue
        if entry.get("sha256_in_prefix") and entry.get("sha256") and entry["sha256_in_prefix"] != entry["sha256"]:
            continue
        size = entry.get("size_in_bytes")
        if size is None:
            continue
        p = prefix / rel
        checked += 1
        if p.is_symlink():
            if not p.exists():
                bad.append(f"DANGLING {rel} -> {os.readlink(p)}")
        elif not p.exists():
            bad.append(f"MISSING {rel}")
        elif p.stat().st_size != size:
            bad.append(f"SIZE {rel}: {p.stat().st_size} != {size}")
if bad:
    print(f"[runtime] ERROR: {len(bad)} link-integrity failures, first 20:", file=sys.stderr)
    print("\n".join("    " + b for b in bad[:20]), file=sys.stderr)
    sys.exit(1)
print(f"[runtime] link integrity ok ({checked} files)")
PYCHECK

echo "[runtime] import smoke test"
"$PY" -I - "$PREFIX" <<'PYIMPORT'
import importlib, sys
from pathlib import Path
prefix = Path(sys.argv[1]).resolve()
mods = ["numpy", "pandas", "scipy", "h5py", "aiohttp", "aiohttp_cors", "sqlalchemy", "sklearn",
        "skimage", "hmmlearn", "joblib", "tqdm", "cooler", "pyBigWig"]
for m in mods:
    origin = Path(importlib.import_module(m).__file__).resolve()
    if prefix not in origin.parents:
        sys.exit(f"[runtime] ERROR: {m} imported from {origin}, outside {prefix}")
print(f"[runtime] {len(mods)} imports ok, all from {prefix}")
import numpy, pyBigWig
numpy.linalg.svd(numpy.random.RandomState(0).rand(8, 8))
assert pyBigWig.numpy == 1, "pyBigWig was built without numpy support"
print("[runtime] numpy linear algebra ok; pyBigWig numpy support ok")
PYIMPORT

echo "[runtime] writing manifest to $MANIFEST"
sha256sum "$CONDA_LOCK" "$PIP_LOCK" | sed "s|$HERE/||" > "$MANIFEST/lock_sha256.txt"
"$PY" -I - "$PREFIX" > "$MANIFEST/conda_packages.tsv" <<'PYLIST'
import json, sys
from pathlib import Path
print("name\tversion\tbuild\tlicense\tsha256\turl")
recs = [json.loads(m.read_text()) for m in (Path(sys.argv[1]) / "conda-meta").glob("*.json")]
for r in sorted(recs, key=lambda r: r["name"]):
    print("\t".join([r["name"], r["version"], r["build"], r.get("license", ""), r["sha256"], r["url"]]))
PYLIST
"$PY" -I - "$MANIFEST/pip_install_report.json" > "$MANIFEST/pip_packages.tsv" <<'PYLIST'
import json, sys
print("name\tversion\tlicense\tsha256\turl")
for item in json.load(open(sys.argv[1]))["install"]:
    meta, info = item["metadata"], item["download_info"]
    lic = meta.get("license_expression") or meta.get("license") or ""
    sha = info.get("archive_info", {}).get("hashes", {}).get("sha256", "")
    print("\t".join([meta["name"], meta["version"], lic.splitlines()[0] if lic else "", sha, info["url"]]))
PYLIST
"$PY" -I -m pip list --format=freeze --disable-pip-version-check > "$MANIFEST/pip_freeze.txt"
"$PY" -VV > "$MANIFEST/python_version.txt"

echo "[runtime] copying $PREFIX -> $OUT"
cp -a "$PREFIX" "$OUT"
rm -rf "$PREFIX"
echo "[runtime] linux-64 runtime at $OUT ($(du -sh "$OUT" | cut -f1))"

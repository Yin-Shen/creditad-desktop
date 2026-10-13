#!/usr/bin/env bash
# Stage the backend and the example data of the Linux AppImage from a tag of the main
# repository (https://github.com/Yin-Shen/creditad).
#
#   scripts/stage_linux_package.sh --repo DIR --tag TAG --released-resources DIR --out DIR
#
#   --repo                a clone of the main repository; only read (git archive), never
#                         checked out, so its working tree and branches are left alone
#   --tag                 the backend release to package, e.g. v1.0.4
#   --released-resources  resources/ of a released desktop build (linux-unpacked/resources,
#                         or squashfs-root/resources after `CrediTAD-Linux.AppImage
#                         --appimage-extract`). It supplies the files the main repository
#                         does not hold: the three chr7 .mcool contact maps (over GitHub's
#                         file-size limit), the UCSC gap masks and labels.json of
#                         backend/extra_mode/, example_data/README.md and
#                         multicell/index.json. A file present at TAG is taken from TAG.
#   --out                 new directory; receives backend/ and example_data/, the inputs
#                         CREDITAD_PACKAGE_BACKEND and CREDITAD_PACKAGE_EXAMPLE_DATA, plus
#                         STAGE_MANIFEST.tsv (sha256, size and source of every staged file)
#
# Layout written (the layout of the 1.0.1 package):
#   backend/                               TAG:backend/
#   backend/extra_mode/chr7_tracks/        TAG:data/chr7_preview_tracks/*.bigWig
#   backend/extra_mode/loops/              TAG:data/loops/*.bedpe.gz, decompressed
#   example_data/chr7_tracks/              the chr7 .mcool files + TAG:data/chr7_preview_tracks/*.bigWig
#   example_data/multicell/<CELL>_<RES>/   TAG:data/multicell/; *_boundaries.bed.gz decompressed
#                                          to .bed, because the Home-page demo route registers
#                                          only plain *_boundaries.bed files as caller tracks
set -euo pipefail

die() { echo "[stage] ERROR: $*" >&2; exit 1; }
REPO= TAG= RELEASED= OUT=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --released-resources) RELEASED="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
[[ -n "$REPO" && -n "$TAG" && -n "$RELEASED" && -n "$OUT" ]] \
  || die "usage: $0 --repo DIR --tag TAG --released-resources DIR --out DIR"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(realpath "$REPO")"
RELEASED="$(realpath "$RELEASED")"
OUT="$(realpath -m "$OUT")"
[[ -e "$OUT" ]] && die "$OUT already exists; remove it first"
[[ -d "$RELEASED/example_data/chr7_tracks" ]] || die "$RELEASED does not look like resources/ of a released build"

git_ro() { git -c safe.directory="$REPO" -C "$REPO" "$@"; }
COMMIT="$(git_ro rev-parse --verify --quiet "$TAG^{commit}")" || die "tag $TAG not found in $REPO"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "[stage] exporting $TAG ($COMMIT) from $REPO"
git_ro archive --format=tar "$COMMIT" backend data/multicell data/chr7_preview_tracks data/loops \
  | tar -x -C "$TMP"

mkdir -p "$OUT"
SOURCES="$OUT/.sources.tsv"
: > "$SOURCES"
# record DEST SOURCE: one line per staged file, for the manifest
record() { printf '%s\t%s\n' "$1" "$2" >> "$SOURCES"; }

cp -a "$TMP/backend" "$OUT/backend"
(cd "$OUT/backend" && find . -type f | sed 's|^\./||') | while read -r f; do
  record "backend/$f" "$TAG:backend/$f"
done

EXTRA="$OUT/backend/extra_mode"
mkdir -p "$EXTRA/chr7_tracks" "$EXTRA/loops" "$OUT/example_data/chr7_tracks" "$OUT/example_data/multicell"

for bw in "$TMP"/data/chr7_preview_tracks/*.bigWig; do
  name="$(basename "$bw")"
  cp "$bw" "$EXTRA/chr7_tracks/$name"; record "backend/extra_mode/chr7_tracks/$name" "$TAG:data/chr7_preview_tracks/$name"
  cp "$bw" "$OUT/example_data/chr7_tracks/$name"; record "example_data/chr7_tracks/$name" "$TAG:data/chr7_preview_tracks/$name"
done

for gz in "$TMP"/data/loops/*.bedpe.gz; do
  name="$(basename "$gz" .gz)"
  gzip -dc "$gz" > "$EXTRA/loops/$name"; record "backend/extra_mode/loops/$name" "$TAG:data/loops/$name.gz (decompressed)"
done

for f in hg19_gaps.bed hg38_gaps.bed labels.json; do
  if [[ ! -f "$EXTRA/$f" ]]; then
    [[ -f "$RELEASED/backend/extra_mode/$f" ]] || die "$f is neither at $TAG nor in $RELEASED/backend/extra_mode"
    cp "$RELEASED/backend/extra_mode/$f" "$EXTRA/$f"; record "backend/extra_mode/$f" "released:backend/extra_mode/$f"
  fi
done

for cell in GM12878 IMR90 HepG2; do
  name="${cell}_chr7_hg38.mcool"
  [[ -f "$RELEASED/example_data/chr7_tracks/$name" ]] || die "missing $RELEASED/example_data/chr7_tracks/$name"
  cp "$RELEASED/example_data/chr7_tracks/$name" "$OUT/example_data/chr7_tracks/$name"
  record "example_data/chr7_tracks/$name" "released:example_data/chr7_tracks/$name"
done
cp "$RELEASED/example_data/README.md" "$OUT/example_data/README.md"
record "example_data/README.md" "released:example_data/README.md"

for pkg in "$TMP"/data/multicell/*/; do
  name="$(basename "$pkg")"
  dest="$OUT/example_data/multicell/$name"
  mkdir -p "$dest"
  for f in "$pkg"*; do
    base="$(basename "$f")"
    if [[ "$base" == *_boundaries.bed.gz ]]; then
      gzip -dc "$f" > "$dest/${base%.gz}"; record "example_data/multicell/$name/${base%.gz}" "$TAG:data/multicell/$name/$base (decompressed)"
    else
      cp "$f" "$dest/$base"; record "example_data/multicell/$name/$base" "$TAG:data/multicell/$name/$base"
    fi
  done
done
if [[ -f "$RELEASED/example_data/multicell/index.json" ]]; then
  cp "$RELEASED/example_data/multicell/index.json" "$OUT/example_data/multicell/index.json"
  record "example_data/multicell/index.json" "released:example_data/multicell/index.json"
fi

# Checks, then the manifest. The .mcool checksums are the ones the Data Manager of this
# backend verifies; the host-path check covers what electron-builder will ship, i.e. the
# backend after the rules in scripts/package_excludes.json.
python3 -I - "$OUT" "$HERE/package_excludes.json" "$TAG" "$COMMIT" "$REPO" "$RELEASED" <<'PYCHECK'
import ast, fnmatch, hashlib, json, re, sys
from pathlib import Path
out, excl_path, tag, commit, repo, released = sys.argv[1:7]
out = Path(out)
excl = json.loads(Path(excl_path).read_text())
errors = []

dm = (out / "backend" / "data_manager.py").read_text()
cells = ast.literal_eval(re.search(r"_DEMO_CELLS = (\(.*?\n\))\n", dm, re.S).group(1))
for spec in cells:
    for kind, rel in (("mcool", f"example_data/chr7_tracks/{spec['cell']}_chr7_hg38.mcool"),
                      ("ctcf", f"backend/extra_mode/chr7_tracks/{spec['cell']}_CTCF_{spec['ctcf']}_hg38_chr7.bigWig"),
                      ("rad21", f"backend/extra_mode/chr7_tracks/{spec['cell']}_RAD21_{spec['rad21']}_hg38_chr7.bigWig")):
        md5 = hashlib.md5((out / rel).read_bytes()).hexdigest()
        if md5 != spec[f"{kind}_md5"]:
            errors.append(f"md5 of {rel} is {md5}, data_manager expects {spec[kind + '_md5']}")

for need in ("GM12878_25kb", "IMR90_25kb", "HepG2_25kb", "GM12878_10kb", "IMR90_10kb", "HepG2_10kb"):
    d = out / "example_data" / "multicell" / need
    beds = sorted(p.name for p in d.glob("*_boundaries.bed"))
    if not (d / "annotation.tsv.gz").is_file() and not (d / "annotation.tsv").is_file():
        errors.append(f"{need}: no annotation table")
    for caller in ("TopDom", "SpectralTAD", "OnTAD", "MSTD", "arrowhead", "DI"):
        if f"{caller}_boundaries.bed" not in beds:
            errors.append(f"{need}: {caller}_boundaries.bed missing")

def shipped(rel):
    parts = rel.split("/")
    if any(p in excl["dir_names"] for p in parts[:-1]) or parts[-1] in excl["file_names"]:
        return False
    if any(fnmatch.fnmatchcase(parts[-1], pat) for pat in excl["file_patterns"]):
        return False
    return rel not in ("sql_db/tad_tokens.db",) and not (rel.startswith("extra_mode/") and rel.count("/") == 1 and rel.endswith(".bigWig"))

host = re.compile(rb"/root/|/home/[A-Za-z0-9_.-]+/|miniforge|micromamba")
backend = out / "backend"
n_ship = 0
for p in sorted(backend.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(backend).as_posix()
    if not shipped(rel):
        continue
    n_ship += 1
    if p.suffix in (".py", ".md", ".txt", ".json", ".jsonl", ".toml", ".cfg", ".tsv", ".bed", ".yml", ".yaml", ".sh"):
        m = host.search(p.read_bytes())
        if m:
            errors.append(f"host path in backend/{rel}: {m.group(0).decode(errors='replace')}")
    if fnmatch.fnmatchcase(p.name, "*.bak*") or ".before_" in p.name:
        errors.append(f"backup file would ship: backend/{rel}")

if errors:
    print("[stage] ERROR:\n  " + "\n  ".join(errors), file=sys.stderr)
    sys.exit(1)

sources = dict(line.rstrip("\n").split("\t", 1) for line in (out / ".sources.tsv").read_text().splitlines())
rows = ["path\tsize\tsha256\tsource"]
for rel in sorted(sources):
    data = (out / rel).read_bytes()
    rows.append(f"{rel}\t{len(data)}\t{hashlib.sha256(data).hexdigest()}\t{sources[rel]}")
(out / "STAGE_MANIFEST.tsv").write_text("\n".join(rows) + "\n")
(out / ".sources.tsv").unlink()
(out / "STAGE_INFO.txt").write_text(
    f"backend tag: {tag}\nbackend commit: {commit}\nrepository: {repo}\n"
    f"released resources: {released}\nfiles staged: {len(sources)}\n"
    f"backend files shipped after package_excludes.json: {n_ship}\n")
print(f"[stage] {len(sources)} files staged; {n_ship} backend files pass package_excludes.json; "
      "chr7 md5 match data_manager; no host paths, no backups")
PYCHECK
echo "[stage] done: $OUT"
echo "[stage]   CREDITAD_PACKAGE_BACKEND=$OUT/backend"
echo "[stage]   CREDITAD_PACKAGE_EXAMPLE_DATA=$OUT/example_data"

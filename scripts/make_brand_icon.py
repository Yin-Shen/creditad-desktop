#!/usr/bin/env python3
"""Generate the CrediTAD application icon.

The mark is the tool's own subject: four boundary ticks of decreasing height on a
coordinate axis, reading left to right the way the D5→D1 evidence ramp does. It
replaces the generic DNA-helix-on-a-gradient icon, which said nothing about what
this application does and matched no other surface in the product.

Drawn directly at each raster size rather than downscaled from one master, so the
1 px axis rule and the tick stems stay crisp at 16 px.

    python3 scripts/make_brand_icon.py          # writes public/CrediTAD.{ico,svg,png}

Sizes follow what electron-builder and Windows shell ask for; the .ico carries all
of them in one file.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"

PLATE = (29, 63, 143, 255)      # --brand  #1D3F8F
MARK = (255, 255, 255, 255)
AXIS = (255, 255, 255, 140)

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
PNG_SIZES = [256, 512]

# Tick geometry as fractions of the plate, so every size is the same drawing.
# (x_centre, height). Heights and spacing are deliberately IRREGULAR: evenly
# descending bars read as a bar chart of a falling quantity, which is both wrong
# and unflattering. Boundaries do not arrive in order of strength.
TICKS = [
    (0.190, 0.40),
    (0.320, 0.60),
    (0.450, 0.26),
    (0.580, 0.52),
    (0.710, 0.34),
    (0.840, 0.46),
]
AXIS_Y = 0.735
AXIS_X0, AXIS_X1 = 0.115, 0.885
TICK_W = 0.058
# Ticks cross the axis instead of standing on it — that is what a boundary tick
# track looks like, and it is what separates the mark from a bar chart.
TICK_BELOW = 0.075
PAD = 0.0


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = max(2, round(size * 0.20))
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=PLATE)

    axis_y = round(size * AXIS_Y)
    axis_h = max(1, round(size * 0.028))
    d.rectangle(
        [round(size * AXIS_X0), axis_y, round(size * AXIS_X1) - 1, axis_y + axis_h - 1],
        fill=AXIS,
    )

    tick_w = max(1, round(size * TICK_W))
    for cx, h in TICKS:
        x0 = round(size * cx - tick_w / 2)
        y1 = axis_y + max(1, round(size * TICK_BELOW))
        y0 = axis_y - max(2, round(size * h))
        d.rectangle([x0, y0, x0 + tick_w - 1, y1], fill=MARK)

    return img


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="CrediTAD">
  <title>CrediTAD</title>
  <rect width="256" height="256" rx="51" fill="#1D3F8F"/>
  <rect x="38" y="198" width="180" height="7" rx="3.5" fill="#FFFFFF" opacity="0.55"/>
  <g fill="#FFFFFF">
    <rect x="43"  y="80"  width="18" height="113" rx="3"/>
    <rect x="79"  y="24"  width="18" height="169" rx="3"/>
    <rect x="119" y="121" width="18" height="72"  rx="3"/>
    <rect x="155" y="47"  width="18" height="146" rx="3"/>
    <rect x="193" y="96"  width="18" height="97"  rx="3"/>
  </g>
</svg>
"""


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    master = render(512)
    for n in PNG_SIZES:
        render(n).save(PUBLIC / f"CrediTAD-{n}.png")

    frames = [render(n) for n in ICO_SIZES]
    # Pillow writes every appended image as its own directory entry.
    frames[-1].save(
        PUBLIC / "CrediTAD.ico",
        format="ICO",
        sizes=[(n, n) for n in ICO_SIZES],
        append_images=frames[:-1],
    )
    # The legacy name is still the fallback in electron/main.ts and the builder
    # config, so it must not keep serving the old artwork.
    frames[-1].save(
        PUBLIC / "TAD-TAG.ico",
        format="ICO",
        sizes=[(n, n) for n in ICO_SIZES],
        append_images=frames[:-1],
    )

    (PUBLIC / "CrediTAD.svg").write_text(SVG)
    master.save(PUBLIC / "CrediTAD-master.png")

    print("wrote:", ", ".join(sorted(p.name for p in PUBLIC.glob("CrediTAD*"))), "+ TAD-TAG.ico")


if __name__ == "__main__":
    main()

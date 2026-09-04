"""Render media/icon.png (the Marketplace / listing icon) from a description, so it can be
regenerated at any size. Stdlib + Pillow (dev-time only; the PNG is committed).

    python scripts/make-icon.py            # writes media/icon.png at 256x256

Design: a rounded dark teal square with a soft radial glow, and the pulse line from
media/icon.svg drawn thick in white with a lit "running" dot at its peak — the same mark that
sits in the Activity Bar and the dashboard header, so the listing and the editor match.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / "media" / "icon.png"
S = 256          # output size
SS = 4           # supersample for smooth edges
W = S * SS


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def main() -> None:
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    # Background: vertical gradient inside a rounded square.
    top, bottom = (24, 44, 52), (14, 86, 80)
    grad = Image.new("RGBA", (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        gd.line([(0, y), (W, y)], fill=lerp(top, bottom, y / W) + (255,))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    # Soft glow behind the peak of the pulse.
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    cx, cy, r = int(W * 0.56), int(W * 0.30), int(W * 0.26)
    gdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(95, 211, 190, 110))
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.09))
    img.alpha_composite(Image.composite(glow, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask))

    # The pulse line (same points as media/icon.svg, scaled into the square with margins).
    pts = [(2, 12), (6, 12), (9, 5), (13, 19), (16, 12), (22, 12)]
    m = W * 0.14
    sx = (W - 2 * m) / 20.0
    sy = (W - 2 * m) / 14.0
    line = [(m + (x - 2) * sx, m + (y - 5) * sy) for x, y in pts]
    d = ImageDraw.Draw(img)
    width = int(W * 0.075)
    # shadow pass for depth, then the white line
    shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.line([(x + W * 0.012, y + W * 0.018) for x, y in line], fill=(0, 0, 0, 120), width=width, joint="curve")
    for x, y in line:
        sd.ellipse([x - width / 2 + W * 0.012, y - width / 2 + W * 0.018, x + width / 2 + W * 0.012, y + width / 2 + W * 0.018], fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(W * 0.01))
    img.alpha_composite(shadow)
    d.line(line, fill=(255, 255, 255, 255), width=width, joint="curve")
    for x, y in line:  # round caps
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=(255, 255, 255, 255))

    # The "running" dot at the peak, in the accent teal with a white ring.
    px, py = line[2]
    rr = int(W * 0.075)
    d.ellipse([px - rr - W * 0.012, py - rr - W * 0.012, px + rr + W * 0.012, py + rr + W * 0.012], fill=(255, 255, 255, 255))
    d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=(95, 211, 190, 255))

    out = img.resize((S, S), Image.LANCZOS)
    out.save(OUT, optimize=True)
    print(f"wrote {OUT} {out.size}")


if __name__ == "__main__":
    main()

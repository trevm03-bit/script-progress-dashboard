"""Renders candidate publisher logos ("TM" monograms) as PNGs. Pillow only.

    python scripts/make-logo.py <out_dir> [size]

Three directions, each a monoline "TM" on a dark rounded square with the same teal as the
extension icon, so the profile and the extension read as one hand:

  reticle  - precision: the monogram sits inside a fine ring with four tick marks and a lit
             centre point at the M's vertex, like a measuring instrument
  spark    - analysis: the M's inner stroke is a rising sparkline that ends in a lit data point,
             on a faint baseline grid
  circuit  - computing: T and M drawn as circuit traces with solder-pad dots at every joint,
             over a whisper of graph paper
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SS = 4
TEAL = (95, 211, 190)
WHITE = (255, 255, 255)
TOP, BOTTOM = (30, 52, 62), (17, 92, 86)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def base(W, radius=0.22, grid=False):
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    grad = Image.new("RGBA", (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        gd.line([(0, y), (W, y)], fill=lerp(TOP, BOTTOM, y / W) + (255,))
    if grid:
        step = W / 12
        for i in range(1, 12):
            gd.line([(i * step, 0), (i * step, W)], fill=(255, 255, 255, 14), width=max(1, W // 400))
            gd.line([(0, i * step), (W, i * step)], fill=(255, 255, 255, 14), width=max(1, W // 400))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * radius), fill=255)
    img.paste(grad, (0, 0), mask)
    return img, mask


def stroke(d, pts, width, color=WHITE):
    d.line(pts, fill=color + (255,), width=width, joint="curve")
    for x, y in pts:
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=color + (255,))


def dot(d, x, y, r, color=TEAL, ring=True):
    if ring:
        d.ellipse([x - r * 1.35, y - r * 1.35, x + r * 1.35, y + r * 1.35], fill=WHITE + (255,))
    d.ellipse([x - r, y - r, x + r, y + r], fill=color + (255,))


def glow(img, mask, cx, cy, r, W):
    g = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse([cx - r, cy - r, cx + r, cy + r], fill=TEAL + (95,))
    g = g.filter(ImageFilter.GaussianBlur(W * 0.08))
    img.alpha_composite(Image.composite(g, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask))


def letters(W, left, top, width_frac, height_frac):
    """Return stroke paths for a monoline T and M laid out side by side."""
    w = W * width_frac
    h = W * height_frac
    # T: crossbar + stem   (occupies the left 42%)
    tx0, tx1 = left, left + w * 0.42
    tcx = (tx0 + tx1) / 2
    T = [[(tx0, top), (tx1, top)], [(tcx, top), (tcx, top + h)]]
    # M: two stems and the inner V   (right 52%)
    mx0, mx1 = left + w * 0.48, left + w
    mmid = (mx0 + mx1) / 2
    M_outer = [[(mx0, top + h), (mx0, top)], [(mx1, top + h), (mx1, top)]]
    M_inner = [(mx0, top), (mmid, top + h * 0.62), (mx1, top)]
    return T, M_outer, M_inner, (mmid, top + h * 0.62)


def reticle(W):
    img, mask = base(W)
    d = ImageDraw.Draw(img)
    cx = cy = W / 2
    R = W * 0.40
    lw = max(2, int(W * 0.012))
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=WHITE + (150,), width=lw)
    tick = W * 0.05
    for ang in (0, 90, 180, 270):
        import math
        a = math.radians(ang)
        x0, y0 = cx + math.cos(a) * (R - tick), cy + math.sin(a) * (R - tick)
        x1, y1 = cx + math.cos(a) * (R + tick * 0.35), cy + math.sin(a) * (R + tick * 0.35)
        d.line([(x0, y0), (x1, y1)], fill=WHITE + (220,), width=lw * 2)
    # 12 minor ticks
    import math
    for k in range(24):
        if k % 6 == 0:
            continue
        a = math.radians(k * 15)
        x0, y0 = cx + math.cos(a) * (R - tick * 0.45), cy + math.sin(a) * (R - tick * 0.45)
        x1, y1 = cx + math.cos(a) * R, cy + math.sin(a) * R
        d.line([(x0, y0), (x1, y1)], fill=WHITE + (110,), width=lw)
    T, Mo, Mi, vertex = letters(W, W * 0.27, W * 0.34, 0.46, 0.32)
    sw = int(W * 0.052)
    glow(img, mask, vertex[0], vertex[1], W * 0.16, W)
    d = ImageDraw.Draw(img)
    for p in T + Mo:
        stroke(d, p, sw)
    stroke(d, Mi, sw)
    dot(d, vertex[0], vertex[1], W * 0.035)
    return img


def spark(W):
    img, mask = base(W, grid=True)
    d = ImageDraw.Draw(img)
    T, Mo, Mi, vertex = letters(W, W * 0.17, W * 0.30, 0.66, 0.40)
    sw = int(W * 0.06)
    # baseline like a chart axis
    d.line([(W * 0.14, W * 0.70), (W * 0.86, W * 0.70)], fill=WHITE + (70,), width=max(2, int(W * 0.008)))
    for p in T + Mo:
        stroke(d, p, sw)
    # inner M stroke as a sparkline: down to the vertex, then a jagged rise to the right stem's top
    (x0, y0), (vx, vy), (x1, y1) = Mi
    path = [(x0, y0), (vx - (vx - x0) * 0.35, y0 + (vy - y0) * 0.55), (vx, vy),
            (vx + (x1 - vx) * 0.30, vy - (vy - y1) * 0.35), (vx + (x1 - vx) * 0.50, vy - (vy - y1) * 0.20),
            (vx + (x1 - vx) * 0.72, vy - (vy - y1) * 0.70), (x1, y1)]
    glow(img, mask, x1, y1, W * 0.14, W)
    d = ImageDraw.Draw(img)
    stroke(d, path, int(sw * 0.8), TEAL)
    dot(d, x1, y1, W * 0.036)
    return img


def circuit(W):
    img, mask = base(W, grid=True)
    d = ImageDraw.Draw(img)
    T, Mo, Mi, vertex = letters(W, W * 0.17, W * 0.30, 0.66, 0.40)
    sw = int(W * 0.045)
    # traces: the M's inner V becomes right-angled circuit routing
    (x0, y0), (vx, vy), (x1, y1) = Mi
    inner = [(x0, y0), (x0 + (vx - x0) * 0.55, y0), (x0 + (vx - x0) * 0.55, vy), (vx, vy),
             (x1 - (x1 - vx) * 0.55, vy), (x1 - (x1 - vx) * 0.55, y1), (x1, y1)]
    glow(img, mask, vx, vy, W * 0.14, W)
    d = ImageDraw.Draw(img)
    for p in T + Mo:
        stroke(d, p, sw)
    stroke(d, inner, sw, TEAL)
    pad = W * 0.026
    for x, y in [T[0][0], T[0][1], T[1][1], Mo[0][0], Mo[1][0], (x0, y0), (x1, y1)]:
        dot(d, x, y, pad, color=(30, 52, 62), ring=True)
    dot(d, vx, vy, W * 0.034)
    return img


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 512
    out.mkdir(parents=True, exist_ok=True)
    W = size * SS
    for name, fn in [("reticle", reticle), ("spark", spark), ("circuit", circuit)]:
        img = fn(W).resize((size, size), Image.LANCZOS)
        img.save(out / f"logo-{name}.png", optimize=True)
        print("wrote", out / f"logo-{name}.png")


if __name__ == "__main__":
    main()

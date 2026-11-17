"""Create the bundled demo: a photo with a realistic watermark and its mask."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "samples" / "mountain.jpg"
OUT_IMAGE = ROOT / "samples" / "demo-watermarked.jpg"
OUT_MASK = ROOT / "samples" / "demo-mask.png"


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def main() -> int:
    if not SRC.exists():
        print(f"missing source image: {SRC}", file=sys.stderr)
        return 1

    image = Image.open(SRC).convert("RGB")
    w, h = image.size
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    scale = w / 1600
    title_font = font(int(34 * scale))
    sub_font = font(int(18 * scale), bold=False)
    mark_font = font(int(25 * scale))

    # Bottom-right editorial watermark, including a soft shadow.
    pad = int(58 * scale)
    x = w - pad
    y = h - int(70 * scale)
    text = "LAMA TRAVEL"
    sub = "旅行摄影 · 2026"
    bbox = draw.textbbox((0, 0), text, font=title_font)
    tw = bbox[2] - bbox[0]
    sub_bbox = draw.textbbox((0, 0), sub, font=sub_font)
    sw = sub_bbox[2] - sub_bbox[0]
    block_w = max(tw, sw)

    # Logo mark.
    r = int(17 * scale)
    cx, cy = x - block_w - int(24 * scale), y + int(8 * scale)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 205), width=max(2, int(2 * scale)))
    draw.line((cx - r * 0.55, cy, cx - r * 0.1, cy + r * 0.45), fill=(255, 255, 255, 215), width=max(2, int(2.5 * scale)))
    draw.line((cx - r * 0.1, cy + r * 0.45, cx + r * 0.65, cy - r * 0.5), fill=(255, 255, 255, 215), width=max(2, int(2.5 * scale)))

    for dx, dy in ((2, 2), (-1, 1), (1, -1)):
        draw.text((x - tw + dx, y + dy), text, font=title_font, fill=(0, 0, 0, 95))
        draw.text((x - sw + dx, y + int(45 * scale) + dy), sub, font=sub_font, fill=(0, 0, 0, 80))
    draw.text((x - tw, y), text, font=title_font, fill=(255, 255, 255, 220))
    draw.text((x - sw, y + int(45 * scale)), sub, font=sub_font, fill=(255, 255, 255, 205))

    # A second, smaller watermark near the top-left to make evaluation honest.
    wx, wy = int(52 * scale), int(48 * scale)
    draw.rounded_rectangle(
        (wx - 12, wy - 10, wx + int(330 * scale), wy + int(42 * scale)),
        radius=int(8 * scale),
        fill=(10, 16, 14, 85),
    )
    draw.text((wx, wy), "©  STOCK  /  LAMA", font=mark_font, fill=(255, 255, 255, 185))

    composed = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    composed.save(OUT_IMAGE, quality=92, subsampling=1)

    # Mask covers the watermark strokes with a small margin. The server expands it.
    mask = Image.new("L", image.size, 0)
    md = ImageDraw.Draw(mask)
    margin = int(8 * scale)
    md.rounded_rectangle(
        (cx - r - margin, cy - r - margin, x + margin, y + int(78 * scale) + margin),
        radius=int(14 * scale),
        fill=255,
    )
    md.rounded_rectangle(
        (wx - 14, wy - 12, wx + int(338 * scale), wy + int(46 * scale)),
        radius=int(10 * scale),
        fill=255,
    )
    mask.save(OUT_MASK)

    print(f"wrote {OUT_IMAGE} ({composed.width}x{composed.height})")
    print(f"wrote {OUT_MASK}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Dev probe: measure PP-OCR text detection for watermark auto-location.

Measures detection latency for a few working points, how much of the demo's
hand-drawn mask the detected quads cover, and how padding changes that.
Writes ``outputs/probe-det.png`` with the quads drawn.

Not needed at runtime:

    .\\.venv\\Scripts\\python.exe -m pip install rapidocr==3.10.0 onnxruntime==1.32.0
    .\\.venv\\Scripts\\python.exe scripts\\probe_detect.py
    .\\.venv\\Scripts\\python.exe scripts\\probe_detect.py --json
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
OUTPUTS = ROOT / "outputs"

# Working points from docs/auto-detect.md.  "min"/736 is RapidOCR's default and
# runs the detector at the source resolution; "max"/960 is the recommended one.
CONFIGS: list[tuple[str, dict]] = [
    ("default (min/736)", {}),
    ("max/736", {"Det.limit_side_len": 736, "Det.limit_type": "max"}),
    ("max/960", {"Det.limit_side_len": 960, "Det.limit_type": "max"}),
    ("max/1280", {"Det.limit_side_len": 1280, "Det.limit_type": "max"}),
    (
        "max/960 recall",
        {
            "Det.limit_side_len": 960,
            "Det.limit_type": "max",
            "Det.box_thresh": 0.3,
            "Det.thresh": 0.2,
            "Det.unclip_ratio": 1.8,
        },
    ),
]
PADS = (0.0, 0.2, 0.35, 0.5)


def read_bgr(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"cannot read {path}")
    return image


def detect(ocr, image: np.ndarray) -> np.ndarray | None:
    out = ocr(image, use_det=True, use_cls=False, use_rec=False)
    boxes = getattr(out, "boxes", None)
    if boxes is None:
        return None
    return np.asarray(boxes, dtype=np.float32).reshape(-1, 4, 2)


def median_ms(ocr, image: np.ndarray, reps: int = 5) -> tuple[float, np.ndarray | None]:
    detect(ocr, image)  # warmup, also loads the model
    times: list[float] = []
    boxes = None
    for _ in range(reps):
        started = time.perf_counter()
        boxes = detect(ocr, image)
        times.append((time.perf_counter() - started) * 1000.0)
    return statistics.median(times), boxes


def fill_quads(quads: np.ndarray | None, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    if quads is not None:
        for quad in quads:
            cv2.fillPoly(mask, [np.round(quad).astype(np.int32)], 255)
    return mask


def pad_rects(quads: np.ndarray, shape: tuple[int, int], ratio: float) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    for quad in quads:
        x0, y0 = quad.min(axis=0)
        x1, y1 = quad.max(axis=0)
        pad = ratio * (y1 - y0)
        cv2.rectangle(
            mask,
            (int(x0 - pad), int(y0 - pad)),
            (int(x1 + pad), int(y1 + pad)),
            255,
            -1,
        )
    return mask


def coverage(pred: np.ndarray, gt: np.ndarray) -> tuple[float, float]:
    total = int(np.count_nonzero(gt))
    hit = int(np.count_nonzero((pred > 0) & gt))
    marked = int(np.count_nonzero(pred > 0))
    spill = np.count_nonzero((pred > 0) & ~gt) / marked * 100 if marked else 0.0
    return hit / total * 100 if total else 0.0, spill


def main() -> int:
    try:
        from rapidocr import RapidOCR
    except ImportError:
        print("rapidocr is not installed:", file=sys.stderr)
        print(r"  .\.venv\Scripts\python.exe -m pip install rapidocr==3.10.0 onnxruntime==1.32.0", file=sys.stderr)
        return 1

    as_json = "--json" in sys.argv[1:]

    demo = read_bgr(SAMPLES / "demo-watermarked.jpg")
    clean = read_bgr(SAMPLES / "mountain.jpg")
    gt_path = SAMPLES / "demo-mask.png"
    gt = None
    if gt_path.exists():
        gt = read_bgr(gt_path).max(axis=2) > 16
    h, w = demo.shape[:2]

    report: dict = {"image": {"width": w, "height": h}, "runs": [], "padding": []}
    demo_quads: np.ndarray | None = None

    for name, params in CONFIGS:
        ocr = RapidOCR(params=params) if params else RapidOCR()
        ms, quads = median_ms(ocr, demo)
        n = 0 if quads is None else len(quads)
        row = {"config": name, "boxes": n, "median_ms": round(ms, 1)}
        if gt is not None and quads is not None:
            row["gt_coverage_pct"] = round(coverage(fill_quads(quads, gt.shape), gt)[0], 1)
        report["runs"].append(row)
        if name == "max/960":
            demo_quads = quads
        if not as_json:
            print(f"{name:22s} {n:2d} boxes  {ms:6.1f} ms  gt={row.get('gt_coverage_pct', '-')}%")

    # False positives on a clean photo without any text.
    ocr = RapidOCR(params={"Det.limit_side_len": 960, "Det.limit_type": "max"})
    ms, quads = median_ms(ocr, clean)
    n = 0 if quads is None else len(quads)
    report["clean_image"] = {"boxes": n, "median_ms": round(ms, 1)}
    if not as_json:
        print(f"{'clean photo':22s} {n:2d} boxes  {ms:6.1f} ms  (false positives if >0)")

    # How far the detected glyphs are from a usable block mask.
    if gt is not None and demo_quads is not None:
        total = int(np.count_nonzero(gt))
        for ratio in PADS:
            mask = pad_rects(demo_quads, gt.shape, ratio)
            cov = np.count_nonzero((mask > 0) & gt) / total * 100
            spill = np.count_nonzero((mask > 0) & ~gt) / max(1, np.count_nonzero(mask > 0)) * 100
            report["padding"].append(
                {"pad_ratio": ratio, "gt_coverage_pct": round(cov, 1), "spill_pct": round(spill, 1)}
            )
            if not as_json:
                print(f"pad {ratio:.2f}h -> gt {cov:5.1f}%  spill {spill:4.1f}%")

        vis = demo.copy()
        for quad in demo_quads:
            cv2.polylines(vis, [np.round(quad).astype(np.int32)], True, (0, 255, 0), 2)
        OUTPUTS.mkdir(exist_ok=True)
        cv2.imwrite(str(OUTPUTS / "probe-det.png"), vis)
        report["overlay"] = "outputs/probe-det.png"

    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

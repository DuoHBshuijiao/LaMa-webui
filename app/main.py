"""FastAPI entry point for the LaMa single-frame watermark workbench."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .engine import InferenceError, LamaEngine
from .imaging import (
    InputError,
    MAX_UPLOAD_BYTES,
    composite,
    encode_png,
    prepare,
)

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
OUTPUTS = ROOT / "outputs"
MODEL = ROOT / "models" / "big-lama.pt"
OUTPUTS.mkdir(exist_ok=True)

APP_VERSION = "1.0.0"
JOB_RE = re.compile(r"^[a-f0-9]{12}$")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
LOGGER = logging.getLogger("lama.workbench")

engine = LamaEngine(MODEL)


def cleanup_outputs(max_age_hours: int = 48) -> None:
    cutoff = time.time() - max_age_hours * 3600
    for path in OUTPUTS.glob("*.png"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                meta = path.with_suffix(".json")
                if meta.exists():
                    meta.unlink()
        except OSError:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_outputs()
    LOGGER.info("Loading LaMa from %s", MODEL)
    try:
        await asyncio.to_thread(engine.load)
        info = engine.info()
        LOGGER.info(
            "LaMa ready on %s%s in %.0f ms (warmup %.0f ms)",
            info["device"],
            f" ({info['gpu']})" if info.get("gpu") else "",
            info["load_ms"],
            info["warmup_ms"],
        )
    except Exception:
        LOGGER.exception("LaMa failed to load; the UI will show the failure state")
    yield
    LOGGER.info("LaMa workbench stopped")


app = FastAPI(
    title="LaMa 清痕 · 单帧去水印工作台",
    version=APP_VERSION,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' blob: data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "frame-ancestors 'none'"
    )
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(InputError)
async def input_error_handler(_: Request, exc: InputError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(InferenceError)
async def inference_error_handler(_: Request, exc: InferenceError):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/api/health")
async def health() -> dict[str, Any]:
    info = engine.info()
    info.update(
        {
            "status": "ready" if info["ready"] else "error",
            "version": APP_VERSION,
            "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
            "limits": {"max_side": 2048, "min_side": 512},
        }
    )
    return info


async def _read_limited(upload: UploadFile, label: str) -> bytes:
    total = 0
    chunks: list[bytes] = []
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise InputError(f"{label}超过 40MB，请先压缩后再试。")
        chunks.append(chunk)
    if total == 0:
        raise InputError(f"{label}为空。")
    return b"".join(chunks)


@app.post("/api/inpaint")
async def inpaint(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    dilate: int = Form(6),
    max_side: int = Form(1600),
    feather: float = Form(2.0),
):
    if not engine.ready:
        raise HTTPException(status_code=503, detail=engine.error or "模型尚未就绪。")

    started = time.perf_counter()
    dilate = max(0, min(32, int(dilate)))
    max_side = max(512, min(2048, int(max_side)))
    feather = max(0.0, min(8.0, float(feather)))

    image_bytes, mask_bytes = await asyncio.gather(
        _read_limited(image, "图片"),
        _read_limited(mask, "遮罩"),
    )

    try:
        prepared = await asyncio.to_thread(prepare, image_bytes, mask_bytes, max_side, dilate)
        prediction = await asyncio.to_thread(engine.inpaint, prepared.image, prepared.mask)
        result = await asyncio.to_thread(
            composite, prepared.original, prediction, prepared.original_mask, feather
        )
        png = await asyncio.to_thread(encode_png, result)
    except InputError:
        raise
    except InferenceError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.exception("Unexpected inpainting failure")
        raise HTTPException(status_code=500, detail="处理失败，请稍后重试或降低推理精度。") from exc

    total_ms = (time.perf_counter() - started) * 1000
    job_id = uuid.uuid4().hex[:12]
    result_path = OUTPUTS / f"{job_id}.png"
    result_path.write_bytes(png)

    meta = {
        "job_id": job_id,
        **prepared.meta,
        "feather": feather,
        "inference_ms": round(engine.last_ms, 1),
        "total_ms": round(total_ms, 1),
        "device": engine.info()["device"],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "bytes": len(png),
    }
    (OUTPUTS / f"{job_id}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    LOGGER.info(
        "job %s  %dx%d -> %dx%d  scale=%.2f  mask=%.1f%%  %.0f ms  %s",
        job_id,
        prepared.meta["width"],
        prepared.meta["height"],
        prepared.meta["processed_width"],
        prepared.meta["processed_height"],
        prepared.scale,
        prepared.meta["coverage"],
        total_ms,
        engine.device.type,
    )

    headers = {
        "X-Job-Id": job_id,
        "X-Width": str(prepared.meta["width"]),
        "X-Height": str(prepared.meta["height"]),
        "X-Processed-Width": str(prepared.meta["processed_width"]),
        "X-Processed-Height": str(prepared.meta["processed_height"]),
        "X-Inference-Ms": str(round(engine.last_ms)),
        "X-Total-Ms": str(round(total_ms)),
        "X-Coverage": str(prepared.meta["coverage"]),
        "X-Device": engine.info()["device"],
        "X-Result-Url": f"/api/results/{job_id}",
        "Cache-Control": "no-store",
    }
    return Response(content=png, media_type="image/png", headers=headers)


@app.get("/api/results/{job_id}")
async def get_result(job_id: str):
    if not JOB_RE.fullmatch(job_id):
        raise HTTPException(status_code=404, detail="结果不存在。")
    path = OUTPUTS / f"{job_id}.png"
    if not path.exists():
        raise HTTPException(status_code=404, detail="结果已过期或不存在。")
    return FileResponse(path, media_type="image/png", filename=f"lama-{job_id}.png")


@app.get("/api/results/{job_id}/meta")
async def get_result_meta(job_id: str):
    if not JOB_RE.fullmatch(job_id):
        raise HTTPException(status_code=404, detail="结果不存在。")
    path = OUTPUTS / f"{job_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="结果已过期或不存在。")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/samples", StaticFiles(directory=ROOT / "samples"), name="samples")


@app.get("/")
async def index():
    return FileResponse(
        STATIC / "index.html",
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/favicon.svg")
async def favicon():
    return FileResponse(STATIC / "favicon.svg", media_type="image/svg+xml")


@app.get("/healthz")
async def healthz():
    return {"ok": engine.ready}

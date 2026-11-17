"""Image decoding, mask preparation and compositing helpers."""
from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 80_000_000

MAX_UPLOAD_BYTES = 40 * 1024 * 1024
MAX_PIXELS = 60_000_000
MAX_INFER_SIDE = 2048
MAX_INFER_PIXELS = 4_400_000


class InputError(ValueError):
    """A user-facing input problem (HTTP 400)."""


@dataclass
class PreparedInput:
    original: np.ndarray
    image: np.ndarray
    mask: np.ndarray
    original_mask: np.ndarray
    scale: float
    meta: dict[str, Any]


def _open_image(data: bytes) -> Image.Image:
    if not data:
        raise InputError("图片内容为空。")
    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > MAX_PIXELS:
            raise InputError("图片像素过大（超过 6000 万像素），请先缩小后再试。")
        image.load()
    except InputError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InputError("无法识别这个图片文件，请换一张 JPG、PNG 或 WebP。") from exc
    try:
        image = ImageOps.exif_transpose(image)
    except Exception:
        pass
    return image


def decode_image(data: bytes) -> np.ndarray:
    image = _open_image(data)
    if image.width * image.height > MAX_PIXELS:
        raise InputError("图片像素过大（超过 6000 万像素），请先缩小后再试。")
    if image.width < 16 or image.height < 16:
        raise InputError("图片太小了，至少需要 16 × 16 像素。")
    return np.asarray(image.convert("RGB"), dtype=np.uint8)


def decode_mask(data: bytes, width: int, height: int) -> np.ndarray:
    image = _open_image(data).convert("RGBA")
    arr = np.asarray(image, dtype=np.uint8)
    alpha = arr[:, :, 3]
    # Browser masks are white-on-transparent; some tools export black/white RGB.
    if alpha.size and int(alpha.min()) < 250:
        mask = alpha
    else:
        rgb = arr[:, :, :3].astype(np.float32)
        mask = np.max(rgb, axis=2).astype(np.uint8)
    if mask.shape[:2] != (height, width):
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR)
    if int(mask.max(initial=0)) < 12:
        raise InputError("遮罩是空的，请先涂抹要去掉的水印区域。")
    return mask


def compute_infer_size(width: int, height: int, max_side: int) -> tuple[int, int, float]:
    max_side = max(512, min(MAX_INFER_SIDE, int(max_side or 1600)))
    scale = min(1.0, max_side / max(width, height))
    if width * height * scale * scale > MAX_INFER_PIXELS:
        scale = math.sqrt(MAX_INFER_PIXELS / (width * height))
    # Keep the original aspect ratio; LaMa pads to a multiple of 8 internally.
    proc_w = min(MAX_INFER_SIDE, max(8, int(round(width * scale))))
    proc_h = min(MAX_INFER_SIDE, max(8, int(round(height * scale))))
    actual_scale = min(proc_w / width, proc_h / height)
    return proc_w, proc_h, min(1.0, actual_scale)


def prepare(
    image_bytes: bytes,
    mask_bytes: bytes,
    max_side: int,
    dilate_px: int,
) -> PreparedInput:
    original = decode_image(image_bytes)
    height, width = original.shape[:2]
    mask = decode_mask(mask_bytes, width, height)

    proc_w, proc_h, scale = compute_infer_size(width, height, max_side)
    if (proc_w, proc_h) != (width, height):
        small_image = cv2.resize(original, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
        small_mask = cv2.resize(mask, (proc_w, proc_h), interpolation=cv2.INTER_NEAREST)
    else:
        small_image = original
        small_mask = mask

    small_mask = (small_mask > 16).astype(np.uint8)
    proc_dilate = int(round(dilate_px * scale))
    if proc_dilate > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (proc_dilate * 2 + 1, proc_dilate * 2 + 1))
        small_mask = cv2.dilate(small_mask, kernel, iterations=1)

    coverage = float(np.count_nonzero(small_mask)) / float(proc_w * proc_h)
    if coverage < 0.00002:
        raise InputError("遮罩太小了，请把水印区域涂抹得再完整一些。")
    if coverage > 0.92:
        raise InputError("遮罩覆盖了超过 92% 的画面，请缩小涂抹范围后再试。")

    original_mask = (mask > 16).astype(np.uint8)
    if dilate_px > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_px * 2 + 1, dilate_px * 2 + 1))
        original_mask = cv2.dilate(original_mask, kernel, iterations=1)

    return PreparedInput(
        original=original,
        image=small_image,
        mask=small_mask.astype(np.float32),
        original_mask=original_mask,
        scale=scale,
        meta={
            "width": width,
            "height": height,
            "processed_width": proc_w,
            "processed_height": proc_h,
            "scale": round(scale, 4),
            "coverage": round(coverage * 100, 2),
            "dilate": dilate_px,
        },
    )


def composite(
    original: np.ndarray,
    prediction: np.ndarray,
    original_mask: np.ndarray,
    feather: float = 2.0,
) -> np.ndarray:
    """Upscale the prediction and softly composite it into the full-res frame."""
    height, width = original.shape[:2]
    predicted = (np.clip(prediction, 0.0, 1.0) * 255.0).astype(np.uint8)
    if predicted.shape[:2] != (height, width):
        predicted = cv2.resize(predicted, (width, height), interpolation=cv2.INTER_LANCZOS4)

    if feather and feather > 0:
        alpha = cv2.GaussianBlur(
            original_mask.astype(np.float32),
            (0, 0),
            sigmaX=max(0.35, float(feather)),
            sigmaY=max(0.35, float(feather)),
        )
    else:
        alpha = original_mask.astype(np.float32)
    alpha = np.clip(alpha, 0.0, 1.0)[:, :, None]

    blended = predicted.astype(np.float32) * alpha + original.astype(np.float32) * (1.0 - alpha)
    return np.clip(blended + 0.5, 0, 255).astype(np.uint8)


def encode_png(image_rgb: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(image_rgb, mode="RGB").save(buffer, format="PNG", compress_level=4)
    return buffer.getvalue()


__all__ = [
    "InputError",
    "PreparedInput",
    "prepare",
    "composite",
    "encode_png",
    "decode_image",
    "decode_mask",
    "MAX_UPLOAD_BYTES",
]

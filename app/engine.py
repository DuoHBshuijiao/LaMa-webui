"""LaMa inference engine (TorchScript big-lama)."""
from __future__ import annotations

import gc
import os
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT / "models" / "big-lama.pt"


class InferenceError(RuntimeError):
    """Raised when the model cannot run for the current input."""


def _pick_device(requested: str | None = None) -> torch.device:
    requested = (requested or os.environ.get("LAMA_DEVICE", "auto")).lower()
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise InferenceError("已指定 CUDA，但当前 PyTorch 无法使用显卡。")
        return torch.device("cuda")
    if requested == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def pad_to_modulo(image: np.ndarray, mask: np.ndarray, modulo: int = 8):
    """Symmetric-pad an HWC image and HW mask so both sides divide by modulo."""
    h, w = image.shape[:2]
    out_h = (h + modulo - 1) // modulo * modulo
    out_w = (w + modulo - 1) // modulo * modulo
    pad = ((0, out_h - h), (0, out_w - w))
    image = np.pad(image, (*pad, (0, 0)), mode="symmetric")
    mask = np.pad(mask, pad, mode="symmetric")
    return image, mask, (h, w)


class LamaEngine:
    def __init__(self, model_path: str | Path | None = None):
        self.model_path = Path(model_path or os.environ.get("LAMA_MODEL_PATH", DEFAULT_MODEL))
        self.device = torch.device("cpu")
        self.model: torch.jit.ScriptModule | None = None
        self.error: str | None = None
        self.load_ms: float = 0.0
        self.warmup_ms: float = 0.0
        self.last_ms: float = 0.0
        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()

    # ------------------------------------------------------------------ load
    @property
    def ready(self) -> bool:
        return self.model is not None and self.error is None

    def load(self) -> None:
        with self._load_lock:
            if self.model is not None:
                return
            if not self.model_path.exists():
                self.error = f"模型文件不存在：{self.model_path}"
                return
            started = time.perf_counter()
            try:
                self.device = _pick_device()
                if self.device.type == "cpu":
                    # Leave one core for the web server and OS.
                    torch.set_num_threads(max(2, min(12, (os.cpu_count() or 4) - 2)))
                model = torch.jit.load(str(self.model_path), map_location="cpu")
                model.eval()
                model.to(self.device)
                self.model = model
                self.load_ms = (time.perf_counter() - started) * 1000
                self._warmup()
                self.error = None
            except Exception as exc:  # pragma: no cover - surfaced in health
                self.error = f"模型加载失败：{exc}"
                self.model = None
                raise

    def _warmup(self) -> None:
        assert self.model is not None
        size = 320
        image = torch.zeros((1, 3, size, size), dtype=torch.float32, device=self.device)
        mask = torch.zeros((1, 1, size, size), dtype=torch.float32, device=self.device)
        started = time.perf_counter()
        with torch.inference_mode():
            self.model(image, mask)
        self.warmup_ms = (time.perf_counter() - started) * 1000

    # --------------------------------------------------------------- metadata
    def info(self) -> dict[str, Any]:
        gpu_name = None
        if self.device.type == "cuda" and torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
        return {
            "ready": self.ready,
            "model": "LaMa · big-lama",
            "model_file": self.model_path.name,
            "model_size_mb": round(self.model_path.stat().st_size / 1e6, 1) if self.model_path.exists() else None,
            "device": self.device.type,
            "device_label": "GPU" if self.device.type == "cuda" else "CPU",
            "gpu": gpu_name,
            "torch": torch.__version__,
            "threads": torch.get_num_threads(),
            "load_ms": round(self.load_ms, 1),
            "warmup_ms": round(self.warmup_ms, 1),
            "last_ms": round(self.last_ms, 1),
            "error": self.error,
        }

    # --------------------------------------------------------------- inference
    def inpaint(self, image_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """Run LaMa on an RGB uint8/float image and a binary-ish HW mask.

        The inputs are padded to a multiple of 8 and cropped back afterwards.
        """
        if self.model is None:
            raise InferenceError(self.error or "模型尚未加载。")
        if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
            raise InferenceError("输入图像必须是 RGB 三通道。")
        if mask.ndim != 2 or mask.shape[:2] != image_rgb.shape[:2]:
            raise InferenceError("遮罩尺寸与图像尺寸不一致。")

        with self._infer_lock:
            started = time.perf_counter()
            image = image_rgb.astype(np.float32, copy=False)
            if image.max(initial=0) > 1.5:
                image = image / 255.0
            mask = mask.astype(np.float32, copy=False)
            if mask.max(initial=0) > 1.5:
                mask = mask / 255.0
            mask = (mask > 0.1).astype(np.float32)

            padded_image, padded_mask, (height, width) = pad_to_modulo(image, mask)
            image_t = torch.from_numpy(padded_image.transpose(2, 0, 1)).unsqueeze(0)
            mask_t = torch.from_numpy(padded_mask).unsqueeze(0).unsqueeze(0)
            image_t = image_t.to(self.device)
            mask_t = mask_t.to(self.device)

            try:
                with torch.inference_mode():
                    output = self.model(image_t, mask_t)
                result = output[0, :, :height, :width].permute(1, 2, 0)
                result = result.detach().float().cpu().numpy()
            except torch.cuda.OutOfMemoryError as exc:
                gc.collect()
                torch.cuda.empty_cache()
                raise InferenceError("显存不足，请把推理精度降到 1280px 后重试。") from exc
            except RuntimeError as exc:
                if "out of memory" in str(exc).lower():
                    gc.collect()
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    raise InferenceError("内存不足，请把推理精度降到 1280px 后重试。") from exc
                raise InferenceError(f"推理失败：{exc}") from exc
            finally:
                del image_t, mask_t
                if self.device.type == "cuda":
                    torch.cuda.empty_cache()

            self.last_ms = (time.perf_counter() - started) * 1000
            return np.clip(result, 0.0, 1.0)


__all__ = ["LamaEngine", "InferenceError", "DEFAULT_MODEL"]

"""Download the TorchScript big-lama weights used by the workbench."""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = (
    "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/"
    "v0.1.0/big-lama.pt"
)
DEFAULT_SHA256 = "7ba7aa7ac37a4d41fdbbeba3a2af7ead18058552997e3a3cd1a3b2210c9e6b4c"
EXPECTED_BYTES = 205_803_670


def human(bytes_: float) -> str:
    return f"{bytes_ / (1024 * 1024):.1f} MB"


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    if partial.exists():
        partial.unlink()

    print(f"Downloading LaMa weights\n  from: {url}\n  to:   {target}")
    request = urllib.request.Request(url, headers={"User-Agent": "lama-workbench/1.0"})
    started = time.time()
    with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as sink:
        total = int(response.headers.get("Content-Length") or 0)
        received = 0
        last_report = 0.0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            sink.write(chunk)
            received += len(chunk)
            now = time.time()
            if now - last_report > 0.8:
                last_report = now
                percent = f"{received / total * 100:5.1f}%" if total else f"{human(received)}"
                speed = received / max(0.001, now - started) / (1024 * 1024)
                print(f"\r  {percent}  {human(received)}  {speed:.1f} MB/s", end="", flush=True)
    print()
    if total and received != total:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"下载不完整：收到 {received} / {total} 字节。")

    digest = hashlib.sha256()
    with partial.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    actual = digest.hexdigest()
    if actual != DEFAULT_SHA256:
        partial.unlink(missing_ok=True)
        raise RuntimeError(
            "模型校验失败，文件已删除。\n"
            f"  期望 SHA256: {DEFAULT_SHA256}\n"
            f"  实际 SHA256: {actual}"
        )
    partial.replace(target)
    print(f"Verified SHA256 {actual[:16]}…  ({human(target.stat().st_size)})")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download big-lama.pt")
    parser.add_argument("--url", default=os.environ.get("LAMA_MODEL_URL", DEFAULT_URL))
    parser.add_argument("--output", default=str(ROOT / "models" / "big-lama.pt"))
    parser.add_argument("--force", action="store_true", help="replace an existing model")
    args = parser.parse_args()

    target = Path(args.output).resolve()
    if target.exists() and not args.force:
        size = target.stat().st_size
        digest = hashlib.sha256()
        with target.open("rb") as handle:
            for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() == DEFAULT_SHA256:
            print(f"Model already present and verified: {target} ({human(size)})")
            return 0
        print(f"Existing model does not match the expected hash: {target}")
        print("Re-run with --force to replace it.")
        return 1
    try:
        download(args.url, target)
    except KeyboardInterrupt:
        print("\nCancelled.")
        return 130
    except Exception as exc:
        print(f"\nDownload failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

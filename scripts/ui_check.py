"""Smoke-test the workbench in a real browser and capture screenshots."""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / ".cache" / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)
URL = "http://127.0.0.1:7860"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def run(viewport: dict, suffix: str, wait_result: bool = True) -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=EDGE, headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport=viewport, device_scale_factor=1)
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(600)
        page.screenshot(path=str(SHOTS / f"01-empty-{suffix}.png"), full_page=False)

        page.locator("#loadDemo").click()
        page.wait_for_selector("#artboardWrap:not([hidden])", timeout=15000)
        page.wait_for_timeout(900)
        coverage = page.locator("#maskLabel").inner_text()
        dims = page.locator("#dimsLabel").inner_text()
        page.screenshot(path=str(SHOTS / f"02-editor-{suffix}.png"), full_page=False)

        if wait_result:
            page.locator("#runBtn").click()
            page.wait_for_selector("#resultPanel:not([hidden])", timeout=45000)
            page.wait_for_timeout(700)
            page.screenshot(path=str(SHOTS / f"03-result-{suffix}.png"), full_page=False)
            result_meta = page.locator("#resultMeta").inner_text()
            print(f"[{suffix}] coverage={coverage!r} dims={dims!r} result={result_meta!r}")
            page.locator('[data-view="result"]').click()
            page.wait_for_timeout(300)
            page.screenshot(path=str(SHOTS / f"04-result-only-{suffix}.png"), full_page=False)
            page.locator("#editMaskBtn").click()
            page.wait_for_timeout(300)
            page.screenshot(path=str(SHOTS / f"05-edit-again-{suffix}.png"), full_page=False)
        else:
            print(f"[{suffix}] coverage={coverage!r} dims={dims!r}")

        metrics = page.evaluate(
            """() => ({
                bodyW: document.body.scrollWidth, innerW: window.innerWidth,
                bodyH: document.body.scrollHeight, innerH: window.innerHeight,
                stage: (() => { const r = document.querySelector('#stage').getBoundingClientRect();
                    return {w: Math.round(r.width), h: Math.round(r.height)}; })(),
                engine: document.querySelector('#engineLabel').textContent,
                quality: document.querySelector('#qualityEstimate').textContent,
            })"""
        )
        print(f"[{suffix}] metrics={metrics}")
        if console_errors:
            print(f"[{suffix}] console errors: {console_errors}")
        if page_errors:
            print(f"[{suffix}] page errors: {page_errors}", file=sys.stderr)
        browser.close()


if __name__ == "__main__":
    run({"width": 1600, "height": 1000}, "desktop")
    run({"width": 390, "height": 844}, "mobile", wait_result=False)

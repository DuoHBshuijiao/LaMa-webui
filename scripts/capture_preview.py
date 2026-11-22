"""Capture final preview screenshots from the running workbench."""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
OUT.mkdir(exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
URL = "http://127.0.0.1:7860"


def main() -> None:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=EDGE, headless=True, args=["--no-sandbox"])

        page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on("console", lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" else None)
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / "preview-empty.png"))

        page.locator("#loadDemo").click()
        page.wait_for_selector("#artboardWrap:not([hidden])", timeout=15000)
        page.wait_for_timeout(5200)
        page.screenshot(path=str(OUT / "preview-edit.png"))

        page.locator("#runBtn").click()
        page.wait_for_selector("#resultPanel:not([hidden])", timeout=45000)
        page.wait_for_timeout(5200)
        page.screenshot(path=str(OUT / "preview-result.png"))
        print("desktop result:", page.locator("#resultMeta").inner_text())

        # Mid-size layout: make sure all view controls remain visible.
        page.set_viewport_size({"width": 1024, "height": 768})
        page.wait_for_timeout(500)
        controls = {
            "viewSwitch": page.locator("#viewSwitch").is_visible(),
            "edit": page.locator("#editMaskBtn").is_visible(),
            "imageInfo": page.locator("#fileInfo").is_visible(),
        }
        print("1024 controls:", controls)
        page.close()

        mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        mobile.on("pageerror", lambda exc: errors.append(f"mobile pageerror: {exc}"))
        mobile.goto(URL, wait_until="networkidle")
        mobile.locator("#loadDemo").click()
        mobile.wait_for_selector("#artboardWrap:not([hidden])", timeout=15000)
        mobile.wait_for_timeout(5200)
        mobile.screenshot(path=str(OUT / "preview-mobile.png"))
        print("mobile body:", mobile.evaluate("({w:document.body.scrollWidth, h:document.body.scrollHeight})"))
        mobile.close()
        browser.close()

    if errors:
        raise SystemExit("Browser errors:\n" + "\n".join(errors))
    print("screenshots written to", OUT)


if __name__ == "__main__":
    main()

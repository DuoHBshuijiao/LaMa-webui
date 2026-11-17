/* LAMA 清痕 — single-frame inpainting workbench */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const MAX_BYTES = 40 * 1024 * 1024;
  const MAX_PIXELS = 60_000_000;

  const el = {
    enginePill: $("#enginePill"),
    engineLabel: $("#engineLabel"),
    topFileName: $("#topFileName"),
    stageTitle: $("#stageTitle"),
    stageFileMeta: $("#stageFileMeta"),
    stage: $("#stage"),
    emptyState: $("#emptyState"),
    dropzone: $("#dropzone"),
    fileInput: $("#fileInput"),
    loadDemo: $("#loadDemo"),
    demoFrame: $("#demoFrame"),
    demoPhoto: $("#demoPhoto"),
    artboardWrap: $("#artboardWrap"),
    artboard: $("#artboard"),
    baseImage: $("#baseImage"),
    resultLayer: $("#resultLayer"),
    resultImage: $("#resultImage"),
    beforeLayer: $("#beforeLayer"),
    beforeImage: $("#beforeImage"),
    maskCanvas: $("#maskCanvas"),
    compareLine: $("#compareLine"),
    compareHandle: $("#compareHandle"),
    compareTags: $("#compareTags"),
    compareHint: $("#compareHint"),
    brushCursor: $("#brushCursor"),
    brushPreview: $("#brushPreview"),
    brushPreviewRing: $("#brushPreviewRing"),
    brushPreviewLabel: $("#brushPreviewLabel"),
    dragOverlay: $("#dragOverlay"),
    processing: $("#processing"),
    procStage: $("#procStage"),
    procDetail: $("#procDetail"),
    procElapsed: $("#procElapsed"),
    canvasToolbar: $("#canvasToolbar"),
    stageTip: $("#stageTip"),
    zoomDisplay: $("#zoomDisplay"),
    viewSwitch: $("#viewSwitch"),
    backToResultBtn: $("#backToResultBtn"),
    editMaskBtn: $("#editMaskBtn"),
    replaceBtn: $("#replaceBtn"),
    uploadTool: $("#uploadTool"),
    undoBtn: $("#undoBtn"),
    redoBtn: $("#redoBtn"),
    clearBtn: $("#clearBtn"),
    railBrushValue: $("#railBrushValue"),
    brushSize: $("#brushSize"),
    brushValue: $("#brushValue"),
    dilate: $("#dilate"),
    dilateValue: $("#dilateValue"),
    feather: $("#feather"),
    featherValue: $("#featherValue"),
    qualityState: $("#qualityState"),
    qualityEstimate: $("#qualityEstimate"),
    maskState: $("#maskState"),
    maskLabel: $("#maskLabel"),
    dimsLabel: $("#dimsLabel"),
    footerDevice: $("#footerDevice"),
    modelDevice: $("#modelDevice"),
    runPanel: $("#runPanel"),
    resultPanel: $("#resultPanel"),
    runBtn: $("#runBtn"),
    actionHint: $("#actionHint"),
    resultMeta: $("#resultMeta"),
    resultDevice: $("#resultDevice"),
    downloadBtn: $("#downloadBtn"),
    copyBtn: $("#copyBtn"),
    adjustMaskBtn: $("#adjustMaskBtn"),
    rerunBtn: $("#rerunBtn"),
    helpBtn: $("#helpBtn"),
    helpDialog: $("#helpDialog"),
    closeHelpBtn: $("#closeHelpBtn"),
    toastStack: $("#toastStack"),
  };

  const maskCtx = el.maskCanvas.getContext("2d", { willReadFrequently: true });
  const state = {
    image: null,
    file: null,
    fileName: "",
    fileType: "",
    originalUrl: null,
    naturalW: 0,
    naturalH: 0,
    fitW: 0,
    fitH: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    tool: "brush",
    brush: 56,
    dilate: 6,
    feather: 2,
    maxSide: 1600,
    actions: [],
    redo: [],
    coverage: 0,
    mode: "empty",
    gesture: null,
    compareSplit: 50,
    demoSplit: 54,
    demoGesture: null,
    result: null,
    resultMeta: null,
    busy: false,
    ready: false,
    health: null,
    spaceDown: false,
    procTimer: null,
    procStarted: 0,
    lastPointer: null,
    lastImagePoint: null,
    brushPreviewTimer: null,
    coverageTimer: null,
  };

  // ------------------------------------------------------------- utilities
  function toast(message, type = "info", duration = 3400) {
    const node = document.createElement("div");
    node.className = `toast is-${type}`;
    const dot = document.createElement("span");
    dot.className = "toast-dot";
    const text = document.createElement("span");
    text.textContent = message;
    node.append(dot, text);
    el.toastStack.prepend(node);
    while (el.toastStack.children.length > 3) el.toastStack.lastElementChild.remove();
    window.setTimeout(() => {
      node.classList.add("is-out");
      window.setTimeout(() => node.remove(), 190);
    }, duration);
  }

  function dismissToasts(type = "info") {
    for (const node of Array.from(el.toastStack.children)) {
      if (node.classList?.contains(`is-${type}`)) node.remove();
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function shortGpu(name) {
    if (!name) return "";
    return name.replace(/^NVIDIA\s+/i, "").replace(/\s+Laptop GPU$/i, "").trim();
  }

  function baseName(name) {
    return (name || "lama").replace(/\.[^.]+$/, "");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = src;
    });
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith("image/")) return true;
    return /\.(jpe?g|png|webp|bmp|avif)$/i.test(file.name || "");
  }

  // ------------------------------------------------------------- demo slider
  function setDemoSplit(value) {
    state.demoSplit = clamp(Number.isFinite(Number(value)) ? Number(value) : 54, 0, 100);
    if (el.demoFrame) el.demoFrame.style.setProperty("--demo-split", `${state.demoSplit.toFixed(2)}%`);
    if (el.demoPhoto) {
      const rounded = Math.round(state.demoSplit);
      el.demoPhoto.setAttribute("aria-valuenow", String(rounded));
      el.demoPhoto.setAttribute("aria-valuetext", `分割线 ${rounded}%`);
    }
  }

  function splitFromDemoPointer(event) {
    const rect = el.demoPhoto.getBoundingClientRect();
    if (!rect.width) return state.demoSplit;
    return clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
  }

  function beginDemoDrag(event) {
    if (event.button !== undefined && event.button > 0) return;
    event.preventDefault();
    state.demoGesture = { pointerId: event.pointerId };
    el.demoPhoto.classList.add("is-dragging");
    try { el.demoPhoto.setPointerCapture(event.pointerId); } catch { /* noop */ }
    setDemoSplit(splitFromDemoPointer(event));
  }

  function moveDemoDrag(event) {
    if (!state.demoGesture || state.demoGesture.pointerId !== event.pointerId) return;
    setDemoSplit(splitFromDemoPointer(event));
  }

  function endDemoDrag(event) {
    if (!state.demoGesture) return;
    if (event && state.demoGesture.pointerId !== event.pointerId) return;
    state.demoGesture = null;
    el.demoPhoto.classList.remove("is-dragging");
    if (event) {
      try { el.demoPhoto.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    }
  }

  // ----------------------------------------------------------------- health
  async function loadHealth() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json();
      state.health = health;
      state.ready = Boolean(health.ready);
      el.enginePill.classList.remove("is-loading", "is-ready", "is-error");
      if (state.ready) {
        el.enginePill.classList.add("is-ready");
        const device = health.device === "cuda" ? "CUDA" : "CPU";
        el.engineLabel.textContent = `${device} · 就绪`;
        el.enginePill.title = `${health.model} · ${device}${health.gpu ? ` · ${health.gpu}` : ""} · 本地推理`;
        el.modelDevice.textContent = health.device === "cuda" ? "CUDA" : "CPU";
        const threads = health.threads ? ` · ${health.threads} 线程` : "";
        el.footerDevice.textContent = health.device === "cuda"
          ? `CUDA${health.gpu ? ` · ${shortGpu(health.gpu)}` : ""}`
          : `CPU${threads}`;
      } else {
        el.enginePill.classList.add("is-error");
        el.engineLabel.textContent = "模型未就绪";
        el.enginePill.title = health.error || "模型加载失败";
        el.footerDevice.textContent = "模型未就绪";
        if (health.error) toast(health.error, "error", 7000);
      }
      updateEstimate();
      refreshControls();
    } catch (error) {
      state.ready = false;
      el.enginePill.classList.remove("is-loading", "is-ready");
      el.enginePill.classList.add("is-error");
      el.engineLabel.textContent = "服务连接失败";
      el.footerDevice.textContent = "离线";
      toast("无法连接本地推理服务，请确认服务已启动。", "error", 6000);
      refreshControls();
    }
  }

  // ------------------------------------------------------------ image setup
  async function loadFile(file, options = {}) {
    if (state.busy) return;
    if (!file || !isImageFile(file)) {
      toast("请选择 JPG、PNG 或 WEBP 图片。", "error");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast("图片超过 40MB，请先压缩后再试。", "error");
      return;
    }
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || "")) {
      toast("浏览器无法直接读取 HEIC，请先导出为 JPG 或 PNG。", "error", 5200);
      return;
    }

    let url = "";
    try {
      url = URL.createObjectURL(file);
      const image = await loadImage(url);
      if (image.naturalWidth < 16 || image.naturalHeight < 16) throw new Error("图片尺寸太小");
      if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("图片超过 6000 万像素");

      invalidateResult({ silent: true });
      if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);

      state.image = image;
      state.file = file;
      state.fileName = file.name || "lama-image";
      state.fileType = file.type || "image/jpeg";
      state.originalUrl = url;
      state.naturalW = image.naturalWidth;
      state.naturalH = image.naturalHeight;
      state.actions = [];
      state.redo = [];
      state.coverage = 0;
      state.lastImagePoint = null;
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      hideBrushPreview();
      el.maskLabel.textContent = "遮罩 0.0%";
      el.maskState.textContent = "未标记";

      el.baseImage.src = url;
      el.beforeImage.src = url;
      el.baseImage.alt = state.fileName;
      await Promise.allSettled([el.baseImage.decode?.(), el.beforeImage.decode?.()]);

      el.maskCanvas.width = state.naturalW;
      el.maskCanvas.height = state.naturalH;
      maskCtx.clearRect(0, 0, state.naturalW, state.naturalH);

      el.emptyState.hidden = true;
      el.artboardWrap.hidden = false;
      el.canvasToolbar.hidden = false;
      el.replaceBtn.hidden = false;
      el.topFileName.textContent = state.fileName;
      el.stageTitle.textContent = baseName(state.fileName);
      el.stageFileMeta.textContent = `${state.naturalW} × ${state.naturalH}`;
      el.dimsLabel.textContent = `${state.naturalW} × ${state.naturalH} px`;
      document.title = `${baseName(state.fileName)} · LAMA 清痕`;

      setMode("edit");
      if (options.maskBlob) {
        try {
          await addMaskRaster(options.maskBlob);
        } catch {
          toast("示例遮罩载入失败，请手动涂抹。", "error");
        }
      }
      updateCoverage();
      refreshControls();
      updateEstimate();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitArtboard(true));
      });
      if (options.demo) {
        toast("示例已载入，遮罩也准备好了。可以直接开始去水印。", "info", 4600);
      } else {
        toast("图片已载入，涂抹水印区域后开始修复。", "info");
      }
    } catch (error) {
      if (url && url !== state.originalUrl) URL.revokeObjectURL(url);
      toast(error.message === "图片尺寸太小"
        ? "图片太小，至少需要 16 × 16 像素。"
        : error.message === "图片超过 6000 万像素"
          ? "图片超过 6000 万像素，请先缩小后再试。"
          : "这张图片无法读取，请换一张 JPG 或 PNG。", "error", 5000);
    }
  }

  function resetMaskCanvas() {
    el.maskCanvas.width = state.naturalW;
    el.maskCanvas.height = state.naturalH;
    maskCtx.clearRect(0, 0, state.naturalW, state.naturalH);
  }

  async function addMaskRaster(blob) {
    const maskUrl = URL.createObjectURL(blob);
    try {
      const image = await loadImage(maskUrl);
      const canvas = document.createElement("canvas");
      canvas.width = state.naturalW;
      canvas.height = state.naturalH;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, state.naturalW, state.naturalH);
      const pixels = ctx.getImageData(0, 0, state.naturalW, state.naturalH);
      const data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        // Browser masks use white-on-transparent; the demo mask is a
        // grayscale PNG with an opaque black background.  Trust the alpha
        // channel only when the image actually contains transparency.
        const alpha = data[i + 3] < 250
          ? data[i + 3]
          : Math.max(data[i], data[i + 1], data[i + 2]);
        data[i] = 255;
        data[i + 1] = 101;
        data[i + 2] = 76;
        data[i + 3] = alpha;
      }
      ctx.putImageData(pixels, 0, 0);
      state.actions = [{ type: "raster", canvas, locked: true }];
      state.redo = [];
      redrawMask();
      updateCoverage();
      refreshControls();
    } finally {
      URL.revokeObjectURL(maskUrl);
    }
  }

  // ---------------------------------------------------------------- artboard
  function fitArtboard(reset = true) {
    if (!state.image) return;
    const oldDisplay = state.zoom * state.fitW / Math.max(1, state.naturalW);
    const rect = el.stage.getBoundingClientRect();
    const narrow = window.matchMedia("(max-width: 620px)").matches;
    const padX = narrow ? 24 : 78;
    const padY = narrow ? 74 : 116;
    const availW = Math.max(200, rect.width - padX);
    const availH = Math.max(180, rect.height - padY);
    const scale = Math.min(availW / state.naturalW, availH / state.naturalH, 1);
    state.fitW = Math.max(80, Math.round(state.naturalW * scale));
    state.fitH = Math.max(60, Math.round(state.naturalH * scale));
    el.artboard.style.width = `${state.fitW}px`;
    el.artboard.style.height = `${state.fitH}px`;
    if (reset) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
    } else {
      const newDisplay = state.fitW / Math.max(1, state.naturalW);
      state.zoom = clamp(oldDisplay / Math.max(0.0001, newDisplay), 0.35, 8);
      clampPan();
    }
    applyTransform();
  }

  function applyTransform() {
    el.artboard.style.transform = `translate(calc(-50% + ${state.panX}px), calc(-50% + ${state.panY}px)) scale(${state.zoom})`;
    updateZoomLabel();
    updateCompareOverlay();
    if (!el.brushPreview.hidden) placeBrushPreview(state.brush);
  }

  function clampPan() {
    const rect = el.stage.getBoundingClientRect();
    const scaledW = state.fitW * state.zoom;
    const scaledH = state.fitH * state.zoom;
    const maxX = Math.max(34, (scaledW - rect.width) / 2 + 64);
    const maxY = Math.max(28, (scaledH - rect.height) / 2 + 64);
    state.panX = clamp(state.panX, -maxX, maxX);
    state.panY = clamp(state.panY, -maxY, maxY);
  }

  function updateZoomLabel() {
    const percent = Math.round((state.zoom * state.fitW / Math.max(1, state.naturalW)) * 100);
    el.zoomDisplay.textContent = `${percent}%`;
  }

  function zoomAt(nextZoom, anchorX = 0, anchorY = 0) {
    if (!state.image) return;
    const oldZoom = state.zoom;
    const zoom = clamp(nextZoom, 0.35, 8);
    if (Math.abs(zoom - oldZoom) < 0.0001) return;
    state.panX = anchorX - (anchorX - state.panX) * (zoom / oldZoom);
    state.panY = anchorY - (anchorY - state.panY) * (zoom / oldZoom);
    state.zoom = zoom;
    clampPan();
    applyTransform();
  }

  function actualPixels() {
    if (!state.image) return;
    const target = state.naturalW / Math.max(1, state.fitW);
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    zoomAt(target, 0, 0);
  }

  // ------------------------------------------------------------------ mask
  function strokePath(ctx, action, color) {
    const points = action.points;
    if (!points.length) return;
    ctx.save();
    ctx.globalCompositeOperation = action.mode === "eraser" ? "destination-out" : "source-over";
    ctx.lineWidth = action.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, action.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i += 1) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderActions(ctx, color = "#ff654c") {
    ctx.clearRect(0, 0, state.naturalW, state.naturalH);
    for (const action of state.actions) {
      if (action.type === "clear") {
        ctx.clearRect(0, 0, state.naturalW, state.naturalH);
      } else if (action.type === "raster") {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(action.canvas, 0, 0, state.naturalW, state.naturalH);
        ctx.restore();
      } else if (action.type === "stroke") {
        strokePath(ctx, action, color);
      }
    }
  }

  function redrawMask() {
    renderActions(maskCtx, "#ff654c");
  }

  function drawDot(point, size, eraser) {
    maskCtx.save();
    maskCtx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    maskCtx.fillStyle = "#ff654c";
    maskCtx.beginPath();
    maskCtx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
    maskCtx.fill();
    maskCtx.restore();
  }

  function drawSegment(from, to, size, eraser) {
    maskCtx.save();
    maskCtx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    maskCtx.lineWidth = size;
    maskCtx.lineCap = "round";
    maskCtx.lineJoin = "round";
    maskCtx.strokeStyle = "#ff654c";
    maskCtx.beginPath();
    maskCtx.moveTo(from.x, from.y);
    maskCtx.lineTo(to.x, to.y);
    maskCtx.stroke();
    maskCtx.restore();
  }

  function updateCoverage() {
    window.clearTimeout(state.coverageTimer);
    state.coverageTimer = window.setTimeout(() => {
      if (!state.image) return;
      const sampleW = Math.max(32, Math.min(320, state.naturalW));
      const sampleH = Math.max(20, Math.round(sampleW * state.naturalH / Math.max(1, state.naturalW)));
      const sample = document.createElement("canvas");
      sample.width = sampleW;
      sample.height = sampleH;
      const ctx = sample.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(el.maskCanvas, 0, 0, sampleW, sampleH);
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
      let marked = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) marked += 1;
      }
      state.coverage = (marked / (sampleW * sampleH)) * 100;
      el.maskLabel.textContent = `遮罩 ${state.coverage.toFixed(1)}%`;
      if (state.coverage < 0.03) {
        el.maskState.textContent = "未标记";
      } else if (state.coverage > 75) {
        el.maskState.textContent = `覆盖 ${state.coverage.toFixed(0)}%`;
      } else {
        el.maskState.textContent = `已标记 ${state.coverage.toFixed(1)}%`;
      }
      refreshControls();
    }, 90);
  }

  function canUndo() {
    return state.actions.some((action) => !action.locked);
  }

  function undo() {
    if (!state.image || state.busy) return;
    for (let i = state.actions.length - 1; i >= 0; i -= 1) {
      if (!state.actions[i].locked) {
        invalidateResult({ silent: true });
        state.redo.push(state.actions.splice(i, 1)[0]);
        redrawMask();
        updateCoverage();
        refreshControls();
        return;
      }
    }
  }

  function redo() {
    if (!state.image || state.busy || !state.redo.length) return;
    invalidateResult({ silent: true });
    state.actions.push(state.redo.pop());
    redrawMask();
    updateCoverage();
    refreshControls();
  }

  function clearMask() {
    if (!state.image || state.busy || state.coverage < 0.03) return;
    invalidateResult({ silent: true });
    state.actions.push({ type: "clear" });
    state.redo = [];
    redrawMask();
    state.coverage = 0;
    el.maskLabel.textContent = "遮罩 0.0%";
    el.maskState.textContent = "未标记";
    updateCoverage();
    refreshControls();
    toast("遮罩已清空，可用 Ctrl+Z 撤销。", "info", 2600);
  }

  async function exportMaskBlob() {
    const canvas = document.createElement("canvas");
    canvas.width = state.naturalW;
    canvas.height = state.naturalH;
    const ctx = canvas.getContext("2d");
    renderActions(ctx, "#ffffff");
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("遮罩导出失败"));
      }, "image/png");
    });
  }

  // --------------------------------------------------------------- gesture
  function pointFromEvent(event) {
    const rect = el.maskCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) * state.naturalW / rect.width, 0, state.naturalW),
      y: clamp((event.clientY - rect.top) * state.naturalH / rect.height, 0, state.naturalH),
    };
  }

  function insideArtboard(event) {
    const rect = el.artboard.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  function startPan(event) {
    state.gesture = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: state.panX,
      panY: state.panY,
    };
    el.artboard.classList.add("is-panning");
    el.brushCursor.hidden = true;
    try { el.stage.setPointerCapture(event.pointerId); } catch { /* noop */ }
  }

  function startStroke(event, point) {
    invalidateResult({ silent: true });
    const rect = el.maskCanvas.getBoundingClientRect();
    const scale = rect.width ? state.naturalW / rect.width : 1;
    const eraser = state.tool === "eraser";
    const stroke = {
      type: "stroke",
      mode: eraser ? "eraser" : "brush",
      size: Math.max(1, state.brush * scale),
      points: [point],
    };
    state.actions.push(stroke);
    state.redo = [];
    drawDot(point, stroke.size, eraser);
    state.gesture = {
      type: "draw",
      pointerId: event.pointerId,
      stroke,
      last: point,
      eraser,
    };
    try { el.stage.setPointerCapture(event.pointerId); } catch { /* noop */ }
    refreshControls();
  }

  function startCompareDrag(event) {
    state.gesture = { type: "compare", pointerId: event.pointerId };
    try { el.stage.setPointerCapture(event.pointerId); } catch { /* noop */ }
    updateCompareFromClientX(event.clientX);
    el.brushCursor.hidden = true;
  }

  function setCompareSplit(value) {
    state.compareSplit = clamp(Number.isFinite(Number(value)) ? Number(value) : 50, 0, 100);
    applyCompare();
  }

  function updateCompareFromClientX(clientX) {
    const rect = el.artboard.getBoundingClientRect();
    if (!rect.width) return;
    setCompareSplit(((clientX - rect.left) / rect.width) * 100);
  }

  function applyCompare() {
    const split = clamp(state.compareSplit, 0, 100);
    el.artboard.style.setProperty("--split", `${split}%`);
    if (el.compareHandle) {
      const rounded = Math.round(split);
      el.compareHandle.setAttribute("aria-valuenow", String(rounded));
      el.compareHandle.setAttribute("aria-valuetext", `原图 ${rounded}% / 修复 ${100 - rounded}%`);
    }
    updateCompareOverlay();
  }

  function updateCompareOverlay() {
    if (!state.image || !el.compareLine) return;
    const art = el.artboard.getBoundingClientRect();
    const stage = el.stage.getBoundingClientRect();
    if (art.width < 1 || art.height < 1) return;
    // The divider lives in stage space, so it stays a crisp 1px line
    // regardless of image zoom or source resolution.
    const originX = stage.left + el.stage.clientLeft;
    const originY = stage.top + el.stage.clientTop;
    const left = art.left - originX;
    const right = art.right - originX;
    const x = clamp(
      Math.round(left + art.width * (state.compareSplit / 100) - 0.5),
      Math.round(left),
      Math.max(Math.round(left), Math.round(right) - 1)
    );
    el.compareLine.style.left = `${x}px`;
    el.compareLine.style.top = `${Math.round(art.top - originY)}px`;
    el.compareLine.style.height = `${Math.round(art.height)}px`;
  }

  function onPointerDown(event) {
    if (!state.image || state.busy || el.processing.hidden === false) return;
    if (event.button !== undefined && event.button > 1) return;
    if (event.target.closest("button, .canvas-toolbar, .processing")) return;

    const panRequested = state.tool === "pan" || state.spaceDown || event.button === 1;
    if (state.mode === "compare" && !panRequested) {
      if (!insideArtboard(event)) return;
      event.preventDefault();
      startCompareDrag(event);
      return;
    }

    if (!insideArtboard(event)) return;
    if (state.mode !== "edit") {
      if (panRequested) {
        event.preventDefault();
        startPan(event);
      }
      return;
    }
    if (panRequested) {
      event.preventDefault();
      startPan(event);
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    startStroke(event, point);
  }

  function onPointerMove(event) {
    if (state.image && insideArtboard(event)) {
      state.lastImagePoint = { x: event.clientX, y: event.clientY };
    }
    updateCursor(event);
    if (!state.gesture || state.gesture.pointerId !== event.pointerId) return;
    const gesture = state.gesture;
    if (gesture.type === "pan") {
      state.panX = gesture.panX + (event.clientX - gesture.startX);
      state.panY = gesture.panY + (event.clientY - gesture.startY);
      clampPan();
      applyTransform();
      return;
    }
    if (gesture.type === "compare") {
      updateCompareFromClientX(event.clientX);
      return;
    }
    if (gesture.type === "draw") {
      const events = typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [event];
      for (const sample of events) {
        const point = pointFromEvent(sample);
        if (!point) continue;
        const last = gesture.last;
        const distance = Math.hypot(point.x - last.x, point.y - last.y);
        if (distance < 0.6) continue;
        drawSegment(last, point, gesture.stroke.size, gesture.eraser);
        gesture.stroke.points.push(point);
        gesture.last = point;
      }
    }
  }

  function endGesture(event) {
    if (!state.gesture) return;
    if (event && state.gesture.pointerId !== event.pointerId) return;
    const gesture = state.gesture;
    if (gesture.type === "draw") {
      redrawMask();
      updateCoverage();
    }
    if (gesture.type === "pan") {
      el.artboard.classList.remove("is-panning");
    }
    state.gesture = null;
    if (event) {
      try { el.stage.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    }
    refreshControls();
  }

  function hideBrushPreview() {
    if (state.brushPreviewTimer) {
      window.clearTimeout(state.brushPreviewTimer);
      state.brushPreviewTimer = null;
    }
    el.brushPreview.hidden = true;
  }

  function placeBrushPreview(size) {
    const stage = el.stage.getBoundingClientRect();
    const art = el.artboard.getBoundingClientRect();
    const left = Math.max(stage.left, art.left) + 1;
    const right = Math.min(stage.right, art.right) - 1;
    const top = Math.max(stage.top, art.top) + 1;
    const bottom = Math.min(stage.bottom, art.bottom) - 1;
    if (right <= left || bottom <= top) return;

    const radius = size / 2;
    const margin = radius + 5;
    let cx;
    let cy;
    const last = state.lastImagePoint;
    if (last && last.x >= left && last.x <= right && last.y >= top && last.y <= bottom) {
      cx = last.x;
      cy = last.y;
    } else {
      cx = (left + right) / 2;
      cy = (top + bottom) / 2;
    }
    cx = right - left > margin * 2 ? clamp(cx, left + margin, right - margin) : (left + right) / 2;
    cy = bottom - top > margin * 2 ? clamp(cy, top + margin, bottom - margin) : (top + bottom) / 2;
    // Keep the value label visible below the circle.
    const bottomReserve = radius + 34;
    if (cy + bottomReserve > bottom) cy = Math.max(top + radius, bottom - bottomReserve);
    if (cy - radius < top) cy = top + radius;

    const originX = stage.left + el.stage.clientLeft;
    const originY = stage.top + el.stage.clientTop;
    el.brushPreview.style.left = `${cx - originX}px`;
    el.brushPreview.style.top = `${cy - originY}px`;
  }

  function showBrushPreview(duration = 1200) {
    if (!state.image || state.busy || state.mode !== "edit" || state.tool === "pan") return;
    const size = state.brush;
    el.brushPreview.hidden = false;
    el.brushPreview.style.setProperty("--brush-size", `${size}px`);
    el.brushPreviewRing.classList.toggle("is-eraser", state.tool === "eraser");
    el.brushPreviewLabel.textContent = `${state.tool === "eraser" ? "橡皮" : "画笔"} · ${size} px`;
    el.brushPreviewLabel.style.top = `${size / 2 + 11}px`;
    placeBrushPreview(size);
    if (state.brushPreviewTimer) window.clearTimeout(state.brushPreviewTimer);
    state.brushPreviewTimer = window.setTimeout(() => {
      state.brushPreviewTimer = null;
      el.brushPreview.hidden = true;
    }, duration);
  }

  function updateCursor(event) {
    if (!state.image || state.busy || state.mode !== "edit" || state.tool === "pan" || state.spaceDown) {
      el.brushCursor.hidden = true;
      return;
    }
    if (event.pointerType === "touch" && state.gesture) {
      el.brushCursor.hidden = true;
      return;
    }
    if (!insideArtboard(event)) {
      el.brushCursor.hidden = true;
      return;
    }
    const stageRect = el.stage.getBoundingClientRect();
    el.brushCursor.style.left = `${event.clientX - stageRect.left}px`;
    el.brushCursor.style.top = `${event.clientY - stageRect.top}px`;
    el.brushCursor.style.width = `${state.brush}px`;
    el.brushCursor.style.height = `${state.brush}px`;
    el.brushCursor.classList.toggle("is-eraser", state.tool === "eraser");
    hideBrushPreview();
    el.brushCursor.hidden = false;
  }

  // ------------------------------------------------------------------ view
  function setMode(mode) {
    state.mode = mode;
    const hasResult = Boolean(state.result);
    const showResult = mode === "result" || mode === "compare";
    el.resultLayer.hidden = !showResult;
    el.beforeLayer.hidden = mode !== "compare";
    el.compareLine.hidden = mode !== "compare";
    el.compareTags.hidden = mode !== "compare";
    el.compareHint.hidden = mode !== "compare";
    el.maskCanvas.hidden = mode !== "edit";
    el.stageTip.hidden = mode !== "edit";
    el.viewSwitch.hidden = !hasResult || mode === "edit";
    el.editMaskBtn.hidden = !hasResult || mode === "edit";
    el.backToResultBtn.hidden = !hasResult || mode !== "edit";
    if (hasResult) {
      $$("button", el.viewSwitch).forEach((button) => {
        const active = button.dataset.view === mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
    }
    el.artboard.classList.toggle("is-pan-ready", state.tool === "pan" || state.spaceDown);
    el.artboard.classList.toggle("is-compare", mode === "compare");
    if (mode !== "edit") hideBrushPreview();
    updateCompareOverlay();
    refreshControls();
  }

  function setResult(blob, url, meta) {
    if (state.result?.url) URL.revokeObjectURL(state.result.url);
    state.result = { blob, url, meta };
    state.resultMeta = meta;
    el.resultImage.src = url;
    el.resultImage.alt = `${baseName(state.fileName)} 修复结果`;
    el.resultPanel.hidden = false;
    el.runPanel.hidden = true;
    el.resultMeta.textContent = `${meta.width} × ${meta.height} · ${(meta.totalMs / 1000).toFixed(1)}s`;
    el.resultDevice.textContent = meta.device === "cuda" ? "CUDA" : "CPU";
    el.replaceBtn.hidden = false;
    setMode("compare");
    applyCompare();
  }

  function invalidateResult(options = {}) {
    if (!state.result) {
      if (!options.silent) refreshControls();
      return;
    }
    if (state.result.url) {
      el.resultImage.removeAttribute("src");
      URL.revokeObjectURL(state.result.url);
    }
    state.result = null;
    state.resultMeta = null;
    el.resultLayer.hidden = true;
    el.beforeLayer.hidden = true;
    el.compareLine.hidden = true;
    el.compareTags.hidden = true;
    el.compareHint.hidden = true;
    el.resultPanel.hidden = true;
    el.runPanel.hidden = false;
    el.viewSwitch.hidden = true;
    el.editMaskBtn.hidden = true;
    el.backToResultBtn.hidden = true;
    state.mode = "edit";
    el.artboard.classList.remove("is-compare");
    el.maskCanvas.hidden = false;
    el.stageTip.hidden = false;
    refreshControls();
  }

  // ------------------------------------------------------------------ run
  function refreshControls() {
    const hasImage = Boolean(state.image);
    const hasMask = state.coverage > 0.03;
    const busy = state.busy;
    const canRun = hasImage && hasMask && state.ready && !busy;

    el.runBtn.disabled = !canRun;
    el.undoBtn.disabled = !hasImage || busy || !canUndo();
    el.redoBtn.disabled = !hasImage || busy || state.redo.length === 0;
    el.clearBtn.disabled = !hasImage || busy || !hasMask;

    if (!hasImage) {
      el.actionHint.textContent = "先上传一张图片";
    } else if (!state.ready) {
      el.actionHint.textContent = "本地模型尚未就绪";
    } else if (!hasMask) {
      el.actionHint.textContent = "涂抹水印区域后即可开始";
    } else if (busy) {
      el.actionHint.textContent = "正在本机重建画面…";
    } else {
      const seconds = estimateSeconds();
      el.actionHint.textContent = `${deviceName()} 推理 · 预计约 ${formatSeconds(seconds)}`;
    }
    el.qualityEstimate.textContent = estimateLabel();
    el.modelDevice.textContent = state.health?.device === "cuda" ? "CUDA" : "CPU";
  }

  function currentMegapixels() {
    if (state.image) {
      const scale = Math.min(1, state.maxSide / Math.max(state.naturalW, state.naturalH));
      return (state.naturalW * state.naturalH * scale * scale) / 1e6;
    }
    return 1.7;
  }

  function estimateSeconds() {
    const mp = currentMegapixels();
    if (state.health?.device === "cuda") return Math.max(1.4, 1.2 + 0.9 * mp);
    return Math.max(3.2, 1.1 + 5.9 * mp);
  }

  function formatSeconds(seconds) {
    if (seconds < 10) return `${seconds.toFixed(1)} 秒`;
    return `${Math.round(seconds)} 秒`;
  }

  function estimateLabel() {
    const mp = currentMegapixels();
    const resized = state.image
      && Math.max(state.naturalW, state.naturalH) > state.maxSide;
    const size = state.image
      ? (resized ? `缩放至 ${state.maxSide}px` : "原尺寸")
      : "1600px";
    return `${size} · 预计约 ${formatSeconds(estimateSeconds())} · ${deviceName()} 推理`;
  }

  function deviceName() {
    return state.health?.device === "cuda" ? "CUDA" : "CPU";
  }

  async function runInpaint() {
    if (!state.image || !state.file || state.busy) return;
    if (!state.ready) {
      toast("模型尚未就绪，请查看服务日志。", "error");
      return;
    }
    if (state.coverage < 0.03) {
      toast("先涂抹水印区域，再开始修复。", "error");
      return;
    }

    if (state.result) {
      // Re-running from the result panel replaces the previous result.
      el.runPanel.hidden = true;
    }
    dismissToasts("info");
    state.busy = true;
    el.runBtn.disabled = true;
    document.body.classList.add("is-busy");
    el.processing.hidden = false;
    el.brushCursor.hidden = true;
    startProcessingClock();
    refreshControls();

    try {
      const maskBlob = await exportMaskBlob();
      const form = new FormData();
      form.append("image", state.file, state.fileName);
      form.append("mask", maskBlob, "mask.png");
      form.append("dilate", String(state.dilate));
      form.append("max_side", String(state.maxSide));
      form.append("feather", String(state.feather));

      const response = await fetch("/api/inpaint", { method: "POST", body: form });
      if (!response.ok) {
        let message = "处理失败，请稍后重试。";
        try {
          const payload = await response.json();
          if (payload?.detail) message = payload.detail;
        } catch { /* noop */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("服务返回了空结果。");
      const url = URL.createObjectURL(blob);
      const image = await loadImage(url);
      const meta = {
        width: image.naturalWidth,
        height: image.naturalHeight,
        totalMs: Number(response.headers.get("X-Total-Ms")) || 0,
        inferenceMs: Number(response.headers.get("X-Inference-Ms")) || 0,
        processedWidth: Number(response.headers.get("X-Processed-Width")) || image.naturalWidth,
        processedHeight: Number(response.headers.get("X-Processed-Height")) || image.naturalHeight,
        device: response.headers.get("X-Device") || deviceName().toLowerCase(),
        jobId: response.headers.get("X-Job-Id") || "",
        coverage: Number(response.headers.get("X-Coverage")) || state.coverage,
      };
      setResult(blob, url, meta);
      toast(`修复完成 · ${(meta.totalMs / 1000).toFixed(1)} 秒`, "success", 3600);
    } catch (error) {
      toast(error.message || "处理失败，请稍后重试。", "error", 6000);
      refreshControls();
    } finally {
      state.busy = false;
      document.body.classList.remove("is-busy");
      stopProcessingClock();
      el.processing.hidden = true;
      refreshControls();
    }
  }

  function startProcessingClock() {
    stopProcessingClock();
    state.procStarted = performance.now();
    const tick = () => {
      const seconds = (performance.now() - state.procStarted) / 1000;
      el.procElapsed.textContent = `${seconds.toFixed(1)}s`;
      if (seconds < 1.6) {
        el.procStage.textContent = "正在分析遮罩…";
        el.procDetail.textContent = "读取画面与边缘信息";
      } else if (seconds < 4.2) {
        el.procStage.textContent = "正在重建纹理…";
        el.procDetail.textContent = "LaMa 正在填补缺失区域";
      } else if (seconds < 8) {
        el.procStage.textContent = "正在融合光影…";
        el.procDetail.textContent = "把生成区域接回原画面";
      } else {
        el.procStage.textContent = "正在完成最后处理…";
        el.procDetail.textContent = "大图与 CPU 推理会多花一点时间";
      }
    };
    tick();
    state.procTimer = window.setInterval(tick, 120);
  }

  function stopProcessingClock() {
    if (state.procTimer) {
      window.clearInterval(state.procTimer);
      state.procTimer = null;
    }
  }

  function downloadResult() {
    if (!state.result) return;
    const anchor = document.createElement("a");
    anchor.href = state.result.url;
    anchor.download = `${baseName(state.fileName)}-clean.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast("正在下载 PNG。", "info", 2400);
  }

  async function copyResult() {
    if (!state.result) return;
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("clipboard unsupported");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": state.result.blob })]);
      toast("修复结果已复制到剪贴板。", "success", 2800);
    } catch {
      toast("当前浏览器不能直接复制图片，请使用下载。", "error", 3800);
    }
  }

  // ------------------------------------------------------------------ tool
  function setTool(tool) {
    state.tool = tool === "eraser" || tool === "pan" ? tool : "brush";
    $$("[data-tool]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tool === state.tool);
    });
    el.artboard.classList.toggle("is-pan-ready", state.tool === "pan" || state.spaceDown);
    if (state.tool === "pan") {
      el.brushCursor.hidden = true;
      hideBrushPreview();
    }
  }

  function setQuality(side) {
    state.maxSide = Number(side);
    $$(".quality-options button").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.side) === state.maxSide);
    });
    el.qualityState.textContent = state.maxSide === 1280 ? "快速" : state.maxSide === 2048 ? "精细" : "标准";
    updateEstimate();
  }

  function updateEstimate() {
    refreshControls();
  }

  function updateSliderFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const progress = ((value - min) / Math.max(1, max - min)) * 100;
    input.style.setProperty("--range-progress", `${progress}%`);
  }

  // ------------------------------------------------------------- demo/load
  async function loadDemoImage() {
    if (state.busy) return;
    el.loadDemo.disabled = true;
    try {
      const [imageResponse, maskResponse] = await Promise.all([
        fetch("/samples/demo-watermarked.jpg", { cache: "no-store" }),
        fetch("/samples/demo-mask.png", { cache: "no-store" }),
      ]);
      if (!imageResponse.ok || !maskResponse.ok) throw new Error("示例素材不可用");
      const [imageBlob, maskBlob] = await Promise.all([imageResponse.blob(), maskResponse.blob()]);
      const file = new File([imageBlob], "lama-lake-demo.jpg", { type: "image/jpeg" });
      await loadFile(file, { maskBlob, demo: true });
    } catch {
      toast("示例素材载入失败，请直接上传一张图片。", "error");
    } finally {
      el.loadDemo.disabled = false;
    }
  }

  // ------------------------------------------------------------------ help
  function openHelp() {
    if (!el.helpDialog.open) el.helpDialog.showModal();
  }

  function closeHelp() {
    if (el.helpDialog.open) el.helpDialog.close();
  }

  // ---------------------------------------------------------------- events
  function bindEvents() {
    el.dropzone.addEventListener("click", () => el.fileInput.click());
    el.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        el.fileInput.click();
      }
    });
    el.uploadTool.addEventListener("click", () => el.fileInput.click());
    el.replaceBtn.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", () => {
      const file = el.fileInput.files?.[0];
      el.fileInput.value = "";
      if (file) loadFile(file);
    });
    el.loadDemo.addEventListener("click", loadDemoImage);

    el.demoPhoto.addEventListener("pointerdown", beginDemoDrag);
    el.demoPhoto.addEventListener("pointermove", moveDemoDrag);
    el.demoPhoto.addEventListener("pointerup", endDemoDrag);
    el.demoPhoto.addEventListener("pointercancel", endDemoDrag);
    el.demoPhoto.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 10 : 2;
      let next = null;
      if (event.key === "ArrowLeft") next = state.demoSplit - step;
      else if (event.key === "ArrowRight") next = state.demoSplit + step;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 100;
      if (next === null) return;
      event.preventDefault();
      setDemoSplit(next);
    });

    $$("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });
    $$(".quality-options button").forEach((button) => {
      button.addEventListener("click", () => setQuality(button.dataset.side));
    });

    el.brushSize.addEventListener("input", () => {
      state.brush = Number(el.brushSize.value);
      el.brushValue.textContent = `${state.brush} px`;
      el.railBrushValue.textContent = String(state.brush);
      el.brushCursor.style.width = `${state.brush}px`;
      el.brushCursor.style.height = `${state.brush}px`;
      updateSliderFill(el.brushSize);
      showBrushPreview();
    });
    el.dilate.addEventListener("input", () => {
      state.dilate = Number(el.dilate.value);
      el.dilateValue.textContent = `${state.dilate} px`;
      updateSliderFill(el.dilate);
    });
    el.feather.addEventListener("input", () => {
      state.feather = Number(el.feather.value);
      el.featherValue.textContent = `${state.feather.toFixed(1)} px`;
      updateSliderFill(el.feather);
    });

    el.undoBtn.addEventListener("click", undo);
    el.redoBtn.addEventListener("click", redo);
    el.clearBtn.addEventListener("click", clearMask);
    el.runBtn.addEventListener("click", runInpaint);
    el.rerunBtn.addEventListener("click", runInpaint);
    el.downloadBtn.addEventListener("click", downloadResult);
    el.copyBtn.addEventListener("click", copyResult);
    el.adjustMaskBtn.addEventListener("click", () => setMode("edit"));
    el.editMaskBtn.addEventListener("click", () => setMode("edit"));
    el.backToResultBtn.addEventListener("click", () => setMode("compare"));

    $$("button", el.viewSwitch).forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.view));
    });

    el.compareHandle.addEventListener("keydown", (event) => {
      let next = null;
      if (event.shiftKey && event.key === "ArrowLeft") next = state.compareSplit - 5;
      else if (event.shiftKey && event.key === "ArrowRight") next = state.compareSplit + 5;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 100;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      setCompareSplit(next);
    });

    el.zoomOutBtn = $("#zoomOutBtn");
    el.zoomInBtn = $("#zoomInBtn");
    el.fitBtn = $("#fitBtn");
    el.zoomOutBtn.addEventListener("click", () => zoomAt(state.zoom * 0.8, 0, 0));
    el.zoomInBtn.addEventListener("click", () => zoomAt(state.zoom * 1.25, 0, 0));
    el.fitBtn.addEventListener("click", () => fitArtboard(true));
    el.zoomDisplay.addEventListener("click", actualPixels);

    el.stage.addEventListener("pointerdown", onPointerDown);
    el.stage.addEventListener("pointermove", onPointerMove);
    el.stage.addEventListener("pointerup", endGesture);
    el.stage.addEventListener("pointercancel", endGesture);
    el.stage.addEventListener("pointerleave", () => {
      if (!state.gesture) el.brushCursor.hidden = true;
    });
    el.stage.addEventListener("wheel", (event) => {
      if (!state.image) return;
      const stageRect = el.stage.getBoundingClientRect();
      const anchorX = event.clientX - stageRect.left - stageRect.width / 2;
      const anchorY = event.clientY - stageRect.top - stageRect.height / 2;

      // In compare view a two-finger swipe moves the split, which is much
      // easier on a trackpad than grabbing the small circular handle.
      if (state.mode === "compare" && !event.ctrlKey) {
        event.preventDefault();
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
        setCompareSplit(state.compareSplit + delta * 0.06);
        return;
      }

      // Ctrl+wheel and trackpad pinch zoom around the pointer.
      if (event.ctrlKey) {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.002);
        zoomAt(state.zoom * factor, anchorX, anchorY);
        return;
      }

      // Plain two-finger scrolling / wheel pans the canvas.
      event.preventDefault();
      const factor = event.deltaMode === 1 ? 16 : 1;
      state.panX -= event.deltaX * factor;
      state.panY -= event.deltaY * factor;
      clampPan();
      applyTransform();
    }, { passive: false });

    el.stage.addEventListener("dblclick", (event) => {
      if (!state.image || event.target.closest("button, .canvas-toolbar, .processing")) return;
      if (state.mode === "compare") setCompareSplit(50);
    });

    window.addEventListener("resize", () => {
      if (!state.image || state.busy) return;
      window.clearTimeout(state._resizeTimer);
      state._resizeTimer = window.setTimeout(() => fitArtboard(true), 110);
    });

    el.helpBtn.addEventListener("click", openHelp);
    el.closeHelpBtn.addEventListener("click", closeHelp);
    el.helpDialog.addEventListener("click", (event) => {
      const rect = el.helpDialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom) {
        closeHelp();
      }
    });

    // Global drag & drop
    let dragDepth = 0;
    window.addEventListener("dragenter", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      dragDepth += 1;
      document.body.classList.add("is-dragging");
      if (state.image) el.dragOverlay.hidden = false;
      el.dropzone.classList.add("is-dragover");
    });
    window.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        document.body.classList.remove("is-dragging");
        el.dragOverlay.hidden = true;
        el.dropzone.classList.remove("is-dragover");
      }
    });
    window.addEventListener("drop", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      dragDepth = 0;
      document.body.classList.remove("is-dragging");
      el.dragOverlay.hidden = true;
      el.dropzone.classList.remove("is-dragover");
      const file = event.dataTransfer.files?.[0];
      if (file) loadFile(file);
    });

    document.addEventListener("paste", (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (file) loadFile(file);
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing || el.helpDialog.open) return;

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        runInpaint();
        return;
      }
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        state.spaceDown = true;
        el.artboard.classList.add("is-pan-ready");
        el.brushCursor.hidden = true;
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        fitArtboard(true);
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        actualPixels();
        return;
      }
      if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
        if (!state.image || state.busy) return;
        event.preventDefault();
        const step = event.shiftKey ? 160 : 48;
        if (key === "arrowleft") state.panX -= step;
        else if (key === "arrowright") state.panX += step;
        else if (key === "arrowup") state.panY -= step;
        else state.panY += step;
        clampPan();
        applyTransform();
        return;
      }
      if (key === "b") setTool("brush");
      else if (key === "e") setTool("eraser");
      else if (key === "h") setTool("pan");
      else if (key === "[" || key === "]") {
        const delta = key === "[" ? -4 : 4;
        state.brush = clamp(state.brush + delta, 8, 220);
        el.brushSize.value = String(state.brush);
        el.brushValue.textContent = `${state.brush} px`;
        el.railBrushValue.textContent = String(state.brush);
        updateSliderFill(el.brushSize);
        showBrushPreview();
      } else if (key === "?") {
        openHelp();
      } else if (key === "escape" && state.mode === "edit" && state.result) {
        setMode("compare");
      }
    });

    document.addEventListener("keyup", (event) => {
      if (event.code === "Space") {
        state.spaceDown = false;
        el.artboard.classList.remove("is-pan-ready");
      }
    });

    window.addEventListener("blur", () => {
      if (state.gesture) endGesture();
      state.spaceDown = false;
      el.artboard.classList.remove("is-pan-ready");
      el.brushCursor.hidden = true;
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.gesture?.type === "draw") endGesture();
    });
    window.addEventListener("beforeunload", () => {
      if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
      if (state.result?.url) URL.revokeObjectURL(state.result.url);
    });
  }

  function init() {
    bindEvents();
    [el.brushSize, el.dilate, el.feather].forEach(updateSliderFill);
    setTool("brush");
    applyCompare();
    setDemoSplit(54);
    loadHealth();
  }

  init();
})();

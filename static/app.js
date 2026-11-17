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
    brushLabel: $("#brushLabel"),
    batchBar: $("#batchBar"),
    batchList: $("#batchList"),
    batchCount: $("#batchCount"),
    batchAddBtn: $("#batchAddBtn"),
    batchInput: $("#batchInput"),
    batchSection: $("#batchSection"),
    batchState: $("#batchState"),
    batchProgress: $("#batchProgress"),
    maskSource: $("#maskSource"),
    applyMaskBtn: $("#applyMaskBtn"),
    maskOnlyEmpty: $("#maskOnlyEmpty"),
    batchRunBtn: $("#batchRunBtn"),
    batchExportBtn: $("#batchExportBtn"),
    movePrevBtn: $("#movePrevBtn"),
    moveNextBtn: $("#moveNextBtn"),
    removeItemBtn: $("#removeItemBtn"),
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
  let itemSeq = 0;
  const state = {
    items: [],
    index: -1,
    batchRunning: false,
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
    sizes: { brush: 56, eraser: 96 },
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
    toolHold: null,
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
  function validateFile(file) {
    if (!file || !isImageFile(file)) return "请选择 JPG、PNG 或 WEBP 图片。";
    if (file.size > MAX_BYTES) return "图片超过 40MB，请先压缩后再试。";
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || "")) {
      return "浏览器无法直接读取 HEIC，请先导出为 JPG 或 PNG。";
    }
    return "";
  }

  function createItem(file, image, url) {
    return {
      id: `item-${++itemSeq}`,
      file,
      image,
      url,
      fileName: file.name || "lama-image",
      naturalW: image.naturalWidth,
      naturalH: image.naturalHeight,
      actions: [],
      redo: [],
      coverage: 0,
      result: null,
      resultMeta: null,
    };
  }

  function activeItem() {
    return state.items[state.index] || null;
  }

  async function addFiles(fileList, options = {}) {
    if (state.busy || state.batchRunning) {
      toast("正在处理图片，稍后再添加。", "info");
      return [];
    }
    const files = Array.from(fileList || []);
    if (!files.length) return [];
    const added = [];
    let problem = "";
    for (const file of files) {
      const invalid = validateFile(file);
      if (invalid) {
        problem = problem || invalid;
        continue;
      }
      let url = "";
      try {
        url = URL.createObjectURL(file);
        const image = await loadImage(url);
        if (image.naturalWidth < 16 || image.naturalHeight < 16) throw new Error("small");
        if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("huge");
        added.push(createItem(file, image, url));
      } catch (error) {
        if (url) URL.revokeObjectURL(url);
        if (error.message === "small") problem = problem || "有图片太小，至少需要 16 × 16 像素。";
        else if (error.message === "huge") problem = problem || "有图片超过 6000 万像素，请先缩小。";
        else problem = problem || "有图片无法读取，请换一张 JPG 或 PNG。";
      }
    }
    if (!added.length) {
      toast(problem || "这些图片无法读取。", "error", 5200);
      return [];
    }
    const firstIndex = state.items.length;
    state.items.push(...added);
    activate(firstIndex);
    renderBatchList();
    if (options.quiet) return added;
    if (added.length > 1) {
      toast(`已加入 ${added.length} 张图片：逐张涂抹，或用「套用遮罩」批量处理。`, "info", 4800);
    } else if (problem) {
      toast(`已加入 1 张图片；另一张被跳过：${problem}`, "info", 5200);
    } else if (!state.result) {
      toast("图片已载入，涂抹水印区域后开始修复。", "info");
    }
    return added;
  }

  function activate(index, options = {}) {
    const item = state.items[index];
    if (!item) return;
    const sameItem = index === state.index;
    state.index = index;
    state.image = item.image;
    state.file = item.file;
    state.fileName = item.fileName;
    state.fileType = item.file.type || "image/jpeg";
    state.originalUrl = item.url;
    state.naturalW = item.naturalW;
    state.naturalH = item.naturalH;
    state.actions = item.actions;
    state.redo = item.redo;
    state.coverage = item.coverage;
    state.result = item.result;
    state.resultMeta = item.resultMeta;
    if (!sameItem) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
    }

    el.baseImage.src = item.url;
    el.beforeImage.src = item.url;
    el.baseImage.alt = item.fileName;
    el.maskCanvas.width = item.naturalW;
    el.maskCanvas.height = item.naturalH;
    redrawMask();
    el.maskLabel.textContent = `遮罩 ${item.coverage.toFixed(1)}%`;
    el.maskState.textContent = item.coverage < 0.03
      ? "未标记"
      : item.coverage > 75
        ? `覆盖 ${item.coverage.toFixed(0)}%`
        : `已标记 ${item.coverage.toFixed(1)}%`;
    el.emptyState.hidden = true;
    el.artboardWrap.hidden = false;
    el.canvasToolbar.hidden = false;
    el.replaceBtn.hidden = false;
    el.topFileName.textContent = item.fileName;
    el.stageTitle.textContent = baseName(item.fileName);
    el.stageFileMeta.textContent = `${item.naturalW} × ${item.naturalH}`;
    el.dimsLabel.textContent = `${item.naturalW} × ${item.naturalH} px`;
    document.title = `${baseName(item.fileName)} · LAMA 清痕`;
    hideBrushPreview();
    if (item.result) {
      showResultView(item.result, item.resultMeta, item.fileName);
      setMode("compare");
    } else {
      el.resultImage.removeAttribute("src");
      el.resultPanel.hidden = true;
      el.runPanel.hidden = false;
      setMode("edit");
    }
    updateCoverage();
    refreshControls();
    renderBatchList();
    if (!sameItem && options.fit !== false) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitArtboard(true));
      });
    }
  }

  function showResultView(result, meta, fileName) {
    el.resultImage.src = result.url;
    el.resultImage.alt = `${baseName(fileName)} 修复结果`;
    el.resultPanel.hidden = false;
    el.runPanel.hidden = true;
    el.resultMeta.textContent = `${meta.width} × ${meta.height} · ${(meta.totalMs / 1000).toFixed(1)}s`;
    el.resultDevice.textContent = meta.device === "cuda" ? "CUDA" : "CPU";
    el.replaceBtn.hidden = false;
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
      const item = activeItem();
      const raster = { type: "raster", canvas, locked: true };
      if (item) {
        item.actions = [raster];
        item.redo = [];
        state.actions = item.actions;
        state.redo = item.redo;
      } else {
        state.actions = [raster];
        state.redo = [];
      }
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
    if (!el.brushPreview.hidden) placeBrushPreview(activeSize());
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

  function renderActions(ctx, color = "#ff654c", item = activeItem()) {
    if (!item) return;
    const width = item.naturalW;
    const height = item.naturalH;
    ctx.clearRect(0, 0, width, height);
    for (const action of item.actions) {
      if (action.type === "clear") {
        ctx.clearRect(0, 0, width, height);
      } else if (action.type === "raster") {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(action.canvas, 0, 0, width, height);
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
      const item = activeItem();
      if (!item) return;
      item.coverage = measureCoverage(item);
      state.coverage = item.coverage;
      el.maskLabel.textContent = `遮罩 ${item.coverage.toFixed(1)}%`;
      if (item.coverage < 0.03) {
        el.maskState.textContent = "未标记";
      } else if (item.coverage > 75) {
        el.maskState.textContent = `覆盖 ${item.coverage.toFixed(0)}%`;
      } else {
        el.maskState.textContent = `已标记 ${item.coverage.toFixed(1)}%`;
      }
      refreshControls();
      renderBatchList();
    }, 90);
  }

  function measureCoverage(item) {
    if (!item) return 0;
    const sampleW = Math.max(32, Math.min(320, item.naturalW));
    const sampleH = Math.max(20, Math.round((sampleW * item.naturalH) / Math.max(1, item.naturalW)));
    const sample = document.createElement("canvas");
    sample.width = sampleW;
    sample.height = sampleH;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.scale(sampleW / item.naturalW, sampleH / item.naturalH);
    renderActions(ctx, "#ff654c", item);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
    let marked = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) marked += 1;
    }
    return (marked / (sampleW * sampleH)) * 100;
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
    state.redo.length = 0;
    redrawMask();
    state.coverage = 0;
    el.maskLabel.textContent = "遮罩 0.0%";
    el.maskState.textContent = "未标记";
    updateCoverage();
    refreshControls();
    toast("遮罩已清空，可用 Ctrl+Z 撤销。", "info", 2600);
  }

  async function exportMaskBlob(item = activeItem()) {
    const canvas = document.createElement("canvas");
    canvas.width = item.naturalW;
    canvas.height = item.naturalH;
    const ctx = canvas.getContext("2d");
    renderActions(ctx, "#ffffff", item);
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
      size: Math.max(1, activeSize() * scale),
      points: [point],
    };
    state.actions.push(stroke);
    state.redo.length = 0;
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
    const size = activeSize();
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
    el.brushCursor.style.width = `${activeSize()}px`;
    el.brushCursor.style.height = `${activeSize()}px`;
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
    const item = activeItem();
    const previous = state.result || item?.result;
    if (previous?.url && previous.url !== url) URL.revokeObjectURL(previous.url);
    const result = { blob, url, meta };
    state.result = result;
    state.resultMeta = meta;
    if (item) {
      item.result = result;
      item.resultMeta = meta;
    }
    showResultView(result, meta, state.fileName);
    setMode("compare");
    applyCompare();
    renderBatchList();
  }

  function invalidateResult(options = {}) {
    const item = activeItem();
    const current = state.result || item?.result;
    if (!current) {
      if (!options.silent) refreshControls();
      return;
    }
    if (current.url) URL.revokeObjectURL(current.url);
    state.result = null;
    state.resultMeta = null;
    if (item) {
      item.result = null;
      item.resultMeta = null;
    }
    el.resultImage.removeAttribute("src");
    el.resultPanel.hidden = true;
    el.runPanel.hidden = false;
    setMode("edit");
    renderBatchList();
    if (!options.silent) refreshControls();
  }

  // ---------------------------------------------------------------- batch
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(entries) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const crc = crc32(entry.bytes);
      const size = entry.bytes.length;
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x21, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      parts.push(local, entry.bytes);

      const cen = new Uint8Array(46 + name.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      central.push(cen);
      offset += local.length + entry.bytes.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  function dateStamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  function moveItem(from, to) {
    if (state.busy || state.batchRunning) return;
    const count = state.items.length;
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    if (from < 0 || to < 0 || from >= count || to >= count || from === to) return;
    const active = state.items[state.index];
    const [item] = state.items.splice(from, 1);
    state.items.splice(to, 0, item);
    state.index = state.items.indexOf(active);
    renderBatchList();
  }

  function moveActive(offset) {
    if (state.index < 0) return;
    moveItem(state.index, state.index + offset);
  }

  function removeItem(index) {
    if (state.busy || state.batchRunning) {
      toast("正在处理中，稍后再移除。", "info", 2400);
      return;
    }
    const item = state.items[index];
    if (!item) return;
    URL.revokeObjectURL(item.url);
    if (item.result?.url) URL.revokeObjectURL(item.result.url);
    const wasActive = index === state.index;
    state.items.splice(index, 1);
    if (!state.items.length) {
      resetWorkspace();
      toast("队列已清空，重新添加图片即可继续。", "info", 3200);
      return;
    }
    if (wasActive) {
      const next = Math.min(index, state.items.length - 1);
      state.index = -1;
      activate(next, { fit: true });
    } else {
      if (index < state.index) state.index -= 1;
      renderBatchList();
      refreshControls();
    }
  }

  function resetWorkspace() {
    state.index = -1;
    state.image = null;
    state.file = null;
    state.fileName = "";
    state.fileType = "";
    state.originalUrl = null;
    state.naturalW = 0;
    state.naturalH = 0;
    state.actions = [];
    state.redo = [];
    state.coverage = 0;
    state.result = null;
    state.resultMeta = null;
    state.gesture = null;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    el.baseImage.removeAttribute("src");
    el.beforeImage.removeAttribute("src");
    el.resultImage.removeAttribute("src");
    el.artboardWrap.hidden = true;
    el.canvasToolbar.hidden = true;
    el.replaceBtn.hidden = true;
    el.emptyState.hidden = false;
    el.resultPanel.hidden = true;
    el.runPanel.hidden = false;
    el.topFileName.textContent = "未载入画面";
    el.stageTitle.textContent = "等待画布";
    el.stageFileMeta.textContent = "";
    el.dimsLabel.textContent = "— × —";
    el.maskLabel.textContent = "遮罩 0.0%";
    el.maskState.textContent = "未标记";
    document.title = "LAMA 清痕 · 单帧去水印工作台";
    setMode("edit");
    el.stageTip.hidden = true;
    el.brushCursor.hidden = true;
    hideBrushPreview();
    maskCtx.clearRect(0, 0, el.maskCanvas.width, el.maskCanvas.height);
    renderBatchList();
    refreshControls();
  }

  function renderBatchList() {
    const count = state.items.length;
    el.batchBar.hidden = count === 0;
    el.batchSection.hidden = count === 0;
    el.batchCount.textContent = `${count} 张`;
    el.batchList.replaceChildren();
    let dragSource = null;
    state.items.forEach((item, index) => {
      const thumb = document.createElement("div");
      thumb.className = "batch-thumb";
      thumb.draggable = true;
      thumb.tabIndex = 0;
      thumb.setAttribute("role", "button");
      thumb.setAttribute("aria-label", `第 ${index + 1} 张：${item.fileName}`);
      if (index === state.index) thumb.classList.add("is-active");
      if (item.result) thumb.classList.add("is-done");
      thumb.title = `${index + 1}. ${item.fileName}（拖动可排序）`;

      const image = document.createElement("img");
      image.src = item.url;
      image.alt = "";
      image.draggable = false;

      const badge = document.createElement("span");
      badge.className = "batch-thumb-index";
      badge.textContent = String(index + 1);
      thumb.append(image, badge);

      if (item.coverage > 0.03) {
        const mask = document.createElement("span");
        mask.className = "batch-thumb-mask";
        mask.textContent = `${item.coverage.toFixed(0)}%`;
        thumb.append(mask);
      }
      if (item.result) {
        const done = document.createElement("span");
        done.className = "batch-thumb-done";
        done.textContent = "✓";
        thumb.append(done);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "batch-thumb-remove";
      remove.setAttribute("aria-label", `移除第 ${index + 1} 张`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeItem(index);
      });
      thumb.append(remove);

      const open = () => {
        if (state.busy || state.batchRunning) {
          toast("正在处理中，等这张完成再切换。", "info", 2400);
          return;
        }
        activate(index);
      };
      thumb.addEventListener("click", open);
      thumb.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });

      thumb.addEventListener("dragstart", (event) => {
        if (state.busy || state.batchRunning) {
          event.preventDefault();
          return;
        }
        dragSource = index;
        thumb.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
      });
      thumb.addEventListener("dragend", () => {
        dragSource = null;
        thumb.classList.remove("is-dragging");
        renderBatchList();
      });
      thumb.addEventListener("dragover", (event) => {
        if (dragSource === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        thumb.classList.add("is-drop-target");
      });
      thumb.addEventListener("dragleave", () => thumb.classList.remove("is-drop-target"));
      thumb.addEventListener("drop", (event) => {
        event.preventDefault();
        thumb.classList.remove("is-drop-target");
        const from = Number(event.dataTransfer.getData("text/plain"));
        if (Number.isInteger(from)) moveItem(from, index);
      });

      el.batchList.append(thumb);
    });
    renderMaskSources();
    const doneCount = state.items.filter((item) => item.result).length;
    el.batchState.textContent = `${doneCount} / ${count} 已完成`;
    el.removeItemBtn.disabled = count === 0 || state.index < 0;
    el.movePrevBtn.disabled = state.index <= 0;
    el.moveNextBtn.disabled = state.index < 0 || state.index >= count - 1;
  }

  function renderMaskSources() {
    if (!el.maskSource) return;
    const selectedName = el.maskSource.dataset.selectedName || "";
    const signature = state.items
      .map((item) => `${item.fileName}:${item.naturalW}x${item.naturalH}`)
      .join("\u0001");
    if (el.maskSource.dataset.signature !== signature) {
      el.maskSource.replaceChildren();
      state.items.forEach((item, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `${index + 1}. ${baseName(item.fileName).slice(0, 16)}`;
        el.maskSource.append(option);
      });
      el.maskSource.dataset.signature = signature;
    }
    if (!state.items.length) {
      delete el.maskSource.dataset.selectedName;
      return;
    }
    let pick = state.items.findIndex((item) => item.fileName === selectedName);
    if (pick < 0) pick = Math.max(0, Math.min(state.index, state.items.length - 1));
    el.maskSource.value = String(pick);
    el.maskSource.dataset.selectedName = state.items[pick].fileName;
  }

  function cloneActionsFor(source, target) {
    const scaleX = target.naturalW / Math.max(1, source.naturalW);
    const scaleY = target.naturalH / Math.max(1, source.naturalH);
    const strokeScale = Math.min(scaleX, scaleY);
    return source.actions.map((action) => {
      if (action.type === "stroke") {
        return {
          type: "stroke",
          mode: action.mode,
          size: Math.max(1, action.size * strokeScale),
          points: action.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY })),
        };
      }
      if (action.type === "raster") {
        const canvas = document.createElement("canvas");
        canvas.width = target.naturalW;
        canvas.height = target.naturalH;
        canvas.getContext("2d").drawImage(action.canvas, 0, 0, target.naturalW, target.naturalH);
        return { type: "raster", canvas, locked: Boolean(action.locked) };
      }
      return { ...action };
    });
  }

  function dropItemResult(item) {
    if (!item?.result) return;
    if (item.result.url) URL.revokeObjectURL(item.result.url);
    item.result = null;
    item.resultMeta = null;
    if (state.items[state.index] === item) {
      state.result = null;
      state.resultMeta = null;
    }
  }

  function applyMaskToAll() {
    if (state.busy || state.batchRunning) return;
    const sourceIndex = Number(el.maskSource.value);
    const source = state.items[sourceIndex];
    if (!source) {
      toast("先选择要复用哪张图片的遮罩。", "info");
      return;
    }
    if (!source.actions.length) {
      toast("这张图片还没有遮罩，先涂抹或载入示例遮罩。", "info", 3800);
      return;
    }
    const onlyEmpty = el.maskOnlyEmpty.checked;
    let applied = 0;
    state.items.forEach((item, index) => {
      if (index === sourceIndex) return;
      if (onlyEmpty && item.coverage > 0.03) return;
      dropItemResult(item);
      item.actions = cloneActionsFor(source, item);
      item.redo = [];
      item.coverage = measureCoverage(item);
      applied += 1;
    });
    if (applied) {
      const current = state.items[state.index];
      if (current) {
        state.actions = current.actions;
        state.redo = current.redo;
        state.coverage = current.coverage;
      }
      activate(state.index, { fit: false });
      updateCoverage();
    } else {
      renderBatchList();
      refreshControls();
    }
    toast(
      applied
        ? `已把第 ${sourceIndex + 1} 张的遮罩套用到 ${applied} 张图片。`
        : "没有需要套用的图片（其余图片都已有遮罩）。",
      applied ? "success" : "info",
      3800,
    );
  }

  async function runBatch() {
    if (state.busy || state.batchRunning) return;
    if (!state.ready) {
      toast("模型尚未就绪，请稍候。", "error");
      return;
    }
    const targets = state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.coverage > 0.03 && !item.result);
    if (!targets.length) {
      toast("没有待处理的图片：先涂抹遮罩，或用「套用到全部」。", "info", 4200);
      return;
    }
    state.batchRunning = true;
    el.batchRunBtn.disabled = true;
    el.batchExportBtn.disabled = true;
    el.batchAddBtn.disabled = true;
    document.body.classList.add("is-batch");
    let finished = 0;
    try {
      for (let n = 0; n < targets.length; n += 1) {
        const target = targets[n];
        el.batchProgress.textContent = `处理中 ${n + 1} / ${targets.length} · ${target.item.fileName}`;
        activate(target.index, { fit: false });
        // eslint-disable-next-line no-await-in-loop
        const ok = await runInpaint({ batch: true });
        if (ok) finished += 1;
      }
    } finally {
      state.batchRunning = false;
      el.batchRunBtn.disabled = false;
      el.batchExportBtn.disabled = false;
      el.batchAddBtn.disabled = false;
      el.batchProgress.textContent = "";
      document.body.classList.remove("is-batch");
      renderBatchList();
      refreshControls();
    }
    toast(`批量处理完成：${finished} / ${targets.length} 张成功。`, finished ? "success" : "error", 4600);
  }

  async function exportBatchZip() {
    if (state.batchRunning) return;
    const done = state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.result);
    if (!done.length) {
      toast("还没有处理结果：先批量去水印。", "info", 3600);
      return;
    }
    el.batchExportBtn.disabled = true;
    try {
      const files = [];
      for (const { item, index } of done) {
        const bytes = new Uint8Array(await item.result.blob.arrayBuffer());
        files.push({
          name: `${String(index + 1).padStart(3, "0")}-${baseName(item.fileName)}.png`,
          bytes,
        });
      }
      downloadBlob(zipStore(files), `lama-batch-${dateStamp()}.zip`);
      toast(`已打包 ${files.length} 张结果。`, "success", 3800);
    } catch {
      toast("打包失败，请重试。", "error", 4200);
    } finally {
      el.batchExportBtn.disabled = false;
    }
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

  async function runInpaint(options = {}) {
    if (!state.image || !state.file || state.busy) return false;
    if (!state.ready) {
      toast("模型尚未就绪，请查看服务日志。", "error");
      return false;
    }
    if (state.coverage < 0.03) {
      toast("先涂抹水印区域，再开始修复。", "error");
      return false;
    }

    if (state.result) {
      // Re-running from the result panel replaces the previous result.
      el.runPanel.hidden = true;
    }
    dismissToasts("info");
    state.busy = true;
    el.runBtn.disabled = true;
    document.body.classList.add("is-busy");
    if (!options.batch) {
      el.processing.hidden = false;
      startProcessingClock();
    }
    el.brushCursor.hidden = true;
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
      if (!options.batch) toast(`修复完成 · ${(meta.totalMs / 1000).toFixed(1)} 秒`, "success", 3600);
      return true;
    } catch (error) {
      toast(error.message || "处理失败，请稍后重试。", "error", 6000);
      refreshControls();
      return false;
    } finally {
      state.busy = false;
      document.body.classList.remove("is-busy");
      if (!options.batch) {
        stopProcessingClock();
        el.processing.hidden = true;
      }
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

  // ------------------------------------------------------------ brush size
  // Brush and eraser keep their own size, so switching tools no longer forces
  // one shared number on both.
  function activeSize() {
    return state.sizes[state.tool === "eraser" ? "eraser" : "brush"];
  }

  function syncBrushControls() {
    const size = activeSize();
    el.brushSize.value = String(size);
    el.brushValue.textContent = `${size} px`;
    el.railBrushValue.textContent = String(size);
    el.brushLabel.textContent = state.tool === "eraser" ? "橡皮尺寸" : "画笔尺寸";
    updateSliderFill(el.brushSize);
    el.brushCursor.style.width = `${size}px`;
    el.brushCursor.style.height = `${size}px`;
  }

  function setActiveSize(value) {
    const size = clamp(Math.round(Number(value) || activeSize()), 8, 220);
    state.sizes[state.tool === "eraser" ? "eraser" : "brush"] = size;
    syncBrushControls();
    return size;
  }

  // Tap X to swap brush and eraser; hold it to borrow the other tool for as
  // long as the key is down and get the previous one back on release.
  const TOOL_HOLD_MS = 260;

  function toggleTool(event) {
    if (event.repeat || state.toolHold) return;
    const from = state.tool === "pan" ? "brush" : state.tool;
    const to = from === "brush" ? "eraser" : "brush";
    state.toolHold = { from, to, at: performance.now() };
    setTool(to);
  }

  function releaseToolHold() {
    const hold = state.toolHold;
    if (!hold) return;
    state.toolHold = null;
    if (performance.now() - hold.at >= TOOL_HOLD_MS) setTool(hold.from);
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
    } else {
      syncBrushControls();
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
      const added = await addFiles([file], { quiet: true });
      if (!added.length) throw new Error("示例素材不可用");
      await addMaskRaster(maskBlob);
      toast("示例已载入，遮罩也准备好了。可以直接开始去水印。", "info", 4600);
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
      const files = Array.from(el.fileInput.files || []);
      el.fileInput.value = "";
      if (files.length) addFiles(files);
    });
    el.batchAddBtn.addEventListener("click", () => el.batchInput.click());
    el.batchInput.addEventListener("change", () => {
      const files = Array.from(el.batchInput.files || []);
      el.batchInput.value = "";
      if (files.length) addFiles(files);
    });
    el.applyMaskBtn.addEventListener("click", applyMaskToAll);
    el.batchRunBtn.addEventListener("click", runBatch);
    el.batchExportBtn.addEventListener("click", exportBatchZip);
    el.movePrevBtn.addEventListener("click", () => moveActive(-1));
    el.moveNextBtn.addEventListener("click", () => moveActive(1));
    el.removeItemBtn.addEventListener("click", () => {
      if (state.index >= 0) removeItem(state.index);
    });
    el.maskSource.addEventListener("change", () => {
      const item = state.items[Number(el.maskSource.value)];
      if (item) el.maskSource.dataset.selectedName = item.fileName;
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
      const size = setActiveSize(el.brushSize.value);
      el.brushCursor.style.width = `${size}px`;
      el.brushCursor.style.height = `${size}px`;
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

    // Dragging a slider leaves it focused: the focus ring stays on the control
    // and the canvas never gets the keystrokes.  Hand focus back on release so
    // the shortcuts work again; keyboard users keep focus while nudging.
    [el.brushSize, el.dilate, el.feather].forEach((slider) => {
      slider.addEventListener("pointerup", () => slider.blur());
      slider.addEventListener("pointercancel", () => slider.blur());
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
      if (file) addFiles(event.dataTransfer.files);
    });

    document.addEventListener("paste", (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (file) addFiles([file]);
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const tag = target?.tagName;
      const isRange = tag === "INPUT" && target?.type === "range";
      // Only text entry swallows shortcuts.  A focused slider used to block
      // B / E / H / Space after the brush size had been dragged.
      const typing =
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable ||
        (tag === "INPUT" &&
          !isRange &&
          !["checkbox", "radio", "button", "submit", "reset", "file", "color"].includes(target?.type));
      if (typing || el.helpDialog.open) return;

      const key = event.key.toLowerCase();
      if (
        isRange &&
        ["arrowleft", "arrowright", "arrowup", "arrowdown", "home", "end", "pageup", "pagedown"].includes(key)
      ) {
        // Let a focused slider keep its native keyboard controls; its own
        // "input" handler already syncs the state.
        return;
      }
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
      if (event.altKey && (key === "arrowleft" || key === "arrowright")) {
        event.preventDefault();
        moveActive(key === "arrowleft" ? -1 : 1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (key === "arrowleft" || key === "arrowright")) {
        if (state.items.length > 1 && !state.busy && !state.batchRunning) {
          event.preventDefault();
          const next = state.index + (key === "arrowright" ? 1 : -1);
          activate((next + state.items.length) % state.items.length);
        }
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
      if (key === "x") {
        toggleTool(event);
        return;
      }
      if (key === "b" || key === "e" || key === "h") {
        // An explicit pick wins over a pending long-press swap.
        state.toolHold = null;
        setTool(key === "b" ? "brush" : key === "e" ? "eraser" : "pan");
        return;
      }
      if (key === "[" || key === "]") {
        const step = event.shiftKey ? 20 : 4;
        setActiveSize(activeSize() + (key === "[" ? -step : step));
        showBrushPreview();
        return;
      }
      if (key === "?") {
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
      if (event.key.toLowerCase() === "x") releaseToolHold();
    });

    window.addEventListener("blur", () => {
      if (state.gesture) endGesture();
      state.spaceDown = false;
      if (state.toolHold) {
        const hold = state.toolHold;
        state.toolHold = null;
        setTool(hold.from);
      }
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
    renderBatchList();
    loadHealth();
  }

  init();
})();

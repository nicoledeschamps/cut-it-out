import { fetchArenaImages } from './arena.js';
import { fetchCosmosImages } from './cosmos.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'collage-draft-01';
const SOURCE_KEY = 'collage-source';

const SOURCES = {
  arena:  { label: 'are.na', loader: fetchArenaImages },
  cosmos: { label: 'cosmos', loader: fetchCosmosImages },
};

const state = {
  pieces: [],
  selectedId: null,
  tool: 'select',
  source: 'arena',
  sourceData: { arena: { images: [], page: 1 }, cosmos: { images: [], page: 1 } },
  nextZ: 1,
  nextId: 1,
  history: [],
};
const HISTORY_LIMIT = 60;

const surface = document.getElementById('surface');
const piecesG = document.getElementById('pieces');
const overlayG = document.getElementById('overlay');
const thumbGrid = document.getElementById('thumb-grid');
const moreBtn = document.getElementById('more-btn');
const exportBtn = document.getElementById('export-btn');
const exportSvgBtn = document.getElementById('export-svg-btn');
const clearBtn = document.getElementById('clear-btn');
const toolHint = document.getElementById('tool-hint');
const GUIDE_KEY = 'cut-it-out-onboarded';

// Keep the guide usable even if a later boot step fails in a browser or saved state.
function showGuide() {
  const ov = document.getElementById('guide-overlay');
  if (!ov) return;
  ov.hidden = false;
  ov.setAttribute('aria-hidden', 'false');
}

function hideGuide() {
  const ov = document.getElementById('guide-overlay');
  if (!ov) return;
  ov.hidden = true;
  ov.setAttribute('aria-hidden', 'true');
  try { localStorage.setItem(GUIDE_KEY, '1'); } catch {}
}

function bindGuide() {
  document.getElementById('guide-start')?.addEventListener('click', hideGuide);
  document.getElementById('guide-close')?.addEventListener('click', hideGuide);
  document.getElementById('help-btn')?.addEventListener('click', showGuide);
  document.getElementById('guide-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'guide-overlay') hideGuide();
  });
  window.addEventListener('keydown', (evt) => {
    const ov = document.getElementById('guide-overlay');
    if (evt.key === 'Escape' && ov && !ov.hidden) {
      hideGuide();
      evt.preventDefault();
    }
  });
}

bindGuide();

// ---------- coords ----------
function svgPoint(evt) {
  const pt = surface.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(surface.getScreenCTM().inverse());
}

// ---------- state helpers ----------
function selectPiece(id) {
  const prevId = state.selectedId;
  state.selectedId = id;
  // if leaving a piece while in crop mode, re-render it so the clip re-applies
  if (prevId && prevId !== id && state.tool === 'crop') {
    const prev = state.pieces.find(p => p.id === prevId);
    if (prev) renderPiece(prev);
  }
  // re-render new selection in case it's now being cropped
  if (id) {
    const p = state.pieces.find(p => p.id === id);
    if (p) renderPiece(p);
  }
  renderOverlay();
  syncPieceBar();
  renderLayerPanel();
}

function syncPieceBar() {
  const bar = document.getElementById('piece-bar');
  const slider = document.getElementById('opacity-slider');
  const readout = document.getElementById('opacity-readout');
  const edgeWrap = document.getElementById('edge-intensity-wrap');
  const edgeSlider = document.getElementById('edge-slider');
  const edgeReadout = document.getElementById('edge-readout');
  const resetBtn = document.getElementById('reset-edges-btn');
  const imageZoomWrap = document.getElementById('image-zoom-wrap');
  const imageZoomSlider = document.getElementById('image-zoom-slider');
  const imageZoomReadout = document.getElementById('image-zoom-readout');
  const adjustBtn = document.getElementById('adjust-image-btn');
  const fitBtn = document.getElementById('fit-image-btn');
  if (!state.selectedId) { bar.hidden = true; return; }
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece) { bar.hidden = true; return; }
  bar.hidden = false;
  const pct = Math.round((piece.opacity ?? 1) * 100);
  slider.value = pct;
  readout.textContent = pct + '%';
  const showEdge = hasNonCleanEdge(piece);
  edgeWrap.hidden = !showEdge;
  resetBtn.hidden = !showEdge;
  if (showEdge) {
    edgeSlider.value = piece.edgeIntensity ?? 12;
    edgeReadout.textContent = (piece.edgeIntensity ?? 12) + 'px';
  }
  const hasMask = !!piece.lassoPath;
  imageZoomWrap.hidden = !hasMask;
  adjustBtn.hidden = !hasMask;
  fitBtn.hidden = !hasMask;
  adjustBtn.classList.toggle('active', state.tool === 'adjust');
  adjustBtn.textContent = state.tool === 'adjust' ? 'done adjusting' : 'adjust image';
  if (hasMask) {
    imageZoomSlider.value = Math.round((piece.imageScale ?? 1) * 100);
    imageZoomReadout.textContent = Math.round((piece.imageScale ?? 1) * 100) + '%';
  }
  document.getElementById('remove-mask-btn').hidden = !hasMask;
}

function setTool(tool) {
  const prev = state.tool;
  state.tool = tool;
  document.querySelectorAll('.tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  toolHint.textContent =
    tool === 'crop'
      ? (state.selectedId ? 'drag handles to crop · click outside to finish' : 'select a piece, then crop')
      : tool === 'adjust'
        ? 'drag image inside mask · scroll or image slider to zoom'
      : tool === 'mask'
        ? (state.selectedId ? 'drag a shape on the piece · release to mask' : 'select a piece, then mask')
        : isEdgeTool(tool)
          ? (state.selectedId ? `click an edge to apply ${tool} · click again to undo` : 'select a piece, then ' + tool)
          : 'click a thumbnail to add · drag corners or scroll to scale';
  // re-render the selected piece since cropping toggles its display
  if (state.selectedId && (prev === 'crop' || tool === 'crop')) {
    const p = state.pieces.find(p => p.id === state.selectedId);
    if (p) renderPiece(p);
  }
  renderOverlay();
}

function bringToFront(piece) {
  state.nextZ += 1;
  piece.z = state.nextZ;
  // re-append to move to top of SVG draw order
  const el = document.getElementById(piece.id);
  if (el) piecesG.appendChild(el);
  renderLayerPanel();
}

function snapshot() {
  return {
    pieces: JSON.parse(JSON.stringify(state.pieces)),
    nextZ: state.nextZ,
    nextId: state.nextId,
    selectedId: state.selectedId,
  };
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  updateUndoBtn();
}

function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  // wipe current DOM piece nodes
  for (const p of state.pieces) {
    document.getElementById(p.id)?.remove();
    document.getElementById(`clip-${p.id}`)?.remove();
  }
  state.pieces = prev.pieces;
  state.nextZ = prev.nextZ;
  state.nextId = prev.nextId;
  state.pieces.sort((a, b) => a.z - b.z);
  for (const p of state.pieces) renderPiece(p);
  state.selectedId = prev.selectedId && state.pieces.find(p => p.id === prev.selectedId) ? prev.selectedId : null;
  renderOverlay();
  syncPieceBar();
  renderLayerPanel();
  saveState();
  updateUndoBtn();
}

function updateUndoBtn() {
  const btn = document.getElementById('undo-btn');
  if (btn) btn.disabled = state.history.length === 0;
}

// ---------- pieces ----------
function addPieceFromImage(img, opts = {}) {
  pushHistory();
  const naturalRatio = (img.full && img.naturalRatio) || 1;
  const baseW = 280;
  const baseH = baseW / (naturalRatio || 1);
  // phyllotaxis spread: each new piece sits on a golden-angle spiral around canvas center
  const i = state.pieces.length;
  const angle = i * 137.508 * Math.PI / 180;
  const radius = Math.sqrt(i) * 75;
  const margin = 40;
  const spreadX = 700 + Math.cos(angle) * radius + (Math.random() - 0.5) * 30 - baseW / 2;
  const spreadY = 450 + Math.sin(angle) * radius + (Math.random() - 0.5) * 30 - baseH / 2;
  const placedX = Math.min(1400 - baseW - margin, Math.max(margin, spreadX));
  const placedY = Math.min(900 - baseH - margin, Math.max(margin, spreadY));
  const piece = {
    id: 'piece-' + (state.nextId++),
    src: img.full,
    thumb: img.thumb,
    sourceTag: img.source || 'arena',
    x: opts.x ?? placedX,
    y: opts.y ?? placedY,
    w: opts.w ?? baseW,
    h: opts.h ?? baseH,
    rot: opts.rot ?? (Math.random() - 0.5) * 6,
    z: ++state.nextZ,
    crop: null, // {x,y,w,h} in piece-local coords (0..1)
  };
  piece.opacity = opts.opacity ?? 1;
  piece.edges = opts.edges ?? { n: 'clean', e: 'clean', s: 'clean', w: 'clean' };
  piece.edgeIntensity = opts.edgeIntensity ?? 12;
  piece.seed = opts.seed ?? Math.floor(Math.random() * 0xFFFFFF);
  piece.imageX = opts.imageX ?? 0;
  piece.imageY = opts.imageY ?? 0;
  piece.imageScale = opts.imageScale ?? 1;
  state.pieces.push(piece);
  renderPiece(piece);
  selectPiece(piece.id);
  renderLayerPanel();
  saveState();
}

function renderPiece(piece) {
  let g = document.getElementById(piece.id);
  if (!g) {
    g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('id', piece.id);
    g.classList.add('piece', 'piece-shadow');
    g.dataset.id = piece.id;
    piecesG.appendChild(g);
  }
  g.style.display = piece.hidden ? 'none' : '';
  g.setAttribute('transform', `translate(${piece.x + piece.w / 2} ${piece.y + piece.h / 2}) rotate(${piece.rot}) translate(${-piece.w / 2} ${-piece.h / 2})`);

  const cropping = isCroppingPiece(piece);
  const hasLasso = !!piece.lassoPath;
  const needsClip = hasLasso || !!piece.crop || hasNonCleanEdge(piece);

  let clipId = `clip-${piece.id}`;
  let clipPath = document.getElementById(clipId);
  if (needsClip) {
    if (!clipPath) {
      clipPath = document.createElementNS(SVG_NS, 'clipPath');
      clipPath.setAttribute('id', clipId);
      surface.querySelector('defs').appendChild(clipPath);
    }
    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
    clipPath.innerHTML = '';
    if (hasLasso) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', piece.lassoPath);
      clipPath.appendChild(path);
    } else if (hasNonCleanEdge(piece)) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', buildEdgePath(piece));
      clipPath.appendChild(path);
    } else {
      const c = piece.crop;
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', c.x * piece.w);
      r.setAttribute('y', c.y * piece.h);
      r.setAttribute('width', c.w * piece.w);
      r.setAttribute('height', c.h * piece.h);
      clipPath.appendChild(r);
    }
  }

  let img = g.querySelector('image');
  if (!img) {
    img = document.createElementNS(SVG_NS, 'image');
    img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    img.setAttribute('crossorigin', 'anonymous');
    g.appendChild(img);
  }
  img.setAttribute('href', piece.src);
  img.setAttribute('width', piece.w);
  img.setAttribute('height', piece.h);
  const imageScale = piece.imageScale ?? 1;
  const imageX = piece.imageX ?? 0;
  const imageY = piece.imageY ?? 0;
  if (hasLasso) {
    img.setAttribute('transform', `translate(${imageX} ${imageY}) translate(${piece.w / 2} ${piece.h / 2}) scale(${imageScale}) translate(${-piece.w / 2} ${-piece.h / 2})`);
  } else {
    img.removeAttribute('transform');
  }
  if (needsClip && !cropping) img.setAttribute('clip-path', `url(#${clipId})`);
  else img.removeAttribute('clip-path');
  const baseOpacity = piece.opacity ?? 1;
  img.style.opacity = cropping ? Math.min(0.45, baseOpacity) : baseOpacity;
  // shadow only when not cropping (cleaner overlay)
  g.classList.toggle('piece-shadow', !cropping);

  // burnt overlays — separate group, after image, sharing the same clip
  let burntG = g.querySelector('.burnt-layer');
  const burntEdges = piece.edges
    ? ['n', 'e', 's', 'w'].filter(k => piece.edges[k] === 'burnt')
    : [];
  if (burntEdges.length === 0) {
    if (burntG) burntG.remove();
  } else {
    if (!burntG) {
      burntG = document.createElementNS(SVG_NS, 'g');
      burntG.classList.add('burnt-layer');
      g.appendChild(burntG);
    }
    burntG.innerHTML = '';
    if (needsClip && !cropping) burntG.setAttribute('clip-path', `url(#${clipId})`);
    else burntG.removeAttribute('clip-path');
    const c = piece.crop || { x: 0, y: 0, w: 1, h: 1 };
    const x0 = c.x * piece.w;
    const y0 = c.y * piece.h;
    const x1 = (c.x + c.w) * piece.w;
    const y1 = (c.y + c.h) * piece.h;
    const burnDepth = (piece.edgeIntensity ?? 12) * 2.5;
    for (const edge of burntEdges) {
      const r = document.createElementNS(SVG_NS, 'rect');
      if (edge === 'n') {
        r.setAttribute('x', x0); r.setAttribute('y', y0);
        r.setAttribute('width', x1 - x0); r.setAttribute('height', burnDepth);
      } else if (edge === 's') {
        r.setAttribute('x', x0); r.setAttribute('y', y1 - burnDepth);
        r.setAttribute('width', x1 - x0); r.setAttribute('height', burnDepth);
      } else if (edge === 'e') {
        r.setAttribute('x', x1 - burnDepth); r.setAttribute('y', y0);
        r.setAttribute('width', burnDepth); r.setAttribute('height', y1 - y0);
      } else {
        r.setAttribute('x', x0); r.setAttribute('y', y0);
        r.setAttribute('width', burnDepth); r.setAttribute('height', y1 - y0);
      }
      r.setAttribute('fill', `url(#burn-${edge})`);
      r.style.mixBlendMode = 'multiply';
      r.style.opacity = cropping ? '0' : '1';
      burntG.appendChild(r);
    }
  }
}

function isCroppingPiece(piece) {
  return state.tool === 'crop' && state.selectedId === piece.id;
}

function isEdgeTool(tool) {
  return tool === 'wavy' || tool === 'zigzag' || tool === 'tear' || tool === 'burnt';
}

function hasNonCleanEdge(piece) {
  const e = piece.edges;
  if (!e) return false;
  return e.n !== 'clean' || e.e !== 'clean' || e.s !== 'clean' || e.w !== 'clean';
}

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

function buildEdgePath(piece) {
  const c = piece.crop || { x: 0, y: 0, w: 1, h: 1 };
  const e = piece.edges || { n: 'clean', e: 'clean', s: 'clean', w: 'clean' };
  const amp = piece.edgeIntensity ?? 12;
  const x0 = c.x * piece.w;
  const y0 = c.y * piece.h;
  const x1 = (c.x + c.w) * piece.w;
  const y1 = (c.y + c.h) * piece.h;
  // one rng per piece — re-seeded each render so output is stable
  const rng = makeRng(piece.seed || 1);
  let d = `M ${x0} ${y0}`;
  d += edgeSegment(e.n, x0, y0, x1, y0, amp, rng);
  d += edgeSegment(e.e, x1, y0, x1, y1, amp, rng);
  d += edgeSegment(e.s, x1, y1, x0, y1, amp, rng);
  d += edgeSegment(e.w, x0, y1, x0, y0, amp, rng);
  d += ' Z';
  return d;
}

// amplitude envelope: full strength in the middle, taper to 0 in outer 15%
// so adjacent edges meet cleanly at corners regardless of style mix
function cornerTaper(i, n, frac = 0.15) {
  const t = (i - 0.5) / n;
  if (t < frac) return t / frac;
  if (t > 1 - frac) return (1 - t) / frac;
  return 1;
}

function edgeSegment(style, sx, sy, ex, ey, amp, rng) {
  if (style === 'clean') return ` L ${ex} ${ey}`;
  const len = Math.hypot(ex - sx, ey - sy);
  const isRough = style === 'tear' || style === 'burnt';
  const targetWavelen = style === 'zigzag' ? 22 : isRough ? 8 : 30;
  const n = Math.max(2, Math.round(len / targetWavelen));
  const ux = (ex - sx) / n;
  const uy = (ey - sy) / n;
  const norm = Math.hypot(ux, uy) || 1;
  const perpX = uy / norm;
  const perpY = -ux / norm;
  let path = '';
  let cx = sx, cy = sy;
  for (let i = 1; i <= n; i++) {
    const tx = sx + ux * i;
    const ty = sy + uy * i;
    const taper = cornerTaper(i, n);
    const a = amp * taper;
    if (style === 'wavy') {
      const sign = (i % 2 === 1) ? 1 : -1;
      const midX = (cx + tx) / 2 + perpX * a * sign;
      const midY = (cy + ty) / 2 + perpY * a * sign;
      path += ` Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)}`;
    } else if (style === 'zigzag') {
      const sign = (i % 2 === 1) ? 1 : -1;
      const midX = (cx + tx) / 2 + perpX * a * sign;
      const midY = (cy + ty) / 2 + perpY * a * sign;
      path += ` L ${midX.toFixed(2)} ${midY.toFixed(2)} L ${tx.toFixed(2)} ${ty.toFixed(2)}`;
    } else if (isRough) {
      // anchor end exactly at corner so adjacent edges meet
      if (i === n) {
        path += ` L ${tx.toFixed(2)} ${ty.toFixed(2)}`;
      } else {
        // random perpendicular jitter, biased slightly outward for tear
        const r = (rng() - (style === 'tear' ? 0.3 : 0.5)) * 2 * a;
        // small along-edge wobble for fibrous feel (no taper — keeps fibers consistent)
        const along = (rng() - 0.5) * 0.4 * amp;
        const px = tx + perpX * r + (ux / norm) * along;
        const py = ty + perpY * r + (uy / norm) * along;
        path += ` L ${px.toFixed(2)} ${py.toFixed(2)}`;
      }
    }
    cx = tx; cy = ty;
  }
  return path;
}

// ---------- layer panel ----------
function renderLayerPanel() {
  const list = document.getElementById('layer-list');
  const panel = document.getElementById('layer-panel');
  const showBtn = document.getElementById('layer-show-btn');
  if (!list || !panel) return;
  list.innerHTML = '';
  if (state.pieces.length === 0) {
    panel.hidden = true;
    showBtn.hidden = true;
    return;
  }
  if (panel.dataset.collapsed === '1') {
    panel.hidden = true;
    showBtn.hidden = false;
  } else {
    panel.hidden = false;
    showBtn.hidden = true;
  }
  const sorted = [...state.pieces].sort((a, b) => b.z - a.z);
  for (const piece of sorted) {
    const li = document.createElement('li');
    li.className = 'layer-row';
    if (piece.id === state.selectedId) li.classList.add('selected');
    if (piece.hidden) li.classList.add('hidden');
    li.dataset.id = piece.id;
    const thumb = document.createElement('div');
    thumb.className = 'layer-thumb';
    thumb.style.backgroundImage = `url("${piece.thumb || piece.src}")`;
    const meta = document.createElement('div');
    meta.className = 'layer-meta';
    meta.textContent = `${piece.sourceTag || 'piece'} · ${piece.id.replace('piece-', '#')}`;
    const eye = document.createElement('button');
    eye.className = 'layer-eye';
    eye.textContent = piece.hidden ? '○' : '●';
    eye.title = piece.hidden ? 'show' : 'hide';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePieceHidden(piece.id);
    });
    li.appendChild(thumb);
    li.appendChild(meta);
    li.appendChild(eye);
    li.addEventListener('pointerdown', (e) => onLayerRowPointerDown(e, piece.id));
    list.appendChild(li);
  }
}

function togglePieceHidden(id) {
  const piece = state.pieces.find(p => p.id === id);
  if (!piece) return;
  pushHistory();
  piece.hidden = !piece.hidden;
  const el = document.getElementById(piece.id);
  if (el) el.style.display = piece.hidden ? 'none' : '';
  if (piece.hidden && state.selectedId === id) {
    state.selectedId = null;
    renderOverlay();
    syncPieceBar();
  }
  renderLayerPanel();
  saveState();
}

let layerDrag = null;
function onLayerRowPointerDown(evt, id) {
  if (evt.target.classList.contains('layer-eye')) return;
  layerDrag = {
    id,
    startY: evt.clientY,
    startX: evt.clientX,
    moved: false,
    pointerId: evt.pointerId,
    captureEl: evt.currentTarget,
  };
  evt.currentTarget.setPointerCapture(evt.pointerId);
  evt.preventDefault();
}

document.addEventListener('pointermove', (evt) => {
  if (!layerDrag) return;
  const dy = evt.clientY - layerDrag.startY;
  const dx = evt.clientX - layerDrag.startX;
  if (!layerDrag.moved && Math.hypot(dx, dy) > 4) {
    layerDrag.moved = true;
    document.querySelector(`.layer-row[data-id="${layerDrag.id}"]`)?.classList.add('dragging');
  }
  if (layerDrag.moved) {
    const list = document.getElementById('layer-list');
    document.querySelectorAll('.layer-row').forEach(r => {
      r.classList.remove('drop-above', 'drop-below');
    });
    const rows = list.querySelectorAll('.layer-row:not(.dragging)');
    let targetRow = null; let above = true;
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      if (evt.clientY < rect.top + rect.height / 2) { targetRow = r; above = true; break; }
      targetRow = r; above = false;
    }
    if (targetRow) targetRow.classList.add(above ? 'drop-above' : 'drop-below');
  }
});

document.addEventListener('pointerup', () => {
  if (!layerDrag) return;
  const id = layerDrag.id;
  const moved = layerDrag.moved;
  try { layerDrag.captureEl?.releasePointerCapture(layerDrag.pointerId); } catch {}
  layerDrag = null;
  if (!moved) {
    const piece = state.pieces.find(p => p.id === id);
    if (piece && piece.hidden) togglePieceHidden(id);
    selectPiece(id);
    return;
  }
  document.querySelector(`.layer-row[data-id="${id}"]`)?.classList.remove('dragging');
  const before = document.querySelector('.layer-row.drop-above');
  const after = document.querySelector('.layer-row.drop-below');
  if (before) reorderLayer(id, before.dataset.id, 'above');
  else if (after) reorderLayer(id, after.dataset.id, 'below');
  document.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drop-above', 'drop-below'));
});

function reorderLayer(srcId, refId, position) {
  if (srcId === refId) return;
  pushHistory();
  const sorted = [...state.pieces].sort((a, b) => b.z - a.z);
  const src = sorted.find(p => p.id === srcId);
  if (!src) return;
  const filtered = sorted.filter(p => p.id !== srcId);
  const refIdx = filtered.findIndex(p => p.id === refId);
  if (refIdx === -1) return;
  const insertAt = position === 'above' ? refIdx : refIdx + 1;
  filtered.splice(insertAt, 0, src);
  filtered.forEach((p, i) => { p.z = filtered.length - i; });
  state.nextZ = Math.max(state.nextZ, filtered.length);
  // re-append SVG groups in z-asc order
  const inOrder = [...state.pieces].sort((a, b) => a.z - b.z);
  for (const p of inOrder) {
    const el = document.getElementById(p.id);
    if (el) piecesG.appendChild(el);
  }
  renderLayerPanel();
  saveState();
}

function duplicatePiece(id) {
  const orig = state.pieces.find(p => p.id === id);
  if (!orig) return;
  pushHistory();
  const piece = {
    ...orig,
    id: 'piece-' + (state.nextId++),
    x: orig.x + 30,
    y: orig.y + 30,
    z: ++state.nextZ,
    crop: orig.crop ? { ...orig.crop } : null,
    edges: orig.edges ? { ...orig.edges } : { n: 'clean', e: 'clean', s: 'clean', w: 'clean' },
    seed: Math.floor(Math.random() * 0xFFFFFF),
    imageX: orig.imageX ?? 0,
    imageY: orig.imageY ?? 0,
    imageScale: orig.imageScale ?? 1,
  };
  state.pieces.push(piece);
  renderPiece(piece);
  selectPiece(piece.id);
  renderLayerPanel();
  saveState();
}

function deletePiece(id) {
  const idx = state.pieces.findIndex(p => p.id === id);
  if (idx === -1) return;
  pushHistory();
  state.pieces.splice(idx, 1);
  document.getElementById(id)?.remove();
  document.getElementById(`clip-${id}`)?.remove();
  if (state.selectedId === id) state.selectedId = null;
  renderOverlay();
  renderLayerPanel();
  saveState();
}

// ---------- selection / crop overlay ----------
function renderOverlay() {
  overlayG.innerHTML = '';
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece) return;
  if (state.tool === 'adjust' && !piece.lassoPath) setTool('select');

  const cx = piece.x + piece.w / 2;
  const cy = piece.y + piece.h / 2;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', `translate(${cx} ${cy}) rotate(${piece.rot})`);
  overlayG.appendChild(g);

  if (isCroppingPiece(piece)) {
    renderCropHandles(g, piece);
  } else {
    renderSelectionHandles(g, piece);
    if (isEdgeTool(state.tool)) {
      renderEdgeRibbons(g, piece);
    }
    if (piece.lassoPath) {
      const maskOutlineG = document.createElementNS(SVG_NS, 'g');
      // lassoPath is in piece-local pixel coords (origin at top-left), but g is centered
      maskOutlineG.setAttribute('transform', `translate(${-piece.w / 2} ${-piece.h / 2})`);
      const outline = document.createElementNS(SVG_NS, 'path');
      outline.setAttribute('d', piece.lassoPath);
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', '#d62828');
      outline.setAttribute('stroke-width', '1.2');
      outline.setAttribute('stroke-dasharray', '5 3');
      outline.setAttribute('pointer-events', 'none');
      outline.setAttribute('opacity', '0.85');
      maskOutlineG.appendChild(outline);
      g.appendChild(maskOutlineG);
    }
  }
}

function renderEdgeRibbons(g, piece) {
  const c = piece.crop || { x: 0, y: 0, w: 1, h: 1 };
  // visible cropped rect in piece-local centered frame
  const left = -piece.w / 2 + c.x * piece.w;
  const top = -piece.h / 2 + c.y * piece.h;
  const right = left + c.w * piece.w;
  const bottom = top + c.h * piece.h;
  const thick = 14;
  const edges = [
    { name: 'n', x: left, y: top - thick / 2, w: right - left, h: thick },
    { name: 'e', x: right - thick / 2, y: top, w: thick, h: bottom - top },
    { name: 's', x: left, y: bottom - thick / 2, w: right - left, h: thick },
    { name: 'w', x: left - thick / 2, y: top, w: thick, h: bottom - top },
  ];
  for (const e of edges) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', e.x); r.setAttribute('y', e.y);
    r.setAttribute('width', e.w); r.setAttribute('height', e.h);
    r.classList.add('edge-ribbon');
    if (piece.edges && piece.edges[e.name] === state.tool) {
      r.classList.add('active');
    }
    r.dataset.edge = e.name;
    g.appendChild(r);
  }
}

function renderSelectionHandles(g, piece) {
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', -piece.w / 2);
  rect.setAttribute('y', -piece.h / 2);
  rect.setAttribute('width', piece.w);
  rect.setAttribute('height', piece.h);
  rect.classList.add('sel-rect');
  g.appendChild(rect);

  // 4 corner resize handles
  const corners = [
    { name: 'nw', x: -piece.w / 2, y: -piece.h / 2, cursor: 'nwse-resize' },
    { name: 'ne', x:  piece.w / 2, y: -piece.h / 2, cursor: 'nesw-resize' },
    { name: 'sw', x: -piece.w / 2, y:  piece.h / 2, cursor: 'nesw-resize' },
    { name: 'se', x:  piece.w / 2, y:  piece.h / 2, cursor: 'nwse-resize' },
  ];
  for (const c of corners) {
    const sq = document.createElementNS(SVG_NS, 'rect');
    sq.setAttribute('x', c.x - 4); sq.setAttribute('y', c.y - 4);
    sq.setAttribute('width', 8); sq.setAttribute('height', 8);
    sq.classList.add('sel-handle');
    sq.style.cursor = c.cursor;
    sq.dataset.resizeHandle = c.name;
    g.appendChild(sq);
    // wider hit target
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('x', c.x - 12); hit.setAttribute('y', c.y - 12);
    hit.setAttribute('width', 24); hit.setAttribute('height', 24);
    hit.setAttribute('fill', 'transparent');
    hit.style.cursor = c.cursor;
    hit.dataset.resizeHandle = c.name;
    g.appendChild(hit);
  }

  // rotate handle
  const rotR = 6;
  const rotY = -piece.h / 2 - 28;
  const stem = document.createElementNS(SVG_NS, 'line');
  stem.setAttribute('x1', 0); stem.setAttribute('y1', -piece.h / 2);
  stem.setAttribute('x2', 0); stem.setAttribute('y2', rotY + rotR);
  stem.setAttribute('stroke', '#2a2418'); stem.setAttribute('stroke-width', '1');
  g.appendChild(stem);

  const rotHandle = document.createElementNS(SVG_NS, 'circle');
  rotHandle.setAttribute('cx', 0); rotHandle.setAttribute('cy', rotY);
  rotHandle.setAttribute('r', rotR);
  rotHandle.classList.add('sel-handle', 'rotate');
  rotHandle.dataset.handle = 'rotate';
  g.appendChild(rotHandle);
}

function renderCropHandles(g, piece) {
  const crop = piece.crop || { x: 0, y: 0, w: 1, h: 1 };
  // crop rect in piece-local pixel coords (centered group)
  const x = -piece.w / 2 + crop.x * piece.w;
  const y = -piece.h / 2 + crop.y * piece.h;
  const w = crop.w * piece.w;
  const h = crop.h * piece.h;

  // dim mask: 4 rects covering the cropped-away regions
  const dimColor = 'rgba(244, 236, 219, 0.7)';
  const dims = [
    [-piece.w / 2, -piece.h / 2, piece.w, y - (-piece.h / 2)],          // top
    [-piece.w / 2, y + h, piece.w, (-piece.h / 2 + piece.h) - (y + h)], // bottom
    [-piece.w / 2, y, x - (-piece.w / 2), h],                             // left
    [x + w, y, (-piece.w / 2 + piece.w) - (x + w), h],                    // right
  ];
  for (const [dx, dy, dw, dh] of dims) {
    if (dw <= 0 || dh <= 0) continue;
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', dx); r.setAttribute('y', dy);
    r.setAttribute('width', dw); r.setAttribute('height', dh);
    r.setAttribute('fill', dimColor);
    r.setAttribute('pointer-events', 'none');
    g.appendChild(r);
  }

  // bright crop frame
  const frame = document.createElementNS(SVG_NS, 'rect');
  frame.setAttribute('x', x); frame.setAttribute('y', y);
  frame.setAttribute('width', w); frame.setAttribute('height', h);
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', '#2a2418');
  frame.setAttribute('stroke-width', '1.5');
  frame.setAttribute('pointer-events', 'none');
  g.appendChild(frame);

  // rule-of-thirds guides
  for (let i = 1; i < 3; i++) {
    const v = document.createElementNS(SVG_NS, 'line');
    v.setAttribute('x1', x + (w * i) / 3); v.setAttribute('y1', y);
    v.setAttribute('x2', x + (w * i) / 3); v.setAttribute('y2', y + h);
    v.setAttribute('stroke', '#2a2418'); v.setAttribute('stroke-width', '0.4'); v.setAttribute('opacity', '0.5');
    v.setAttribute('pointer-events', 'none');
    g.appendChild(v);
    const hl = document.createElementNS(SVG_NS, 'line');
    hl.setAttribute('x1', x); hl.setAttribute('y1', y + (h * i) / 3);
    hl.setAttribute('x2', x + w); hl.setAttribute('y2', y + (h * i) / 3);
    hl.setAttribute('stroke', '#2a2418'); hl.setAttribute('stroke-width', '0.4'); hl.setAttribute('opacity', '0.5');
    hl.setAttribute('pointer-events', 'none');
    g.appendChild(hl);
  }

  // 8 handles: 4 corners + 4 edges
  const handles = [
    { name: 'nw', x: x,         y: y,         cursor: 'nwse-resize' },
    { name: 'n',  x: x + w / 2, y: y,         cursor: 'ns-resize' },
    { name: 'ne', x: x + w,     y: y,         cursor: 'nesw-resize' },
    { name: 'e',  x: x + w,     y: y + h / 2, cursor: 'ew-resize' },
    { name: 'se', x: x + w,     y: y + h,     cursor: 'nwse-resize' },
    { name: 's',  x: x + w / 2, y: y + h,     cursor: 'ns-resize' },
    { name: 'sw', x: x,         y: y + h,     cursor: 'nesw-resize' },
    { name: 'w',  x: x,         y: y + h / 2, cursor: 'ew-resize' },
  ];
  for (const h of handles) {
    // bracket-style on corners (iPhone), bar on edges
    const isCorner = h.name.length === 2;
    if (isCorner) {
      const len = 14;
      const xs = h.name.includes('w') ? 1 : -1;
      const ys = h.name.includes('n') ? 1 : -1;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${h.x} ${h.y + ys * len} L ${h.x} ${h.y} L ${h.x + xs * len} ${h.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#2a2418');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'square');
      path.style.cursor = h.cursor;
      path.dataset.cropHandle = h.name;
      g.appendChild(path);
    } else {
      const bar = document.createElementNS(SVG_NS, 'rect');
      const len = 22;
      if (h.name === 'n' || h.name === 's') {
        bar.setAttribute('x', h.x - len / 2); bar.setAttribute('y', h.y - 1.5);
        bar.setAttribute('width', len); bar.setAttribute('height', 3);
      } else {
        bar.setAttribute('x', h.x - 1.5); bar.setAttribute('y', h.y - len / 2);
        bar.setAttribute('width', 3); bar.setAttribute('height', len);
      }
      bar.setAttribute('fill', '#2a2418');
      bar.style.cursor = h.cursor;
      bar.dataset.cropHandle = h.name;
      g.appendChild(bar);
    }
    // invisible hit target
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('x', h.x - 12); hit.setAttribute('y', h.y - 12);
    hit.setAttribute('width', 24); hit.setAttribute('height', 24);
    hit.setAttribute('fill', 'transparent');
    hit.style.cursor = h.cursor;
    hit.dataset.cropHandle = h.name;
    g.appendChild(hit);
  }
}

// ---------- pointer interactions ----------
let drag = null;

surface.addEventListener('pointerdown', (evt) => {
  const pt = svgPoint(evt);
  const edgeRibbonEl = evt.target.closest('[data-edge]');
  const cropHandleEl = evt.target.closest('[data-crop-handle]');
  const resizeHandleEl = evt.target.closest('[data-resize-handle]');
  const handleEl = evt.target.closest('[data-handle]');
  const pieceEl = evt.target.closest('.piece');

  if (edgeRibbonEl && state.selectedId && isEdgeTool(state.tool)) {
    const piece = state.pieces.find(p => p.id === state.selectedId);
    const edge = edgeRibbonEl.dataset.edge;
    pushHistory();
    if (!piece.edges) piece.edges = { n: 'clean', e: 'clean', s: 'clean', w: 'clean' };
    piece.edges[edge] = (piece.edges[edge] === state.tool) ? 'clean' : state.tool;
    renderPiece(piece);
    renderOverlay();
    syncPieceBar();
    saveState();
    evt.stopPropagation();
    return;
  }

  if (state.tool === 'mask' && state.selectedId && pieceEl?.dataset.id === state.selectedId) {
    const piece = state.pieces.find(p => p.id === state.selectedId);
    pushHistory();
    const local = worldToPiecePixels(pt, piece);
    drag = { kind: 'lasso', piece, points: [local] };
    surface.setPointerCapture(evt.pointerId);
    return;
  }

  if (state.tool === 'adjust' && state.selectedId && pieceEl?.dataset.id === state.selectedId) {
    const piece = state.pieces.find(p => p.id === state.selectedId);
    if (!piece?.lassoPath) return;
    pushHistory();
    drag = {
      kind: 'adjust-image',
      piece,
      startX: pt.x,
      startY: pt.y,
      imageX: piece.imageX ?? 0,
      imageY: piece.imageY ?? 0,
    };
    surface.setPointerCapture(evt.pointerId);
    return;
  }

  if (cropHandleEl && state.selectedId) {
    const piece = state.pieces.find(p => p.id === state.selectedId);
    pushHistory();
    drag = {
      kind: 'crop-handle',
      piece,
      handle: cropHandleEl.dataset.cropHandle,
      startCrop: { ...(piece.crop || { x: 0, y: 0, w: 1, h: 1 }) },
    };
    surface.setPointerCapture(evt.pointerId);
    return;
  }

  if (resizeHandleEl && state.selectedId) {
    const piece = state.pieces.find(p => p.id === state.selectedId);
    pushHistory();
    const handle = resizeHandleEl.dataset.resizeHandle;
    // anchor = opposite corner in piece-local centered frame
    const sx = handle.includes('w') ? 1 : -1;  // anchor on east side if dragging west
    const sy = handle.includes('n') ? 1 : -1;
    const localAnchor = { x: sx * piece.w / 2, y: sy * piece.h / 2 };
    const center = { x: piece.x + piece.w / 2, y: piece.y + piece.h / 2 };
    const cosR = Math.cos(piece.rot * Math.PI / 180);
    const sinR = Math.sin(piece.rot * Math.PI / 180);
    const worldAnchor = {
      x: center.x + cosR * localAnchor.x - sinR * localAnchor.y,
      y: center.y + sinR * localAnchor.x + cosR * localAnchor.y,
    };
    drag = {
      kind: 'resize', piece, handle, worldAnchor,
      baseW: piece.w, baseH: piece.h, baseAspect: piece.w / piece.h,
    };
    surface.setPointerCapture(evt.pointerId);
    return;
  }

  if (handleEl?.dataset.handle === 'rotate' && state.selectedId) {
    const piece = state.pieces.find(p => p.id === state.selectedId);
    pushHistory();
    drag = {
      kind: 'rotate', piece,
      startAngle: Math.atan2(pt.y - (piece.y + piece.h / 2), pt.x - (piece.x + piece.w / 2)),
      startRot: piece.rot,
    };
    surface.setPointerCapture(evt.pointerId);
    return;
  }

  if (pieceEl) {
    const id = pieceEl.dataset.id;
    const piece = state.pieces.find(p => p.id === id);
    if (state.selectedId !== id) {
      selectPiece(id);
      bringToFront(piece);
    }
    // dragging the image while in crop mode = no-op (image stays put)
    if (state.tool === 'crop') return;
    pushHistory();
    drag = { kind: 'move', piece, ox: pt.x - piece.x, oy: pt.y - piece.y };
    pieceEl.classList.add('dragging');
    surface.setPointerCapture(evt.pointerId);
    return;
  }

  // click on empty surface — exit crop mode if active, else deselect
  if (state.tool === 'crop') {
    setTool('select');
    return;
  }
  if (state.selectedId) selectPiece(null);
});

surface.addEventListener('pointermove', (evt) => {
  if (!drag) return;
  const pt = svgPoint(evt);
  if (drag.kind === 'move') {
    drag.piece.x = pt.x - drag.ox;
    drag.piece.y = pt.y - drag.oy;
    renderPiece(drag.piece);
    renderOverlay();
  } else if (drag.kind === 'rotate') {
    const a = Math.atan2(pt.y - (drag.piece.y + drag.piece.h / 2), pt.x - (drag.piece.x + drag.piece.w / 2));
    const delta = (a - drag.startAngle) * (180 / Math.PI);
    drag.piece.rot = drag.startRot + delta;
    renderPiece(drag.piece);
    renderOverlay();
  } else if (drag.kind === 'resize') {
    // pointer in anchor-frame (origin at worldAnchor, rotated by piece.rot)
    const dx = pt.x - drag.worldAnchor.x;
    const dy = pt.y - drag.worldAnchor.y;
    const cosR = Math.cos(-drag.piece.rot * Math.PI / 180);
    const sinR = Math.sin(-drag.piece.rot * Math.PI / 180);
    let lx = cosR * dx - sinR * dy;
    let ly = sinR * dx + cosR * dy;
    // flip sign based on which corner is being dragged (anchor is opposite)
    const sx = drag.handle.includes('w') ? -1 : 1; // dragging west = lx negative direction
    const sy = drag.handle.includes('n') ? -1 : 1;
    let newW = Math.max(40, lx * sx);
    let newH = Math.max(40, ly * sy);
    // uniform scale: preserve original aspect ratio
    const scale = Math.max(newW / drag.baseW, newH / drag.baseH);
    newW = drag.baseW * scale;
    newH = drag.baseH * scale;
    // recompute piece.x, piece.y so worldAnchor stays put
    const localAnchorX = sx * -1 * newW / 2;  // opposite of dragged corner
    const localAnchorY = sy * -1 * newH / 2;
    const cosF = Math.cos(drag.piece.rot * Math.PI / 180);
    const sinF = Math.sin(drag.piece.rot * Math.PI / 180);
    const offX = cosF * localAnchorX - sinF * localAnchorY;
    const offY = sinF * localAnchorX + cosF * localAnchorY;
    const newCenter = { x: drag.worldAnchor.x - offX, y: drag.worldAnchor.y - offY };
    drag.piece.w = newW;
    drag.piece.h = newH;
    drag.piece.x = newCenter.x - newW / 2;
    drag.piece.y = newCenter.y - newH / 2;
    renderPiece(drag.piece);
    renderOverlay();
  } else if (drag.kind === 'lasso') {
    const local = worldToPiecePixels(pt, drag.piece);
    const last = drag.points[drag.points.length - 1];
    // skip points too close to last (cheap simplification)
    if (Math.hypot(local.x - last.x, local.y - last.y) > 3) {
      drag.points.push(local);
      renderLassoPreview(drag);
    }
  } else if (drag.kind === 'adjust-image') {
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    const rad = -drag.piece.rot * Math.PI / 180;
    drag.piece.imageX = drag.imageX + dx * Math.cos(rad) - dy * Math.sin(rad);
    drag.piece.imageY = drag.imageY + dx * Math.sin(rad) + dy * Math.cos(rad);
    renderPiece(drag.piece);
    renderOverlay();
  } else if (drag.kind === 'crop-handle') {
    const local = worldToPieceLocal(pt, drag.piece);
    const lx = clamp(local.x, 0, 1);
    const ly = clamp(local.y, 0, 1);
    const c = { ...drag.startCrop };
    const minSize = 0.06;
    const right = c.x + c.w;
    const bottom = c.y + c.h;
    const h = drag.handle;
    if (h.includes('w')) { c.x = Math.min(lx, right - minSize); c.w = right - c.x; }
    if (h.includes('e')) { c.w = Math.max(lx - c.x, minSize); }
    if (h.includes('n')) { c.y = Math.min(ly, bottom - minSize); c.h = bottom - c.y; }
    if (h.includes('s')) { c.h = Math.max(ly - c.y, minSize); }
    drag.piece.crop = c;
    renderOverlay();
  }
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

surface.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.kind === 'crop-handle') {
    renderPiece(drag.piece);
    renderOverlay();
    saveState();
  } else if (drag.kind === 'resize') {
    saveState();
  } else if (drag.kind === 'lasso') {
    if (drag.points.length >= 3) {
      drag.piece.lassoPath = pointsToPath(drag.points);
      drag.piece.imageX = drag.piece.imageX ?? 0;
      drag.piece.imageY = drag.piece.imageY ?? 0;
      drag.piece.imageScale = drag.piece.imageScale ?? 1;
      renderPiece(drag.piece);
      renderOverlay();
      syncPieceBar();
      saveState();
    }
    setTool('select');
  } else if (drag.kind === 'adjust-image') {
    syncPieceBar();
    saveState();
  } else {
    document.getElementById(drag.piece.id)?.classList.remove('dragging');
    saveState();
  }
  drag = null;
});

function renderLassoPreview(d) {
  overlayG.innerHTML = '';
  const piece = d.piece;
  const cx = piece.x + piece.w / 2;
  const cy = piece.y + piece.h / 2;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', `translate(${cx} ${cy}) rotate(${piece.rot}) translate(${-piece.w / 2} ${-piece.h / 2})`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pointsToPath(d.points, false));
  path.setAttribute('fill', 'rgba(214, 40, 40, 0.20)');
  path.setAttribute('stroke', '#d62828');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-dasharray', '5 3');
  path.setAttribute('pointer-events', 'none');
  g.appendChild(path);
  overlayG.appendChild(g);
}

function pointsToPath(points, close = true) {
  if (points.length === 0) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
  }
  if (close) d += ' Z';
  return d;
}

// scroll wheel to scale selected piece (uniform)
surface.addEventListener('wheel', (evt) => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece) return;
  evt.preventDefault();
  const factor = Math.exp(-evt.deltaY * 0.0015);
  if (state.tool === 'adjust' && piece.lassoPath) {
    piece.imageScale = clamp((piece.imageScale ?? 1) * factor, 0.5, 3);
    renderPiece(piece);
    syncPieceBar();
    scheduleSave();
    return;
  }
  const newW = Math.max(40, piece.w * factor);
  const newH = piece.h * (newW / piece.w);
  // scale around piece center (no anchor shift)
  const cx = piece.x + piece.w / 2;
  const cy = piece.y + piece.h / 2;
  piece.w = newW;
  piece.h = newH;
  piece.x = cx - newW / 2;
  piece.y = cy - newH / 2;
  renderPiece(piece);
  renderOverlay();
  scheduleSave();
}, { passive: false });

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveState(); saveTimer = null; }, 300);
}

// rotated-piece-local coords in 0..1 (for crop on piece's local box)
function worldToPieceLocal(pt, piece) {
  const px = worldToPiecePixels(pt, piece);
  return { x: px.x / piece.w, y: px.y / piece.h };
}

// rotated-piece-local in raw pixels (0..w by 0..h)
function worldToPiecePixels(pt, piece) {
  const cx = piece.x + piece.w / 2;
  const cy = piece.y + piece.h / 2;
  const rad = -piece.rot * Math.PI / 180;
  const dx = pt.x - cx;
  const dy = pt.y - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + piece.w / 2;
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + piece.h / 2;
  return { x: lx, y: ly };
}

// keyboard
window.addEventListener('keydown', (evt) => {
  if (evt.target.tagName === 'INPUT') return;
  if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'z' && !evt.shiftKey) {
    undo();
    evt.preventDefault();
    return;
  }
  if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'd' && state.selectedId) {
    duplicatePiece(state.selectedId);
    evt.preventDefault();
    return;
  }
  if ((evt.key === 'Delete' || evt.key === 'Backspace') && state.selectedId) {
    deletePiece(state.selectedId);
    evt.preventDefault();
  }
  if (evt.key === 'Escape') {
    state.cropDraft = null;
    selectPiece(null);
    setTool('select');
  }
});

// ---------- thumbnails ----------
async function loadSource(name, reset = true) {
  const cfg = SOURCES[name];
  if (!cfg) return;
  const bucket = state.sourceData[name];
  if (reset) {
    bucket.images = [];
    bucket.page = 1;
    if (state.source === name) thumbGrid.innerHTML = '<div class="thumb-loading">loading…</div>';
  }
  try {
    const imgs = await cfg.loader(bucket.page);
    bucket.images.push(...imgs);
    if (state.source === name) renderThumbnails();
  } catch (e) {
    if (state.source === name) {
      thumbGrid.innerHTML = `<div class="thumb-loading">${cfg.label} fetch failed</div>`;
    }
    console.error(e);
  }
}

function renderThumbnails() {
  thumbGrid.innerHTML = '';
  const images = state.sourceData[state.source].images;
  let visibleCount = images.length;
  for (const img of images) {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.title = img.title;
    const im = document.createElement('img');
    im.loading = 'lazy';
    im.alt = img.title || '';
    im.onerror = () => {
      el.remove();
      visibleCount -= 1;
      if (visibleCount === 0) {
        thumbGrid.innerHTML = '<div class="thumb-loading">no live images found here</div>';
      }
    };
    im.src = img.thumb;
    el.appendChild(im);
    el.addEventListener('click', () => {
      // measure natural ratio
      const probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => {
        addPieceFromImage({ ...img, naturalRatio: probe.naturalWidth / probe.naturalHeight });
      };
      probe.onerror = () => {
        el.remove();
        visibleCount -= 1;
      };
      probe.src = img.full;
    });
    thumbGrid.appendChild(el);
  }
}

async function setSource(name) {
  if (!SOURCES[name] || state.source === name) return;
  state.source = name;
  try { localStorage.setItem(SOURCE_KEY, name); } catch {}
  document.querySelectorAll('.src-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.src === name);
  });
  document.getElementById('src-name').textContent = SOURCES[name].label;
  const bucket = state.sourceData[name];
  if (bucket.images.length === 0) {
    await loadSource(name, true);
  } else {
    renderThumbnails();
  }
}

document.querySelectorAll('.src-tab').forEach(btn => {
  if (btn.disabled) return;
  btn.addEventListener('click', () => setSource(btn.dataset.src));
});

moreBtn.addEventListener('click', async () => {
  state.sourceData[state.source].page += 1;
  await loadSource(state.source, false);
});

// ---------- tool buttons ----------
document.querySelectorAll('.tool').forEach(btn => {
  if (btn.disabled) return;
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

// ---------- persistence ----------
function saveState() {
  const data = {
    pieces: state.pieces.map(p => ({
      id: p.id, src: p.src, thumb: p.thumb, sourceTag: p.sourceTag,
      x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, z: p.z,
      crop: p.crop, opacity: p.opacity ?? 1,
      edges: p.edges || { n: 'clean', e: 'clean', s: 'clean', w: 'clean' },
      edgeIntensity: p.edgeIntensity ?? 12,
      seed: p.seed ?? 1,
      lassoPath: p.lassoPath || null,
      imageX: p.imageX ?? 0,
      imageY: p.imageY ?? 0,
      imageScale: p.imageScale ?? 1,
      hidden: !!p.hidden,
    })),
    nextZ: state.nextZ,
    nextId: state.nextId,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.pieces = (data.pieces || []).map(p => ({
      ...p,
      opacity: p.opacity ?? 1,
      edges: p.edges || { n: 'clean', e: 'clean', s: 'clean', w: 'clean' },
      edgeIntensity: p.edgeIntensity ?? 12,
      seed: p.seed ?? Math.floor(Math.random() * 0xFFFFFF),
      imageX: p.imageX ?? 0,
      imageY: p.imageY ?? 0,
      imageScale: p.imageScale ?? 1,
      hidden: !!p.hidden,
    }));
    state.nextZ = data.nextZ || 1;
    state.nextId = data.nextId || (state.pieces.length + 1);
    // sort by z so order matches
    state.pieces.sort((a, b) => a.z - b.z);
    for (const p of state.pieces) renderPiece(p);
    renderLayerPanel();
  } catch (e) { console.warn('load failed', e); }
}

clearBtn.addEventListener('click', () => {
  if (!state.pieces.length) return;
  if (!confirm('clear all pieces?')) return;
  pushHistory();
  // bypass per-piece pushHistory to avoid 1 entry per piece
  for (const p of state.pieces.slice()) {
    document.getElementById(p.id)?.remove();
    document.getElementById(`clip-${p.id}`)?.remove();
  }
  state.pieces = [];
  state.selectedId = null;
  renderOverlay();
  syncPieceBar();
  renderLayerPanel();
  saveState();
});

// ---------- export ----------
exportBtn.addEventListener('click', exportPNG);
exportSvgBtn.addEventListener('click', exportSVG);

async function buildExportSVG() {
  selectPiece(null); // hide overlay
    const svgClone = surface.cloneNode(true);
    // strip overlay group
    svgClone.querySelector('#overlay')?.replaceChildren();
    // inline images
    const images = svgClone.querySelectorAll('image');
    for (const im of images) {
      const href = im.getAttribute('href') || im.getAttribute('xlink:href');
      const dataUrl = await urlToDataUrl(href);
      im.setAttribute('href', dataUrl);
      im.removeAttribute('xlink:href');
    }
  return new XMLSerializer().serializeToString(svgClone);
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportName(ext) {
  return `collage-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
}

async function exportSVG() {
  exportSvgBtn.textContent = 'exporting…';
  exportSvgBtn.disabled = true;
  try {
    const xml = await buildExportSVG();
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, exportName('svg'));
    exportSvgBtn.textContent = 'export svg';
    exportSvgBtn.disabled = false;
  } catch (e) {
    console.error(e);
    exportSvgBtn.textContent = 'export failed';
    exportSvgBtn.disabled = false;
    setTimeout(() => exportSvgBtn.textContent = 'export svg', 1500);
  }
}

async function exportPNG() {
  exportBtn.textContent = 'exporting…';
  exportBtn.disabled = true;
  try {
    const xml = await buildExportSVG();
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1400; canvas.height = 900;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f4ecdb';
      ctx.fillRect(0, 0, 1400, 900);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((png) => {
        downloadBlob(png, exportName('png'));
      }, 'image/png');
      URL.revokeObjectURL(url);
      exportBtn.textContent = 'export png';
      exportBtn.disabled = false;
    };
    img.onerror = () => {
      exportBtn.textContent = 'export failed';
      exportBtn.disabled = false;
      setTimeout(() => exportBtn.textContent = 'export png', 1500);
    };
    img.src = url;
  } catch (e) {
    console.error(e);
    exportBtn.textContent = 'export failed';
    exportBtn.disabled = false;
    setTimeout(() => exportBtn.textContent = 'export png', 1500);
  }
}

async function urlToDataUrl(url) {
  const res = await fetch(url, { mode: 'cors' });
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ---------- opacity slider ----------
const opacitySlider = document.getElementById('opacity-slider');
const opacityReadout = document.getElementById('opacity-readout');
opacitySlider.addEventListener('pointerdown', () => { if (state.selectedId) pushHistory(); });
opacitySlider.addEventListener('input', () => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece) return;
  const v = Math.max(0.05, Number(opacitySlider.value) / 100);
  piece.opacity = v;
  opacityReadout.textContent = Math.round(v * 100) + '%';
  renderPiece(piece);
  scheduleSave();
});
opacitySlider.addEventListener('change', () => saveState());

const edgeSlider = document.getElementById('edge-slider');
const edgeReadout = document.getElementById('edge-readout');
edgeSlider.addEventListener('pointerdown', () => { if (state.selectedId) pushHistory(); });
edgeSlider.addEventListener('input', () => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece) return;
  const v = Number(edgeSlider.value);
  piece.edgeIntensity = v;
  edgeReadout.textContent = v + 'px';
  renderPiece(piece);
  scheduleSave();
});
edgeSlider.addEventListener('change', () => saveState());

const imageZoomSlider = document.getElementById('image-zoom-slider');
const imageZoomReadout = document.getElementById('image-zoom-readout');
imageZoomSlider.addEventListener('pointerdown', () => { if (state.selectedId) pushHistory(); });
imageZoomSlider.addEventListener('input', () => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece?.lassoPath) return;
  const v = clamp(Number(imageZoomSlider.value) / 100, 0.5, 3);
  piece.imageScale = v;
  imageZoomReadout.textContent = Math.round(v * 100) + '%';
  renderPiece(piece);
  scheduleSave();
});
imageZoomSlider.addEventListener('change', () => saveState());

document.getElementById('adjust-image-btn').addEventListener('click', () => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece?.lassoPath) return;
  setTool(state.tool === 'adjust' ? 'select' : 'adjust');
  syncPieceBar();
});

document.getElementById('fit-image-btn').addEventListener('click', () => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece?.lassoPath) return;
  pushHistory();
  piece.imageX = 0;
  piece.imageY = 0;
  piece.imageScale = 1;
  renderPiece(piece);
  renderOverlay();
  syncPieceBar();
  saveState();
});

document.getElementById('reset-edges-btn').addEventListener('click', () => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece) return;
  pushHistory();
  piece.edges = { n: 'clean', e: 'clean', s: 'clean', w: 'clean' };
  renderPiece(piece);
  renderOverlay();
  syncPieceBar();
  saveState();
});

document.getElementById('remove-mask-btn').addEventListener('click', () => {
  if (!state.selectedId) return;
  const piece = state.pieces.find(p => p.id === state.selectedId);
  if (!piece) return;
  pushHistory();
  piece.lassoPath = null;
  piece.imageX = 0;
  piece.imageY = 0;
  piece.imageScale = 1;
  if (state.tool === 'adjust') setTool('select');
  renderPiece(piece);
  renderOverlay();
  syncPieceBar();
  saveState();
});

// ---------- undo ----------
document.getElementById('undo-btn').addEventListener('click', undo);

// ---------- layer panel toggle ----------
document.getElementById('layer-toggle').addEventListener('click', () => {
  const panel = document.getElementById('layer-panel');
  panel.dataset.collapsed = '1';
  renderLayerPanel();
});
document.getElementById('layer-show-btn').addEventListener('click', () => {
  const panel = document.getElementById('layer-panel');
  delete panel.dataset.collapsed;
  renderLayerPanel();
});

// ---------- boot ----------
setTool('select');
loadState();
syncPieceBar();
updateUndoBtn();
const onboarded = (() => { try { return localStorage.getItem(GUIDE_KEY); } catch { return null; } })();
if (!onboarded) showGuide();
const savedSource = (() => {
  try { return localStorage.getItem(SOURCE_KEY); } catch { return null; }
})();
const initialSource = SOURCES[savedSource] ? savedSource : 'arena';
state.source = initialSource;
document.querySelectorAll('.src-tab').forEach(b => {
  b.classList.toggle('active', b.dataset.src === initialSource);
});
document.getElementById('src-name').textContent = SOURCES[initialSource].label;
loadSource(initialSource, true);

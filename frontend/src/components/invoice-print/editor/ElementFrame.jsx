import { useCallback, useEffect, useRef, useState } from 'react';
import { clampFrameToZone, getElementLabel, TABLE_STYLE_ELEMENT_ID } from './templateSchemaAdapter';

const PX_PER_MM = 3.7795275591;
const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const RESIZE_HANDLE_STYLES = {
  nw: { left: '-5px', top: '-5px', cursor: 'nw-resize' },
  n: { left: '50%', top: '-5px', transform: 'translateX(-50%)', cursor: 'n-resize' },
  ne: { right: '-5px', top: '-5px', cursor: 'ne-resize' },
  e: { right: '-5px', top: '50%', transform: 'translateY(-50%)', cursor: 'e-resize' },
  se: { right: '-5px', bottom: '-5px', cursor: 'se-resize' },
  s: { left: '50%', bottom: '-5px', transform: 'translateX(-50%)', cursor: 's-resize' },
  sw: { left: '-5px', bottom: '-5px', cursor: 'sw-resize' },
  w: { left: '-5px', top: '50%', transform: 'translateY(-50%)', cursor: 'w-resize' },
};
const ALIGN_SNAP_TOLERANCE_MM = 1.1;

function frameToPx(frame = {}, zoom = 1) {
  return {
    x: (Number(frame.x) || 0) * PX_PER_MM * zoom,
    y: (Number(frame.y) || 0) * PX_PER_MM * zoom,
    w: Math.max(1, (Number(frame.w) || 1) * PX_PER_MM * zoom),
    h: Math.max(1, (Number(frame.h) || 1) * PX_PER_MM * zoom),
  };
}

function pxToMm(value, zoom = 1) {
  return Number(value) / Math.max(0.01, PX_PER_MM * zoom);
}

function roundMm(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function roundToGrid(value, grid = 1, enabled = true) {
  if (!enabled) return roundMm(value);
  const step = Math.max(0.1, Number(grid) || 1);
  return roundMm(Math.round((Number(value) || 0) / step) * step);
}

function buildResizeFrame(startFrame, deltaMm, handle) {
  const next = { ...startFrame };
  const dx = deltaMm.x;
  const dy = deltaMm.y;
  if (handle.includes('e')) next.w = Number(startFrame.w) + dx;
  if (handle.includes('s')) next.h = Number(startFrame.h) + dy;
  if (handle.includes('w')) {
    next.x = Number(startFrame.x) + dx;
    next.w = Number(startFrame.w) - dx;
  }
  if (handle.includes('n')) {
    next.y = Number(startFrame.y) + dy;
    next.h = Number(startFrame.h) - dy;
  }
  return next;
}

function findNearestSnap(value, points = [], toleranceMm = ALIGN_SNAP_TOLERANCE_MM) {
  let best = null;
  for (const point of points) {
    const target = Number(point);
    if (!Number.isFinite(target)) continue;
    const distance = Math.abs(target - value);
    if (distance <= toleranceMm && (!best || distance < best.distance)) {
      best = { target, distance };
    }
  }
  return best;
}

function getAxisCandidates(frame = {}, axis = 'x', mode = 'move', handle = '') {
  const posKey = axis === 'x' ? 'x' : 'y';
  const sizeKey = axis === 'x' ? 'w' : 'h';
  const start = Number(frame[posKey]) || 0;
  const size = Math.max(0, Number(frame[sizeKey]) || 0);
  const end = start + size;
  const center = start + size / 2;

  if (mode === 'move') {
    return [
      { edge: 'start', value: start },
      { edge: 'center', value: center },
      { edge: 'end', value: end },
    ];
  }

  const handlesStart = axis === 'x' ? handle.includes('w') : handle.includes('n');
  const handlesEnd = axis === 'x' ? handle.includes('e') : handle.includes('s');
  const candidates = [];
  if (handlesStart) candidates.push({ edge: 'start', value: start });
  if (handlesEnd) candidates.push({ edge: 'end', value: end });
  return candidates;
}

function applyAxisSnap(frame = {}, axis = 'x', points = [], mode = 'move', handle = '') {
  const posKey = axis === 'x' ? 'x' : 'y';
  const sizeKey = axis === 'x' ? 'w' : 'h';
  const candidates = getAxisCandidates(frame, axis, mode, handle);
  let selected = null;

  for (const candidate of candidates) {
    const match = findNearestSnap(candidate.value, points);
    if (match && (!selected || match.distance < selected.match.distance)) {
      selected = { candidate, match };
    }
  }

  if (!selected) return { frame, guide: null };

  const next = { ...frame };
  const start = Number(frame[posKey]) || 0;
  const size = Math.max(0, Number(frame[sizeKey]) || 0);
  const end = start + size;
  const target = selected.match.target;

  if (mode === 'move') {
    if (selected.candidate.edge === 'start') next[posKey] = target;
    if (selected.candidate.edge === 'center') next[posKey] = target - size / 2;
    if (selected.candidate.edge === 'end') next[posKey] = target - size;
  } else if (selected.candidate.edge === 'start') {
    next[posKey] = target;
    next[sizeKey] = end - target;
  } else if (selected.candidate.edge === 'end') {
    next[sizeKey] = target - start;
  }

  next[posKey] = roundMm(next[posKey]);
  next[sizeKey] = roundMm(next[sizeKey]);
  return { frame: next, guide: target };
}

function applyAlignmentSnap(frame = {}, gesture = {}) {
  const targets = gesture.snapTargets || {};
  if (!gesture.snap || !targets.enabled) return { frame, guides: { x: [], y: [] } };

  const xResult = applyAxisSnap(frame, 'x', targets.x || [], gesture.mode, gesture.handle);
  const yResult = applyAxisSnap(xResult.frame, 'y', targets.y || [], gesture.mode, gesture.handle);
  return {
    frame: yResult.frame,
    guides: {
      x: xResult.guide !== null ? [xResult.guide] : [],
      y: yResult.guide !== null ? [yResult.guide] : [],
    },
  };
}

export default function ElementFrame({
  element,
  zone,
  zoom = 1,
  selected = false,
  snapEnabled = true,
  snapGridMm = 1,
  snapTargets = null,
  readOnly = false,
  children,
  onSelect,
  onFrameChange,
  onGuideChange,
  onGestureStart,
  onGestureEnd,
}) {
  const gestureRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const framePx = frameToPx(element.frame, zoom);
  const selectable = element.id !== TABLE_STYLE_ELEMENT_ID;
  const locked = readOnly || element.locked || !selectable;

  const finishGesture = useCallback(() => {
    if (gestureRef.current) onGestureEnd?.();
    gestureRef.current = null;
    setDragging(false);
    onGuideChange?.({ x: [], y: [] });
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [onGestureEnd, onGuideChange]);

  const handlePointerMove = useCallback((event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    event.preventDefault();
    const dxMm = pxToMm(event.clientX - gesture.startX, gesture.zoom);
    const dyMm = pxToMm(event.clientY - gesture.startY, gesture.zoom);
    let nextFrame;
    if (gesture.mode === 'move') {
      nextFrame = {
        ...gesture.startFrame,
        x: roundToGrid(Number(gesture.startFrame.x) + dxMm, gesture.grid, gesture.snap),
        y: roundToGrid(Number(gesture.startFrame.y) + dyMm, gesture.grid, gesture.snap),
      };
    } else {
      const resized = buildResizeFrame(gesture.startFrame, { x: dxMm, y: dyMm }, gesture.handle);
      nextFrame = {
        ...resized,
        x: roundToGrid(resized.x, gesture.grid, gesture.snap),
        y: roundToGrid(resized.y, gesture.grid, gesture.snap),
        w: roundToGrid(resized.w, gesture.grid, gesture.snap),
        h: roundToGrid(resized.h, gesture.grid, gesture.snap),
      };
    }

    const snapped = applyAlignmentSnap(nextFrame, gesture);
    const clamped = clampFrameToZone(snapped.frame, gesture.zone, { minW: element.type === 'line' ? 2 : 3, minH: element.type === 'line' ? 0.5 : 3 });
    onGuideChange?.(snapped.guides);
    onFrameChange?.(clamped);
  }, [element.type, onFrameChange, onGuideChange]);

  const handlePointerUp = useCallback((event) => {
    event.preventDefault();
    finishGesture();
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  }, [finishGesture, handlePointerMove]);

  const startGesture = useCallback((event, mode, handle = '') => {
    if (locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(element.id);
    onGestureStart?.();
    gestureRef.current = {
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startFrame: { ...element.frame },
      zone,
      zoom,
      snap: snapEnabled,
      grid: snapGridMm,
      snapTargets,
    };
    setDragging(true);
    document.body.style.cursor = mode === 'move' ? 'grabbing' : `${handle}-resize`;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp, { passive: false });
    window.addEventListener('pointercancel', handlePointerUp, { passive: false });
  }, [element.frame, element.id, handlePointerMove, handlePointerUp, locked, onGestureStart, onSelect, snapEnabled, snapGridMm, snapTargets, zone, zoom]);

  useEffect(() => () => finishGesture(), [finishGesture]);

  return (
    <div
      className={`invoice-editor-element-frame ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${locked ? 'is-locked' : ''}`}
      style={{
        left: `${framePx.x}px`,
        top: `${framePx.y}px`,
        width: `${framePx.w}px`,
        height: `${framePx.h}px`,
        zIndex: Number(element.zIndex) || 0,
      }}
      title={getElementLabel(element)}
      onPointerDown={(event) => startGesture(event, 'move')}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(element.id);
      }}
    >
      <div className="invoice-editor-element-content">
        {children}
      </div>
      {selected && selectable && !readOnly && (
        <>
          <div className="invoice-editor-element-label">{getElementLabel(element)}</div>
          {RESIZE_HANDLES.map(handle => (
            <span
              key={handle}
              className={`invoice-editor-resize-handle invoice-editor-resize-${handle}`}
              style={RESIZE_HANDLE_STYLES[handle]}
              onPointerDown={(event) => startGesture(event, 'resize', handle)}
              aria-hidden="true"
            />
          ))}
        </>
      )}
    </div>
  );
}

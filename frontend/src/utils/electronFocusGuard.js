const FORM_CONTROL_SELECTOR = [
  'input:not([disabled]):not([readonly])',
  'textarea:not([disabled]):not([readonly])',
  'select:not([disabled])',
  '[contenteditable="true"]',
].join(',');

let installed = false;
let lastEnsureAt = 0;
let lastEnsureKey = '';
let pendingElectronFocusFrame = 0;
let pendingElectronFocusRequest = null;

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getElectronFocusApi() {
  if (!isBrowser()) return null;
  return window.khaDesktop?.window?.ensureInputFocus || null;
}

function getElementFromTarget(target) {
  if (!target) return null;
  if (target.nodeType === Node.TEXT_NODE) return target.parentElement || null;
  return target instanceof Element ? target : null;
}

function getFocusableControl(target) {
  const element = getElementFromTarget(target);
  if (!element) return null;
  if (element.matches?.(FORM_CONTROL_SELECTOR)) return element;
  return element.closest?.(FORM_CONTROL_SELECTOR) || null;
}

function describeControl(control) {
  if (!control) return {};
  const className = typeof control.className === 'string' ? control.className : '';
  return {
    tagName: control.tagName || '',
    type: control.getAttribute?.('type') || '',
    name: control.getAttribute?.('name') || '',
    id: control.id || '',
    placeholder: control.getAttribute?.('placeholder') || '',
    ariaLabel: control.getAttribute?.('aria-label') || '',
    className: className.slice(0, 160),
  };
}

function runElectronInputFocusRequest(request) {
  const ensureInputFocus = getElectronFocusApi();
  if (typeof ensureInputFocus !== 'function') return;

  Promise.resolve(ensureInputFocus(request)).catch(() => {
    // Focus guard must never break typing in renderer.
  });
}

function requestElectronInputFocus(control, reason, options = {}) {
  if (!control) return;
  if (typeof getElectronFocusApi() !== 'function') return;

  const now = Date.now();
  const descriptor = describeControl(control);
  const key = `${reason}:${descriptor.tagName}:${descriptor.type}:${descriptor.id}:${descriptor.name}:${descriptor.placeholder}`;
  if (key === lastEnsureKey && now - lastEnsureAt < 180) return;
  lastEnsureKey = key;
  lastEnsureAt = now;

  const request = { reason, control: descriptor };
  if (options.immediate) {
    runElectronInputFocusRequest(request);
    return;
  }

  pendingElectronFocusRequest = request;
  if (pendingElectronFocusFrame) return;

  const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 16));
  pendingElectronFocusFrame = schedule(() => {
    pendingElectronFocusFrame = 0;
    const nextRequest = pendingElectronFocusRequest;
    pendingElectronFocusRequest = null;
    if (nextRequest) runElectronInputFocusRequest(nextRequest);
  });
}

function requestControlFocus(control, options = {}) {
  if (!control || typeof control.focus !== 'function') return false;

  requestElectronInputFocus(control, options.reason || 'renderer:request-control-focus', {
    immediate: options.immediateElectronFocus === true,
  });

  const focus = () => {
    if (!control.isConnected || document.activeElement === control) return;
    try {
      control.focus({ preventScroll: true });
    } catch (_) {
      control.focus();
    }
  };

  const delay = Number(options.delayMs || 0);
  if (delay > 0) window.setTimeout(focus, delay);
  else focus();

  if (document.activeElement !== control) {
    window.requestAnimationFrame(() => {
      if (!control.isConnected || document.activeElement === control) return;
      focus();
    });
  }

  return true;
}

export function ensureFocusableElement(target, options = {}) {
  if (!isBrowser()) return false;
  const control = getFocusableControl(target);
  if (!control || typeof control.focus !== 'function') return false;

  return requestControlFocus(control, {
    reason: options.reason || 'renderer:ensure-focusable-element',
    immediateElectronFocus: options.immediateElectronFocus === true,
    delayMs: options.delayMs || 0,
  });
}

export function installElectronInputFocusGuard() {
  if (!isBrowser() || installed || !window.khaDesktop?.isElectron) return () => {};
  installed = true;

  const handleFocusIn = (event) => {
    const control = getFocusableControl(event.target);
    // Native focus has already succeeded. Only recover the Electron window when
    // the renderer is genuinely inactive; forcing focus per click breaks caret
    // placement and queues needless IPC calls while typing.
    if (control && document.activeElement === control && !document.hasFocus()) {
      requestElectronInputFocus(control, 'renderer:recover-window-focus');
    }
  };

  document.addEventListener('focusin', handleFocusIn, true);

  return () => {
    document.removeEventListener('focusin', handleFocusIn, true);
    installed = false;
  };
}

function getDesktopPrintApi() {
  try {
    return window?.khaDesktop?.print || null;
  } catch (_) {
    return null;
  }
}

function normalizePrinter(printer = {}) {
  const name = String(printer?.name || '').trim();
  const displayName = String(printer?.displayName || printer?.description || name).trim() || name;
  return {
    name: name || displayName,
    displayName: displayName || name,
    description: String(printer?.description || '').trim(),
    isDefault: Boolean(printer?.isDefault),
    status: Number(printer?.status) || 0,
  };
}

function fallbackPrinters(fallback = []) {
  return (Array.isArray(fallback) ? fallback : [])
    .map((printer) => {
      if (printer && typeof printer === 'object') return normalizePrinter(printer);
      const name = String(printer || '').trim();
      return name ? normalizePrinter({ name, displayName: name }) : null;
    })
    .filter(Boolean);
}

export function isSilentPrintSupported() {
  const api = getDesktopPrintApi();
  return Boolean(api && typeof api.printHtml === 'function');
}

export async function getAvailablePrinters(fallback = []) {
  const api = getDesktopPrintApi();
  if (!api || typeof api.listPrinters !== 'function') return fallbackPrinters(fallback);

  try {
    const printers = await api.listPrinters();
    const normalized = (Array.isArray(printers) ? printers : []).map(normalizePrinter).filter(printer => printer.name);
    if (normalized.length > 0) return normalized;
  } catch (_) {
    // Fallback to static printer names in browser mode or when IPC is unavailable.
  }

  return fallbackPrinters(fallback);
}

export async function printHtmlSilently({
  documentHtml = '',
  jobTitle = '',
  printerName = '',
  copies = 1,
  layout = 'portrait',
  margins = 'default',
  printBackground = true,
  showHeadersFooters = false,
  pageMode = 'all',
  paperSize = '',
  widthMm = 0,
  heightMm = 0,
} = {}) {
  const api = getDesktopPrintApi();
  if (!api || typeof api.printHtml !== 'function') {
    const error = new Error('Trình duyệt web tiêu chuẩn không cho phép bỏ hộp thoại in hệ thống. In trực tiếp chỉ khả dụng trong ứng dụng Electron desktop.');
    error.code = 'SILENT_PRINT_UNAVAILABLE';
    throw error;
  }

  return api.printHtml({
    html: String(documentHtml || ''),
    jobTitle: String(jobTitle || '').trim(),
    deviceName: String(printerName || '').trim(),
    copies: Number(copies) || 1,
    layout: String(layout || 'portrait').trim() || 'portrait',
    margins: String(margins || 'default').trim() || 'default',
    printBackground: printBackground !== false,
    showHeadersFooters: Boolean(showHeadersFooters),
    pageMode: String(pageMode || 'all').trim() || 'all',
    paperSize: String(paperSize || '').trim(),
    widthMm: Number(widthMm) || 0,
    heightMm: Number(heightMm) || 0,
  });
}

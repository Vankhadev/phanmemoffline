import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ArrowLeft, Download, Loader, Printer, RefreshCw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import InvoiceTemplateRenderer, { buildInvoicePageStyle } from '../components/invoice-print/InvoiceTemplateRenderer';
import { getPaperDimensions, normalizeTemplateSettings } from '../components/invoice-print/templateDefaults';
import { getApiErrorMessage, invoicesApi, PRINT_TEMPLATE_UPDATED_EVENT, printTemplatesApi } from '../utils/apiClient';

const PRINT_SETTINGS_KEY = 'kha.invoicePrint.settings';
const PAPER_OPTIONS = ['K80', 'K57', 'A5', 'A4'];
const PRINTER_MODE_OPTIONS = [
  { value: 'office', label: 'M?y in A4/A5' },
  { value: 'thermal', label: 'M?y in nhi?t' },
];
const SCALE_PRESETS = [0.8, 0.9, 0.95, 1];
const MIN_SCALE = 0.5;
const MAX_SCALE = 1;
const SCALE_STEP = 0.05;

function clamp(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(max, Math.max(min, numericValue));
}

function normalizeScale(value) {
  return Math.round(clamp(value, MIN_SCALE, MAX_SCALE) * 100) / 100;
}

function normalizePaperSize(value) {
  const requested = String(value || 'A5').toUpperCase();
  if (requested === 'K58') return 'K57';
  return PAPER_OPTIONS.includes(requested) ? requested : 'A5';
}

function readPrintSettings() {
  const fallback = { scale: 0.95, paperSize: 'A5', paperSizeOverride: false, orientation: 'portrait', orientationOverride: false };
  if (typeof window === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRINT_SETTINGS_KEY) || '{}');
    const paperSize = normalizePaperSize(parsed.paperSize || parsed.paper_size || 'A5');
    return {
      scale: normalizeScale(parsed.scale ?? 0.95),
      paperSize,
      paperSizeOverride: parsed.paperSizeOverride === true,
      orientation: paperSize.startsWith('K') ? 'portrait' : (parsed.orientation === 'landscape' ? 'landscape' : 'portrait'),
      orientationOverride: parsed.orientationOverride === true,
    };
  } catch (_error) {
    return fallback;
  }
}

function readInitialPrintSettings(searchParams) {
  const stored = readPrintSettings();
  if (!searchParams || typeof searchParams.get !== 'function') return stored;
  const paperParam = searchParams.get('paper') || searchParams.get('paper_size') || searchParams.get('paperSize');
  const scaleParam = searchParams.get('scale');
  const orientationParam = searchParams.get('orientation');
  const paperSize = paperParam ? normalizePaperSize(paperParam) : stored.paperSize;
  const orientation = paperSize.startsWith('K')
    ? 'portrait'
    : (orientationParam === 'landscape' || orientationParam === 'portrait' ? orientationParam : stored.orientation);

  return {
    ...stored,
    paperSize,
    paperSizeOverride: stored.paperSizeOverride || Boolean(paperParam),
    scale: scaleParam ? normalizeScale(Number(scaleParam)) : stored.scale,
    orientation,
    orientationOverride: stored.orientationOverride || Boolean(orientationParam),
  };
}

function writePrintSettings(settings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_error) {
    // B? qua n?u tr?nh duy?t kh?a localStorage.
  }
}

function sanitizeFileName(value) {
  return String(value || 'hoa-don')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'hoa-don';
}

function getErrorMessage(error, fallback) {
  return getApiErrorMessage(error?.data || error, error?.message || fallback);
}

function isPrintTemplateApiError(error) {
  const data = error?.data || error || {};
  const signature = [
    data.code,
    data.error_code,
    data.message,
    data.error,
    data.detail,
    typeof data.details === 'string' ? data.details : data.details?.message,
    error?.message,
  ].filter(Boolean).join(' ');
  return /PRINT_TEMPLATE|print[_\s-]*template|mẫu in|template_id/i.test(signature);
}

function getBackendTemplate(data) {
  return data?.template || data?.print_template || data?.printTemplate || null;
}

function normalizeApiItem(data) {
  if (!data) return null;
  if (data.item && typeof data.item === 'object' && !Array.isArray(data.item)) return data.item;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    if (data.data.item && typeof data.data.item === 'object' && !Array.isArray(data.data.item)) return data.data.item;
    if (data.data.template && typeof data.data.template === 'object' && !Array.isArray(data.data.template)) return data.data.template;
    if (data.data.id || data.data.template_name || data.data.editor_document || data.data.layout_json) return data.data;
  }
  if (data.template && typeof data.template === 'object' && !Array.isArray(data.template)) return data.template;
  if (data.id || data.template_name || data.editor_document || data.layout_json) return data;
  return null;
}

function buildFallbackTemplate(settings) {
  const paperSize = normalizePaperSize(settings.paperSize || 'A5');
  const orientation = paperSize.startsWith('K') ? 'portrait' : (settings.orientation || 'portrait');
  return {
    id: null,
    template_name: `M?u ${paperSize} mặc định`,
    paper_size: paperSize,
    orientation,
    settings_json: {
      schema_version: 1,
      paperSize,
      orientation,
      scale: settings.scale || 0.95,
      previewZoom: 1,
      showLogo: false,
      showQr: false,
      showSignature: true,
      showNote: true,
      showDebt: true,
      fontSize: 8.6,
      lineSpacing: 1.22,
      paddingMm: 5,
      marginMm: 0,
      tableWidthPercent: 100,
      tableBorder: true,
      tableBorderWidthMm: 0.22,
    },
  };
}

function buildRendererSettingsOverride(settings, hasBackendTemplate) {
  const paperSize = normalizePaperSize(settings.paperSize || 'A5');
  const orientation = paperSize.startsWith('K') ? 'portrait' : (settings.orientation === 'landscape' ? 'landscape' : 'portrait');
  return {
    scale: settings.scale,
    previewZoom: 1,
    showQr: false,
    paperSize,
    paper_size: paperSize,
    orientation,
    source: hasBackendTemplate ? 'print-page-user-override' : 'print-page-fallback',
  };
}

export default function InvoicePrint() {
  const navigate = useNavigate();
  const { idOrCode = '' } = useParams();
  const [searchParams] = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const templateId = searchParams.get('template_id') || searchParams.get('templateId') || '';
  const documentMode = (searchParams.get('mode') || searchParams.get('type')) === 'estimate' ? 'estimate' : 'invoice';
  const documentLabel = documentMode === 'estimate' ? 'Tạm t?nh' : 'Hóa don';
  const documentTitle = documentMode === 'estimate' ? 'PHI?U T?M T?NH' : 'H?A ?ON B?N H?NG';
  const printRef = useRef(null);
  const autoPrintedRef = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [printError, setPrintError] = useState('');
  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState(() => readInitialPrintSettings(searchParams));
  const [printerMode, setPrinterMode] = useState(() => readInitialPrintSettings(searchParams).paperSize.startsWith('K') ? 'thermal' : 'office');

  const invoiceCode = data?.invoice?.invoice_code || idOrCode || 'hoa-don';
  const backendTemplate = getBackendTemplate(data);
  const hasBackendTemplate = Boolean(backendTemplate);
  const activeTemplate = backendTemplate || buildFallbackTemplate(settings);
  const settingsOverride = useMemo(
    () => buildRendererSettingsOverride(settings, hasBackendTemplate),
    [hasBackendTemplate, settings],
  );
  const templateSettings = useMemo(
    () => normalizeTemplateSettings({
      ...activeTemplate,
      settings_json: {
        ...(activeTemplate?.settings_json || activeTemplate?.settings || {}),
        ...settingsOverride,
      },
      paper_size: activeTemplate?.paper_size,
      orientation: settingsOverride.orientation || activeTemplate?.orientation,
    }),
    [activeTemplate, settingsOverride],
  );
  const page = getPaperDimensions(templateSettings.paperSize, templateSettings.orientation);
  const scalePercent = Math.round(settings.scale * 100);
  const printableData = useMemo(() => {
    if (!data) return data;
    if (documentMode !== 'estimate') return data;
    return {
      ...data,
      invoice: {
        ...(data.invoice || {}),
        document_title: documentTitle,
        print_mode: documentMode,
      },
      metadata: {
        ...(data.metadata || {}),
        document_title: documentTitle,
        print_mode: documentMode,
      },
    };
  }, [data, documentMode, documentTitle]);

  useEffect(() => {
    writePrintSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadInvoice = useCallback(async () => {
    if (!idOrCode) {
      setError('Thi?u m? ho?c ID hóa đơn.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setPrintError('');
    try {
      let payload;
      try {
        payload = await invoicesApi.printData(idOrCode, templateId ? { template_id: templateId } : {});
      } catch (printDataErr) {
        if (!templateId || !isPrintTemplateApiError(printDataErr)) throw printDataErr;
        payload = await invoicesApi.printData(idOrCode, {});
        setToast({
          tone: 'warning',
          message: `${getErrorMessage(printDataErr, 'Template được chọn không kh? d?ng.')} ?? t?i hóa đơn b?ng m?u mặc định d? tiếp tục preview/in.`,
        });
      }

      if (!payload || typeof payload !== 'object' || !payload.invoice) {
        setData(null);
        setError('API dữ liệu in hóa đơn tr? v? thi?u thông tin hóa đơn.');
        return;
      }

      let nextPayload = payload;
      const templateError = payload.metadata?.print_template_error;
      if (templateError?.message) {
        setToast({ tone: 'warning', message: getApiErrorMessage(templateError, 'API mẫu in trở lại; frontend dang d?ng m?u an to?n d? preview/in.') });
      }

      if (!getBackendTemplate(payload)) {
        try {
          const templateData = await printTemplatesApi.current(templateId ? { template_id: templateId } : {});
          const templateItem = normalizeApiItem(templateData);
          if (templateItem) {
            nextPayload = {
              ...payload,
              template: templateItem,
              metadata: {
                ...(payload.metadata || {}),
                print_template: {
                  id: templateItem.id || null,
                  code: templateItem.code || '',
                  revision: templateItem.revision || null,
                  source: 'print-templates-api',
                },
              },
            };
          }
        } catch (templateErr) {
          if (templateId) {
            try {
              const defaultTemplateData = await printTemplatesApi.current({});
              const templateItem = normalizeApiItem(defaultTemplateData);
              if (templateItem) {
                nextPayload = {
                  ...payload,
                  template: templateItem,
                  metadata: {
                    ...(payload.metadata || {}),
                    print_template: {
                      id: templateItem.id || null,
                      code: templateItem.code || '',
                      revision: templateItem.revision || null,
                      source: 'print-templates-api-default-after-template-error',
                    },
                  },
                };
              }
            } catch (_defaultTemplateErr) {
              // Gi? fallback frontend b?n du?i n?u API m?u mặc định cung lỗi.
            }
          }
          setToast({ tone: 'warning', message: getErrorMessage(templateErr, 'Chua tải được mẫu in t? API /api/print-templates; dang d?ng m?u mặc định frontend d? preview/in.') });
        }
      }

      setData(nextPayload);
    } catch (err) {
      setData(null);
      const message = getErrorMessage(err, 'Không thử lại dữ liệu hóa đơn.');
      setError(message);
      setToast({ tone: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [idOrCode, templateId]);

  useEffect(() => {
    autoPrintedRef.current = false;
    loadInvoice();
  }, [loadInvoice]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleTemplateUpdated = (event) => {
      const changedTemplateId = event?.detail?.templateId;
      if (templateId && changedTemplateId && String(changedTemplateId) !== String(templateId)) return;
      setToast({ tone: 'success', message: 'Mẫu in v?a được cập nhật. Preview dang tải lại dữ liệu mới.' });
      loadInvoice();
    };
    window.addEventListener(PRINT_TEMPLATE_UPDATED_EVENT, handleTemplateUpdated);
    return () => window.removeEventListener(PRINT_TEMPLATE_UPDATED_EVENT, handleTemplateUpdated);
  }, [loadInvoice, templateId]);

  const pageStyle = useMemo(
    () => buildInvoicePageStyle(activeTemplate, settingsOverride),
    [activeTemplate, settingsOverride],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const styleId = 'invoice-print-dynamic-page-style';
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      styleElement.setAttribute('data-owner', 'invoice-print');
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = pageStyle;
    return undefined;
  }, [pageStyle]);

  const handlePrintInvoice = useCallback(() => {
    if (!data || typeof window === 'undefined' || !printRef.current) return;
    setPrintError('');
    try {
      const previousTitle = typeof document !== 'undefined' ? document.title : '';
      if (typeof document !== 'undefined') {
        document.title = `${documentMode === 'estimate' ? 'Tam_tinh' : 'Hoa_don'}_${sanitizeFileName(invoiceCode)}`;
      }
      const openPrintDialog = () => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.setTimeout(() => {
              window.print();
              window.setTimeout(() => {
                if (typeof document !== 'undefined' && previousTitle) document.title = previousTitle;
              }, 800);
            }, 80);
          });
        });
      };
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(openPrintDialog, openPrintDialog);
      } else {
        openPrintDialog();
      }
    } catch (err) {
      setPrintError(err?.message || 'Không th? m? h?p tho?i in của h? di?u h?nh.');
    }
  }, [data, documentMode, invoiceCode]);

  useEffect(() => {
    if (!autoPrint || !data || loading || autoPrintedRef.current) return undefined;
    autoPrintedRef.current = true;
    const timer = window.setTimeout(() => handlePrintInvoice(), 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint, data, handlePrintInvoice, loading]);

  const setScale = useCallback((nextScale) => {
    setSettings(prev => ({ ...prev, scale: normalizeScale(nextScale) }));
  }, []);

  const adjustScale = useCallback((delta) => {
    setSettings(prev => ({ ...prev, scale: normalizeScale(prev.scale + delta) }));
  }, []);

  const resetScale = useCallback(() => {
    setSettings(prev => ({ ...prev, scale: 0.95 }));
  }, []);

  const setPaperSize = useCallback((nextPaperSize) => {
    const paperSize = normalizePaperSize(nextPaperSize);
    setPrinterMode(paperSize.startsWith('K') ? 'thermal' : 'office');
    setSettings(prev => {
      return {
        ...prev,
        paperSize,
        paperSizeOverride: true,
        orientation: paperSize.startsWith('K') ? 'portrait' : prev.orientation,
      };
    });
  }, []);

  const handlePrinterModeChange = useCallback((nextMode) => {
    const mode = nextMode === 'thermal' ? 'thermal' : 'office';
    setPrinterMode(mode);
    setSettings(prev => {
      const currentPaperSize = normalizePaperSize(prev.paperSize);
      const paperSize = mode === 'thermal'
        ? (currentPaperSize.startsWith('K') ? currentPaperSize : 'K80')
        : (currentPaperSize.startsWith('K') ? 'A5' : currentPaperSize);
      return {
        ...prev,
        paperSize,
        paperSizeOverride: true,
        orientation: paperSize.startsWith('K') ? 'portrait' : prev.orientation,
      };
    });
  }, []);

  const toggleOrientation = useCallback(() => {
    setSettings(prev => {
      const paperSize = normalizePaperSize(prev.paperSize);
      if (paperSize.startsWith('K')) return { ...prev, orientation: 'portrait', orientationOverride: false };
      return { ...prev, orientation: prev.orientation === 'landscape' ? 'portrait' : 'landscape', orientationOverride: true };
    });
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    const element = printRef.current;
    if (!element || !data) return;

    setPdfLoading(true);
    setPrintError('');
    try {
      const elementRect = element.getBoundingClientRect();
      const captureScale = Math.max(3, Math.min(4, window.devicePixelRatio || 3));
      const captureWidth = Math.ceil(elementRect.width);
      const captureHeight = Math.ceil(elementRect.height);
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: captureScale,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: captureWidth,
        height: captureHeight,
        windowWidth: captureWidth,
        windowHeight: captureHeight,
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDocument) => {
          const clonedInvoice = clonedDocument.querySelector('.invoice-print');
          const clonedInner = clonedDocument.querySelector('.invoice-print-inner');
          if (clonedInvoice) {
            clonedInvoice.classList.add('invoice-pdf-capture');
            clonedInvoice.style.width = `${page.width}mm`;
            clonedInvoice.style.minHeight = `${page.height}mm`;
            clonedInvoice.style.height = `${page.height}mm`;
            clonedInvoice.style.border = '0';
            clonedInvoice.style.borderRadius = '0';
            clonedInvoice.style.boxShadow = 'none';
            clonedInvoice.style.margin = '0';
            clonedInvoice.style.overflow = 'hidden';
            clonedInvoice.style.background = '#ffffff';
          }
          if (clonedInner) {
            clonedInner.style.transformOrigin = 'top center';
            clonedInner.style.background = '#ffffff';
          }
        },
      });

      const pdf = new jsPDF({ orientation: page.orientation, unit: 'mm', format: [page.width, page.height], compress: true, putOnlyUsedFonts: true });
      try {
        pdf.setLanguage?.('vi-VN');
      } catch (_languageError) {
        // jsPDF cu c? th? không h? tr? setLanguage; n?i dung ti?ng Vi?t v?n được raster ?n d?nh t? DOM.
      }
      const imgData = canvas.toDataURL('image/png', 1);
      pdf.addImage(imgData, 'PNG', 0, 0, page.width, page.height, undefined, 'FAST');
      pdf.save(`${documentMode === 'estimate' ? 'Tam_tinh' : 'Hoa_don'}_${sanitizeFileName(invoiceCode)}.pdf`);
    } catch (err) {
      setPrintError(err?.message || 'Không thử lại PDF hóa đơn.');
    } finally {
      setPdfLoading(false);
    }
  }, [data, documentMode, invoiceCode, page.height, page.orientation, page.width]);

  return (
    <div className="invoice-print-page">
      <div className="invoice-print-toolbar no-print">
        <div className="invoice-toolbar-left">
          <button type="button" onClick={() => navigate(-1)} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            <ArrowLeft size={16} /> Quay lỗi
          </button>
          <div>
            <h1>In {documentLabel.toLowerCase()} {page.paperSize}</h1>
            <p>
              {invoiceCode ? `M?/ID: ${invoiceCode}` : 'Preview g?i dữ liệu th?t t? API backend'}
              {hasBackendTemplate ? ` ? M?u: ${activeTemplate.template_name || activeTemplate.name || activeTemplate.id}` : ` ? Mặc định ${page.paperSize}`}
            </p>
          </div>
        </div>

        <div className="invoice-toolbar-actions">
          <label className="invoice-control-group invoice-control-wide">
            <span>Ki?u m?y</span>
            <select value={printerMode} onChange={event => handlePrinterModeChange(event.target.value)}>
              {PRINTER_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="invoice-control-group">
            <span>Kh? gi?y</span>
            <select value={page.paperSize} onChange={event => setPaperSize(event.target.value)}>
              {PAPER_OPTIONS.map(paperSize => <option key={paperSize} value={paperSize}>{paperSize}</option>)}
            </select>
          </label>
          <label className="invoice-control-group">
            <span>Scale n?i dung</span>
            <select
              value={SCALE_PRESETS.includes(settings.scale) ? String(settings.scale) : 'custom'}
              onChange={event => {
                if (event.target.value !== 'custom') setScale(Number(event.target.value));
              }}
            >
              {SCALE_PRESETS.map(scale => (
                <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>
              ))}
              <option value="custom">T?y ch?nh</option>
            </select>
          </label>
          <label className="invoice-control-group invoice-control-number">
            <span>%</span>
            <input
              type="number"
              min={Math.round(MIN_SCALE * 100)}
              max={Math.round(MAX_SCALE * 100)}
              step="5"
              value={scalePercent}
              onChange={event => setScale(Number(event.target.value) / 100)}
            />
          </label>
          <button type="button" onClick={() => adjustScale(-SCALE_STEP)} className="invoice-toolbar-btn invoice-toolbar-btn-light" title="Thu nh?">
            <ZoomOut size={16} /> Thu nh?
          </button>
          <button type="button" onClick={() => adjustScale(SCALE_STEP)} className="invoice-toolbar-btn invoice-toolbar-btn-light" title="Ph?ng to">
            <ZoomIn size={16} /> Ph?ng to
          </button>
          <button type="button" onClick={resetScale} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            Reset 95%
          </button>
          <button type="button" onClick={toggleOrientation} className="invoice-toolbar-btn invoice-toolbar-btn-light" disabled={page.paperSize.startsWith('K')}>
            <RotateCw size={16} /> {page.paperSize.startsWith('K') ? 'Cu?n d?c' : (page.orientation === 'landscape' ? 'Kh? ngang' : 'Kh? d?c')}
          </button>
          <button type="button" onClick={loadInvoice} disabled={loading} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Tải lỗi
          </button>
          <button type="button" onClick={handleDownloadPdf} disabled={!data || pdfLoading} className="invoice-toolbar-btn invoice-toolbar-btn-secondary">
            {pdfLoading ? <Loader size={16} className="animate-spin" /> : <Download size={16} />} Tải PDF
          </button>
          <button type="button" onClick={handlePrintInvoice} disabled={!data} className="invoice-toolbar-btn invoice-toolbar-btn-primary">
            <Printer size={16} /> In
          </button>
        </div>
      </div>

      {toast?.message && (
        <div className="toast-stack no-print">
          <div className={`toast-card ${toast.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : toast.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {toast.tone === 'success' ? '?' : '??'} {toast.message}
          </div>
        </div>
      )}

      {printError && <div className="invoice-alert no-print">{printError}</div>}

      {loading ? (
        <div className="invoice-state-card no-print">
          <Loader size={28} className="animate-spin text-blue-500" />
          <div>
            <b>đang t?i dữ liệu hóa đơn...</b>
            <p>Preview ch? hiển thị sau khi API backend tr? dữ liệu th?t.</p>
          </div>
        </div>
      ) : error ? (
        <div className="invoice-state-card no-print invoice-state-error">
          <b>Không th? m? hóa đơn</b>
          <p>{error}</p>
          <button type="button" onClick={loadInvoice} className="invoice-toolbar-btn invoice-toolbar-btn-primary">
            <RefreshCw size={16} /> Th? lỗi
          </button>
        </div>
      ) : (
        <main className="invoice-preview-shell">
          <div className="invoice-print-preview-frame">
            <InvoiceTemplateRenderer
              ref={printRef}
              payload={printableData}
              template={activeTemplate}
              settingsOverride={settingsOverride}
              printScale={settings.scale}
              previewZoom={1}
            />
          </div>
        </main>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ArrowLeft, Download, Loader, Printer, RefreshCw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import InvoiceTemplateRenderer, { buildInvoicePageStyle } from '../components/invoice-print/InvoiceTemplateRenderer';
import { getPaperDimensions, normalizeTemplateSettings } from '../components/invoice-print/templateDefaults';
import { getApiErrorMessage, invoicesApi } from '../utils/apiClient';

const PRINT_SETTINGS_KEY = 'kha.invoicePrintA5.settings';
const SCALE_PRESETS = [0.8, 0.9, 1, 1.1, 1.2];
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.4;
const SCALE_STEP = 0.1;

function clamp(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(max, Math.max(min, numericValue));
}

function normalizeScale(value) {
  return Math.round(clamp(value, MIN_SCALE, MAX_SCALE) * 100) / 100;
}

function readPrintSettings() {
  if (typeof window === 'undefined') return { scale: 1, orientation: 'portrait', orientationOverride: false };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRINT_SETTINGS_KEY) || '{}');
    return {
      scale: normalizeScale(parsed.scale || 1),
      orientation: parsed.orientation === 'landscape' ? 'landscape' : 'portrait',
      orientationOverride: parsed.orientationOverride === true,
    };
  } catch (_error) {
    return { scale: 1, orientation: 'portrait', orientationOverride: false };
  }
}

function writePrintSettings(settings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_error) {
    // Bỏ qua nếu trình duyệt khóa localStorage.
  }
}

function sanitizeFileName(value) {
  return String(value || 'hoa-don')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'hoa-don';
}

function getErrorMessage(error, fallback) {
  return getApiErrorMessage(error?.data, error?.message || fallback);
}

function getBackendTemplate(data) {
  return data?.template || data?.print_template || data?.printTemplate || null;
}

function buildFallbackTemplate(settings) {
  return {
    id: null,
    template_name: 'Mẫu A5 mặc định',
    paper_size: 'A5',
    orientation: settings.orientation || 'portrait',
    settings_json: {
      schema_version: 1,
      paperSize: 'A5',
      orientation: settings.orientation || 'portrait',
      scale: settings.scale || 1,
      previewZoom: settings.scale || 1,
      showLogo: true,
      showQr: true,
      showSignature: true,
      showNote: true,
      showDebt: true,
      lineSpacing: 1.35,
      paddingMm: 8,
      marginMm: 0,
      tableWidthPercent: 100,
      tableBorder: true,
      tableBorderWidthMm: 0.22,
    },
  };
}

function buildRendererSettingsOverride(settings, hasBackendTemplate) {
  const override = {
    scale: settings.scale,
    previewZoom: settings.scale,
  };
  if (!hasBackendTemplate || settings.orientationOverride) override.orientation = settings.orientation;
  return override;
}

export default function InvoicePrint() {
  const navigate = useNavigate();
  const { idOrCode = '' } = useParams();
  const [searchParams] = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const templateId = searchParams.get('template_id') || searchParams.get('templateId') || '';
  const printRef = useRef(null);
  const autoPrintedRef = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [printError, setPrintError] = useState('');
  const [settings, setSettings] = useState(() => readPrintSettings());

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

  useEffect(() => {
    writePrintSettings(settings);
  }, [settings]);

  const loadInvoice = useCallback(async () => {
    if (!idOrCode) {
      setError('Thiếu mã hoặc ID hóa đơn.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setPrintError('');
    try {
      const payload = await invoicesApi.printData(idOrCode, templateId ? { template_id: templateId } : {});
      setData(payload);
    } catch (err) {
      setData(null);
      setError(getErrorMessage(err, 'Không thể tải dữ liệu hóa đơn.'));
    } finally {
      setLoading(false);
    }
  }, [idOrCode, templateId]);

  useEffect(() => {
    autoPrintedRef.current = false;
    loadInvoice();
  }, [loadInvoice]);

  const pageStyle = useMemo(
    () => buildInvoicePageStyle(activeTemplate, settingsOverride),
    [activeTemplate, settingsOverride],
  );

  const handlePrintInvoice = useReactToPrint({
    contentRef: printRef,
    documentTitle: () => `Hoa_don_${sanitizeFileName(invoiceCode)}`,
    pageStyle,
    onPrintError: (_location, err) => {
      setPrintError(err?.message || 'Không thể mở hộp thoại in.');
    },
  });

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
    setSettings(prev => ({ ...prev, scale: 1 }));
  }, []);

  const toggleOrientation = useCallback(() => {
    setSettings(prev => ({
      ...prev,
      orientation: templateSettings.orientation === 'portrait' ? 'landscape' : 'portrait',
      orientationOverride: true,
    }));
  }, [templateSettings.orientation]);

  const handleDownloadPdf = useCallback(async () => {
    const element = printRef.current;
    if (!element || !data) return;

    setPdfLoading(true);
    setPrintError('');
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
        useCORS: true,
        allowTaint: false,
        logging: false,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
      });

      const pdf = new jsPDF({ orientation: page.orientation, unit: 'mm', format: [page.width, page.height], compress: true });
      const imgData = canvas.toDataURL('image/png', 1);
      const pdfWidth = page.width;
      const pdfHeight = page.height;
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage([page.width, page.height], page.orientation);
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pdfHeight;
      }

      pdf.save(`Hoa_don_${sanitizeFileName(invoiceCode)}.pdf`);
    } catch (err) {
      setPrintError(err?.message || 'Không thể tải PDF hóa đơn.');
    } finally {
      setPdfLoading(false);
    }
  }, [data, invoiceCode, page.height, page.orientation, page.width]);

  return (
    <div className="invoice-print-page">
      <div className="invoice-print-toolbar no-print">
        <div className="invoice-toolbar-left">
          <button type="button" onClick={() => navigate(-1)} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            <ArrowLeft size={16} /> Quay lại
          </button>
          <div>
            <h1>In hóa đơn {page.paperSize}</h1>
            <p>
              {invoiceCode ? `Mã/ID: ${invoiceCode}` : 'Preview gọi dữ liệu thật từ API backend'}
              {hasBackendTemplate ? ` · Mẫu: ${activeTemplate.template_name || activeTemplate.name || activeTemplate.id}` : ' · Fallback A5'}
            </p>
          </div>
        </div>

        <div className="invoice-toolbar-actions">
          <label className="invoice-control-group">
            <span>Scale</span>
            <select
              value={SCALE_PRESETS.includes(settings.scale) ? String(settings.scale) : 'custom'}
              onChange={event => {
                if (event.target.value !== 'custom') setScale(Number(event.target.value));
              }}
            >
              {SCALE_PRESETS.map(scale => (
                <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>
              ))}
              <option value="custom">Tùy chỉnh</option>
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
          <button type="button" onClick={() => adjustScale(-SCALE_STEP)} className="invoice-toolbar-btn invoice-toolbar-btn-light" title="Thu nhỏ">
            <ZoomOut size={16} /> Thu nhỏ
          </button>
          <button type="button" onClick={() => adjustScale(SCALE_STEP)} className="invoice-toolbar-btn invoice-toolbar-btn-light" title="Phóng to">
            <ZoomIn size={16} /> Phóng to
          </button>
          <button type="button" onClick={resetScale} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            Reset 100%
          </button>
          {page.paperSize !== 'K80' && (
            <button type="button" onClick={toggleOrientation} className="invoice-toolbar-btn invoice-toolbar-btn-light">
              <RotateCw size={16} /> {page.label}
            </button>
          )}
          <button type="button" onClick={loadInvoice} disabled={loading} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Tải lại
          </button>
          <button type="button" onClick={handleDownloadPdf} disabled={!data || pdfLoading} className="invoice-toolbar-btn invoice-toolbar-btn-secondary">
            {pdfLoading ? <Loader size={16} className="animate-spin" /> : <Download size={16} />} Tải PDF
          </button>
          <button type="button" onClick={handlePrintInvoice} disabled={!data} className="invoice-toolbar-btn invoice-toolbar-btn-primary">
            <Printer size={16} /> In nhanh
          </button>
        </div>
      </div>

      {printError && <div className="invoice-alert no-print">{printError}</div>}

      {loading ? (
        <div className="invoice-state-card no-print">
          <Loader size={28} className="animate-spin text-blue-500" />
          <div>
            <b>Đang tải dữ liệu hóa đơn...</b>
            <p>Preview chỉ hiển thị sau khi API backend trả dữ liệu thật.</p>
          </div>
        </div>
      ) : error ? (
        <div className="invoice-state-card no-print invoice-state-error">
          <b>Không thể mở hóa đơn</b>
          <p>{error}</p>
          <button type="button" onClick={loadInvoice} className="invoice-toolbar-btn invoice-toolbar-btn-primary">
            <RefreshCw size={16} /> Thử lại
          </button>
        </div>
      ) : (
        <main className="invoice-preview-shell">
          <div className="invoice-print-preview-frame">
            <InvoiceTemplateRenderer
              ref={printRef}
              payload={data}
              template={activeTemplate}
              settingsOverride={settingsOverride}
              printScale={settings.scale}
              previewZoom={settings.scale}
            />
          </div>
        </main>
      )}
    </div>
  );
}

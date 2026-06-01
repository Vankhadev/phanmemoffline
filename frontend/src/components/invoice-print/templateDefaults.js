export const PAPER_DIMENSIONS_MM = Object.freeze({
  A4: { width: 210, height: 297, label: 'A4' },
  A5: { width: 148, height: 210, label: 'A5' },
  K80: { width: 80, height: 220, label: 'K80' },
});

export const DEFAULT_INVOICE_TEMPLATE_SETTINGS = Object.freeze({
  schema_version: 1,
  fontSize: 9.5,
  scale: 1,
  previewZoom: 1,
  paperSize: 'A5',
  orientation: 'portrait',
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
  headerLogoWidthMm: 20,
  headerLogoHeightMm: 20,
  storeName: '',
  storeAddress: '',
  storePhone: '',
});

const BOOLEAN_KEYS = new Set(['showLogo', 'showQr', 'showSignature', 'showNote', 'showDebt', 'tableBorder']);
const NUMBER_LIMITS = Object.freeze({
  fontSize: [7, 16],
  scale: [0.55, 1.6],
  previewZoom: [0.4, 1.8],
  lineSpacing: [1, 2.2],
  paddingMm: [0, 24],
  marginMm: [0, 20],
  tableWidthPercent: [60, 100],
  tableBorderWidthMm: [0, 1],
  headerLogoWidthMm: [8, 40],
  headerLogoHeightMm: [8, 40],
});

export function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function getPaperDimensions(paperSize = 'A5', orientation = 'portrait') {
  const normalizedPaper = String(paperSize || 'A5').toUpperCase();
  const base = PAPER_DIMENSIONS_MM[normalizedPaper] || PAPER_DIMENSIONS_MM.A5;
  if (normalizedPaper === 'K80') return { ...base, paperSize: 'K80', orientation: 'portrait' };
  const normalizedOrientation = orientation === 'landscape' ? 'landscape' : 'portrait';
  if (normalizedOrientation === 'landscape') {
    return { width: base.height, height: base.width, label: `${base.label} ngang`, paperSize: normalizedPaper, orientation: normalizedOrientation };
  }
  return { ...base, label: `${base.label} dọc`, paperSize: normalizedPaper, orientation: normalizedOrientation };
}

export function normalizeTemplateSettings(input = {}) {
  const layout = input?.layout_json || input?.layout || {};
  const rawSettings = input?.settings_json || input?.settings || {};
  const page = layout?.page || {};
  const branding = layout?.branding || {};
  const content = layout?.content || {};
  const table = layout?.table || {};
  const spacing = rawSettings?.spacing || {};
  const flags = rawSettings?.flags || {};
  const typography = rawSettings?.typography || {};
  const print = rawSettings?.print || {};

  const merged = {
    ...DEFAULT_INVOICE_TEMPLATE_SETTINGS,
    fontSize: pickFirst(rawSettings.fontSize, rawSettings.font_size, typography.fontSize, table.fontSizePt),
    scale: pickFirst(rawSettings.scale, print.scale),
    previewZoom: pickFirst(rawSettings.previewZoom, rawSettings.preview_zoom, print.previewZoom),
    paperSize: pickFirst(rawSettings.paperSize, rawSettings.paper_size, input.paper_size, page.size),
    orientation: pickFirst(rawSettings.orientation, input.orientation, page.orientation),
    showLogo: pickFirst(rawSettings.showLogo, rawSettings.show_logo, flags.showLogo, branding.showLogo),
    showQr: pickFirst(rawSettings.showQr, rawSettings.show_qr, flags.showQr, content.showQr),
    showSignature: pickFirst(rawSettings.showSignature, rawSettings.show_signature, flags.showSignature, content.showSignatures),
    showNote: pickFirst(rawSettings.showNote, rawSettings.show_note, flags.showNote, content.showNote),
    showDebt: pickFirst(rawSettings.showDebt, rawSettings.show_debt, flags.showDebt, content.showDebt),
    lineSpacing: pickFirst(rawSettings.lineSpacing, rawSettings.line_spacing, spacing.lineSpacing, typography.lineHeight),
    paddingMm: pickFirst(rawSettings.paddingMm, rawSettings.padding_mm, spacing.paddingMm, page.paddingMm),
    marginMm: pickFirst(rawSettings.marginMm, rawSettings.margin_mm, spacing.marginMm, page.marginMm),
    tableWidthPercent: pickFirst(rawSettings.tableWidthPercent, rawSettings.table_width_percent, table.widthPercent),
    tableBorder: pickFirst(rawSettings.tableBorder, rawSettings.table_border, flags.tableBorder, table.border),
    tableBorderWidthMm: pickFirst(rawSettings.tableBorderWidthMm, rawSettings.table_border_width_mm, table.borderWidthMm),
    headerLogoWidthMm: pickFirst(rawSettings.headerLogoWidthMm, rawSettings.header_logo_width_mm, branding.logoWidthMm),
    headerLogoHeightMm: pickFirst(rawSettings.headerLogoHeightMm, rawSettings.header_logo_height_mm, branding.logoHeightMm, branding.logoWidthMm),
    storeName: pickFirst(rawSettings.storeName, rawSettings.store_name, input.shop_name),
    storeAddress: pickFirst(rawSettings.storeAddress, rawSettings.store_address, input.shop_address),
    storePhone: pickFirst(rawSettings.storePhone, rawSettings.store_phone, input.shop_phone),
  };

  const result = { ...merged };
  for (const [key, [min, max]] of Object.entries(NUMBER_LIMITS)) {
    result[key] = clampNumber(result[key], min, max, DEFAULT_INVOICE_TEMPLATE_SETTINGS[key]);
  }
  for (const key of BOOLEAN_KEYS) {
    result[key] = result[key] === true || result[key] === 1 || result[key] === '1' || result[key] === 'true' || result[key] === 'on';
  }
  result.paperSize = ['A4', 'A5', 'K80'].includes(String(result.paperSize || '').toUpperCase()) ? String(result.paperSize).toUpperCase() : 'A5';
  result.orientation = result.paperSize === 'K80' ? 'portrait' : (result.orientation === 'landscape' ? 'landscape' : 'portrait');
  result.storeName = String(result.storeName || '');
  result.storeAddress = String(result.storeAddress || '');
  result.storePhone = String(result.storePhone || '');
  return result;
}

export function buildTemplateJsonFromSettings(settings = {}) {
  const normalized = normalizeTemplateSettings({ settings_json: settings, paper_size: settings.paperSize, orientation: settings.orientation });
  return {
    layout_json: {
      page: {
        size: normalized.paperSize,
        orientation: normalized.orientation,
        paddingMm: normalized.paddingMm,
        marginMm: normalized.marginMm,
      },
      branding: {
        showLogo: normalized.showLogo,
        logoWidthMm: normalized.headerLogoWidthMm,
        logoHeightMm: normalized.headerLogoHeightMm,
        storeNameUppercase: true,
        headerBorder: true,
      },
      content: {
        showQr: normalized.showQr,
        showSignatures: normalized.showSignature,
        showNote: normalized.showNote,
        showDebt: normalized.showDebt,
        showFooter: true,
      },
      table: {
        fontSizePt: normalized.fontSize,
        headerFontSizePt: Math.max(7, normalized.fontSize - 0.5),
        widthPercent: normalized.tableWidthPercent,
        border: normalized.tableBorder,
        borderWidthMm: normalized.tableBorderWidthMm,
        columns: ['no', 'name', 'unit', 'qty', 'unitPrice', 'discount', 'lineTotal'],
      },
      print: {
        forceWhiteBackground: true,
        exactColorAdjust: true,
      },
    },
    settings_json: {
      schema_version: 1,
      fontSize: normalized.fontSize,
      scale: normalized.scale,
      previewZoom: normalized.previewZoom,
      paperSize: normalized.paperSize,
      orientation: normalized.orientation,
      showLogo: normalized.showLogo,
      showQr: normalized.showQr,
      showSignature: normalized.showSignature,
      showNote: normalized.showNote,
      showDebt: normalized.showDebt,
      lineSpacing: normalized.lineSpacing,
      paddingMm: normalized.paddingMm,
      marginMm: normalized.marginMm,
      tableWidthPercent: normalized.tableWidthPercent,
      tableBorder: normalized.tableBorder,
      tableBorderWidthMm: normalized.tableBorderWidthMm,
      headerLogoWidthMm: normalized.headerLogoWidthMm,
      headerLogoHeightMm: normalized.headerLogoHeightMm,
      storeName: normalized.storeName,
      storeAddress: normalized.storeAddress,
      storePhone: normalized.storePhone,
    },
  };
}

export function normalizePrintTemplate(input = {}) {
  const settings = normalizeTemplateSettings(input);
  return {
    id: input?.id || null,
    code: input?.code || '',
    template_name: input?.template_name || input?.name || '',
    name: input?.name || input?.template_name || '',
    description: input?.description || '',
    header_logo: input?.header_logo || input?.logo_url || input?.logo_url_resolved || '',
    logo_url: input?.logo_url || input?.logo_url_resolved || input?.header_logo || '',
    shop_name: input?.shop_name || settings.storeName || '',
    shop_address: input?.shop_address || settings.storeAddress || '',
    shop_phone: input?.shop_phone || settings.storePhone || '',
    paper_size: settings.paperSize,
    orientation: settings.orientation,
    status: input?.status || 'active',
    is_default: input?.is_default === true || input?.is_default === 1 || input?.is_default === '1',
    layout_json: input?.layout_json || input?.layout || {},
    settings_json: input?.settings_json || input?.settings || {},
    settings,
    template_schema_version: input?.template_schema_version || input?.schema_version || settings?.schema_version || 1,
    schema_version: input?.schema_version || input?.template_schema_version || settings?.schema_version || 1,
    revision: Number(input?.revision) || 1,
    has_draft: input?.has_draft === true || input?.hasDraft === true,
    last_autosaved_at: input?.last_autosaved_at || null,
    published_at: input?.published_at || null,
    editor_document: input?.editor_document || null,
    draft_layout_json: input?.draft_layout_json || null,
    draft_settings_json: input?.draft_settings_json || null,
    editor_meta_json: input?.editor_meta_json || null,
    layout_v2: input?.layout_v2 || input?.published_layout_v2 || null,
    settings_v2: input?.settings_v2 || input?.published_settings_v2 || null,
    draft_layout_v2: input?.draft_layout_v2 || null,
    draft_settings_v2: input?.draft_settings_v2 || null,
    active_editor_layout_json: input?.active_editor_layout_json || null,
    active_editor_settings_json: input?.active_editor_settings_json || null,
    created_at: input?.created_at || null,
    updated_at: input?.updated_at || null,
  };
}

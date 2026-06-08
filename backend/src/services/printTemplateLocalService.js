const {
  getAll,
  insert,
  update,
  withAtomicDbWrite,
  now: dbNow,
} = require('../db/database');
const {
  DEFAULT_LAYOUT_V2,
  DEFAULT_SETTINGS_V2,
  buildDefaultV2Settings,
  cleanText,
  cloneJson,
  isPlainObject,
  normalizeOrientation: normalizeDocumentOrientation,
  normalizePaperSize: normalizeDocumentPaperSize,
  toEditorV2Document,
} = require('./printTemplateDocumentAdapter');
const {
  formatValidationErrors,
  validateEditorMetaJson,
  validateLayoutV2,
  validateSettingsV2,
} = require('./printTemplateLayoutValidator');

const TABLE = 'print_templates';
const DEFAULT_TEMPLATE_SEED_CODE = 'mau-in-hoa-don-mac-dinh';
const DEFAULT_TEMPLATE_SEED_NAME = 'Mẫu in hóa đơn mặc định';
const DEFAULT_TEMPLATE_SEED_DESCRIPTION = 'Mẫu mặc định được lưu trong dữ liệu offline khi chưa cấu hình MySQL.';

function coreService() {
  return require('./printTemplateService');
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeAccountId(value) {
  return parseId(value) || 1;
}

function normalizeUserId(value) {
  return parseId(value) || null;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeStatus(value) {
  const status = cleanText(value || 'active', 20).toLowerCase();
  return ['draft', 'active', 'archived'].includes(status) ? status : 'active';
}

function normalizePrintScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.round(Math.min(5, Math.max(0.1, scale)) * 1000) / 1000;
}

function jsonStringifyOrNull(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJsonObject(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return cloneJson(fallback);
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : cloneJson(fallback);
    } catch (_error) {
      return cloneJson(fallback);
    }
  }
  return cloneJson(fallback);
}

function parseNullableJsonObject(value) {
  if (value === undefined || value === null || value === '') return null;
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function parseJsonObjectInput(value, fieldLabel, fallback = {}, { allowNull = true } = {}) {
  if (value === undefined) return { provided: false, value: cloneJson(fallback) };
  if (value === null || value === '') {
    if (allowNull) return { provided: true, value: null };
    return { error: `${fieldLabel} phai la JSON object hop le.` };
  }
  if (isPlainObject(value)) return { provided: true, value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isPlainObject(parsed)) return { provided: true, value: parsed };
    } catch (_error) {
      return { error: `${fieldLabel} khong phai JSON hop le.` };
    }
  }
  return { error: `${fieldLabel} phai la JSON object hop le.` };
}

function pickBodyValue(body, names) {
  for (const name of names) {
    if (hasOwn(body, name)) return { provided: true, value: body[name], key: name };
  }
  return { provided: false, value: undefined, key: '' };
}

function createHttpError(status, message, code = '', details = null) {
  return coreService().createHttpError(status, message, code, details);
}

function validateV2LayoutOrThrow(layout, fieldLabel = 'layout_json') {
  const result = validateLayoutV2(layout);
  if (!result.ok) {
    throw createHttpError(400, `${fieldLabel} khong hop le: ${formatValidationErrors(result.errors)}`, 'PRINT_TEMPLATE_LAYOUT_VALIDATION_ERROR', { errors: result.errors });
  }
  return result.value;
}

function validateV2SettingsOrThrow(settings, fieldLabel = 'settings_json') {
  const result = validateSettingsV2(settings);
  if (!result.ok) {
    throw createHttpError(400, `${fieldLabel} khong hop le: ${formatValidationErrors(result.errors)}`, 'PRINT_TEMPLATE_SETTINGS_VALIDATION_ERROR', { errors: result.errors });
  }
  return result.value;
}

function validateEditorMetaOrThrow(meta) {
  const result = validateEditorMetaJson(meta);
  if (!result.ok) {
    throw createHttpError(400, `editor_meta_json khong hop le: ${formatValidationErrors(result.errors)}`, 'PRINT_TEMPLATE_EDITOR_META_VALIDATION_ERROR', { errors: result.errors });
  }
  return result.value;
}

function mergeSettingsPublishState(settings, { revision, hasDraft, sourceSchemaVersion } = {}) {
  const result = isPlainObject(settings) ? cloneJson(settings) : cloneJson(DEFAULT_SETTINGS_V2);
  result.schema_version = 2;
  result.renderMode = result.renderMode || result.render_mode || 'hybrid-dom';
  result.editor = isPlainObject(result.editor) ? result.editor : cloneJson(DEFAULT_SETTINGS_V2.editor || {});
  result.publish = isPlainObject(result.publish) ? result.publish : {};
  result.publish.revision = parsePositiveInteger(revision) || 1;
  result.publish.hasDraft = hasDraft === true;
  result.migration = isPlainObject(result.migration) ? result.migration : {};
  result.migration.sourceSchemaVersion = parsePositiveInteger(result.migration.sourceSchemaVersion) || parsePositiveInteger(sourceSchemaVersion) || 2;
  if (!hasOwn(result.migration, 'migratedAt')) result.migration.migratedAt = null;
  if (!hasOwn(result.migration, 'migratedBy')) result.migration.migratedBy = null;
  return result;
}

function extractPaperSizeFromLayout(layout, fallback = 'A5') {
  if (!isPlainObject(layout)) return normalizeDocumentPaperSize(fallback);
  if (Number(layout.schema_version || layout.schemaVersion) === 2) return normalizeDocumentPaperSize(layout.canvas?.pageSize || fallback);
  return normalizeDocumentPaperSize(layout.page?.size || fallback);
}

function extractOrientationFromLayout(layout, fallback = 'portrait') {
  if (!isPlainObject(layout)) return normalizeDocumentOrientation(fallback, extractPaperSizeFromLayout(layout));
  if (Number(layout.schema_version || layout.schemaVersion) === 2) {
    return normalizeDocumentOrientation(layout.canvas?.orientation || fallback, extractPaperSizeFromLayout(layout));
  }
  return normalizeDocumentOrientation(layout.page?.orientation || fallback, extractPaperSizeFromLayout(layout));
}

function serializeRow(row, { invoice = false } = {}) {
  const serializer = invoice ? coreService().serializePrintTemplateForInvoice : coreService().serializePrintTemplate;
  const item = serializer(row);
  if (!item) return null;
  return {
    ...item,
    mysqlAvailable: false,
    storage_source: 'local-json',
    offline_storage: true,
  };
}

function getRowsForAccount(accountId, options = {}) {
  const normalizedAccountId = normalizeAccountId(accountId);
  const includeDeleted = options.includeDeleted === true;
  return getAll(TABLE, row => (
    Number(row?.account_id) === normalizedAccountId
      && (includeDeleted || !row?.deleted_at)
  ), { skipAccountScope: true });
}

function sortTemplateRows(rows = []) {
  return [...rows].sort((a, b) => (
    Number(b.is_default || 0) - Number(a.is_default || 0)
    || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    || Number(b.id || 0) - Number(a.id || 0)
  ));
}

function getTemplateRowById(accountId, id, options = {}) {
  const normalizedAccountId = normalizeAccountId(accountId);
  const parsedId = parseId(id);
  if (!parsedId) return null;
  return getAll(TABLE, row => (
    Number(row?.account_id) === normalizedAccountId
      && Number(row?.id) === parsedId
      && (options.includeDeleted === true || !row?.deleted_at)
  ), { skipAccountScope: true })[0] || null;
}

function getFirstActiveTemplateRow(accountId) {
  return sortTemplateRows(getRowsForAccount(accountId, { includeDeleted: false }))[0] || null;
}

function updateRow(accountId, id, changes, options = {}) {
  const updated = update(TABLE, id, changes, {
    skipAccountScope: true,
    accountId: normalizeAccountId(accountId),
    skipSave: options.skipSave === true,
  });
  return updated;
}

function markOtherRowsNonDefault(accountId, keepId = null) {
  const normalizedAccountId = normalizeAccountId(accountId);
  for (const row of getRowsForAccount(normalizedAccountId)) {
    if (keepId && Number(row.id) === Number(keepId)) continue;
    if (Number(row.is_default) === 1) updateRow(normalizedAccountId, row.id, { is_default: 0 }, { skipSave: true });
  }
}

function buildDefaultTemplatePayload(accountId, userId = null) {
  const revision = 1;
  const layout = validateV2LayoutOrThrow(cloneJson(DEFAULT_LAYOUT_V2), 'layout_json');
  const settings = mergeSettingsPublishState(validateV2SettingsOrThrow(cloneJson(DEFAULT_SETTINGS_V2), 'settings_json'), {
    revision,
    hasDraft: false,
    sourceSchemaVersion: 2,
  });
  return {
    account_id: normalizeAccountId(accountId),
    code: DEFAULT_TEMPLATE_SEED_CODE,
    template_name: DEFAULT_TEMPLATE_SEED_NAME,
    name: DEFAULT_TEMPLATE_SEED_NAME,
    description: DEFAULT_TEMPLATE_SEED_DESCRIPTION,
    template_data: JSON.stringify(layout),
    layout_json: JSON.stringify(layout),
    settings_json: JSON.stringify(settings),
    template_schema_version: 2,
    template_type: 'invoice',
    print_scale: 1,
    paper_size: extractPaperSizeFromLayout(layout, 'A5'),
    orientation: extractOrientationFromLayout(layout, 'portrait'),
    status: 'active',
    is_default: 1,
    revision,
    published_at: dbNow(),
    created_by: normalizeUserId(userId),
    updated_by: normalizeUserId(userId),
  };
}

function refreshDefaultSeedRow(accountId, row, userId = null) {
  if (!row || row.code !== DEFAULT_TEMPLATE_SEED_CODE) return row;
  const changes = {};
  if (row.template_name !== DEFAULT_TEMPLATE_SEED_NAME) {
    changes.template_name = DEFAULT_TEMPLATE_SEED_NAME;
    changes.name = DEFAULT_TEMPLATE_SEED_NAME;
  }
  if (row.description !== DEFAULT_TEMPLATE_SEED_DESCRIPTION) {
    changes.description = DEFAULT_TEMPLATE_SEED_DESCRIPTION;
  }
  if (Object.keys(changes).length === 0) return row;
  return updateRow(accountId, row.id, {
    ...changes,
    updated_by: normalizeUserId(userId),
  }, { skipSave: true }) || row;
}

function ensureDefaultTemplateForAccountSync(accountId, options = {}) {
  const normalizedAccountId = normalizeAccountId(accountId);
  const activeRows = getRowsForAccount(normalizedAccountId);
  if (activeRows.length === 0) {
    const payload = buildDefaultTemplatePayload(normalizedAccountId, options.userId);
    const id = insert(TABLE, payload, { skipAccountScope: true, accountId: normalizedAccountId, skipSave: true });
    return getTemplateRowById(normalizedAccountId, id);
  }

  const defaultRow = activeRows.find(row => Number(row.is_default) === 1);
  if (defaultRow) return refreshDefaultSeedRow(normalizedAccountId, defaultRow, options.userId);

  const row = sortTemplateRows(activeRows)[0];
  markOtherRowsNonDefault(normalizedAccountId, row.id);
  const defaulted = updateRow(normalizedAccountId, row.id, { is_default: 1 }, { skipSave: true }) || row;
  return refreshDefaultSeedRow(normalizedAccountId, defaulted, options.userId);
}

function ensureDefaultTemplateForAccount(accountId, options = {}) {
  return withAtomicDbWrite(() => ensureDefaultTemplateForAccountSync(accountId, options));
}

function findDuplicate(accountId, column, value, excludeId = null) {
  const text = cleanText(value, 255).toLowerCase();
  if (!text) return null;
  return getRowsForAccount(accountId).find(row => (
    cleanText(row?.[column], 255).toLowerCase() === text
      && (!excludeId || Number(row.id) !== Number(excludeId))
  )) || null;
}

function ensureNoDuplicateTemplate(accountId, payload, excludeId = null) {
  if (payload.template_name && findDuplicate(accountId, 'template_name', payload.template_name, excludeId)) {
    throw createHttpError(409, 'Ten mau in hoa don da ton tai.', 'PRINT_TEMPLATE_DUPLICATE_NAME');
  }
  if (payload.code && findDuplicate(accountId, 'code', payload.code, excludeId)) {
    throw createHttpError(409, 'Ma mau in hoa don da ton tai.', 'PRINT_TEMPLATE_DUPLICATE_CODE');
  }
}

async function listPrintTemplates(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  ensureDefaultTemplateForAccount(accountId, { userId: options.userId });

  const includeDeleted = options.includeDeleted === true;
  const status = cleanText(options.status, 20).toLowerCase();
  const q = cleanText(options.q, 120).toLowerCase();
  let rows = getRowsForAccount(accountId, { includeDeleted });
  if (status && ['draft', 'active', 'archived'].includes(status)) rows = rows.filter(row => normalizeStatus(row.status) === status);
  if (q) {
    rows = rows.filter(row => (
      cleanText(row.template_name, 150).toLowerCase().includes(q)
        || cleanText(row.code, 100).toLowerCase().includes(q)
        || cleanText(row.shop_name, 150).toLowerCase().includes(q)
    ));
  }
  return sortTemplateRows(rows).map(row => serializeRow(row));
}

async function getPrintTemplateById(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');
  const row = getTemplateRowById(accountId, id);
  if (!row) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
  return serializeRow(row);
}

async function getDefaultPrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const row = ensureDefaultTemplateForAccount(accountId, { userId: options.userId });
  return serializeRow(row);
}

async function getCurrentPrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const requestedId = parseId(options.templateId || options.id);
  if (requestedId) return getPrintTemplateById({ accountId, id: requestedId });
  const defaultTemplate = await getDefaultPrintTemplate({ accountId, userId: options.userId });
  if (defaultTemplate) return defaultTemplate;
  return serializeRow(getFirstActiveTemplateRow(accountId));
}

async function createPrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const parsed = coreService().buildPrintTemplatePayload(options.body || {}, { partial: false });
  if (parsed.error) throw createHttpError(400, parsed.error, parsed.code || 'PRINT_TEMPLATE_VALIDATION_ERROR', parsed.details || null);

  return withAtomicDbWrite(() => {
    const payload = {
      account_id: accountId,
      ...parsed.value,
      revision: 1,
      created_by: userId,
      updated_by: userId,
    };
    if (Number(payload.template_schema_version) >= 2 && !payload.published_at) payload.published_at = dbNow();
    if (payload.is_default !== 1 && !getFirstActiveTemplateRow(accountId)) payload.is_default = 1;
    ensureNoDuplicateTemplate(accountId, payload);
    if (payload.is_default === 1) markOtherRowsNonDefault(accountId);
    const id = insert(TABLE, payload, { skipAccountScope: true, accountId, skipSave: true });
    return serializeRow(getTemplateRowById(accountId, id));
  });
}

async function updatePrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');

  const parsed = coreService().buildPrintTemplatePayload(options.body || {}, { partial: true });
  if (parsed.error) throw createHttpError(400, parsed.error, parsed.code || 'PRINT_TEMPLATE_VALIDATION_ERROR', parsed.details || null);
  const payload = { ...parsed.value };
  if (Object.keys(payload).length === 0) throw createHttpError(400, 'Khong co du lieu cap nhat mau in hoa don.', 'PRINT_TEMPLATE_EMPTY_UPDATE');

  return withAtomicDbWrite(() => {
    const existing = getTemplateRowById(accountId, id);
    if (!existing) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    if (Number(existing.is_default) === 1 && hasOwn(payload, 'is_default') && payload.is_default !== 1) delete payload.is_default;
    ensureNoDuplicateTemplate(accountId, payload, id);

    payload.updated_by = userId;
    const layoutTouched = hasOwn(payload, 'layout_json')
      || hasOwn(payload, 'settings_json')
      || hasOwn(payload, 'template_schema_version')
      || hasOwn(payload, 'template_data')
      || hasOwn(payload, 'print_scale');
    if (layoutTouched) {
      payload.revision = (parsePositiveInteger(existing.revision) || 1) + 1;
      if (Number(payload.template_schema_version) >= 2) {
        payload.published_at = dbNow();
        payload.draft_layout_json = null;
        payload.draft_settings_json = null;
      }
    }

    if (payload.is_default === 1) markOtherRowsNonDefault(accountId, id);
    const row = updateRow(accountId, id, payload, { skipSave: true });
    return serializeRow(row);
  });
}

function parseExpectedRevision(body = {}) {
  const revisionInput = pickBodyValue(body, ['revision', 'expected_revision', 'expectedRevision', 'current_revision', 'currentRevision']);
  return revisionInput.provided ? parsePositiveInteger(revisionInput.value) : null;
}

function requireExpectedRevision(expectedRevision, actionLabel = 'luu mau in') {
  if (expectedRevision) return expectedRevision;
  throw createHttpError(
    400,
    `Thieu revision hien tai khi ${actionLabel}. Vui long tai chi tiet template truoc khi thao tac.`,
    'PRINT_TEMPLATE_REVISION_REQUIRED'
  );
}

function assertRevisionMatches(row, expectedRevision) {
  const requiredRevision = requireExpectedRevision(expectedRevision);
  const currentRevision = parsePositiveInteger(row?.revision) || 1;
  if (currentRevision !== requiredRevision) {
    throw createHttpError(
      409,
      'Mau in hoa don da duoc cap nhat o phien khac. Vui long tai lai truoc khi luu.',
      'PRINT_TEMPLATE_REVISION_CONFLICT',
      { expected_revision: requiredRevision, current_revision: currentRevision }
    );
  }
}

function parseDraftPayload(body = {}) {
  const result = {
    expectedRevision: parseExpectedRevision(body),
    layoutProvided: false,
    settingsProvided: false,
    editorMetaProvided: false,
    layout: null,
    settings: null,
    editorMeta: undefined,
  };

  const layoutInput = pickBodyValue(body, ['draft_layout_json', 'layout_json', 'layout', 'draftLayout', 'layoutJson']);
  if (layoutInput.provided) {
    const parsed = parseJsonObjectInput(layoutInput.value, 'draft_layout_json', DEFAULT_LAYOUT_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.layoutProvided = true;
    result.layout = validateV2LayoutOrThrow(parsed.value, 'draft_layout_json');
  }

  const settingsInput = pickBodyValue(body, ['draft_settings_json', 'settings_json', 'settings', 'draftSettings', 'settingsJson']);
  if (settingsInput.provided) {
    const parsed = parseJsonObjectInput(settingsInput.value, 'draft_settings_json', DEFAULT_SETTINGS_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.settingsProvided = true;
    result.settings = validateV2SettingsOrThrow(parsed.value, 'draft_settings_json');
  }

  const editorMetaInput = pickBodyValue(body, ['editor_meta_json', 'editor_meta', 'editorMeta', 'meta']);
  if (editorMetaInput.provided) {
    result.editorMetaProvided = true;
    if (editorMetaInput.value === null || editorMetaInput.value === '') {
      result.editorMeta = null;
    } else {
      const parsed = parseJsonObjectInput(editorMetaInput.value, 'editor_meta_json', {}, { allowNull: true });
      if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
      result.editorMeta = validateEditorMetaOrThrow(parsed.value);
    }
  }

  if (!result.layoutProvided && !result.settingsProvided && !result.editorMetaProvided) {
    throw createHttpError(400, 'Khong co du lieu draft de autosave.', 'PRINT_TEMPLATE_EMPTY_AUTOSAVE');
  }

  return result;
}

async function autosavePrintTemplateDraft(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');
  const parsed = parseDraftPayload(options.body || {});

  return withAtomicDbWrite(() => {
    const locked = getTemplateRowById(accountId, id);
    if (!locked) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    requireExpectedRevision(parsed.expectedRevision, 'autosave draft mau in hoa don');
    assertRevisionMatches(locked, parsed.expectedRevision);

    const currentRevision = parsePositiveInteger(locked.revision) || 1;
    const nextRevision = currentRevision + 1;
    const publishedLayout = parseJsonObject(locked.layout_json, {});
    const publishedSettings = parseJsonObject(locked.settings_json, {});
    const existingDraftLayout = parseNullableJsonObject(locked.draft_layout_json);
    const existingDraftSettings = parseNullableJsonObject(locked.draft_settings_json);
    const publishedDocument = toEditorV2Document({
      layout: publishedLayout,
      settings: publishedSettings,
      template: { ...locked, revision: currentRevision, has_draft: Boolean(existingDraftLayout) },
    });

    const nextDraftLayout = parsed.layoutProvided ? parsed.layout : (existingDraftLayout || publishedDocument.layout);
    const nextDraftSettingsSource = parsed.settingsProvided
      ? parsed.settings
      : (existingDraftSettings || publishedDocument.settings || buildDefaultV2Settings({ revision: nextRevision, hasDraft: true, sourceSchemaVersion: 2 }));
    const normalizedSettings = validateV2SettingsOrThrow(
      mergeSettingsPublishState(nextDraftSettingsSource, { revision: nextRevision, hasDraft: true, sourceSchemaVersion: 2 }),
      'draft_settings_json'
    );

    const payload = {
      draft_layout_json: JSON.stringify(nextDraftLayout),
      draft_settings_json: JSON.stringify(mergeSettingsPublishState(normalizedSettings, { revision: nextRevision, hasDraft: true, sourceSchemaVersion: 2 })),
      revision: nextRevision,
      updated_by: userId,
      last_autosaved_at: dbNow(),
    };
    if (parsed.editorMetaProvided) payload.editor_meta_json = jsonStringifyOrNull(parsed.editorMeta);

    return serializeRow(updateRow(accountId, id, payload, { skipSave: true }));
  });
}

function parsePublishPayloadSafe(body = {}) {
  const result = {
    expectedRevision: parseExpectedRevision(body),
    layoutProvided: false,
    settingsProvided: false,
    editorMetaProvided: false,
    layout: null,
    settings: null,
    editorMeta: undefined,
    statusProvided: false,
    status: '',
  };

  const layoutInput = pickBodyValue(body, ['draft_layout_json', 'layout_json', 'layout', 'draftLayout', 'layoutJson']);
  if (layoutInput.provided) {
    const parsed = parseJsonObjectInput(layoutInput.value, 'layout_json', DEFAULT_LAYOUT_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.layoutProvided = true;
    result.layout = validateV2LayoutOrThrow(parsed.value, 'layout_json');
  }

  const settingsInput = pickBodyValue(body, ['draft_settings_json', 'settings_json', 'settings', 'draftSettings', 'settingsJson']);
  if (settingsInput.provided) {
    const parsed = parseJsonObjectInput(settingsInput.value, 'settings_json', DEFAULT_SETTINGS_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.settingsProvided = true;
    result.settings = validateV2SettingsOrThrow(parsed.value, 'settings_json');
  }

  const editorMetaInput = pickBodyValue(body, ['editor_meta_json', 'editor_meta', 'editorMeta', 'meta']);
  if (editorMetaInput.provided) {
    result.editorMetaProvided = true;
    if (editorMetaInput.value === null || editorMetaInput.value === '') {
      result.editorMeta = null;
    } else {
      const parsed = parseJsonObjectInput(editorMetaInput.value, 'editor_meta_json', {}, { allowNull: true });
      if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
      result.editorMeta = validateEditorMetaOrThrow(parsed.value);
    }
  }

  const statusInput = pickBodyValue(body, ['status']);
  if (statusInput.provided) {
    result.statusProvided = true;
    result.status = normalizeStatus(statusInput.value);
  }

  return result;
}

async function publishPrintTemplateDraft(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');
  const parsed = parsePublishPayloadSafe(options.body || {});

  return withAtomicDbWrite(() => {
    const locked = getTemplateRowById(accountId, id);
    if (!locked) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    requireExpectedRevision(parsed.expectedRevision, 'publish mau in hoa don');
    assertRevisionMatches(locked, parsed.expectedRevision);

    const currentRevision = parsePositiveInteger(locked.revision) || 1;
    const nextRevision = currentRevision + 1;
    const draftLayout = parseNullableJsonObject(locked.draft_layout_json);
    const draftSettings = parseNullableJsonObject(locked.draft_settings_json);
    const layoutToPublish = parsed.layoutProvided ? parsed.layout : draftLayout;
    if (!layoutToPublish) throw createHttpError(400, 'Khong co draft layout de publish.', 'PRINT_TEMPLATE_NO_DRAFT_TO_PUBLISH');
    const normalizedLayout = validateV2LayoutOrThrow(layoutToPublish, 'layout_json');
    const settingsToPublish = parsed.settingsProvided
      ? parsed.settings
      : (draftSettings || buildDefaultV2Settings({ revision: nextRevision, hasDraft: false, sourceSchemaVersion: 2 }));
    const normalizedSettings = mergeSettingsPublishState(validateV2SettingsOrThrow(settingsToPublish, 'settings_json'), {
      revision: nextRevision,
      hasDraft: false,
      sourceSchemaVersion: 2,
    });

    const payload = {
      layout_json: JSON.stringify(normalizedLayout),
      template_data: JSON.stringify(normalizedLayout),
      settings_json: JSON.stringify(normalizedSettings),
      template_schema_version: 2,
      print_scale: normalizePrintScale(normalizedSettings.print?.scale ?? normalizedSettings.scale),
      draft_layout_json: null,
      draft_settings_json: null,
      revision: nextRevision,
      paper_size: extractPaperSizeFromLayout(normalizedLayout, locked.paper_size),
      orientation: extractOrientationFromLayout(normalizedLayout, locked.orientation),
      status: parsed.statusProvided ? parsed.status : (normalizeStatus(locked.status) === 'draft' ? 'active' : normalizeStatus(locked.status)),
      updated_by: userId,
      published_at: dbNow(),
    };
    if (parsed.editorMetaProvided) payload.editor_meta_json = jsonStringifyOrNull(parsed.editorMeta);

    return serializeRow(updateRow(accountId, id, payload, { skipSave: true }));
  });
}

async function discardPrintTemplateDraft(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');
  const expectedRevision = parseExpectedRevision(options.body || {});

  return withAtomicDbWrite(() => {
    const locked = getTemplateRowById(accountId, id);
    if (!locked) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    requireExpectedRevision(expectedRevision, 'huy draft mau in hoa don');
    assertRevisionMatches(locked, expectedRevision);
    const payload = {
      draft_layout_json: null,
      draft_settings_json: null,
      revision: (parsePositiveInteger(locked.revision) || 1) + 1,
      updated_by: userId,
    };
    return serializeRow(updateRow(accountId, id, payload, { skipSave: true }));
  });
}

async function setDefaultPrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');

  return withAtomicDbWrite(() => {
    const existing = getTemplateRowById(accountId, id);
    if (!existing) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    markOtherRowsNonDefault(accountId, id);
    const row = updateRow(accountId, id, { is_default: 1, updated_by: userId }, { skipSave: true });
    return serializeRow(row);
  });
}

async function softDeletePrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');

  return withAtomicDbWrite(() => {
    const existing = getTemplateRowById(accountId, id);
    if (!existing) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    const deletedAt = dbNow();
    updateRow(accountId, id, {
      deleted_at: deletedAt,
      is_default: 0,
      updated_by: userId,
    }, { skipSave: true });
    ensureDefaultTemplateForAccountSync(accountId, { userId });
    return {
      item: serializeRow({ ...existing, deleted_at: deletedAt, is_default: 0, updated_by: userId }),
      previousLogoPath: cleanText(existing.logo_path, 1024),
    };
  });
}

async function attachLogoToPrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');

  return withAtomicDbWrite(() => {
    const existing = getTemplateRowById(accountId, id);
    if (!existing) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    const payload = {
      header_logo: cleanText(options.headerLogo, 1024) || null,
      logo_url: cleanText(options.logoUrl || options.headerLogo, 1024) || null,
      logo_path: cleanText(options.logoPath, 1024) || null,
      logo_mime: cleanText(options.logoMime, 100) || null,
      logo_size: Number(options.logoSize) || null,
      revision: (parsePositiveInteger(existing.revision) || 1) + 1,
      updated_by: userId,
    };
    return {
      item: serializeRow(updateRow(accountId, id, payload, { skipSave: true })),
      previousLogoPath: cleanText(existing.logo_path, 1024),
    };
  });
}

async function removeLogoFromPrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mau in hoa don khong hop le.', 'PRINT_TEMPLATE_INVALID_ID');

  return withAtomicDbWrite(() => {
    const existing = getTemplateRowById(accountId, id);
    if (!existing) throw createHttpError(404, 'Khong tim thay mau in hoa don.', 'PRINT_TEMPLATE_NOT_FOUND');
    const payload = {
      header_logo: null,
      logo_url: null,
      logo_path: null,
      logo_mime: null,
      logo_size: null,
      revision: (parsePositiveInteger(existing.revision) || 1) + 1,
      updated_by: userId,
    };
    return {
      item: serializeRow(updateRow(accountId, id, payload, { skipSave: true })),
      previousLogoPath: cleanText(existing.logo_path, 1024),
    };
  });
}

async function countTemplatesUsingLogoPath(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const logoPath = cleanText(options.logoPath, 1024);
  if (!logoPath) return 0;
  const excludeId = parseId(options.excludeId);
  return getRowsForAccount(accountId).filter(row => (
    cleanText(row.logo_path, 1024) === logoPath
      && (!excludeId || Number(row.id) !== Number(excludeId))
  )).length;
}

async function resolveInvoicePrintTemplate(options = {}) {
  const accountId = normalizeAccountId(options.accountId);
  const requestedId = parseId(options.templateId);
  if (requestedId) return serializeRow(getTemplateRowById(accountId, requestedId), { invoice: true });
  const defaultTemplate = await getDefaultPrintTemplate({ accountId });
  if (defaultTemplate) return serializeRow(getTemplateRowById(accountId, defaultTemplate.id), { invoice: true });
  return serializeRow(getFirstActiveTemplateRow(accountId), { invoice: true });
}

module.exports = {
  ensureDefaultTemplateForAccount,
  listPrintTemplates,
  getPrintTemplateById,
  getDefaultPrintTemplate,
  getCurrentPrintTemplate,
  createPrintTemplate,
  updatePrintTemplate,
  autosavePrintTemplateDraft,
  publishPrintTemplateDraft,
  discardPrintTemplateDraft,
  setDefaultPrintTemplate,
  softDeletePrintTemplate,
  attachLogoToPrintTemplate,
  removeLogoFromPrintTemplate,
  countTemplatesUsingLogoPath,
  resolveInvoicePrintTemplate,
};

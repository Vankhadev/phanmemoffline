import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { printTemplatesApi } from '../../../utils/apiClient';
import { buildEditorMeta } from './templateSchemaAdapter';

const DEFAULT_DEBOUNCE_MS = 1200;

function stableStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return '';
  }
}

function stripVolatileSettings(settings = {}) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const publish = source.publish && typeof source.publish === 'object' && !Array.isArray(source.publish) ? source.publish : {};
  const migration = source.migration && typeof source.migration === 'object' && !Array.isArray(source.migration) ? source.migration : {};
  return {
    ...source,
    publish: {
      ...publish,
      revision: 0,
      hasDraft: true,
    },
    migration: {
      ...migration,
      migratedAt: migration.migratedAt || null,
    },
  };
}

function buildAutosaveSignature(document, settings) {
  return stableStringify({ document, settings: stripVolatileSettings(settings) });
}

function isRevisionConflict(error) {
  const code = error?.data?.code || error?.code || '';
  return Number(error?.status) === 409 || code === 'PRINT_TEMPLATE_REVISION_CONFLICT';
}

function unwrapAutosaveItem(data) {
  if (!data) return null;
  if (data.item && typeof data.item === 'object' && !Array.isArray(data.item)) return data.item;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    if (data.data.item && typeof data.data.item === 'object' && !Array.isArray(data.data.item)) return data.data.item;
    if (data.data.template && typeof data.data.template === 'object' && !Array.isArray(data.data.template)) return data.data.template;
    if (data.data.id || data.data.template_name || data.data.layout_json || data.data.editor_document) return data.data;
  }
  if (data.template && typeof data.template === 'object' && !Array.isArray(data.template)) return data.template;
  if (data.id || data.template_name || data.layout_json || data.editor_document) return data;
  return null;
}

export default function useTemplateAutosave({
  templateId,
  enabled = true,
  document,
  settings,
  revision,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  baselineKey = '',
  onSaved,
  onConflict,
  onError,
} = {}) {
  const [status, setStatus] = useState('idle');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [lastError, setLastError] = useState('');
  const [conflict, setConflict] = useState(null);
  const revisionRef = useRef(revision);
  const lastSavedSignatureRef = useRef('');
  const inFlightSignatureRef = useRef('');
  const loadedBaselineRef = useRef('');
  const latestSignatureRef = useRef('');
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  const [saveTick, setSaveTick] = useState(0);

  const onSavedRef = useRef(onSaved);
  const onConflictRef = useRef(onConflict);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    onSavedRef.current = onSaved;
    onConflictRef.current = onConflict;
    onErrorRef.current = onError;
  }, [onConflict, onError, onSaved]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const signature = useMemo(() => buildAutosaveSignature(document, settings), [document, settings]);

  useEffect(() => {
    latestSignatureRef.current = signature;
  }, [signature]);

  useEffect(() => {
    if (!enabled || !templateId || !document || !settings || !signature) return;
    const nextBaselineKey = `${templateId || ''}:${baselineKey || 'initial'}`;
    if (loadedBaselineRef.current === nextBaselineKey) return;
    loadedBaselineRef.current = nextBaselineKey;
    lastSavedSignatureRef.current = signature;
  }, [baselineKey, document, enabled, settings, signature, templateId]);

  useEffect(() => {
    if (!enabled || !templateId || !document || !settings) return undefined;
    if (!signature || signature === lastSavedSignatureRef.current || signature === inFlightSignatureRef.current) return undefined;
    if (inFlightSignatureRef.current) return undefined;
    if (conflict) return undefined;

    setStatus(current => (current === 'saving' ? current : 'dirty'));
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      inFlightSignatureRef.current = signature;
      setStatus('saving');
      setLastError('');
      try {
        const payload = {
          revision: revisionRef.current,
          layout_json: document,
          settings_json: settings,
          editor_meta_json: buildEditorMeta(settings),
        };
        const data = await printTemplatesApi.autosave(templateId, payload);
        const item = unwrapAutosaveItem(data);
        const nextRevision = item?.revision || data?.revision || revisionRef.current;
        revisionRef.current = nextRevision;
        lastSavedSignatureRef.current = signature;
        if (mountedRef.current) {
          setStatus('saved');
          setLastSavedAt(new Date().toISOString());
          setConflict(null);
        }
        onSavedRef.current?.(item, data);
      } catch (error) {
        if (isRevisionConflict(error)) {
          const serverRevision = error?.data?.details?.current_revision || error?.data?.current_revision || null;
          if (serverRevision && serverRevision !== revisionRef.current) {
            revisionRef.current = serverRevision;
            lastSavedSignatureRef.current = '';
            inFlightSignatureRef.current = '';
            if (mountedRef.current) {
              setStatus('dirty');
              setConflict(null);
              setSaveTick(v => v + 1);
            }
            return;
          }
          const nextConflict = {
            message: error?.message || 'M\u1EABu in \u0111\u00E3 \u0111\u01B0\u1EE3c c\u1EADp nh\u1EADt \u1EDF phi\u00EAn kh\u00E1c.',
            currentRevision: serverRevision,
            expectedRevision: error?.data?.details?.expected_revision || error?.data?.expected_revision || revisionRef.current,
          };
          if (mountedRef.current) {
            setStatus('conflict');
            setConflict(nextConflict);
          }
          onConflictRef.current?.(nextConflict, error);
        } else {
          const message = error?.message || 'Autosave mẫu in thất bại.';
          if (mountedRef.current) {
            setStatus('error');
            setLastError(message);
          }
          onErrorRef.current?.(error);
        }
      } finally {
        inFlightSignatureRef.current = '';
        if (mountedRef.current && latestSignatureRef.current && latestSignatureRef.current !== lastSavedSignatureRef.current) {
          setSaveTick(value => value + 1);
        }
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [conflict, debounceMs, document, enabled, saveTick, settings, signature, templateId]);

  const markSaved = useCallback((item = null) => {
    lastSavedSignatureRef.current = buildAutosaveSignature(document, settings);
    latestSignatureRef.current = lastSavedSignatureRef.current;
    if (item?.revision) revisionRef.current = item.revision;
    setStatus('saved');
    setLastSavedAt(new Date().toISOString());
    setConflict(null);
    setLastError('');
  }, [document, settings]);

  const resetAutosave = useCallback((nextRevision = revisionRef.current) => {
    revisionRef.current = nextRevision;
    lastSavedSignatureRef.current = buildAutosaveSignature(document, settings);
    latestSignatureRef.current = lastSavedSignatureRef.current;
    inFlightSignatureRef.current = '';
    loadedBaselineRef.current = `${templateId || ''}:${baselineKey || 'initial'}`;
    setStatus('idle');
    setConflict(null);
    setLastError('');
  }, [baselineKey, document, settings, templateId]);

  const markConflict = useCallback((nextConflict) => {
    setStatus('conflict');
    setConflict(nextConflict || { message: 'Mẫu in đã được cập nhật ? phiđơn kh?c.' });
  }, []);

  const isDirty = Boolean(signature && signature !== lastSavedSignatureRef.current);

  return {
    status,
    lastSavedAt,
    lastError,
    conflict,
    isDirty,
    markSaved,
    markConflict,
    resetAutosave,
    setConflict,
  };
}

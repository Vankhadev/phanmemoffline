import { useEffect, useMemo, useRef, useState } from 'react';
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

function isRevisionConflict(error) {
  const code = error?.data?.code || error?.code || '';
  return Number(error?.status) === 409 || code === 'PRINT_TEMPLATE_REVISION_CONFLICT';
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
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const signature = useMemo(() => stableStringify({ document, settings }), [document, settings]);

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
        const item = data?.item || data?.data || data;
        const nextRevision = item?.revision || data?.revision || revisionRef.current;
        revisionRef.current = nextRevision;
        lastSavedSignatureRef.current = signature;
        if (mountedRef.current) {
          setStatus('saved');
          setLastSavedAt(new Date().toISOString());
          setConflict(null);
        }
        onSaved?.(item, data);
      } catch (error) {
        if (isRevisionConflict(error)) {
          const nextConflict = {
            message: error?.message || 'Mẫu in đã được cập nhật ở phiên khác.',
            currentRevision: error?.data?.details?.current_revision || error?.data?.current_revision || null,
            expectedRevision: error?.data?.details?.expected_revision || error?.data?.expected_revision || revisionRef.current,
          };
          if (mountedRef.current) {
            setStatus('conflict');
            setConflict(nextConflict);
          }
          onConflict?.(nextConflict, error);
        } else {
          const message = error?.message || 'Autosave mẫu in thất bại.';
          if (mountedRef.current) {
            setStatus('error');
            setLastError(message);
          }
          onError?.(error);
        }
      } finally {
        inFlightSignatureRef.current = '';
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [conflict, debounceMs, document, enabled, onConflict, onError, onSaved, settings, signature, templateId]);

  const markSaved = (item = null) => {
    lastSavedSignatureRef.current = stableStringify({ document, settings });
    if (item?.revision) revisionRef.current = item.revision;
    setStatus('saved');
    setLastSavedAt(new Date().toISOString());
    setConflict(null);
    setLastError('');
  };

  const resetAutosave = (nextRevision = revisionRef.current) => {
    revisionRef.current = nextRevision;
    lastSavedSignatureRef.current = stableStringify({ document, settings });
    inFlightSignatureRef.current = '';
    loadedBaselineRef.current = String(templateId || '');
    setStatus('idle');
    setConflict(null);
    setLastError('');
  };

  const markConflict = (nextConflict) => {
    setStatus('conflict');
    setConflict(nextConflict || { message: 'Mẫu in đã được cập nhật ở phiên khác.' });
  };

  return {
    status,
    lastSavedAt,
    lastError,
    conflict,
    markSaved,
    markConflict,
    resetAutosave,
    setConflict,
  };
}

import { useCallback, useMemo, useState } from 'react';
import {
  buildTemplatePayloadFromDocument,
  clampFrameToZone,
  createEditorElement,
  getActiveEditorDocument,
  getTableStyleElement,
  normalizeEditorDocument,
  normalizeEditorSettings,
  TABLE_STYLE_ELEMENT_ID,
  updateDocumentElement,
  updateDocumentTable,
} from './templateSchemaAdapter';

function getInitialSelectedId(document = {}) {
  const firstVisible = (document.elements || []).find(element => element.id !== TABLE_STYLE_ELEMENT_ID && element.visible !== false);
  return firstVisible?.id || document.table?.id || '';
}

export default function useTemplateEditorState(initialTemplate = {}) {
  const initial = useMemo(() => getActiveEditorDocument(initialTemplate, { preferDraft: true }), [initialTemplate]);
  const [template, setTemplate] = useState(initialTemplate);
  const [document, setDocument] = useState(initial.document);
  const [settings, setSettings] = useState(initial.settings);
  const [revision, setRevision] = useState(initial.revision);
  const [activeSource, setActiveSource] = useState(initial.source);
  const [selectedId, setSelectedId] = useState(() => getInitialSelectedId(initial.document));

  const zonesById = useMemo(() => new Map((document.zones || []).map(zone => [zone.id, zone])), [document.zones]);
  const selectedElement = useMemo(() => {
    if (selectedId === document.table?.id || selectedId === 'itemsTable') return { type: 'itemsTable', id: document.table?.id || 'itemsTable', table: document.table, styleElement: getTableStyleElement(document) };
    return (document.elements || []).find(element => element.id === selectedId) || null;
  }, [document, selectedId]);

  const setTemplateFromServer = useCallback((nextTemplate, options = {}) => {
    if (!nextTemplate) return;
    const next = getActiveEditorDocument(nextTemplate, { preferDraft: options.preferDraft !== false });
    setTemplate(nextTemplate);
    setDocument(next.document);
    setSettings(next.settings);
    setRevision(next.revision);
    setActiveSource(next.source);
    setSelectedId(current => {
      if (current === 'itemsTable') return current;
      if ((next.document.elements || []).some(element => element.id === current)) return current;
      return getInitialSelectedId(next.document);
    });
  }, []);

  const updateDocument = useCallback((updater) => {
    setDocument(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      return normalizeEditorDocument(next, template);
    });
    setActiveSource('draft');
  }, [template]);

  const updateSettings = useCallback((updater) => {
    setSettings(current => normalizeEditorSettings(typeof updater === 'function' ? updater(current) : updater, { revision, hasDraft: true }));
    setActiveSource('draft');
  }, [revision]);

  const updateElement = useCallback((elementId, updater) => {
    updateDocument(current => updateDocumentElement(current, elementId, element => {
      const next = typeof updater === 'function' ? updater(element) : { ...element, ...updater };
      const nextType = next.type || element.type;
      const zone = zonesById.get(next.zoneId || element.zoneId) || zonesById.get(element.zoneId);
      if (zone && next.frame && elementId !== TABLE_STYLE_ELEMENT_ID) next.frame = clampFrameToZone(next.frame, zone, { minW: nextType === 'line' ? 2 : 3, minH: nextType === 'line' ? 0.5 : 3 });
      return next;
    }));
  }, [updateDocument, zonesById]);

  const updateTable = useCallback((updater) => {
    updateDocument(current => updateDocumentTable(current, table => (typeof updater === 'function' ? updater(table) : { ...table, ...updater })));
  }, [updateDocument]);

  const addElement = useCallback((type, options = {}) => {
    updateDocument(current => {
      const element = createEditorElement(type, current, options);
      setSelectedId(element.id);
      return { ...current, elements: [...(current.elements || []), element] };
    });
  }, [updateDocument]);

  const removeElement = useCallback((elementId) => {
    if (elementId === TABLE_STYLE_ELEMENT_ID) return;
    updateDocument(current => ({ ...current, elements: (current.elements || []).filter(element => element.id !== elementId) }));
    setSelectedId('itemsTable');
  }, [updateDocument]);

  const duplicateElement = useCallback((elementId) => {
    updateDocument(current => {
      const element = (current.elements || []).find(item => item.id === elementId);
      if (!element || element.id === TABLE_STYLE_ELEMENT_ID) return current;
      const zone = zonesById.get(element.zoneId);
      const copy = {
        ...element,
        id: `${element.type}-${Date.now().toString(36)}`,
        frame: clampFrameToZone({ ...element.frame, x: Number(element.frame.x || 0) + 2, y: Number(element.frame.y || 0) + 2 }, zone),
        zIndex: Math.max(0, ...(current.elements || []).map(item => Number(item.zIndex) || 0)) + 10,
      };
      setSelectedId(copy.id);
      return { ...current, elements: [...(current.elements || []), copy] };
    });
  }, [updateDocument, zonesById]);

  const buildPayload = useCallback(() => buildTemplatePayloadFromDocument(template, document, settings), [document, settings, template]);

  return {
    template,
    document,
    settings,
    revision,
    activeSource,
    selectedId,
    selectedElement,
    zonesById,
    setTemplate,
    setDocument: updateDocument,
    setSettings: updateSettings,
    setRevision,
    setSelectedId,
    setTemplateFromServer,
    updateElement,
    updateTable,
    addElement,
    removeElement,
    duplicateElement,
    buildPayload,
  };
}

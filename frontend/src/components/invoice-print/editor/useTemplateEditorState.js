import { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildTemplatePayloadFromDocument,
  clampFrameToZone,
  cloneJson,
  createEditorElement,
  getActiveEditorDocument,
  getTableStyleElement,
  normalizeEditorDocument,
  normalizeEditorSettings,
  TABLE_STYLE_ELEMENT_ID,
  updateDocumentElement,
  updateDocumentTable,
} from './templateSchemaAdapter';

const MAX_HISTORY_ENTRIES = 80;

function getInitialSelectedId(document = {}) {
  const firstVisible = (document.elements || []).find(element => element.id !== TABLE_STYLE_ELEMENT_ID && element.visible !== false);
  return firstVisible?.id || document.table?.id || '';
}

function createHistorySnapshot(document, settings) {
  return {
    document: cloneJson(document),
    settings: cloneJson(settings),
  };
}

function snapshotsMatch(left, right) {
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export default function useTemplateEditorState(initialTemplate = {}) {
  // Mặc định load bđơn PUBLISHED (không đủ tiđơn draft c?).
  const initial = useMemo(() => getActiveEditorDocument(initialTemplate, { preferDraft: false }), [initialTemplate]);
  const [template, setTemplate] = useState(initialTemplate);
  const [document, setDocument] = useState(initial.document);
  const [settings, setSettings] = useState(initial.settings);
  const [revision, setRevision] = useState(initial.revision);
  const [activeSource, setActiveSource] = useState(initial.source);
  const [selectedId, setSelectedId] = useState(() => getInitialSelectedId(initial.document));
  const documentRef = useRef(initial.document);
  const settingsRef = useRef(initial.settings);
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const transactionRef = useRef(null);
  const [, setHistoryVersion] = useState(0);

  const zonesById = useMemo(() => new Map((document.zones || []).map(zone => [zone.id, zone])), [document.zones]);
  const selectedElement = useMemo(() => {
    if (selectedId === document.table?.id || selectedId === 'itemsTable') return { type: 'itemsTable', id: document.table?.id || 'itemsTable', table: document.table, styleElement: getTableStyleElement(document) };
    return (document.elements || []).find(element => element.id === selectedId) || null;
  }, [document, selectedId]);

  const setTemplateFromServer = useCallback((nextTemplate, options = {}) => {
    if (!nextTemplate) return;
    // Mặc định đủ tiđơn bđơn published tr? khi caller yđủ cđủ draft.
    const next = getActiveEditorDocument(nextTemplate, { preferDraft: options.preferDraft === true });
    setTemplate(nextTemplate);
    documentRef.current = next.document;
    settingsRef.current = next.settings;
    setDocument(next.document);
    setSettings(next.settings);
    setRevision(next.revision);
    setActiveSource(next.source);
    pastRef.current = [];
    futureRef.current = [];
    transactionRef.current = null;
    setHistoryVersion(version => version + 1);
    setSelectedId(current => {
      if (current === 'itemsTable') return current;
      if ((next.document.elements || []).some(element => element.id === current)) return current;
      return getInitialSelectedId(next.document);
    });
  }, []);

  const pushHistory = useCallback((snapshot) => {
    const currentPast = pastRef.current;
    const last = currentPast[currentPast.length - 1];
    if (last && snapshotsMatch(last, snapshot)) return;
    pastRef.current = [...currentPast, snapshot].slice(-MAX_HISTORY_ENTRIES);
    futureRef.current = [];
    setHistoryVersion(version => version + 1);
  }, []);

  const beginHistory = useCallback(() => {
    if (transactionRef.current) return;
    transactionRef.current = createHistorySnapshot(documentRef.current, settingsRef.current);
  }, []);

  const endHistory = useCallback(() => {
    const initialSnapshot = transactionRef.current;
    transactionRef.current = null;
    if (!initialSnapshot) return;
    const currentSnapshot = createHistorySnapshot(documentRef.current, settingsRef.current);
    if (!snapshotsMatch(initialSnapshot, currentSnapshot)) pushHistory(initialSnapshot);
  }, [pushHistory]);

  const updateDocument = useCallback((updater) => {
    const current = documentRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    const normalized = normalizeEditorDocument(next, template);
    if (!transactionRef.current) pushHistory(createHistorySnapshot(current, settingsRef.current));
    documentRef.current = normalized;
    setDocument(normalized);
    setActiveSource('draft');
  }, [pushHistory, template]);

  const updateSettings = useCallback((updater) => {
    const current = settingsRef.current;
    const next = normalizeEditorSettings(typeof updater === 'function' ? updater(current) : updater, { revision, hasDraft: true });
    if (!transactionRef.current) pushHistory(createHistorySnapshot(documentRef.current, current));
    settingsRef.current = next;
    setSettings(next);
    setActiveSource('draft');
  }, [pushHistory, revision]);

  const applyHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const nextDocument = normalizeEditorDocument(snapshot.document, template);
    const nextSettings = normalizeEditorSettings(snapshot.settings, { revision, hasDraft: true });
    documentRef.current = nextDocument;
    settingsRef.current = nextSettings;
    setDocument(nextDocument);
    setSettings(nextSettings);
    setActiveSource('draft');
    setSelectedId(current => {
      if (current === 'itemsTable') return current;
      if ((nextDocument.elements || []).some(element => element.id === current)) return current;
      return getInitialSelectedId(nextDocument);
    });
  }, [revision, template]);

  const undo = useCallback(() => {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    const current = createHistorySnapshot(documentRef.current, settingsRef.current);
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, current].slice(-MAX_HISTORY_ENTRIES);
    transactionRef.current = null;
    applyHistorySnapshot(previous);
    setHistoryVersion(version => version + 1);
  }, [applyHistorySnapshot]);

  const redo = useCallback(() => {
    const next = futureRef.current[futureRef.current.length - 1];
    if (!next) return;
    const current = createHistorySnapshot(documentRef.current, settingsRef.current);
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, current].slice(-MAX_HISTORY_ENTRIES);
    transactionRef.current = null;
    applyHistorySnapshot(next);
    setHistoryVersion(version => version + 1);
  }, [applyHistorySnapshot]);

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

  const bringElementToFront = useCallback((elementId) => {
    updateDocument(current => {
      const maxZIndex = Math.max(0, ...(current.elements || []).map(element => Number(element.zIndex) || 0));
      return updateDocumentElement(current, elementId, element => ({ ...element, zIndex: maxZIndex + 10 }));
    });
  }, [updateDocument]);

  const sendElementToBack = useCallback((elementId) => {
    updateDocument(current => {
      const editableZIndexes = (current.elements || [])
        .filter(element => element.id !== TABLE_STYLE_ELEMENT_ID)
        .map(element => Number(element.zIndex) || 0);
      const minZIndex = Math.min(10, ...editableZIndexes);
      return updateDocumentElement(current, elementId, element => ({ ...element, zIndex: Math.max(1, minZIndex - 10) }));
    });
  }, [updateDocument]);

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
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
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
    bringElementToFront,
    sendElementToBack,
    beginHistory,
    endHistory,
    undo,
    redo,
    buildPayload,
  };
}

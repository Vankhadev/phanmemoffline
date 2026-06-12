/**
 * KHA Data Guardian - Transaction Journal (WAL - Write-Ahead Log)
 * 
 * Ghi nhật ký giao dịch liên tục (append-only JSONL) để chống mất dữ liệu
 * khi mất điện, crash, hoặc tắt máy đột ngột.
 * 
 * Mỗi thay đổi DB được ghi vào journal TRƯỚC khi commit vào DB chính.
 * Khi khởi động lại sau crash: replay journal để khôi phục dữ liệu.
 */
const fs = require('fs');
const path = require('path');

const JOURNAL_FILE_NAME = 'kha-transaction-journal.jsonl';
const JOURNAL_COMMIT_MARKER = 'kha-journal-committed.marker';
const JOURNAL_MAX_SIZE = 5 * 1024 * 1024; // 5MB - auto rotate
const JOURNAL_MAX_ROTATED = 3;
const JOURNAL_FLUSH_INTERVAL_MS = 2000; // flush buffer every 2 seconds

let journalPath = null;
let commitMarkerPath = null;
let journalFd = null;
let journalBuffer = [];
let flushTimer = null;
let entryCount = 0;
let initialized = false;
let pendingEntries = 0;

function initialize(options = {}) {
  const dataDir = options.dataDir || process.env.ELECTRON_USER_DATA || path.resolve(__dirname, '..', '..', 'data');
  journalPath = path.join(dataDir, JOURNAL_FILE_NAME);
  commitMarkerPath = path.join(dataDir, JOURNAL_COMMIT_MARKER);

  try {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  } catch (_) {}

  // Open journal file for appending
  try {
    journalFd = fs.openSync(journalPath, 'a');
  } catch (error) {
    console.error(`[KHA JOURNAL] Cannot open journal file: ${error.message}`);
    return;
  }

  // Start periodic flush
  flushTimer = setInterval(() => flushBuffer(), JOURNAL_FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();

  initialized = true;
  console.log(`[KHA JOURNAL] Initialized. Path: ${journalPath}`);
}

/**
 * Write a journal entry BEFORE the actual DB write happens.
 */
function writeEntry(operation, table, rowId, data = {}) {
  if (!initialized || journalFd === null) return;

  const entry = {
    ts: Date.now(),
    op: operation, // 'insert' | 'update' | 'delete'
    tbl: table,
    id: rowId,
    d: data.after || data.row || null,
    seq: ++entryCount,
  };

  // Only include before-state for updates/deletes (keep journal compact)
  if ((operation === 'update' || operation === 'delete') && data.before) {
    entry.b = data.before;
  }

  journalBuffer.push(JSON.stringify(entry));
  pendingEntries++;

  // Flush immediately for critical tables
  const criticalTables = ['invoices', 'invoice_details', 'customers', 'products', 'import_logs', 'import_details', 'partners'];
  if (criticalTables.includes(table) || journalBuffer.length >= 50) {
    flushBuffer();
  }
}

function flushBuffer() {
  if (journalFd === null || journalBuffer.length === 0) return;

  const data = journalBuffer.join('\n') + '\n';
  journalBuffer = [];

  try {
    fs.writeSync(journalFd, data);
    fs.fsyncSync(journalFd);
  } catch (error) {
    console.error(`[KHA JOURNAL] Flush error: ${error.message}`);
  }
}

/**
 * Mark that all journal entries have been successfully committed to DB.
 * This is called AFTER saveDB() succeeds.
 */
function markCommitted() {
  if (!initialized) return;

  flushBuffer();

  try {
    fs.writeFileSync(commitMarkerPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      entryCount,
      journalSize: getJournalSize(),
    }), 'utf8');
  } catch (_) {}

  pendingEntries = 0;

  // Rotate if needed
  rotateIfNeeded();
}

/**
 * Check if there are uncommitted journal entries (indicates crash/power loss).
 * Called during startup.
 */
function hasUncommittedEntries() {
  if (!journalPath || !fs.existsSync(journalPath)) return false;

  try {
    const journalStat = fs.statSync(journalPath);
    if (journalStat.size === 0) return false;

    // If commit marker doesn't exist or is older than journal → uncommitted entries
    if (!fs.existsSync(commitMarkerPath)) return true;

    const markerStat = fs.statSync(commitMarkerPath);
    return journalStat.mtimeMs > markerStat.mtimeMs;
  } catch (_) {
    return false;
  }
}

/**
 * Read all uncommitted journal entries for replay.
 * Returns entries sorted by sequence number.
 */
function readUncommittedEntries() {
  if (!journalPath || !fs.existsSync(journalPath)) return [];

  try {
    let lastCommitTime = 0;
    if (fs.existsSync(commitMarkerPath)) {
      try {
        const marker = JSON.parse(fs.readFileSync(commitMarkerPath, 'utf8'));
        lastCommitTime = new Date(marker.timestamp).getTime() || 0;
      } catch (_) {}
    }

    const content = fs.readFileSync(journalPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.ts > lastCommitTime) {
          entries.push(entry);
        }
      } catch (_) {}
    }

    return entries.sort((a, b) => a.seq - b.seq);
  } catch (error) {
    console.error(`[KHA JOURNAL] Read error: ${error.message}`);
    return [];
  }
}

/**
 * Replay uncommitted entries against the current database.
 * @param {object} dbModule - The database module (for getDb, insert, update)
 * @returns {object} Replay statistics
 */
function replayUncommittedEntries(dbModule) {
  const entries = readUncommittedEntries();
  if (entries.length === 0) {
    return { replayed: 0, skipped: 0, errors: 0 };
  }

  console.log(`[KHA JOURNAL] Replaying ${entries.length} uncommitted entries...`);
  const stats = { replayed: 0, skipped: 0, errors: 0 };
  const db = dbModule.getDb();

  for (const entry of entries) {
    try {
      const table = entry.tbl;
      if (!db[table] || !Array.isArray(db[table])) {
        stats.skipped++;
        continue;
      }

      const existingRow = db[table].find(row => row && row.id === entry.id);

      if (entry.op === 'insert') {
        if (!existingRow && entry.d) {
          db[table].push(entry.d);
          stats.replayed++;
        } else {
          stats.skipped++;
        }
      } else if (entry.op === 'update') {
        if (existingRow && entry.d) {
          Object.assign(existingRow, entry.d);
          stats.replayed++;
        } else {
          stats.skipped++;
        }
      } else if (entry.op === 'delete') {
        // We don't actually delete for safety - just mark it
        stats.skipped++;
      } else {
        stats.skipped++;
      }
    } catch (error) {
      console.error(`[KHA JOURNAL] Replay error for entry seq=${entry.seq}: ${error.message}`);
      stats.errors++;
    }
  }

  console.log(`[KHA JOURNAL] Replay complete: ${stats.replayed} replayed, ${stats.skipped} skipped, ${stats.errors} errors`);
  return stats;
}

function getJournalSize() {
  try {
    if (journalPath && fs.existsSync(journalPath)) {
      return fs.statSync(journalPath).size;
    }
  } catch (_) {}
  return 0;
}

function rotateIfNeeded() {
  const size = getJournalSize();
  if (size < JOURNAL_MAX_SIZE) return;

  try {
    // Close current fd
    if (journalFd !== null) {
      fs.closeSync(journalFd);
      journalFd = null;
    }

    // Rotate: journal.jsonl → journal.jsonl.1, journal.jsonl.1 → journal.jsonl.2, etc.
    for (let i = JOURNAL_MAX_ROTATED; i >= 1; i--) {
      const src = i === 1 ? journalPath : `${journalPath}.${i - 1}`;
      const dst = `${journalPath}.${i}`;
      if (fs.existsSync(src)) {
        if (i === JOURNAL_MAX_ROTATED) {
          fs.unlinkSync(src);
        } else {
          fs.renameSync(src, dst);
        }
      }
    }

    // Rename current to .1
    if (fs.existsSync(journalPath)) {
      fs.renameSync(journalPath, `${journalPath}.1`);
    }

    // Open new journal
    journalFd = fs.openSync(journalPath, 'a');
    entryCount = 0;
  } catch (error) {
    console.error(`[KHA JOURNAL] Rotate error: ${error.message}`);
    // Try to reopen
    try {
      journalFd = fs.openSync(journalPath, 'a');
    } catch (_) {}
  }
}

function getStatus() {
  return {
    initialized,
    journalPath,
    journalSize: getJournalSize(),
    entryCount,
    pendingEntries,
    hasUncommitted: hasUncommittedEntries(),
  };
}

function shutdown() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushBuffer();
  if (journalFd !== null) {
    try {
      fs.closeSync(journalFd);
    } catch (_) {}
    journalFd = null;
  }
  initialized = false;
}

module.exports = {
  initialize,
  writeEntry,
  flushBuffer,
  markCommitted,
  hasUncommittedEntries,
  readUncommittedEntries,
  replayUncommittedEntries,
  getStatus,
  shutdown,
};

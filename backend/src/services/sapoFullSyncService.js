// Compatibility shim for older imports that referenced sapoFullSyncService.
// The maintained Sapo implementation now lives in sapoSyncService.
module.exports = require('./sapoSyncService');
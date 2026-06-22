class EventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    console.log(`[SYNC] Emit ${event}`);
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`Error in event listener for ${event}:`, err);
      }
    });
  }
}

export const globalSyncEmitter = new EventEmitter();

export function emitGlobalSyncEvents(changedTables, op = null, data = null) {
  const tables = Array.isArray(changedTables) ? changedTables : [changedTables];
  
  tables.forEach(table => {
    switch (table) {
      case 'invoices':
      case 'invoice_details':
        if (op === 'insert') {
          globalSyncEmitter.emit('ORDER_CREATED', data);
        } else if (op === 'update') {
          globalSyncEmitter.emit('ORDER_UPDATED', data);
        } else if (op === 'delete') {
          globalSyncEmitter.emit('ORDER_DELETED', data);
        } else {
          globalSyncEmitter.emit('ORDER_UPDATED', data);
        }
        // Orders also affect inventory and debt
        globalSyncEmitter.emit('PRODUCT_UPDATED', data);
        globalSyncEmitter.emit('DEBT_UPDATED', data);
        break;

      case 'customers':
        if (op === 'insert') {
          globalSyncEmitter.emit('CUSTOMER_CREATED', data);
        } else {
          globalSyncEmitter.emit('CUSTOMER_UPDATED', data);
        }
        globalSyncEmitter.emit('DEBT_UPDATED', data);
        break;

      case 'products':
      case 'product_categories':
      case 'combos':
        globalSyncEmitter.emit('PRODUCT_UPDATED', data);
        break;

      case 'import_logs':
      case 'import_details':
        globalSyncEmitter.emit('PRODUCT_IMPORTED', data);
        globalSyncEmitter.emit('PRODUCT_UPDATED', data);
        break;

      case 'cash_book':
        globalSyncEmitter.emit('DEBT_UPDATED', data);
        break;

      case 'partners':
        if (op === 'insert') {
          globalSyncEmitter.emit('PARTNER_CREATED', data);
        } else if (op === 'delete') {
          globalSyncEmitter.emit('PARTNER_DELETED', data);
        } else {
          globalSyncEmitter.emit('PARTNER_UPDATED', data);
        }
        // Backward-compatible alias because some screens still listen to
        // the customer-shaped events for the suppliers page.
        globalSyncEmitter.emit('CUSTOMER_UPDATED', data);
        break;

      case 'customer_types':
        if (op === 'insert') {
          globalSyncEmitter.emit('CUSTOMER_TYPE_CREATED', data);
        } else if (op === 'delete') {
          globalSyncEmitter.emit('CUSTOMER_TYPE_DELETED', data);
        } else {
          globalSyncEmitter.emit('CUSTOMER_TYPE_UPDATED', data);
        }
        globalSyncEmitter.emit('CUSTOMER_UPDATED', data);
        break;

      default:
        break;
    }
  });
}

const {
  insert,
  auditLog,
  now,
  getActiveAccountId,
} = require('../db/database');

function cloneForLog(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function resolveEntity(entity = {}) {
  if (typeof entity === 'string') {
    return { entity_type: entity, entity_id: null, entity_code: '' };
  }
  return {
    entity_type: entity.type || entity.entity_type || entity.table || entity.name || '',
    entity_id: entity.id || entity.entity_id || null,
    entity_code: entity.code || entity.entity_code || entity.invoice_code || entity.import_code || entity.sku || '',
  };
}

function resolveUser(req = null, options = {}) {
  return {
    user_id: options.userId || req?.user?.id || null,
    user_name: options.userName || req?.user?.name || req?.user?.email || '',
    ip: options.ip || req?.ip || req?.connection?.remoteAddress || '',
    user_agent: options.userAgent || req?.headers?.['user-agent'] || '',
  };
}

function logActivity(req, action, entity = {}, before = null, after = null, content = '', options = {}) {
  try {
    const timestamp = options.timestamp || now();
    const resolvedEntity = resolveEntity(entity);
    const user = resolveUser(req, options);
    const accountId = options.accountId || req?.accountId || req?.account?.id || req?.user?.account_id || getActiveAccountId();
    const payload = {
      account_id: accountId,
      user_id: user.user_id,
      user_name: user.user_name,
      action: String(action || '').trim(),
      entity_type: resolvedEntity.entity_type,
      entity_id: resolvedEntity.entity_id,
      entity_code: resolvedEntity.entity_code,
      content: content || `${action || 'activity'} ${resolvedEntity.entity_type || ''} ${resolvedEntity.entity_code || resolvedEntity.entity_id || ''}`.trim(),
      before: cloneForLog(before),
      after: cloneForLog(after),
      ip: user.ip,
      user_agent: String(user.user_agent || '').slice(0, 500),
      created_at: timestamp,
    };
    const id = insert('accounting_logs', payload, { skipSave: options.skipSave === true, accountId });
    auditLog(action, {
      account_id: accountId,
      user_id: user.user_id,
      entity: resolvedEntity,
      content: payload.content,
    }, { skipSave: options.skipSave === true });
    return { id, ...payload };
  } catch (error) {
    if (options.rethrowOnError) throw error;
    return null;
  }
}

function logDataDeletion(req, entity = {}, before = null, options = {}) {
  const resolved = resolveEntity(entity);
  return logActivity(
    req,
    options.action || 'data.delete',
    resolved,
    before,
    null,
    options.content || `Xóa dữ liệu ${resolved.entity_type || ''} ${resolved.entity_code || resolved.entity_id || ''}`.trim(),
    options,
  );
}

module.exports = {
  logActivity,
  logDataDeletion,
};

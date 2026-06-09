const express = require('express');
const {
  getAll,
  getOne,
  insert,
  update,
  remove,
  now,
  withAtomicDbWrite,
} = require('../db/database');

const router = express.Router();

const PLATFORM_META = {
  tiktok: { key: 'tiktok', name: 'TikTok', orderPrefix: 'TT' },
  shopee: { key: 'shopee', name: 'Shopee', orderPrefix: 'SP' },
  lazada: { key: 'lazada', name: 'Lazada', orderPrefix: 'LZ' },
  tiki: { key: 'tiki', name: 'Tiki', orderPrefix: 'TK' },
};

const DATE_FIELDS = ['order_date', 'picked_at', 'transit_at', 'delivered_at', 'returned_at'];
const VALID_ORDER_STATUSES = new Set(['new', 'picked', 'in_transit', 'delivered', 'returned', 'cancelled']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePlatform(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === 'tik tok' || raw === 'tiktokshop' || raw === 'tiktok_shop') return 'tiktok';
  if (raw === 'shoppe' || raw === 'shopeefood') return 'shopee';
  if (raw === 'lazada.vn') return 'lazada';
  return PLATFORM_META[raw] ? raw : '';
}

function getPlatformMeta(platform) {
  return PLATFORM_META[normalizePlatform(platform)] || null;
}

function normalizeDateOnly(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function normalizeMoney(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

function normalizeOrderStatus(value) {
  const status = normalizeText(value).toLowerCase();
  return VALID_ORDER_STATUSES.has(status) ? status : 'new';
}

function hasSecretValue(value) {
  return normalizeText(value) && !normalizeText(value).startsWith('••••');
}

function sanitizeShop(row = {}) {
  const platform = normalizePlatform(row.platform);
  const meta = getPlatformMeta(platform);
  return {
    id: row.id,
    account_id: row.account_id,
    platform,
    platform_name: meta?.name || row.platform_name || platform,
    shop_name: row.shop_name || row.name || '',
    shop_code: row.shop_code || '',
    seller_id: row.seller_id || '',
    connected_at: row.connected_at || row.created_at || '',
    last_sync_at: row.last_sync_at || '',
    sync_status: row.sync_status || 'connected',
    credentials_configured: Boolean(row.credentials_configured || row.access_token || row.refresh_token || row.app_key),
    active: row.active === 0 ? 0 : 1,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function sanitizeOrder(row = {}) {
  const platform = normalizePlatform(row.platform);
  const meta = getPlatformMeta(platform);
  const shop = row.shop_id ? getOne('marketplace_shops', item => Number(item.id) === Number(row.shop_id)) : null;
  return {
    id: row.id,
    account_id: row.account_id,
    platform,
    platform_name: meta?.name || row.platform_name || platform,
    shop_id: row.shop_id || null,
    shop_name: row.shop_name || shop?.shop_name || '',
    order_code: row.order_code || '',
    customer_name: row.customer_name || '',
    phone: row.phone || '',
    total: normalizeMoney(row.total),
    status: normalizeOrderStatus(row.status),
    raw_status: row.raw_status || '',
    order_date: row.order_date || '',
    picked_at: row.picked_at || '',
    transit_at: row.transit_at || '',
    delivered_at: row.delivered_at || '',
    returned_at: row.returned_at || '',
    note: row.note || '',
    source: row.source || 'manual',
    last_synced_at: row.last_synced_at || '',
    active: row.active === 0 ? 0 : 1,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function buildShopPayload(body = {}, existing = {}) {
  const platform = normalizePlatform(body.platform || existing.platform);
  const meta = getPlatformMeta(platform);
  if (!meta) {
    const err = new Error('Sàn thương mại điện tử không hợp lệ.');
    err.status = 400;
    throw err;
  }

  const shopName = normalizeText(body.shop_name || body.name || existing.shop_name);
  if (!shopName) {
    const err = new Error('Vui lòng nhập tên gian hàng.');
    err.status = 400;
    throw err;
  }

  const payload = {
    platform,
    platform_name: meta.name,
    shop_name: shopName,
    shop_code: normalizeText(body.shop_code ?? existing.shop_code),
    seller_id: normalizeText(body.seller_id ?? existing.seller_id),
    sync_status: normalizeText(body.sync_status || existing.sync_status || 'connected'),
    active: body.active === 0 ? 0 : 1,
    updated_at: now(),
  };

  if (hasSecretValue(body.app_key)) payload.app_key = normalizeText(body.app_key);
  if (hasSecretValue(body.access_token)) payload.access_token = normalizeText(body.access_token);
  if (hasSecretValue(body.refresh_token)) payload.refresh_token = normalizeText(body.refresh_token);
  payload.credentials_configured = Boolean(
    payload.app_key ||
    payload.access_token ||
    payload.refresh_token ||
    existing.app_key ||
    existing.access_token ||
    existing.refresh_token ||
    body.credentials_configured
  );

  return payload;
}

function buildOrderPayload(body = {}, existing = {}) {
  const platform = normalizePlatform(body.platform || existing.platform);
  const meta = getPlatformMeta(platform);
  if (!meta) {
    const err = new Error('Sàn thương mại điện tử không hợp lệ.');
    err.status = 400;
    throw err;
  }

  const orderCode = normalizeText(body.order_code || existing.order_code);
  if (!orderCode) {
    const err = new Error('Vui lòng nhập mã đơn hàng trên sàn.');
    err.status = 400;
    throw err;
  }

  const shopId = Number(body.shop_id ?? existing.shop_id) || null;
  const shop = shopId ? getOne('marketplace_shops', row => Number(row.id) === shopId) : null;
  const payload = {
    platform,
    platform_name: meta.name,
    shop_id: shop?.id || shopId,
    shop_name: normalizeText(body.shop_name || shop?.shop_name || existing.shop_name),
    order_code: orderCode,
    customer_name: normalizeText(body.customer_name ?? existing.customer_name),
    phone: normalizeText(body.phone ?? existing.phone),
    total: normalizeMoney(body.total ?? existing.total),
    status: normalizeOrderStatus(body.status ?? existing.status),
    raw_status: normalizeText(body.raw_status ?? existing.raw_status),
    note: normalizeText(body.note ?? existing.note),
    source: normalizeText(body.source || existing.source || 'manual'),
    active: body.active === 0 ? 0 : 1,
    updated_at: now(),
  };

  for (const field of DATE_FIELDS) {
    payload[field] = normalizeDateOnly(body[field] ?? existing[field]);
  }

  if (!payload.order_date) payload.order_date = now().slice(0, 10);
  return payload;
}

function findExistingOrder(platform, orderCode, shopId = null) {
  const normalizedCode = normalizeText(orderCode).toLowerCase();
  return getOne('marketplace_orders', row => (
    row &&
    row.active !== 0 &&
    normalizePlatform(row.platform) === platform &&
    normalizeText(row.order_code).toLowerCase() === normalizedCode &&
    (!shopId || Number(row.shop_id) === Number(shopId))
  ));
}

function sortByUpdatedAtDesc(a, b) {
  return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
}

function buildSummary(shops, orders) {
  const byPlatform = Object.values(PLATFORM_META).map(meta => {
    const platformShops = shops.filter(shop => shop.platform === meta.key);
    const platformOrders = orders.filter(order => order.platform === meta.key);
    return {
      platform: meta.key,
      platform_name: meta.name,
      shop_count: platformShops.length,
      order_count: platformOrders.length,
      last_sync_at: platformShops
        .map(shop => shop.last_sync_at)
        .filter(Boolean)
        .sort()
        .reverse()[0] || '',
    };
  });

  return {
    shop_count: shops.length,
    order_count: orders.length,
    pending_count: orders.filter(order => ['new', 'picked', 'in_transit'].includes(order.status)).length,
    returned_count: orders.filter(order => order.status === 'returned').length,
    by_platform: byPlatform,
  };
}

router.get('/platforms', (_req, res) => {
  res.json({ ok: true, items: Object.values(PLATFORM_META) });
});

router.get('/shops', (req, res) => {
  const platform = normalizePlatform(req.query.platform);
  const includeInactive = req.query.includeInactive === '1' || req.query.include_inactive === '1';
  const items = getAll('marketplace_shops')
    .filter(row => includeInactive || row.active !== 0)
    .map(sanitizeShop)
    .filter(row => !platform || row.platform === platform)
    .sort((a, b) => String(a.platform).localeCompare(String(b.platform)) || String(a.shop_name).localeCompare(String(b.shop_name)));
  res.json({ ok: true, items });
});

router.post('/shops', (req, res, next) => {
  try {
    const payload = buildShopPayload(req.body || {});
    const id = insert('marketplace_shops', {
      ...payload,
      connected_at: now(),
      created_at: now(),
    });
    res.json({ ok: true, item: sanitizeShop(getOne('marketplace_shops', { id })) });
  } catch (error) {
    next(error);
  }
});

router.put('/shops/:id', (req, res, next) => {
  try {
    const existing = getOne('marketplace_shops', row => Number(row.id) === Number(req.params.id));
    if (!existing) return res.status(404).json({ ok: false, error: 'Không tìm thấy gian hàng.' });
    const payload = buildShopPayload(req.body || {}, existing);
    const item = update('marketplace_shops', existing.id, payload);
    res.json({ ok: true, item: sanitizeShop(item) });
  } catch (error) {
    next(error);
  }
});

router.delete('/shops/:id', (req, res) => {
  const existing = getOne('marketplace_shops', row => Number(row.id) === Number(req.params.id));
  if (!existing) return res.status(404).json({ ok: false, error: 'Không tìm thấy gian hàng.' });
  const item = update('marketplace_shops', existing.id, { active: 0, updated_at: now() });
  res.json({ ok: true, item: sanitizeShop(item) });
});

router.get('/orders', (req, res) => {
  const platform = normalizePlatform(req.query.platform);
  const status = normalizeText(req.query.status).toLowerCase();
  const q = normalizeText(req.query.q || req.query.search).toLowerCase();
  const shopId = Number(req.query.shop_id || req.query.shopId) || null;
  const from = normalizeDateOnly(req.query.from);
  const to = normalizeDateOnly(req.query.to);

  const items = getAll('marketplace_orders')
    .filter(row => row.active !== 0)
    .map(sanitizeOrder)
    .filter(row => !platform || row.platform === platform)
    .filter(row => !shopId || Number(row.shop_id) === shopId)
    .filter(row => !status || row.status === status)
    .filter(row => !from || row.order_date >= from)
    .filter(row => !to || row.order_date <= to)
    .filter(row => !q || [
      row.order_code,
      row.customer_name,
      row.phone,
      row.shop_name,
      row.platform_name,
    ].some(value => normalizeText(value).toLowerCase().includes(q)))
    .sort(sortByUpdatedAtDesc);

  const shops = getAll('marketplace_shops').filter(row => row.active !== 0).map(sanitizeShop);
  res.json({ ok: true, items, summary: buildSummary(shops, items) });
});

router.post('/orders', (req, res, next) => {
  try {
    const payload = buildOrderPayload(req.body || {});
    const existing = findExistingOrder(payload.platform, payload.order_code, payload.shop_id);
    if (existing) {
      const item = update('marketplace_orders', existing.id, payload);
      return res.json({ ok: true, item: sanitizeOrder(item), action: 'updated' });
    }
    const id = insert('marketplace_orders', { ...payload, created_at: now() });
    res.json({ ok: true, item: sanitizeOrder(getOne('marketplace_orders', { id })), action: 'created' });
  } catch (error) {
    next(error);
  }
});

router.put('/orders/:id', (req, res, next) => {
  try {
    const existing = getOne('marketplace_orders', row => Number(row.id) === Number(req.params.id));
    if (!existing) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng sàn.' });
    const payload = buildOrderPayload(req.body || {}, existing);
    const item = update('marketplace_orders', existing.id, payload);
    res.json({ ok: true, item: sanitizeOrder(item) });
  } catch (error) {
    next(error);
  }
});

router.delete('/orders/:id', (req, res) => {
  const removed = remove('marketplace_orders', Number(req.params.id));
  if (!removed) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng sàn.' });
  res.json({ ok: true, item: sanitizeOrder(removed) });
});

router.post('/sync', (req, res) => {
  const platform = normalizePlatform(req.body?.platform || req.query.platform);
  const shops = getAll('marketplace_shops')
    .filter(row => row.active !== 0)
    .filter(row => !platform || normalizePlatform(row.platform) === platform);

  if (shops.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Vui lòng kết nối ít nhất một gian hàng trước khi đồng bộ đơn.',
    });
  }

  const result = withAtomicDbWrite(() => {
    const todayKey = now().slice(0, 10);
    const synced = [];

    for (const shop of shops) {
      const meta = getPlatformMeta(shop.platform);
      const orderCode = `${meta.orderPrefix}${todayKey.replace(/-/g, '')}${String(shop.id).padStart(3, '0')}`;
      const existing = findExistingOrder(meta.key, orderCode, shop.id);
      const payload = {
        platform: meta.key,
        platform_name: meta.name,
        shop_id: shop.id,
        shop_name: shop.shop_name,
        order_code: orderCode,
        customer_name: 'Khách sàn',
        phone: '',
        total: 0,
        status: 'new',
        raw_status: 'WAITING_SYNC_DETAIL',
        order_date: todayKey,
        picked_at: '',
        transit_at: '',
        delivered_at: '',
        returned_at: '',
        note: 'Đơn đồng bộ cục bộ. Khi cấu hình API chính thức, hệ thống sẽ lấy dữ liệu thật từ sàn.',
        source: 'marketplace_sync',
        last_synced_at: now(),
        updated_at: now(),
      };

      if (existing) {
        synced.push(sanitizeOrder(update('marketplace_orders', existing.id, payload, { skipSave: true })));
      } else {
        const id = insert('marketplace_orders', { ...payload, created_at: now() }, { skipSave: true });
        synced.push(sanitizeOrder(getOne('marketplace_orders', { id })));
      }

      update('marketplace_shops', shop.id, {
        last_sync_at: now(),
        sync_status: shop.credentials_configured ? 'synced' : 'needs_api_credentials',
      }, { skipSave: true });
    }

    return synced;
  });

  res.json({
    ok: true,
    items: result,
    synced_count: result.length,
    mode: 'local_connector_ready',
    message: 'Đã đồng bộ danh sách đơn theo kết nối hiện có. Muốn lấy đơn thật cần cấu hình API chính thức của từng sàn.',
  });
});

router.use((err, _req, res, _next) => {
  const status = Number(err?.status) || 500;
  res.status(status).json({
    ok: false,
    error: err?.message || 'Không xử lý được yêu cầu sàn thương mại điện tử.',
  });
});

module.exports = router;

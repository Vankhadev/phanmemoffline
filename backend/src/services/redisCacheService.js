/**
 * Redis & Memory Cache Service cho Phần mềm Bán Hàng Offline
 *
 * Mục đích: Giảm tải tối đa cho Database khi đọc dữ liệu đơn hàng, sản phẩm, khách hàng, thống kê.
 *
 * Tính năng nổi bật:
 * 1. Hỗ trợ Redis: Kết nối tới Redis local hoặc từ xa qua cấu hình REDIS_URL / REDIS_HOST / REDIS_PORT.
 * 2. Tự động dự phòng thông minh (Auto In-Memory Fallback):
 *    Vì đây là phần mềm OFFLINE, nếu máy tính người dùng chưa cài hoặc tắt Redis, dịch vụ sẽ
 *    tự động kích hoạt bộ nhớ đệm trong RAM (In-Memory Cache) với TTL và giới hạn dung lượng.
 *    Phần mềm KHÔNG bao giờ bị lỗi hay dừng hoạt động khi Redis tắt.
 * 3. Tự động xóa cache (Invalidation) khi có thao tác thêm, sửa, xóa (POST/PUT/DELETE).
 */

const Redis = require('ioredis');

const REDIS_ENABLED = process.env.REDIS_ENABLED !== '0';
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_URL = process.env.REDIS_URL || (process.env.REDIS_HOST ? `redis://${REDIS_HOST}:${REDIS_PORT}` : 'redis://127.0.0.1:6379');

let redisClient = null;
let isRedisReady = false;
let redisHasWarned = false;

// Bộ nhớ đệm trong RAM (dùng khi Redis offline hoặc chạy chế độ nhẹ)
const memoryCache = new Map();
const MAX_MEMORY_CACHE_ITEMS = 5000;

// Thống kê hiệu suất Cache
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
  startedAt: new Date().toISOString(),
};

/**
 * Khởi tạo kết nối Redis an toàn, không làm crash server nếu Redis không chạy
 */
function initRedis() {
  if (!REDIS_ENABLED) {
    console.log('[Cache] Redis bị tắt qua biến môi trường REDIS_ENABLED=0. Sử dụng In-Memory Cache.');
    return null;
  }

  try {
    const client = new Redis(REDIS_URL, {
      password: REDIS_PASSWORD,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // Không giữ lệnh nếu Redis rớt mạng
      retryStrategy(times) {
        // Thử lại ngắt quãng nếu Redis offline
        if (times > 5) return 60000; // 1 phút thử lại 1 lần
        return Math.min(times * 2000, 10000);
      },
      lazyConnect: false,
    });

    client.on('connect', () => {
      isRedisReady = true;
      redisHasWarned = false;
      console.log(`[Cache] ✅ Kết nối Redis thành công tại ${REDIS_HOST}:${REDIS_PORT}. Kích hoạt Redis Cache giảm tải cho database.`);
    });

    client.on('ready', () => {
      isRedisReady = true;
    });

    client.on('error', (err) => {
      isRedisReady = false;
      if (!redisHasWarned) {
        console.warn(`[Cache] ⚠️ Chưa phát hiện máy chủ Redis local (${err.code || err.message}). Tự động dùng bộ nhớ In-Memory Cache siêu tốc để giảm tải database.`);
        redisHasWarned = true;
      }
    });

    client.on('close', () => {
      isRedisReady = false;
    });

    return client;
  } catch (err) {
    console.warn('[Cache] Lỗi khởi tạo Redis client:', err.message);
    return null;
  }
}

redisClient = initRedis();

/**
 * Đọc dữ liệu từ Cache (Redis hoặc In-Memory)
 */
async function getCache(key) {
  if (isRedisReady && redisClient) {
    try {
      const data = await redisClient.get(key);
      if (data !== null) {
        stats.hits += 1;
        try {
          return JSON.parse(data);
        } catch (_) {
          return data;
        }
      }
    } catch (_) {
      // Nếu Redis lỗi tạm thời, rơi xuống memory
    }
  }

  // Fallback In-Memory
  const item = memoryCache.get(key);
  if (item) {
    if (item.expireAt && item.expireAt < Date.now()) {
      memoryCache.delete(key);
      stats.misses += 1;
      return null;
    }
    stats.hits += 1;
    return item.value;
  }

  stats.misses += 1;
  return null;
}

/**
 * Ghi dữ liệu vào Cache với thời gian sống (TTL giây)
 */
async function setCache(key, value, ttlSeconds = 60) {
  stats.sets += 1;

  if (isRedisReady && redisClient) {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlSeconds > 0) {
        await redisClient.setex(key, ttlSeconds, serialized);
      } else {
        await redisClient.set(key, serialized);
      }
    } catch (_) {
      // Bỏ qua lỗi Redis, ghi vào memory
    }
  }

  // Luôn giữ bản sao trên memory cache (nhanh hơn cả Redis cho read cục bộ)
  if (memoryCache.size >= MAX_MEMORY_CACHE_ITEMS) {
    // Xóa bớt phần tử đầu tiên (FIFO)
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }

  memoryCache.set(key, {
    value,
    expireAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
  });
}

/**
 * Xóa 1 khóa cụ thể
 */
async function delCache(key) {
  memoryCache.delete(key);
  if (isRedisReady && redisClient) {
    try {
      await redisClient.del(key);
    } catch (_) {}
  }
}

/**
 * Xóa toàn bộ các khóa theo tiền tố (prefix)
 * Ví dụ: invalidatePrefix('invoices') sẽ xóa mọi cache invoices:*
 */
async function invalidatePrefix(prefix) {
  stats.invalidations += 1;
  const p = String(prefix || '').trim();
  if (!p) return;

  // Xóa memory cache
  for (const key of memoryCache.keys()) {
    if (key.startsWith(p)) {
      memoryCache.delete(key);
    }
  }

  // Xóa Redis cache
  if (isRedisReady && redisClient) {
    try {
      const stream = redisClient.scanStream({
        match: `${p}*`,
        count: 100,
      });

      stream.on('data', async (keys) => {
        if (keys.length > 0) {
          const pipeline = redisClient.pipeline();
          keys.forEach(k => pipeline.del(k));
          await pipeline.exec();
        }
      });
    } catch (_) {}
  }
}

/**
 * Xóa sạch toàn bộ cache
 */
async function clearAllCache() {
  memoryCache.clear();
  if (isRedisReady && redisClient) {
    try {
      await redisClient.flushdb();
    } catch (_) {}
  }
}

/**
 * Lấy trạng thái hiện tại của Cache để hiển thị trên giao diện hoặc kiểm tra
 */
function getCacheStatus() {
  return {
    ok: true,
    redisEnabled: REDIS_ENABLED,
    redisConnected: isRedisReady,
    mode: isRedisReady ? 'redis' : 'in-memory',
    engine: isRedisReady ? 'Redis Server' : 'In-Memory Cache (RAM)',
    memoryItems: memoryCache.size,
    stats,
    config: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      hasPassword: Boolean(REDIS_PASSWORD),
    },
  };
}

/**
 * Middleware Express tự động cache kết quả GET
 */
function cacheMiddleware(prefix = 'cache', ttlSeconds = 60) {
  return async (req, res, next) => {
    // Chỉ cache method GET
    if (req.method !== 'GET') return next();

    // Bỏ qua nếu có header no-cache hoặc query nocache=1 / _t
    if (req.headers['x-no-cache'] || req.query.nocache === '1' || req.query._no_cache === '1') {
      return next();
    }

    const cacheKey = `${prefix}:${req.originalUrl || req.url}`;

    try {
      const cached = await getCache(cacheKey);
      if (cached !== null) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Engine', isRedisReady ? 'redis' : 'in-memory');
        return res.json(cached);
      }
    } catch (_) {}

    // Bắt hook res.json để lưu cache
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Cache-Engine', isRedisReady ? 'redis' : 'in-memory');

      // Chỉ cache khi status code 200/201 và body hợp lệ
      if ((!res.statusCode || res.statusCode === 200 || res.statusCode === 201) && body) {
        setCache(cacheKey, body, ttlSeconds).catch(() => {});
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Middleware xóa cache sau các mutation (POST, PUT, DELETE, PATCH)
 */
function invalidateCacheMiddleware(prefixes = []) {
  const prefixList = Array.isArray(prefixes) ? prefixes : [prefixes];
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Sau khi trả kết quả thành công thì xóa cache
      if (!res.statusCode || (res.statusCode >= 200 && res.statusCode < 300)) {
        prefixList.forEach(prefix => invalidatePrefix(prefix).catch(() => {}));
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = {
  getCache,
  setCache,
  delCache,
  invalidatePrefix,
  clearAllCache,
  getCacheStatus,
  cacheMiddleware,
  invalidateCacheMiddleware,
  isRedisReady: () => isRedisReady,
};

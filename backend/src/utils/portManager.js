/**
 * KHA Port Manager - Helper kiểm tra/tìm port trống cho backend.
 *
 * Mục tiêu: backend không bao giờ crash vì EADDRINUSE.
 * - Ưu tiên port cấu hình (mặc định 7000).
 * - Nếu bận thì thử lần lượt danh sách fallback (7001..7100).
 * - Nếu không có port nào trống thì ném lỗi rõ ràng (không crash im lặng).
 *
 * Dùng cho cả backend chạy độc lập (npm start / dev:backend) lẫn khi Electron
 * spawn backend (Electron tự chọn port trước rồi truyền qua env PORT, nhưng
 * portManager vẫn là lớp phòng vệ cuối cùng trong chính backend).
 */
const net = require('net');

const DEFAULT_FALLBACK_PORTS = [7000, 7001, 7002, 7003, 7004, 7005, 7010, 7100];

/**
 * Kiểm tra một port có rảnh trên host hay không.
 * Trả về Promise<boolean> (true = rảnh, false = đang bị chiếm).
 */
function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    let settled = false;
    const server = net.createServer();

    const finish = available => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      if (server.listening) {
        server.close(() => resolve(available));
      } else {
        resolve(available);
      }
    };

    server.once('error', () => finish(false));

    try {
      server.listen({ port: Number(port), host: String(host), exclusive: true }, () => finish(true));
    } catch (_) {
      finish(false);
    }
  });
}

/**
 * Tìm port trống đầu tiên.
 *
 * @param {object} options
 * @param {number} [options.preferredPort=7000] Port ưu tiên (từ env PORT).
 * @param {number[]} [options.fallbackPorts]    Danh sách port dự phòng.
 * @param {string}  [options.host='127.0.0.1']  Host cần kiểm tra.
 * @param {object}  [options.logger]            Logger tùy chọn ({ log, warn }).
 * @returns {Promise<number>} Port trống đầu tiên tìm được.
 */
async function getAvailablePort(options = {}) {
  const preferredPort = Number(options.preferredPort || 7000);
  const fallbackPorts = Array.isArray(options.fallbackPorts) && options.fallbackPorts.length
    ? options.fallbackPorts
    : DEFAULT_FALLBACK_PORTS;
  const host = String(options.host || '127.0.0.1');
  const logger = options.logger || console;

  const ports = Array.from(new Set([preferredPort, ...fallbackPorts]))
    .filter(p => Number.isInteger(p) && p > 0 && p < 65536);

  for (let i = 0; i < ports.length; i += 1) {
    const port = ports[i];
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port, host)) {
      if (i > 0) {
        logger.warn(`[KHA PORT] Port ${preferredPort} đang bận, chuyển sang port ${port}.`);
      }
      return port;
    }
    if (i === 0) {
      logger.warn(`[KHA PORT] Port ${preferredPort} đang bận (EADDRINUSE), thử port dự phòng...`);
    }
  }

  throw new Error(`Không tìm thấy port trống trong danh sách: ${ports.join(', ')} trên host ${host}. Hãy tắt ứng dụng đang giữ cổng hoặc đặt PORT=<cổng_khác> rồi chạy lại backend.`);
}

module.exports = {
  isPortAvailable,
  getAvailablePort,
  DEFAULT_FALLBACK_PORTS,
};

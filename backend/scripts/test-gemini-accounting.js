const http = require('http');
const https = require('https');
const express = require('express');
const accountingRoutes = require('../src/routes/accounting');
const geminiAccountingService = require('../src/services/geminiAccountingService');
const { getDb } = require('../src/db/database');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1, name: 'Admin Test', role: 'admin' };
  req.permissions = ['debts.read', 'debts.manage', 'accounting.read', 'accounting.manage', 'system.settings.manage'];
  req.accountId = 1;
  next();
});

app.use('/api/accounting', accountingRoutes);

function requestJson(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runGeminiAccountingTests() {
  const PORT = 7992;
  const server = app.listen(PORT, '127.0.0.1', async () => {
    console.log(`[TEST] Gemini Accounting test server running on port ${PORT}\n`);
    let passed = 0;
    let total = 0;

    try {
      // 1. GET /api/accounting/ai/config
      total++;
      console.log('1. Test GET /api/accounting/ai/config:');
      const resConfig = await requestJson(`http://127.0.0.1:${PORT}/api/accounting/ai/config`);
      console.log('   Status:', resConfig.status);
      console.log('   Config keys:', Object.keys(resConfig.data.config || {}));
      console.log('   Model:', resConfig.data.config?.model);
      console.log('   Is Configured:', resConfig.data.config?.isConfigured);
      if (resConfig.status === 200 && resConfig.data.ok && resConfig.data.config) {
        console.log('   => PASS');
        passed++;
      } else {
        console.error('   => FAIL');
      }

      // 2. PUT /api/accounting/ai/config (Save new config)
      total++;
      console.log('\n2. Test PUT /api/accounting/ai/config:');
      const testApiKey = 'AIzaSyTestApiKeyMock1234567890xyz';
      const resSave = await requestJson(`http://127.0.0.1:${PORT}/api/accounting/ai/config`, { method: 'PUT' }, {
        apiKey: testApiKey,
        model: 'gemini-1.5-flash',
        temperature: 0.3,
      });
      console.log('   Status:', resSave.status);
      console.log('   Save OK:', resSave.data.ok);
      console.log('   Masked Key:', resSave.data.config?.maskedKey);
      console.log('   Is Configured:', resSave.data.config?.isConfigured);
      if (
        resSave.status === 200 &&
        resSave.data.ok &&
        resSave.data.config?.maskedKey === 'AIzaSy...0xyz' &&
        resSave.data.config?.isConfigured === true
      ) {
        console.log('   => PASS');
        passed++;
      } else {
        console.error('   => FAIL');
      }

      // 3. Validation on missing question in /ai/chat
      total++;
      console.log('\n3. Test POST /api/accounting/ai/chat (Validation check):');
      const resChatValidation = await requestJson(`http://127.0.0.1:${PORT}/api/accounting/ai/chat`, { method: 'POST' }, {
        question: '',
      });
      console.log('   Status:', resChatValidation.status);
      console.log('   Error message:', resChatValidation.data.error);
      if (resChatValidation.status === 400 && resChatValidation.data.ok === false) {
        console.log('   => PASS');
        passed++;
      } else {
        console.error('   => FAIL');
      }

      // 4. Validation on missing customerId in /ai/reminder-message
      total++;
      console.log('\n4. Test POST /api/accounting/ai/reminder-message (Validation check):');
      const resReminderValidation = await requestJson(`http://127.0.0.1:${PORT}/api/accounting/ai/reminder-message`, { method: 'POST' }, {
        style: 'gentle',
      });
      console.log('   Status:', resReminderValidation.status);
      console.log('   Error message:', resReminderValidation.data.error);
      if (resReminderValidation.status === 400 && resReminderValidation.data.ok === false) {
        console.log('   => PASS');
        passed++;
      } else {
        console.error('   => FAIL');
      }

      // 5. Mock Google Generative REST API to test End-to-End AI capabilities
      total++;
      console.log('\n5. Mocking Gemini REST API for End-to-End Analysis:');
      const originalHttpsRequest = https.request;
      let lastInterceptedRequest = null;
      const originalFetch = global.fetch;

      global.fetch = async function (url, opts) {
        if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
          const body = JSON.parse(opts?.body || '{}');
          lastInterceptedRequest = {
            path: url,
            method: opts?.method || 'POST',
            body,
          };
          let replyText = '### BÁO CÁO PHÂN TÍCH TÀI CHÍNH TỪ TRỢ LÝ AI\n1. Sức khỏe dòng tiền: Tỷ lệ nợ quá hạn ở mức an toàn.\n2. Cảnh báo nợ xấu: Cần tập trung theo dõi các khách hàng nợ trên 30 ngày.\n3. Đề xuất hành động: Gửi tin nhắn nhắc nợ và yêu cầu thanh toán trước khi mở hạn mức mới.';
          const prompt = body.contents?.[body.contents.length - 1]?.parts?.[0]?.text || '';
          if (prompt.includes('Ai là khách hàng') || body.contents?.length > 1) {
            replyText = 'Khách hàng có nợ lớn nhất là Khách lẻ với số dư nợ quá hạn lâu ngày.';
          } else if (prompt.includes('tin nhắn nhắc nợ') || prompt.includes('Nhắc nợ')) {
            replyText = 'Kính gửi Quý khách, cửa hàng gửi thông tin công nợ đơn hàng cần đối soát thanh toán.';
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ text: replyText }],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: {
                promptTokenCount: 520,
                candidatesTokenCount: 120,
                totalTokenCount: 640,
              },
            }),
          };
        }
        if (typeof originalFetch === 'function') {
          return originalFetch.apply(this, arguments);
        }
        throw new Error('fetch is not supported');
      };

      https.request = function (options, callback) {
        // Intercept Gemini API calls
        if (options.hostname === 'generativelanguage.googleapis.com') {
          const stream = new (require('stream').PassThrough)();
          let capturedBody = '';
          stream.write = function (chunk) { capturedBody += chunk; return true; };
          stream.end = function () {
            lastInterceptedRequest = {
              path: options.path,
              method: options.method,
              body: JSON.parse(capturedBody || '{}'),
            };

            const mockResponse = new (require('stream').Readable)({
              read() {
                this.push(JSON.stringify({
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            text: '### BÁO CÁO PHÂN TÍCH TÀI CHÍNH TỪ TRỢ LÝ AI\n1. Sức khỏe dòng tiền: Tỷ lệ nợ quá hạn ở mức an toàn.\n2. Cảnh báo nợ xấu: Cần tập trung theo dõi các khách hàng nợ trên 30 ngày.\n3. Đề xuất hành động: Gửi tin nhắn nhắc nợ và yêu cầu thanh toán trước khi mở hạn mức mới.',
                          },
                        ],
                      },
                      finishReason: 'STOP',
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 520,
                    candidatesTokenCount: 120,
                    totalTokenCount: 640,
                  },
                }));
                this.push(null);
              },
            });
            mockResponse.statusCode = 200;
            mockResponse.headers = { 'content-type': 'application/json' };
            callback(mockResponse);
          };
          return stream;
        }
        return originalHttpsRequest.apply(https, arguments);
      };

      const resAnalyze = await requestJson(`http://127.0.0.1:${PORT}/api/accounting/ai/analyze`, { method: 'POST' }, {
        period_type: 'this_month',
      });
      console.log('   Status:', resAnalyze.status);
      console.log('   Analysis text length:', resAnalyze.data.analysis?.length);
      console.log('   Model used:', resAnalyze.data.model_used);
      console.log('   Intercepted Path has model:', lastInterceptedRequest?.path.includes('gemini-'));
      if (resAnalyze.status === 200 && resAnalyze.data.ok && resAnalyze.data.analysis) {
        console.log('   => PASS');
        passed++;
      } else {
        console.error('   => FAIL');
      }

      // 6. Test /api/accounting/ai/chat with conversation history
      total++;
      console.log('\n6. Test POST /api/accounting/ai/chat (Mock response):');
      const resChat = await requestJson(`http://127.0.0.1:${PORT}/api/accounting/ai/chat`, { method: 'POST' }, {
        question: 'Ai là khách hàng có nợ xấu lớn nhất?',
        history: [
          { role: 'user', text: 'Chào trợ lý kế toán' },
          { role: 'model', text: 'Chào bạn, tôi là trợ lý kế toán. Tôi có thể giúp gì cho bạn?' },
        ],
      });
      console.log('   Status:', resChat.status);
      console.log('   Chat reply received:', Boolean(resChat.data.reply));
      console.log('   Intercepted contents count:', lastInterceptedRequest?.body?.contents?.length);
      if (resChat.status === 200 && resChat.data.ok && resChat.data.reply) {
        console.log('   => PASS');
        passed++;
      } else {
        console.error('   => FAIL');
      }

      // 7. Test /api/accounting/ai/reminder-message with real customer
      total++;
      console.log('\n7. Test POST /api/accounting/ai/reminder-message (Mock response):');
      const db = getDb();
      const sampleCustomer = (db.customers || []).find(c => !c.deleted_at);
      const customerId = sampleCustomer ? sampleCustomer.id : 1;

      const resReminder = await requestJson(`http://127.0.0.1:${PORT}/api/accounting/ai/reminder-message`, { method: 'POST' }, {
        customer_id: customerId,
        style: 'gentle',
        customNotes: 'Ưu đãi giảm 2% nếu thanh toán trước ngày 10',
      });
      console.log('   Status:', resReminder.status);
      console.log('   Reminder Customer:', resReminder.data.customer_name);
      console.log('   Reminder Style:', resReminder.data.style);
      console.log('   Prompt includes bank account info:', lastInterceptedRequest?.body?.contents?.[0]?.parts?.[0]?.text?.includes('Tài khoản nhận thanh toán') || false);
      if (resReminder.status === 200 && resReminder.data.ok && resReminder.data.message) {
        console.log('   => PASS');
        passed++;
      } else {
        console.error('   => FAIL');
      }

      // Restore https.request and fetch
      https.request = originalHttpsRequest;
      if (originalFetch) global.fetch = originalFetch;

      console.log(`\n========================================`);
      console.log(`KẾT QUẢ KIỂM THỬ: ${passed}/${total} BÀI TEST THÀNH CÔNG!`);
      console.log(`========================================\n`);

    } catch (err) {
      console.error('[TEST ERROR]:', err);
    } finally {
      server.close();
      process.exit(passed === total ? 0 : 1);
    }
  });
}

runGeminiAccountingTests();

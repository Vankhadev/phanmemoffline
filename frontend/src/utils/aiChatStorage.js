/**
 * Quản lý lưu trữ bền vững (Persistent Storage) Lịch sử trò chuyện với Trợ lý AI Thông Minh (Gemini)
 * Đảm bảo khi người dùng thoát ra hoặc chuyển trang, lịch sử hỏi đáp và trích xuất dữ liệu vẫn còn nguyên.
 */

export const AI_CHAT_STORAGE_KEY = 'gemini_accounting_chat_history_v1';
export const AI_CHAT_UPDATED_EVENT = 'kha-ai-chat-updated';

const DEFAULT_WELCOME_MESSAGE = {
  id: 'welcome-initial',
  role: 'model',
  text: `Chào anh/chị! Tôi là **Trợ Lý AI Thông Minh (Google Gemini AI)** của phần mềm Bán Hàng Pos.

Tôi hoạt động như một con Chatbot AI toàn năng (tương tự như ChatGPT và Google Gemini), sẵn sàng giải đáp và hỗ trợ mọi nhu cầu của chủ cửa hàng:
• 💬 **Hỏi đáp tự do mọi chủ đề:** Kinh doanh, bán hàng, cuộc sống, dịch thuật, thơ ca, mẹo vặt, viết bài đăng mạng xã hội...
• 📊 **Tra cứu số liệu cửa hàng thời gian thực:** Doanh thu hôm nay/tháng này, đơn hàng gần đây, kiểm tra tồn kho & mặt hàng sắp hết, sổ quỹ tiền mặt, công nợ...
• 🧾 **Giải đáp nghiệp vụ:** Thuế GTGT, báo cáo tài chính, quản lý dòng tiền...
• ⚙️ **Kết nối API Key:** Bấm vào biểu tượng ⚙️ ở góc trên để cài đặt hoặc kiểm tra Google Gemini API Key bất cứ lúc nào.

Anh/chị cần tôi hỗ trợ hay giải đáp điều gì ngay bây giờ ạ?`,
  time: '',
};

export function loadStoredChatMessages() {
  if (typeof window === 'undefined') return [DEFAULT_WELCOME_MESSAGE];
  try {
    const raw = localStorage.getItem(AI_CHAT_STORAGE_KEY);
    if (!raw) return [DEFAULT_WELCOME_MESSAGE];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Làm sạch cụm từ cũ nếu có trong cache trước đó
      return parsed.map(msg => {
        if (!msg || typeof msg.text !== 'string') return msg;
        let cleanText = msg.text;
        if (cleanText.includes('(chuẩn MISA)')) {
          cleanText = cleanText.replace(/\(chuẩn MISA\)/g, '');
        }
        if (cleanText.includes('Với tư cách là Trợ lý Kế toán Trưởng ảo')) {
          cleanText = cleanText
            .replace(/Với tư cách là Trợ lý Kế toán Trưởng ảo của phần mềm Bán Hàng Pos[^,]*,?\s*/gi, '')
            .replace(/\(được nghiên cứu, phát triển và lập trình hoàn toàn bởi Lập trình viên Văn Kha\),?\s*/gi, '')
            .replace(/Nếu Lập trình viên Văn Kha tiến hành kết nối \[tích hợp\]/gi, 'Nếu chúng ta tiến hành tích hợp')
            .trim();
        }
        return {
          ...msg,
          text: cleanText,
        };
      });
    }
  } catch (err) {
    console.warn('[AI CHAT STORAGE] Lỗi đọc lịch sử chat:', err);
  }
  return [DEFAULT_WELCOME_MESSAGE];
}

export function saveStoredChatMessages(messages = []) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(messages));
    window.dispatchEvent(new CustomEvent(AI_CHAT_UPDATED_EVENT, { detail: { messages } }));
  } catch (err) {
    // Nếu vượt dung lượng localStorage do có nhiều ảnh đính kèm, giữ lại tối đa 3 ảnh gần nhất
    try {
      const slimMessages = messages.map((m, idx, arr) => {
        if (m.image && idx < arr.length - 3) {
          const { image, ...rest } = m;
          return { ...rest, hasImageDetached: true };
        }
        return m;
      });
      localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(slimMessages));
      window.dispatchEvent(new CustomEvent(AI_CHAT_UPDATED_EVENT, { detail: { messages } }));
    } catch (innerErr) {
      console.warn('[AI CHAT STORAGE] Lỗi ghi lịch sử chat (quota exceeded):', innerErr);
    }
  }
}

export function clearStoredChatMessages() {
  if (typeof window === 'undefined') return [DEFAULT_WELCOME_MESSAGE];
  try {
    localStorage.removeItem(AI_CHAT_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(AI_CHAT_UPDATED_EVENT, { detail: { messages: [DEFAULT_WELCOME_MESSAGE] } }));
  } catch (err) {
    console.warn('[AI CHAT STORAGE] Lỗi xóa lịch sử chat:', err);
  }
  return [DEFAULT_WELCOME_MESSAGE];
}

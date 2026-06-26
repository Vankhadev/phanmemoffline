import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('❌ Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg w-full">
            <h1 className="text-2xl font-bold text-red-600 mb-4">?? D? x?y ra lỗi</h1>
            <p className="text-gray-700 mb-4">
              Ứng dụng gặp lỗi không mong muốn. Vui lòng:
            </p>
            <ul className="list-disc pl-5 text-gray-600 space-y-2 mb-6">
              <li>Refresh lại trang (Ctrl+F5)</li>
              <li>Kiểm tra console (F12) để xem chi tiết lỗi</li>
              <li>Đảm bảo backend đang chạy tại port 7000</li>
            </ul>
            <div className="bg-gray-100 rounded p-4 text-sm">
              <p className="font-mono text-red-600 break-all">
                {this.state.error?.toString()}
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-medium"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

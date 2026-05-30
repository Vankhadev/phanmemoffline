(function () {
  "use strict";

  const PRINT_BUTTON_ID = "printInvoiceBtn";
  const INVOICE_ID = "invoiceA5";
  const PRINT_FRAME_ID = "a5InvoicePrintFrame";
  const PRINT_PREPARE_DELAY = 280;
  const PRINT_CLEANUP_DELAY = 1200;

  const printButton = document.getElementById(PRINT_BUTTON_ID);
  const invoiceNode = document.getElementById(INVOICE_ID);

  if (!printButton || !invoiceNode) {
    return;
  }

  /**
   * Đọc toàn bộ CSS cùng origin để nhúng trực tiếp vào iframe in.
   * Fallback sang thẻ link nếu trình duyệt chặn đọc cssRules.
   */
  function collectPageStyles() {
    const inlineStyles = [];
    const linkedStyles = [];

    Array.from(document.styleSheets).forEach((sheet) => {
      const href = sheet.href;

      try {
        const rules = Array.from(sheet.cssRules || []).map((rule) => rule.cssText).join("\n");
        if (rules) {
          inlineStyles.push(rules);
          return;
        }
      } catch (error) {
        if (href) {
          linkedStyles.push(`<link rel="stylesheet" href="${href}">`);
        }
      }
    });

    return `${linkedStyles.join("\n")}\n<style>${inlineStyles.join("\n")}</style>`;
  }

  /**
   * Tạo iframe ẩn, clone hóa đơn và style vào tài liệu độc lập để in.
   * Cách này hạn chế lỗi reload trang chính và lệch layout trên Chrome/Cốc Cốc/Edge.
   */
  function createPrintFrame(invoiceClone) {
    const oldFrame = document.getElementById(PRINT_FRAME_ID);
    if (oldFrame) {
      oldFrame.remove();
    }

    const iframe = document.createElement("iframe");
    iframe.id = PRINT_FRAME_ID;
    iframe.title = "A5 invoice print frame";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument || iframe.contentWindow.document;
    frameDocument.open();
    frameDocument.write(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>In hóa đơn A5</title>
  ${collectPageStyles()}
  <style>
    html, body {
      width: 148mm !important;
      height: 210mm !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #fff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      display: block !important;
    }
    .print-root {
      width: 148mm !important;
      height: 210mm !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #fff !important;
    }
    .print-root .invoice-page {
      transform: none !important;
      zoom: 1 !important;
    }
  </style>
</head>
<body>
  <main class="print-root">${invoiceClone.outerHTML}</main>
</body>
</html>`);
    frameDocument.close();

    return iframe;
  }

  function setLoading(isLoading) {
    printButton.classList.toggle("is-loading", isLoading);
    printButton.disabled = isLoading;
    printButton.querySelector(".button-label").textContent = isLoading ? "ĐANG CHUẨN BỊ..." : "IN HÓA ĐƠN";
  }

  function removePrintFrame(iframe) {
    window.setTimeout(() => {
      if (iframe && iframe.parentNode) {
        iframe.remove();
      }
    }, PRINT_CLEANUP_DELAY);
  }

  function printInvoice() {
    setLoading(true);

    window.setTimeout(() => {
      const invoiceClone = invoiceNode.cloneNode(true);
      invoiceClone.removeAttribute("id");
      invoiceClone.classList.add("is-print-clone");

      const iframe = createPrintFrame(invoiceClone);
      const printWindow = iframe.contentWindow;
      let printed = false;

      const triggerPrint = () => {
        if (printed) {
          return;
        }

        printed = true;

        try {
          printWindow.focus();
          printWindow.print();
        } finally {
          setLoading(false);
          removePrintFrame(iframe);
        }
      };

      if (iframe.contentDocument.readyState === "complete") {
        triggerPrint();
      } else {
        iframe.onload = triggerPrint;
        window.setTimeout(triggerPrint, 350);
      }
    }, PRINT_PREPARE_DELAY);
  }

  printButton.addEventListener("click", printInvoice);
})();

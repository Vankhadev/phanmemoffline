#!/usr/bin/env python3
"""Standard-library regression tests for data_integrity_monitor.py."""

import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("toophanmem.py")
SPEC = importlib.util.spec_from_file_location("toophanmem", MODULE_PATH)
MONITOR = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MONITOR)


def invoice(invoice_id, day, status="completed"):
    return {"id": invoice_id, "invoice_code": f"HD{invoice_id}", "created_at": f"{day}T08:00:00.000Z", "status": status, "total": 100000, "active": 1}


class IntegrityMonitorTests(unittest.TestCase):
    def test_reports_missing_invoices_by_day_without_restoring(self):
        previous_db = {"invoices": [invoice(index, "2026-08-13") for index in range(1, 301)], "customers": [], "products": [], "cash_book": [], "invoice_details": [], "import_logs": []}
        current_db = {"invoices": [invoice(index, "2026-08-13") for index in range(1, 251)], "customers": [], "products": [], "cash_book": [], "invoice_details": [], "import_logs": [], "audit_logs": []}
        anomalies = MONITOR.compare_snapshots(MONITOR.summarize(previous_db), MONITOR.summarize(current_db), current_db)
        daily = next(item for item in anomalies if item["type"] == "daily_invoice_decrease")
        self.assertEqual(daily["lost"], 50)
        self.assertEqual(daily["missing_invoice_ids"][0], "251")
        self.assertEqual(daily["missing_invoice_ids"][-1], "300")

    def test_keeps_independent_cost_and_cash_metrics(self):
        db = {
            "invoices": [invoice(1, "2026-08-13")],
            "invoice_details": [{"invoice_id": 1, "product_id": 10, "quantity": 2, "cost_price_at_sale": 50000}],
            "products": [{"id": 10, "active": 1, "stock": 5}],
            "customers": [], "import_logs": [],
            "cash_book": [{"active": 1, "type": "income", "amount": 100000}],
        }
        snapshot = MONITOR.summarize(db)
        self.assertEqual(snapshot["business_metrics"]["completed_cost"], 100000)
        self.assertEqual(snapshot["cash_book"]["balance"], 100000)

    def test_repair_requires_explicit_offline_confirmation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "phanmienoffline.db.json"
            db_path.write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                MONITOR.ensure_database_is_offline(db_path, False)

    def test_does_not_flag_valid_vietnamese_text_as_mojibake(self):
        self.assertIsNone(MONITOR.repairable_mojibake("CÂY ĐÈN GỖ"))
        self.assertEqual(MONITOR.repairable_mojibake("ÄÃ´ng PhÆ°Æ¡ng"), "Đông Phương")


if __name__ == "__main__":
    unittest.main()

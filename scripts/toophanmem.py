#!/usr/bin/env python3
"""Safe 24/7 integrity monitor for the local JSON database.

Default mode is read-only: it records compact count snapshots and forensic
reports but never changes the database. Recovery is intentionally limited to a
missing/corrupt database and requires --allow-recovery plus a verified backup.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "backend" / "data" / "phanmienoffline.db.json"
DEFAULT_STATE = ROOT / "backend" / "data" / "integrity-monitor-state.json"
DEFAULT_REPORT_DIR = ROOT / "backend" / "logs" / "integrity-monitor"
CRITICAL_TABLES = ("invoices", "invoice_details", "customers", "products", "cash_book", "import_logs")
MOJIBAKE_MARKERS = ("Ã", "Â", "Æ", "Ä", "áº", "á»")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("Database JSON root must be an object.")
    return data


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def parse_date(value: Any) -> str:
    text = str(value or "")
    return text[:10] if len(text) >= 10 else "unknown"


def active_rows(rows: Iterable[Any]) -> List[Dict[str, Any]]:
    return [row for row in rows if isinstance(row, dict) and row.get("active", 1) != 0 and not row.get("deleted_at")]


def invoice_state(invoice: Dict[str, Any]) -> str:
    return str(invoice.get("status") or "pending").strip().lower()


def money(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def summarize(db: Dict[str, Any]) -> Dict[str, Any]:
    invoices = [row for row in db.get("invoices", []) if isinstance(row, dict)]
    active_invoices = [row for row in invoices if not row.get("deleted_at")]
    by_date: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for invoice in active_invoices:
        by_date[parse_date(invoice.get("created_at") or invoice.get("updated_at"))].append(invoice)

    invoice_days = {}
    for day, rows in by_date.items():
        status_counts = Counter(invoice_state(row) for row in rows)
        invoice_days[day] = {
            "count": len(rows),
            "total": round(sum(money(row.get("total")) for row in rows), 2),
            "completed": status_counts.get("completed", 0),
            "cancelled": sum(count for status, count in status_counts.items() if status in {"cancelled", "canceled", "da_huy", "đã hủy"}),
            "statuses": dict(sorted(status_counts.items())),
            "invoice_ids": sorted(str(row.get("id")) for row in rows if row.get("id") is not None),
        }

    cash_book = active_rows(db.get("cash_book", []))
    products_by_id = {str(row.get("id")): row for row in db.get("products", []) if isinstance(row, dict) and row.get("id") is not None}
    details = [row for row in db.get("invoice_details", []) if isinstance(row, dict)]
    completed_ids = {
        str(row.get("id")) for row in active_invoices
        if invoice_state(row) == "completed" and row.get("id") is not None
    }
    completed_details = [row for row in details if str(row.get("invoice_id")) in completed_ids]
    total_cost = 0.0
    for detail in completed_details:
        product = products_by_id.get(str(detail.get("variant_id") or detail.get("product_id"))) or {}
        unit_cost = next((money(detail.get(field)) for field in ("cost_price_at_sale", "import_price", "purchase_price", "cost_price") if money(detail.get(field)) > 0), money(product.get("import_price") or product.get("cost_price")))
        total_cost += money(detail.get("quantity")) * unit_cost
    return {
        "generated_at": utc_now(),
        "counts": {table: len([row for row in db.get(table, []) if isinstance(row, dict)]) for table in CRITICAL_TABLES},
        "active_counts": {
            "invoices": len(active_invoices),
            "customers": len(active_rows(db.get("customers", []))),
            "products": len(active_rows(db.get("products", []))),
            "cash_book": len(cash_book),
        },
        "invoice_days": dict(sorted(invoice_days.items())),
        "cash_book": {
            "income": round(sum(money(row.get("amount")) for row in cash_book if row.get("type") == "income"), 2),
            "expense": round(sum(money(row.get("amount")) for row in cash_book if row.get("type") == "expense"), 2),
            "balance": round(sum(money(row.get("amount")) if row.get("type") == "income" else -money(row.get("amount")) for row in cash_book), 2),
            "count": len(cash_book),
        },
        "business_metrics": {
            "completed_invoice_count": len(completed_ids),
            "completed_invoice_detail_count": len(completed_details),
            "completed_revenue": round(sum(money(row.get("total")) for row in active_invoices if str(row.get("id")) in completed_ids), 2),
            "completed_cost": round(total_cost, 2),
            "products_with_stock": sum(1 for row in active_rows(db.get("products", [])) if money(row.get("stock")) != 0),
        },
    }


def forensic_locations(db: Dict[str, Any], missing_ids: set[str]) -> Dict[str, List[Dict[str, Any]]]:
    findings = {"current": [], "soft_deleted": [], "audit_logs": [], "cash_book": []}
    for invoice in db.get("invoices", []):
        if not isinstance(invoice, dict) or str(invoice.get("id")) not in missing_ids:
            continue
        target = "soft_deleted" if invoice.get("deleted_at") or invoice.get("active") == 0 else "current"
        findings[target].append({
            "id": invoice.get("id"), "invoice_code": invoice.get("invoice_code"), "status": invoice.get("status"),
            "created_at": invoice.get("created_at"), "updated_at": invoice.get("updated_at"), "deleted_at": invoice.get("deleted_at"),
        })
    for row in db.get("audit_logs", []):
        if not isinstance(row, dict):
            continue
        entity_id = str(row.get("entity_id") or row.get("reference_id") or "")
        if entity_id in missing_ids:
            findings["audit_logs"].append({key: row.get(key) for key in ("id", "action", "entity_type", "entity_id", "created_at", "note", "content")})
    for row in db.get("cash_book", []):
        if not isinstance(row, dict) or str(row.get("reference_id") or "") not in missing_ids:
            continue
        findings["cash_book"].append({key: row.get(key) for key in ("id", "reference_id", "reference_type", "type", "amount", "date", "active")})
    return findings


def compare_snapshots(previous: Dict[str, Any], current: Dict[str, Any], db: Dict[str, Any]) -> List[Dict[str, Any]]:
    anomalies: List[Dict[str, Any]] = []
    previous_counts = previous.get("counts", {})
    for table, current_count in current["counts"].items():
        before = int(previous_counts.get(table, current_count) or 0)
        if current_count < before:
            anomalies.append({"type": "table_count_decrease", "table": table, "before": before, "after": current_count, "lost": before - current_count})

    previous_days = previous.get("invoice_days", {})
    for day, before_data in previous_days.items():
        now_data = current["invoice_days"].get(day, {"count": 0, "invoice_ids": []})
        before_count = int(before_data.get("count", 0) or 0)
        now_count = int(now_data.get("count", 0) or 0)
        if now_count >= before_count:
            continue
        prior_ids = set(map(str, before_data.get("invoice_ids", [])))
        current_ids = set(map(str, now_data.get("invoice_ids", [])))
        missing_ids = prior_ids - current_ids
        anomalies.append({
            "type": "daily_invoice_decrease",
            "date": day,
            "before": before_count,
            "after": now_count,
            "lost": before_count - now_count,
            "missing_invoice_ids": sorted(missing_ids),
            "forensics": forensic_locations(db, missing_ids) if missing_ids else {},
            "message": f"Invoice count for {day} fell from {before_count} to {now_count}; no automatic restore was performed.",
        })
    return anomalies


def repairable_mojibake(value: str) -> str | None:
    if not any(marker in value for marker in MOJIBAKE_MARKERS):
        return None
    try:
        candidate = value.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return None
    if candidate != value and not any(marker in candidate for marker in MOJIBAKE_MARKERS):
        return candidate
    return None


def walk_strings(value: Any, path: str = "$"):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk_strings(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_strings(child, f"{path}[{index}]")
    elif isinstance(value, str) and repairable_mojibake(value) is not None:
        yield path, value


def repair_mojibake(value: Any) -> Tuple[Any, int]:
    if isinstance(value, dict):
        repaired, changes = {}, 0
        for key, child in value.items():
            repaired_child, child_changes = repair_mojibake(child)
            repaired[key] = repaired_child
            changes += child_changes
        return repaired, changes
    if isinstance(value, list):
        repaired, changes = [], 0
        for child in value:
            repaired_child, child_changes = repair_mojibake(child)
            repaired.append(repaired_child)
            changes += child_changes
        return repaired, changes
    if isinstance(value, str):
        candidate = repairable_mojibake(value)
        if candidate is not None:
            return candidate, 1
    return value, 0


def find_verified_backup(backup_dir: Path, minimum_invoices: int) -> Path | None:
    if not backup_dir.is_dir():
        return None
    candidates = sorted(backup_dir.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    for candidate in candidates:
        try:
            data = read_json(candidate)
            if len(data.get("invoices", [])) >= minimum_invoices and isinstance(data.get("nextId"), dict):
                return candidate
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return None


def ensure_database_is_offline(db_path: Path, force_offline: bool) -> None:
    if not force_offline:
        raise ValueError("Database repair requires --force-offline after stopping the backend.")
    guardian_lock = db_path.parent / "kha-guardian-running.lock"
    if guardian_lock.exists():
        raise ValueError("Backend appears to be running (guardian lock exists). Stop it before repairing database text.")


def recover_only_when_unreadable(db_path: Path, backup_dir: Path, report: Dict[str, Any], allow_recovery: bool) -> bool:
    if not allow_recovery:
        return False
    previous_count = int(report.get("previous", {}).get("counts", {}).get("invoices", 0) or 0)
    backup = find_verified_backup(backup_dir, previous_count)
    if not backup:
        report["recovery"] = {"performed": False, "reason": "No verified backup with sufficient invoice count."}
        return False
    quarantine = db_path.with_name(f"{db_path.name}.unreadable-{datetime.now():%Y%m%d%H%M%S}")
    if db_path.exists():
        shutil.move(str(db_path), str(quarantine))
    shutil.copy2(backup, db_path)
    report["recovery"] = {"performed": True, "source": str(backup), "quarantined": str(quarantine) if quarantine.exists() else None}
    return True


def run_once(args: argparse.Namespace) -> int:
    db_path = Path(args.db).resolve()
    state_path = Path(args.state).resolve()
    report_dir = Path(args.report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    previous = read_json(state_path) if state_path.exists() else {}
    report: Dict[str, Any] = {"generated_at": utc_now(), "database": str(db_path), "mode": "read_only", "previous": previous.get("snapshot", {}), "anomalies": []}

    try:
        db = read_json(db_path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        report["anomalies"].append({"type": "database_unreadable", "message": str(error)})
        recovered = recover_only_when_unreadable(db_path, Path(args.backup_dir).resolve(), report, args.allow_recovery)
        report["mode"] = "recovered_unreadable_database" if recovered else "read_only"
        write_json_atomic(report_dir / f"integrity-{datetime.now():%Y%m%d-%H%M%S}.json", report)
        return 2

    encoding_issues = [{"path": path, "value": value[:300]} for path, value in walk_strings(db)]
    if encoding_issues:
        report["anomalies"].append({"type": "possible_mojibake", "count": len(encoding_issues), "samples": encoding_issues[:50]})
    if args.repair_encoding:
        ensure_database_is_offline(db_path, args.force_offline)
        backup = db_path.with_name(f"{db_path.name}.pre-encoding-repair-{datetime.now():%Y%m%d%H%M%S}")
        shutil.copy2(db_path, backup)
        repaired_db, changes = repair_mojibake(copy.deepcopy(db))
        if changes:
            write_json_atomic(db_path, repaired_db)
        report["encoding_repair"] = {"performed": changes > 0, "changes": changes, "rollback_copy": str(backup)}

    current = summarize(db)
    report["snapshot"] = current
    if previous.get("snapshot"):
        report["anomalies"].extend(compare_snapshots(previous["snapshot"], current, db))
    write_json_atomic(state_path, {"version": 1, "updated_at": utc_now(), "snapshot": current})
    write_json_atomic(report_dir / f"integrity-{datetime.now():%Y%m%d-%H%M%S}.json", report)
    print(json.dumps({"ok": True, "anomalies": len(report["anomalies"]), "counts": current["counts"], "report_dir": str(report_dir)}, ensure_ascii=False))
    return 1 if report["anomalies"] else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only local database integrity monitor.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--state", default=str(DEFAULT_STATE))
    parser.add_argument("--report-dir", default=str(DEFAULT_REPORT_DIR))
    parser.add_argument("--backup-dir", default=str(DEFAULT_DB.parent / "backups"))
    parser.add_argument("--once", action="store_true", help="Run one audit (default).")
    parser.add_argument("--watch", action="store_true", help="Run continuously.")
    parser.add_argument("--interval-seconds", type=int, default=300)
    parser.add_argument("--allow-recovery", action="store_true", help="Permit recovery only when the database is missing or unreadable.")
    parser.add_argument("--repair-encoding", action="store_true", help="Repair unambiguous UTF-8-as-Latin-1 mojibake after writing a rollback copy.")
    parser.add_argument("--force-offline", action="store_true", help="Confirm backend is stopped before a database text repair.")
    args = parser.parse_args()
    if args.repair_encoding and not args.allow_recovery:
        parser.error("--repair-encoding requires --allow-recovery")
    if not args.watch:
        return run_once(args)
    interval = max(30, args.interval_seconds)
    while True:
        try:
            run_once(args)
        except Exception as error:  # Keep the 24/7 monitor alive and log its failure.
            print(json.dumps({"ok": False, "error": str(error), "at": utc_now()}, ensure_ascii=False), file=sys.stderr)
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())

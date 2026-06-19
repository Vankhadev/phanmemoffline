/**
 * migrate-data.js — Migrate dữ liệu từ JSON store -> SQLite Enterprise
 * Usage: node migrate-data.js
 * Đảm bảo: KHÔNG mất bất kỳ dòng nào. Mọi lỗi đều được ghi vào report.warnings.
 */
"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs   = require("fs");
const path = require("path");

const ROOT     = path.resolve("g:/phanmienoffline");
const SRC_JSON = path.join(ROOT, "phanmienoffline.db.json");
const DB_PATH  = path.join(ROOT, "data", "phanmienoffline_enterprise.db");

function num(v, d=0)  { const n=Number(v); return Number.isFinite(n)?n:d; }
function str(v)       { return (v===undefined||v===null)?null:String(v); }
function ts(v)        { return v?String(v):null; }
function bool01(v,d=1){ if(v===undefined||v===null)return d; return v?1:0; }

const raw = JSON.parse(fs.readFileSync(SRC_JSON,"utf8"));
const get = (k) => Array.isArray(raw[k])?raw[k]:[];

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys=ON;");

const report = {
  accounts:0, users:0, customer_ranks:0, customers:0,
  categories:0, products:0, suppliers:0,
  orders:0, order_items:0, cash:0, audit:0,
  skipped:[], warnings:[]
};

function tryRun(stmt, args, label) {
  try { stmt.run(...args); return true; }
  catch(e) { report.warnings.push(label+" | "+e.message); return false; }
}

db.exec("BEGIN");
try {
  // ── accounts ────────────────────────────────────────────────────────
  const accStmt = db.prepare(`INSERT OR REPLACE INTO accounts(id,slug,name,plan,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
  for (const a of get("accounts")) {
    if(tryRun(accStmt,[num(a.id),str(a.slug)||"acc"+a.id,str(a.name)||"Default",str(a.plan)||"free",bool01(a.active),ts(a.created_at)||new Date().toISOString(),ts(a.updated_at)||new Date().toISOString()],"account id="+a.id)) report.accounts++;
  }
  if(report.accounts===0){
    db.prepare(`INSERT OR IGNORE INTO accounts(id,slug,name) VALUES (1,'default','Default')`).run();
    report.accounts=1;
  }

  // ── users ────────────────────────────────────────────────────────────
  const uStmt = db.prepare(`INSERT OR REPLACE INTO users(id,account_id,name,email,phone,password_hash,role,approved,active,last_login,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const u of get("users")) {
    const role=["owner","admin","manager","staff","cashier","viewer"].includes(String(u.role))?String(u.role):"staff";
    if(tryRun(uStmt,[num(u.id),num(u.account_id,1),str(u.name)||"user",str(u.email),str(u.phone),str(u.password)||"!",role,bool01(u.approved,1),bool01(u.active,1),ts(u.last_login),ts(u.created_at)||new Date().toISOString(),ts(u.updated_at)||new Date().toISOString()],"user id="+u.id)) report.users++;
  }

  // ── customer_ranks (from customer_types) ─────────────────────────────
  const rankStmt = db.prepare(`INSERT OR IGNORE INTO customer_ranks(id,account_id,name,color,active) VALUES (?,?,?,?,?)`);
  for (const ct of get("customer_types")) {
    if(tryRun(rankStmt,[num(ct.id),num(ct.account_id,1),str(ct.name)||"rank"+ct.id,str(ct.color),bool01(ct.active,1)],"customer_rank id="+ct.id)) report.customer_ranks++;
  }

  // ── customers ────────────────────────────────────────────────────────
  const cStmt = db.prepare(`INSERT OR REPLACE INTO customers(id,account_id,customer_code,full_name,phone,email,address,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const c of get("customers")) {
    const code=str(c.customer_code)||("KH"+String(c.id).padStart(4,"0"));
    const st=bool01(c.active,1)?"active":"inactive";
    if(tryRun(cStmt,[num(c.id),num(c.account_id,1),code,str(c.name)||str(c.full_name)||"Khach le",str(c.phone),str(c.email),str(c.address),str(c.note),st,ts(c.created_at)||new Date().toISOString(),ts(c.updated_at)||new Date().toISOString()],"customer id="+c.id)) report.customers++;
  }

  // ── categories ───────────────────────────────────────────────────────
  const catStmt = db.prepare(`INSERT OR REPLACE INTO categories(id,account_id,name,active,created_at,updated_at) VALUES (?,?,?,?,?,?)`);
  for (const pc of get("product_categories")) {
    if(tryRun(catStmt,[num(pc.id),num(pc.account_id,1),str(pc.name)||"cat"+pc.id,bool01(pc.active,1),ts(pc.created_at)||new Date().toISOString(),ts(pc.updated_at)||new Date().toISOString()],"category id="+pc.id)) report.categories++;
  }

  // ── suppliers (from partners) ─────────────────────────────────────────
  const sStmt = db.prepare(`INSERT OR REPLACE INTO suppliers(id,account_id,supplier_code,name,phone,email,address,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const p of get("partners")) {
    const st=bool01(p.active,1)?"active":"inactive";
    if(tryRun(sStmt,[num(p.id),num(p.account_id,1),"NCC"+String(p.id).padStart(4,"0"),str(p.name)||"NCC"+p.id,str(p.phone),str(p.email),str(p.address),st,ts(p.created_at)||new Date().toISOString(),ts(p.updated_at)||new Date().toISOString()],"supplier id="+p.id)) report.suppliers++;
  }

  // ── products ─────────────────────────────────────────────────────────
  // KHÔNG dùng OR IGNORE: giữ MỌI sản phẩm. SKU trùng -> tự thêm hậu tố.
  const pStmt = db.prepare(`INSERT INTO products(id,account_id,sku,barcode,name,category_id,purchase_price,sale_price,stock_quantity,minimum_stock,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const catIds = new Set(get("product_categories").map(x=>num(x.id)));
  const seenSku = new Set();
  for (const p of get("products")) {
    const acc=num(p.account_id,1);
    let sku=str(p.sku); if(!sku) sku="SP"+String(p.id).padStart(6,"0");
    let key=acc+"|"+sku;
    if(seenSku.has(key)){
      const orig=sku; let n=2;
      while(seenSku.has(acc+"|"+sku+"-DUP"+n)) n++;
      sku=sku+"-DUP"+n;
      key=acc+"|"+sku;
      report.warnings.push("SKU trung: '"+orig+"' (product id="+p.id+") -> doi thanh '"+sku+"'");
    }
    seenSku.add(key);
    const catId=catIds.has(num(p.default_category_id))?num(p.default_category_id):null;
    const st=bool01(p.active,1)?"active":"inactive";
    if(tryRun(pStmt,[num(p.id),acc,sku,str(p.barcode),str(p.name)||sku,catId,num(p.import_price),num(p.retail_price),num(p.stock),num(p.min_stock,0),st,ts(p.created_at)||new Date().toISOString(),ts(p.updated_at)||new Date().toISOString()],"product id="+p.id)) report.products++;
  }

  // ── orders (from invoices) ────────────────────────────────────────────
  const oStmt = db.prepare(`INSERT OR REPLACE INTO orders(id,account_id,order_code,customer_id,user_id,subtotal,discount_amount,vat_amount,total_amount,paid_amount,remaining_amount,payment_status,order_status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const custIds=new Set(get("customers").map(x=>num(x.id)));
  const userIds=new Set(get("users").map(x=>num(x.id)));
  for (const v of get("invoices")) {
    const total=num(v.total);
    const paid=num(v.paid_amount);
    const rem=total-paid;
    const pst=paid<=0?"unpaid":(paid>=total?"paid":"partial");
    const ost=String(v.status)==="cancelled"?"cancelled":"completed";
    const cid=custIds.has(num(v.customer_id))?num(v.customer_id):null;
    const uid=userIds.has(num(v.user_id))?num(v.user_id):null;
    if(tryRun(oStmt,[num(v.id),num(v.account_id,1),str(v.invoice_code)||"HD"+v.id,cid,uid,num(v.subtotal),num(v.discount_amount),num(v.vat_amount),total,paid,rem,pst,ost,str(v.note),ts(v.created_at)||new Date().toISOString(),ts(v.updated_at)||new Date().toISOString()],"order id="+v.id)) report.orders++;
  }

  // ── order_items (from invoice_details) ───────────────────────────────
  const oiStmt = db.prepare(`INSERT OR REPLACE INTO order_items(id,order_id,product_id,quantity,purchase_price,sale_price,discount_amount,total_amount) VALUES (?,?,?,?,?,?,?,?)`);
  const orderIds=new Set(get("invoices").map(x=>num(x.id)));
  const prodIds=new Set(get("products").map(x=>num(x.id)));
  for (const d of get("invoice_details")) {
    if(!orderIds.has(num(d.invoice_id))){ report.skipped.push("order_item id="+d.id+" -> invoice "+d.invoice_id+" khong ton tai"); continue; }
    const pid=prodIds.has(num(d.product_id))?num(d.product_id):null;
    const qty=num(d.quantity,1);
    const line=num(d.line_total)||(qty*num(d.unit_price));
    if(tryRun(oiStmt,[num(d.id),num(d.invoice_id),pid,qty,num(d.import_price),num(d.unit_price),num(d.discount_amount),line],"order_item id="+d.id)) report.order_items++;
  }

  // ── cash_transactions (from cash_book) ───────────────────────────────
  // amount=0 được chấp nhận (CHECK >= 0), dùng Math.abs để tránh âm
  const cashStmt = db.prepare(`INSERT OR REPLACE INTO cash_transactions(id,account_id,transaction_type,amount,description,reference_type,reference_id,created_at) VALUES (?,?,?,?,?,?,?,?)`);
  for (const cb of get("cash_book")) {
    const t=String(cb.type).toLowerCase().includes("thu")||String(cb.type).toLowerCase()==="income"?"INCOME":"EXPENSE";
    const amt=Math.abs(num(cb.amount));
    if(tryRun(cashStmt,[num(cb.id),num(cb.account_id,1),t,amt,str(cb.note)||str(cb.category),str(cb.reference_type),num(cb.reference_id)||null,ts(cb.created_at)||ts(cb.date)||new Date().toISOString()],"cash id="+cb.id)) report.cash++;
  }

  // ── audit_logs ───────────────────────────────────────────────────────
  // action là free text, không ràng buộc CHECK => giữ mọi giá trị gốc
  const aStmt = db.prepare(`INSERT OR REPLACE INTO audit_logs(id,account_id,user_id,action,module,new_data,ip,user_agent,created_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const al of get("audit_logs")) {
    const uid=userIds.has(num(al.user_id))?num(al.user_id):null;
    const meta=typeof al.meta==="object"?JSON.stringify(al.meta):str(al.meta);
    if(tryRun(aStmt,[num(al.id),num(al.account_id,1),uid,str(al.action)||"OTHER","legacy",meta,str(al.ip),str(al.user_agent),ts(al.created_at)||new Date().toISOString()],"audit id="+al.id)) report.audit++;
  }

  db.exec("COMMIT");
} catch(e) {
  db.exec("ROLLBACK");
  console.error("MIGRATION FAILED (rollback):", e.message);
  process.exit(2);
}

// post-check
const fk=db.prepare("PRAGMA foreign_key_check").all();
const ic=db.prepare("PRAGMA integrity_check").all();

console.log("\nDATA MIGRATION REPORT:");
console.log(JSON.stringify(report, null, 2));
console.log("\nintegrity_check:", ic[0].integrity_check);
console.log("FK violations:", fk.length);
if(fk.length>0) console.log(JSON.stringify(fk));
db.close();

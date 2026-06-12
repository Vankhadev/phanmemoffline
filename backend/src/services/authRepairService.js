/**
 * KHA Auth Repair & Self-Healing Service
 * 
 * Quản lý tự động kiểm tra cấu trúc bảng hệ thống tài khoản (users, roles, permissions, sessions)
 * và tự động sửa các lỗi liên quan tới tài khoản người dùng, phân quyền.
 * Đồng thời sinh cấu hình tài khoản Admin Recovery sử dụng cục bộ trong chế độ khẩn cấp.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const adminAlertService = require('./adminAlertService');

/**
 * Đảm bảo các bảng và role mặc định tồn tại trong cơ sở dữ liệu
 */
function ensureAuthSchema() {
  const dbModule = require('../db/database');
  const { hashPassword } = require('../utils/password');
  
  const current = dbModule.getDb();
  let modified = false;

  // 1. Kiểm tra cấu trúc các bảng cốt lõi
  const requiredTables = ['users', 'roles', 'permissions', 'role_permissions', 'sessions'];
  for (const table of requiredTables) {
    if (!current[table] || !Array.isArray(current[table])) {
      current[table] = [];
      modified = true;
      console.log(`[AUTH REPAIR] Initialized missing table: ${table}`);
    }
  }

  // 2. Seed các roles mặc định nếu thiếu
  const defaultRoles = [
    { key: 'admin', name: 'Quản trị viên' },
    { key: 'owner', name: 'Chủ cửa hàng' },
    { key: 'manager', name: 'Quản lý' },
    { key: 'accountant', name: 'Kế toán' },
    { key: 'cashier', name: 'Thu ngân' },
    { key: 'employee', name: 'Nhân viên' },
    { key: 'user', name: 'Người dùng' }
  ];

  for (const role of defaultRoles) {
    if (!current.roles.some(r => r.key === role.key)) {
      if (!current.nextId) current.nextId = {};
      const id = current.nextId.roles || 1;
      current.nextId.roles = id + 1;
      current.roles.push({
        id,
        key: role.key,
        name: role.name,
        created_at: dbModule.now(),
        updated_at: dbModule.now()
      });
      modified = true;
      console.log(`[AUTH REPAIR] Seeded default role: ${role.key}`);
    }
  }

  // 3. Gọi seeding của permissions và role_permissions từ database.js (nếu trống)
  if (current.permissions.length === 0) {
    if (typeof dbModule.seedDefaultPermissions === 'function') {
      dbModule.seedDefaultPermissions();
      modified = true;
    }
  }
  if (current.role_permissions.length === 0) {
    if (typeof dbModule.seedDefaultRolePermissions === 'function') {
      dbModule.seedDefaultRolePermissions();
      modified = true;
    }
  }

  if (modified) {
    dbModule.saveDB();
  }
  console.log('[AUTH REPAIR] Auth schema checks completed');
}

/**
 * Tự động sửa lỗi dữ liệu người dùng (phân quyền, active, plain-text passwords)
 */
function repairUserAuthSystem() {
  const dbModule = require('../db/database');
  const { hashPassword, isPasswordHash } = require('../utils/password');

  const current = dbModule.getDb();
  let modified = false;

  if (!current.users || !Array.isArray(current.users)) {
    return;
  }

  for (const user of current.users) {
    if (!user) continue;

    // 1. Migrate fullname & name
    if (!user.fullname && user.name) {
      user.fullname = user.name;
      modified = true;
    }
    if (!user.name && user.fullname) {
      user.name = user.fullname;
      modified = true;
    }
    if (!user.name && !user.fullname) {
      const fallbackName = user.email ? user.email.split('@')[0] : 'Tài khoản';
      user.name = fallbackName;
      user.fullname = fallbackName;
      modified = true;
    }

    // 2. Kiểm tra/Đảm bảo các cột email, phone, password, created_at tồn tại
    if (user.email === undefined || user.email === null) {
      user.email = '';
      modified = true;
    }
    if (user.phone === undefined || user.phone === null) {
      user.phone = '';
      modified = true;
    }
    if (user.password === undefined || user.password === null) {
      user.password = hashPassword('12345678'); // Mật khẩu mặc định an toàn tối thiểu 8 ký tự
      modified = true;
    }
    if (!user.created_at) {
      user.created_at = dbModule.now();
      modified = true;
    }

    // Sửa lỗi active và approved (đặc biệt đối với tài khoản admin chính)
    if (user.role === 'admin' && String(user.email).trim().toLowerCase() === 'dongphuongqc@gmail.com') {
      if (user.active !== 1 || user.approved !== 1) {
        user.active = 1;
        user.approved = 1;
        modified = true;
        console.log(`[AUTH REPAIR] Restored active/approved state for main Admin: ${user.email}`);
      }
    } else {
      if (user.active === undefined || user.active === null) {
        user.active = 1;
        modified = true;
      }
      if (user.approved === undefined || user.approved === null) {
        user.approved = 1;
        modified = true;
      }
    }

    // Sửa lỗi thiếu account_id
    if (user.account_id === undefined || user.account_id === null) {
      user.account_id = 1;
      modified = true;
    }

    // Sửa mật khẩu plain text (tự động mã hóa nếu phát hiện chưa được mã hóa)
    if (user.password && !isPasswordHash(user.password)) {
      const plainPassword = user.password;
      user.password = hashPassword(plainPassword);
      modified = true;
      console.log(`[AUTH REPAIR] Hashed raw plain-text password for user ID ${user.id} (${user.email})`);
    }
  }

  // Đảm bảo có ít nhất một tài khoản Admin đang hoạt động
  const activeAdmins = current.users.filter(u => u && u.role === 'admin' && u.active === 1 && u.approved === 1);
  if (activeAdmins.length === 0) {
    const firstActive = current.users.find(u => u && u.active === 1 && u.approved === 1);
    if (firstActive) {
      firstActive.role = 'admin';
      modified = true;
      console.log(`[AUTH REPAIR] No active Admin found. Auto-promoted oldest user: ${firstActive.email}`);
      adminAlertService.sendWarningAlert('auth-repair', `Hệ thống không tìm thấy Admin hoạt động nào. Đã tự động thăng cấp người dùng: ${firstActive.email} làm ADMIN.`);
    } else {
      // Tạo lại Admin mặc định nếu DB hoàn toàn không có user nào hoạt động
      const defaultAccount = current.accounts && current.accounts[0] ? current.accounts[0] : { id: 1 };
      const newId = current.nextId.users || 1;
      current.nextId.users = newId + 1;
      current.users.push({
        id: newId,
        account_id: defaultAccount.id,
        name: 'Đông Phương QC',
        fullname: 'Đông Phương QC',
        email: 'dongphuongqc@gmail.com',
        phone: '0904045075',
        password: hashPassword('khongnoiduoc'),
        role: 'admin',
        approved: 1,
        active: 1,
        created_at: dbModule.now(),
        updated_at: dbModule.now(),
        session_token: null,
      });
      modified = true;
      console.log(`[AUTH REPAIR] No active users in database. Seeded default Admin dongphuongqc@gmail.com`);
      adminAlertService.sendWarningAlert('auth-repair', 'Phát hiện cơ sở dữ liệu trống người dùng. Đã khởi tạo lại Admin mặc định dongphuongqc@gmail.com.');
    }
  }

  if (modified) {
    dbModule.saveDB();
  }
}

/**
 * Khởi tạo tài khoản khẩn cấp Admin Recovery dùng cục bộ
 */
function initializeEmergencyAdmin() {
  const dbModule = require('../db/database');
  const { hashPassword } = require('../utils/password');

  const current = dbModule.getDb();
  const dbDir = path.dirname(dbModule.DB_PATH);
  const recoveryFile = path.join(dbDir, '.kha-admin-recovery');

  // Sinh mật khẩu ngẫu nhiên bảo mật
  const rawPassword = crypto.randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(recoveryFile, rawPassword, 'utf8');
  } catch (err) {
    console.error(`[AUTH REPAIR] Failed to write recovery credentials file: ${err.message}`);
  }

  const hashed = hashPassword(rawPassword);
  let recoveryUser = current.users.find(u => String(u.email).trim().toLowerCase() === 'admin_recovery@phanmienoffline.local');

  if (recoveryUser) {
    recoveryUser.password = hashed;
    recoveryUser.active = 1;
    recoveryUser.approved = 1;
    recoveryUser.role = 'admin';
    recoveryUser.updated_at = dbModule.now();
  } else {
    const defaultAccount = current.accounts && current.accounts[0] ? current.accounts[0] : { id: 1 };
    const newId = current.nextId.users || 1;
    current.nextId.users = newId + 1;
    current.users.push({
      id: newId,
      account_id: defaultAccount.id,
      name: 'Admin Recovery',
      email: 'admin_recovery@phanmienoffline.local',
      phone: '0904045075',
      password: hashed,
      role: 'admin',
      approved: 1,
      active: 1,
      created_at: dbModule.now(),
      updated_at: dbModule.now(),
      session_token: null,
    });
  }

  dbModule.saveDB();
  console.log(`[AUTH REPAIR] Emergency Admin generated. Credentials written to ${recoveryFile}`);
  adminAlertService.sendInfoAlert('auth-repair', `Khởi tạo tài khoản Admin Recovery thành công. File mật khẩu: ${recoveryFile}`);
}

module.exports = {
  ensureAuthSchema,
  repairUserAuthSystem,
  initializeEmergencyAdmin,
};

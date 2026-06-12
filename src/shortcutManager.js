const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { exec } = require('child_process');

const SHORTCUT_NAME = 'Bán Hàng Pos.lnk';
const UPGRADE_STATUS_FILE = 'shortcut-upgrade-status.json';

async function pathExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

async function rebuildIconCache() {
  console.log('[Shortcut Manager] Rebuilding icon cache...');
  const psCommand = `Stop-Process -Name explorer -Force; Start-Sleep -Seconds 1; Remove-Item -Path "$env:localappdata\\IconCache.db" -Force -ErrorAction SilentlyContinue; Remove-Item -Path "$env:localappdata\\Microsoft\\Windows\\Explorer\\iconcache*" -Force -ErrorAction SilentlyContinue; Start-Process explorer`;
  
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -Command "${psCommand}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('[Shortcut Manager] Rebuild icon cache failed:', error.message);
      } else {
        console.log('[Shortcut Manager] Rebuild icon cache completed.');
      }
      resolve();
    });
  });
}

async function getShortcutPaths() {
  const desktop = path.join(app.getPath('desktop'), SHORTCUT_NAME);
  const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT_NAME);
  const taskbar = path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'Taskbar', SHORTCUT_NAME);
  return { desktop, startMenu, taskbar };
}

async function upgradeShortcuts(win) {
  if (process.platform !== 'win32') return;

  const userData = app.getPath('userData');
  const statusPath = path.join(userData, UPGRADE_STATUS_FILE);
  
  // Check if already updated
  let status = {};
  if (await pathExists(statusPath)) {
    try {
      status = JSON.parse(await fsp.readFile(statusPath, 'utf8'));
    } catch (_) {}
  }

  if (status.version_1_7_1_updated) {
    console.log('[Shortcut Manager] Shortcuts already upgraded to v1.7.1.');
    return;
  }

  console.log('[Shortcut Manager] Starting v1.7.1 shortcut and icon upgrade...');

  const backupDir = path.join(userData, 'backups', 'v1.7.0_backup');
  const shortcutsBackupDir = path.join(backupDir, 'shortcuts');
  const iconsBackupDir = path.join(backupDir, 'icons');
  const configsBackupDir = path.join(backupDir, 'configs');

  await fsp.mkdir(shortcutsBackupDir, { recursive: true });
  await fsp.mkdir(iconsBackupDir, { recursive: true });
  await fsp.mkdir(configsBackupDir, { recursive: true });

  const shortcutPaths = await getShortcutPaths();
  const backupPaths = {
    desktop: path.join(shortcutsBackupDir, 'desktop.lnk'),
    startMenu: path.join(shortcutsBackupDir, 'startMenu.lnk'),
    taskbar: path.join(shortcutsBackupDir, 'taskbar.lnk'),
  };

  try {
    // 1. Backup old shortcuts
    for (const [key, srcPath] of Object.entries(shortcutPaths)) {
      if (await pathExists(srcPath)) {
        await fsp.copyFile(srcPath, backupPaths[key]);
        console.log(`[Shortcut Manager] Backed up shortcut: ${key}`);
      }
    }

    // 2. Backup logo/icons
    const iconPath = app.isPackaged 
      ? path.join(process.resourcesPath, 'icons', 'app-icon.png')
      : path.join(__dirname, '..', 'build', 'icons', 'app-icon.ico');
    
    if (await pathExists(iconPath)) {
      await fsp.copyFile(iconPath, path.join(iconsBackupDir, path.basename(iconPath)));
    }

    // 3. Backup configurations
    const files = await fsp.readdir(userData);
    for (const file of files) {
      if (file.endsWith('.json') && file !== UPGRADE_STATUS_FILE && file !== 'phanmienoffline.db.json') {
        await fsp.copyFile(path.join(userData, file), path.join(configsBackupDir, file));
      }
    }

    // 4. Update Shortcuts
    const target = process.execPath;
    const workingDirectory = path.dirname(target);
    const icon = iconPath;

    for (const [key, shortcutPath] of Object.entries(shortcutPaths)) {
      console.log(`[Shortcut Manager] Updating shortcut: ${key}`);
      
      // Delete old shortcut if exists
      if (await pathExists(shortcutPath)) {
        await fsp.unlink(shortcutPath);
      }

      // Recreate shortcut with new icon and properties
      shell.writeShortcutLink(shortcutPath, 'create', {
        target,
        workingDirectory,
        icon,
        iconIndex: 0,
        description: 'Bán hàng offline',
      });
    }

    // 5. Verification
    let verified = true;
    for (const [key, shortcutPath] of Object.entries(shortcutPaths)) {
      if (!(await pathExists(shortcutPath))) {
        // If Desktop shortcut was not there, it might not be a failure (e.g. not pinned to taskbar)
        if (key === 'taskbar') continue; 
        console.error(`[Shortcut Manager] Verification failed: Missing shortcut for ${key}`);
        verified = false;
        break;
      }

      const shortcutDetails = shell.readShortcutLink(shortcutPath);
      if (shortcutDetails.target !== target || shortcutDetails.icon !== icon) {
        console.error(`[Shortcut Manager] Verification failed for ${key}: Target or Icon mismatch`);
        verified = false;
        break;
      }
    }

    if (!verified) {
      throw new Error('Verification of created shortcuts failed.');
    }

    // Save update status
    status.version_1_7_1_updated = true;
    await fsp.writeFile(statusPath, JSON.stringify(status, null, 2), 'utf8');
    console.log('[Shortcut Manager] Shortcuts and icons upgraded successfully.');

    // Refresh icon cache to make sure they display immediately
    await rebuildIconCache();

    // Trigger update message to frontend
    if (win && win.webContents) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          win.webContents.send('kha-shortcut-updated-toast', {
            success: true,
            message: 'Cập nhật phiên bản 1.7.1 thành công.\n\n✓ Logo mới đã được áp dụng.\n✓ Icon Desktop đã được cập nhật.\n✓ Dữ liệu khách hàng được bảo toàn.\n✓ Hệ thống hoạt động bình thường.'
          });
        }, 3000);
      });
    }

  } catch (error) {
    console.error('[Shortcut Manager] Upgrade failed. Initiating recovery...', error);
    
    // Log error details
    const logDir = path.join(userData, 'logs');
    await fsp.mkdir(logDir, { recursive: true });
    await fsp.appendFile(
      path.join(logDir, 'shortcut-upgrade.log'),
      `${new Date().toISOString()} - Upgrade failed: ${error.stack || error.message}\n`,
      'utf8'
    );

    // Rollback shortcuts
    for (const [key, srcPath] of Object.entries(shortcutPaths)) {
      if (await pathExists(backupPaths[key])) {
        try {
          if (await pathExists(srcPath)) {
            await fsp.unlink(srcPath);
          }
          await fsp.copyFile(backupPaths[key], srcPath);
          console.log(`[Shortcut Manager] Rolled back shortcut: ${key}`);
        } catch (rollbackErr) {
          console.error(`[Shortcut Manager] Rollback failed for ${key}:`, rollbackErr.message);
        }
      }
    }

    // Rebuild Icon Cache in recovery
    await rebuildIconCache();
  }
}

module.exports = {
  upgradeShortcuts,
};

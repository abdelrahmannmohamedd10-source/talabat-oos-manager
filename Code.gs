// ============================================================
//  OOS Manager – Apps Script Backend (Code.gs)
//  Spreadsheet: 1zrqSAAIyaNEBN30y0U7rWDDo4hl9O2Xz8QB9p3gRyGw
// ============================================================

const SS_ID = '1zrqSAAIyaNEBN30y0U7rWDDo4hl9O2Xz8QB9p3gRyGw';

// ── Master_Database column indices (0-based, row 1 = header, data from row 2)
const MD = {
  DATE: 0, VENDOR: 1, BRANCH_ID: 2, ORDER_ID: 3, SKU: 4, ITEM_NAME: 5,
  STATUS: 6, CHAIN_ID: 7, CHAIN_NAME: 8, PROC_STATUS: 11,
  TCHAMP: 12, IMG_URL: 13, SYS_STATUS: 14, TIMESTAMP: 16
};

// ── maping sheet column indices (0-based, no header, data from row 1)
const MAP = {
  CHAIN_NAME: 0, TCHAMP_NICK: 1, CHAIN_ID: 2, TCHAMP_EMAIL: 3,
  MGR_NAME: 5, MGR_EMAIL: 6, MGR_PASS: 7
};

// ── Users sheet column indices (0-based, row 1 = header, data from row 2)
const UCOLS = { EMAIL: 0, PASS: 1, NAME: 2, ROLE: 3, FIRST_LOGIN: 4 };
const DEFAULT_PASS = '123456';

// ════════════════════════════════════════════════════════════
//  ENTRY POINTS
// ════════════════════════════════════════════════════════════

function doGet(e) {
  const p = e.parameter;
  const action   = p.action   || '';
  const callback = p.callback || '';
  const rawPayload = (() => { try { return JSON.parse(p.payload || '{}'); } catch(x) { return {}; } })();
  const email = ((p.email || rawPayload.email) || '').trim().toLowerCase();

  let result;
  try {
    switch (action) {
      case 'verifyUserAuth':    result = verifyUserAuth(email);                          break;
      case 'getUserData':       result = getUserData(email);                             break;
      case 'getOwnerData':      result = getOwnerData(email, p.filterName || 'all');     break;
      case 'getAdminAnalytics': result = getAdminAnalytics(email, p.filterName || 'all'); break;
      case 'getAssignments':    result = getAssignments(email);                          break;
      case 'getUsers':          result = getUsers(email);                                break;
      case 'recordUserLogin':   result = recordUserLogin(rawPayload);                   break;
      case 'submitBatchFeedback': result = submitBatchFeedback(rawPayload);             break;
      case 'submitBranchSummary': result = submitBranchSummary(rawPayload);             break;
      default: result = { status: 'error', message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { status: 'error', message: err.toString() };
  }

  const json = JSON.stringify(result);
  const body = callback ? callback + '(' + json + ')' : json;
  return ContentService.createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action  = body.action  || '';
    const email   = (body.email  || '').trim().toLowerCase();
    const payload = body.payload || {};

    switch (action) {
      case 'recordUserLogin':     result = recordUserLogin(payload);                              break;
      case 'submitBatchFeedback': result = submitBatchFeedback(payload);                         break;
      case 'submitBranchSummary': result = submitBranchSummary(payload);                         break;
      case 'updateAssignments':   result = updateAssignments(email, payload);                    break;
      case 'loginWithPassword':   result = loginWithPassword(payload.email, payload.password);   break;
      case 'changePassword':      result = changePassword(payload.email, payload.oldPass, payload.newPass); break;
      case 'resetPassword':       result = resetPassword(email, payload.targetEmail);            break;
      case 'addUser':             result = addUser(email, payload.newEmail, payload.name, payload.role); break;
      default: result = { status: 'error', message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { status: 'error', message: err.toString() };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

function ss() { return SpreadsheetApp.openById(SS_ID); }

function getOrCreateSheet(name, headers) {
  const wb = ss();
  let sh = wb.getSheetByName(name);
  if (!sh) {
    sh = wb.insertSheet(name);
    if (headers && headers.length) sh.appendRow(headers);
  }
  return sh;
}

/** Returns all rows from maping sheet (no header in maping, data from row 1) */
function getMapRows() {
  const sh = ss().getSheetByName('maping');
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 1) return [];
  return sh.getRange(1, 1, last, 8).getValues();
}

/** Returns all data rows from Master_Database (row 1 = header, data from row 2) */
function getMasterRows() {
  const sh = ss().getSheetByName('Master_Database');
  if (!sh) return { rows: [], sheet: null };
  const last = sh.getLastRow();
  if (last < 2) return { rows: [], sheet: sh };
  const cols = sh.getLastColumn();
  const values = sh.getRange(2, 1, last - 1, Math.max(cols, 17)).getValues();
  return { rows: values, sheet: sh };
}

/** Extracts manager emails from maping (col H = 123456 marks manager rows) */
function getManagerEmails(mapRows) {
  return mapRows
    .filter(r => r[MAP.MGR_PASS] == 123456 && typeof r[MAP.MGR_EMAIL] === 'string' && r[MAP.MGR_EMAIL].includes('@'))
    .map(r => r[MAP.MGR_EMAIL].trim().toLowerCase());
}

/** Find T-champ nickname + email by login email. Returns null if not found. */
function findTChamp(email, mapRows) {
  const em = email.trim().toLowerCase();
  for (const r of mapRows) {
    const tEmail = String(r[MAP.TCHAMP_EMAIL] || '').trim().toLowerCase();
    if (tEmail && tEmail === em) {
      return { champName: String(r[MAP.TCHAMP_NICK]).trim(), email: r[MAP.TCHAMP_EMAIL] };
    }
  }
  return null;
}

function fmtDate(v) {
  if (!v) return '';
  try { return Utilities.formatDate(new Date(v), 'Africa/Cairo', 'yyyy-MM-dd'); }
  catch(_) { return String(v); }
}

function fmtDateTime(v) {
  if (!v) return '';
  try { return Utilities.formatDate(new Date(v), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'); }
  catch(_) { return String(v); }
}

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════

function verifyUserAuth(email) {
  if (!email) return { status: 'unauthorized', message: 'No email' };
  const mapRows = getMapRows();
  const mgrs = getManagerEmails(mapRows);

  // Collect all T-champ nicknames for admin filter
  const allNames = [...new Set(
    mapRows.map(r => String(r[MAP.TCHAMP_NICK] || '').trim()).filter(n => n)
  )];

  if (mgrs.includes(email)) {
    const row = mapRows.find(r => r[MAP.MGR_EMAIL] && r[MAP.MGR_EMAIL].trim().toLowerCase() === email);
    const name = row ? String(row[MAP.MGR_NAME]).trim() : email.split('@')[0];
    return { status: 'ok', isAuthorized: true, isOwner: true, name, email, allNames };
  }

  const champ = findTChamp(email, mapRows);
  if (champ) {
    return { status: 'ok', isAuthorized: true, isOwner: false, name: champ.champName, champName: champ.champName, email, allNames: [] };
  }

  return { status: 'unauthorized', isAuthorized: false, message: 'Email not registered' };
}

// ════════════════════════════════════════════════════════════
//  DATA LOADING
// ════════════════════════════════════════════════════════════

function buildItemObj(r) {
  return {
    date:        fmtDate(r[MD.DATE]),
    vendorName:  r[MD.VENDOR]     || '',
    branchId:    r[MD.BRANCH_ID]  || '',
    orderId:     r[MD.ORDER_ID]   || '',
    sku:         r[MD.SKU]        || '',
    itemName:    r[MD.ITEM_NAME]  || '',
    status:      r[MD.STATUS]     || '',
    chainId:     r[MD.CHAIN_ID]   || '',
    chainName:   r[MD.CHAIN_NAME] || '',
    procStatus:  r[MD.PROC_STATUS]|| '',
    champ:       r[MD.TCHAMP]     || '',
    imgUrl:      r[MD.IMG_URL]    || '',
    timestamp:   fmtDateTime(r[MD.TIMESTAMP])
  };
}

function getUserData(email) {
  const auth = verifyUserAuth(email);
  if (auth.status !== 'ok' || auth.isOwner) return { status: 'unauthorized' };

  const champName = auth.champName;
  const { rows } = getMasterRows();
  const items = rows
    .filter(r => String(r[MD.TCHAMP]).trim().toLowerCase() === champName.toLowerCase()
              && String(r[MD.PROC_STATUS]).trim() !== 'PROCESSED')
    .map(buildItemObj);

  return { status: 'ok', champName, items };
}

function getOwnerData(email, filterName) {
  const auth = verifyUserAuth(email);
  if (auth.status !== 'ok' || !auth.isOwner) return { status: 'unauthorized' };

  const { rows } = getMasterRows();
  const filtered = (filterName === 'all')
    ? rows
    : rows.filter(r => String(r[MD.TCHAMP]).trim().toLowerCase() === filterName.toLowerCase());

  const items = filtered
    .filter(r => String(r[MD.PROC_STATUS]).trim() !== 'PROCESSED')
    .map(buildItemObj);

  return { status: 'ok', items };
}

// ════════════════════════════════════════════════════════════
//  ADMIN ANALYTICS
// ════════════════════════════════════════════════════════════

function getAdminAnalytics(email, filterName) {
  const auth = verifyUserAuth(email);
  if (auth.status !== 'ok' || !auth.isOwner) return { status: 'unauthorized' };

  const { rows } = getMasterRows();
  const target = (filterName === 'all') ? rows
    : rows.filter(r => String(r[MD.TCHAMP]).trim().toLowerCase() === filterName.toLowerCase());

  const total      = target.length;
  const processed  = target.filter(r => String(r[MD.PROC_STATUS]).trim() === 'PROCESSED').length;
  const pending    = total - processed;
  const noChamp    = target.filter(r => String(r[MD.TCHAMP]).trim() === 'no t champ').length;
  const pct        = total ? Math.round(processed / total * 100) : 0;

  // Per-champ breakdown
  const champMap = {};
  for (const r of target) {
    const ch = String(r[MD.TCHAMP]).trim() || 'no t champ';
    if (!champMap[ch]) champMap[ch] = { total: 0, processed: 0 };
    champMap[ch].total++;
    if (String(r[MD.PROC_STATUS]).trim() === 'PROCESSED') champMap[ch].processed++;
  }

  // Login logs (last 50)
  const logSh = ss().getSheetByName('Login_Logs');
  let loginLogs = [];
  if (logSh && logSh.getLastRow() > 1) {
    const logData = logSh.getRange(2, 1, logSh.getLastRow() - 1, 9).getValues();
    loginLogs = logData.slice(-50).reverse().map(r => ({
      timestamp: fmtDateTime(r[0]),
      name:      r[1], email:    r[2],
      lat:       r[3], lng:      r[4],
      accuracy:  r[5], mapsUrl:  r[6],
      areaName:  r[7]
    }));
  }

  return { status: 'ok', total, processed, pending, noChamp, pct, champBreakdown: champMap, loginLogs };
}

// ════════════════════════════════════════════════════════════
//  LOGIN RECORDING
// ════════════════════════════════════════════════════════════

function recordUserLogin(p) {
  const sh = getOrCreateSheet('Login_Logs',
    ['Timestamp', 'Name', 'Email', 'Lat', 'Lng', 'Accuracy', 'MapsUrl', 'AreaName', 'LocationMs']);
  sh.appendRow([
    new Date(), p.name || '', p.email || '',
    p.lat || '', p.lng || '', p.accuracy || '',
    p.mapsUrl || '', p.areaName || '', p.locationMs || ''
  ]);
  return { status: 'ok' };
}

// ════════════════════════════════════════════════════════════
//  FEEDBACK SUBMISSION
// ════════════════════════════════════════════════════════════

function submitBatchFeedback(p) {
  // p = { champName, items: [{sku, orderId, branchId, chainId, itemName, action, note, waitDays}] }
  if (!p.items || !p.items.length) return { status: 'error', message: 'No items' };

  const fbSh = getOrCreateSheet('Feedback', [
    'Timestamp', 'ChampName', 'BranchId', 'ChainId', 'OrderId',
    'SKU', 'ItemName', 'Action', 'Note', 'WaitDays'
  ]);

  const now = new Date();
  const rows = p.items.map(item => [
    now, p.champName || '', item.branchId || '', item.chainId || '',
    item.orderId || '', item.sku || '', item.itemName || '',
    item.action || '', item.note || '', item.waitDays || ''
  ]);
  if (rows.length) fbSh.getRange(fbSh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  // Mark items as PROCESSED in Master_Database
  markProcessed(p.items.map(i => ({ orderId: i.orderId, sku: i.sku })));

  return { status: 'ok', saved: rows.length };
}

function markProcessed(keys) {
  const { rows, sheet } = getMasterRows();
  if (!sheet) return;
  const keySet = new Set(keys.map(k => String(k.orderId) + '_' + String(k.sku)));
  rows.forEach((r, i) => {
    const key = String(r[MD.ORDER_ID]) + '_' + String(r[MD.SKU]);
    if (keySet.has(key)) {
      // row 2 in sheet = i+2 (because we skipped header)
      sheet.getRange(i + 2, MD.PROC_STATUS + 1).setValue('PROCESSED');
    }
  });
}

// ════════════════════════════════════════════════════════════
//  BRANCH SUMMARY
// ════════════════════════════════════════════════════════════

function submitBranchSummary(p) {
  const sh = getOrCreateSheet('Visit_Summary', [
    'Timestamp', 'ChampName', 'BranchId', 'VendorName', 'VisitDate',
    'Status', 'Note', 'TotalItems', 'ResolvedItems'
  ]);
  sh.appendRow([
    new Date(), p.champName || '', p.branchId || '', p.vendorName || '',
    p.visitDate || '', p.status || '', p.note || '',
    p.totalItems || 0, p.resolvedItems || 0
  ]);
  return { status: 'ok' };
}

// ════════════════════════════════════════════════════════════
//  ASSIGNMENTS
// ════════════════════════════════════════════════════════════

function getAssignments(email) {
  const auth = verifyUserAuth(email);
  if (auth.status !== 'ok' || !auth.isOwner) return { status: 'unauthorized' };

  const mapRows = getMapRows();
  const rows = [];
  const champSet = new Set();

  for (const r of mapRows) {
    const chainName = String(r[MAP.CHAIN_NAME] || '').trim();
    const champ     = String(r[MAP.TCHAMP_NICK] || '').trim();
    const chainId   = r[MAP.CHAIN_ID];
    const tEmail    = String(r[MAP.TCHAMP_EMAIL] || '').trim();

    if (!chainName || !chainId) continue;   // skip blank/header rows
    // Skip manager-only rows (no chain ID, or chain ID is non-numeric)
    if (isNaN(chainId) || chainId === '') continue;

    rows.push({ chainName, champ, chainId: Number(chainId), tEmail });
    if (champ) champSet.add(champ);
  }

  const champOptions = [...champSet].sort();
  if (!champOptions.includes('no t champ')) champOptions.push('no t champ');

  return { status: 'ok', rows, champOptions };
}

function updateAssignments(email, updates) {
  // updates = [{chainId, newChamp}]
  const auth = verifyUserAuth(email);
  if (auth.status !== 'ok' || !auth.isOwner) return { status: 'unauthorized' };
  if (!updates || !updates.length) return { status: 'error', message: 'No updates' };

  const wb = ss();
  const mapSh = wb.getSheetByName('maping');
  if (!mapSh) return { status: 'error', message: 'maping sheet not found' };

  const mapRows = getMapRows();

  // Build email lookup: champNick → email (from existing maping rows)
  const champEmailMap = {};
  for (const r of mapRows) {
    const nick  = String(r[MAP.TCHAMP_NICK]   || '').trim();
    const tmail = String(r[MAP.TCHAMP_EMAIL]  || '').trim();
    if (nick && tmail && tmail.includes('@')) champEmailMap[nick] = tmail;
  }

  // Update maping sheet
  const updateMap = {};
  for (const u of updates) updateMap[Number(u.chainId)] = u.newChamp;

  let mapUpdated = 0;
  for (let i = 0; i < mapRows.length; i++) {
    const chainId = Number(mapRows[i][MAP.CHAIN_ID]);
    if (updateMap.hasOwnProperty(chainId)) {
      const newChamp = updateMap[chainId];
      const newEmail = champEmailMap[newChamp] || '';
      mapSh.getRange(i + 1, MAP.TCHAMP_NICK + 1).setValue(newChamp);
      mapSh.getRange(i + 1, MAP.TCHAMP_EMAIL + 1).setValue(newEmail);
      mapUpdated++;
    }
  }

  // Update Master_Database column M for NOT_PROCESSED rows matching chain IDs
  const { rows: mdRows, sheet: mdSh } = getMasterRows();
  let mdUpdated = 0;
  if (mdSh && mdRows.length) {
    for (let i = 0; i < mdRows.length; i++) {
      const chainId   = Number(mdRows[i][MD.CHAIN_ID]);
      const procState = String(mdRows[i][MD.PROC_STATUS]).trim();
      if (updateMap.hasOwnProperty(chainId) && procState !== 'PROCESSED') {
        mdSh.getRange(i + 2, MD.TCHAMP + 1).setValue(updateMap[chainId]);
        mdUpdated++;
      }
    }
  }

  SpreadsheetApp.flush();
  return { status: 'ok', mapUpdated, mdUpdated };
}

// ════════════════════════════════════════════════════════════
//  PASSWORD AUTH — Users sheet
// ════════════════════════════════════════════════════════════

/**
 * Returns all rows from Users sheet.
 * Auto-creates and seeds the sheet from maping data on first call.
 */
function getUsersRows() {
  const wb = ss();
  let sh = wb.getSheetByName('Users');

  if (!sh) {
    sh = wb.insertSheet('Users');
    sh.appendRow(['email', 'password', 'name', 'role', 'isFirstLogin']);

    // Seed from maping: managers first, then t-champs
    const mapRows = getMapRows();
    const seeded = new Set();

    for (const r of mapRows) {
      const mgrEmail = String(r[MAP.MGR_EMAIL] || '').trim().toLowerCase();
      const mgrName  = String(r[MAP.MGR_NAME]  || '').trim();
      if (mgrEmail && mgrEmail.includes('@') && !seeded.has(mgrEmail)) {
        sh.appendRow([mgrEmail, DEFAULT_PASS, mgrName, 'owner', 'TRUE']);
        seeded.add(mgrEmail);
      }
    }
    for (const r of mapRows) {
      const tEmail = String(r[MAP.TCHAMP_EMAIL] || '').trim().toLowerCase();
      const tName  = String(r[MAP.TCHAMP_NICK]  || '').trim();
      if (tEmail && tEmail.includes('@') && !seeded.has(tEmail)) {
        sh.appendRow([tEmail, DEFAULT_PASS, tName, 'tchamp', 'TRUE']);
        seeded.add(tEmail);
      }
    }
    SpreadsheetApp.flush();
  }

  const last = sh.getLastRow();
  if (last < 2) return { sheet: sh, rows: [] };
  const vals = sh.getRange(2, 1, last - 1, 5).getValues();
  return { sheet: sh, rows: vals };
}

function loginWithPassword(email, password) {
  if (!email || !password) return { status: 'error', message: 'بيانات ناقصة' };
  const em   = email.trim().toLowerCase();
  const pass = String(password).trim();

  const { sheet: sh, rows } = getUsersRows();

  for (let i = 0; i < rows.length; i++) {
    const rowEmail = String(rows[i][UCOLS.EMAIL] || '').trim().toLowerCase();
    if (rowEmail !== em) continue;

    const storedPass = String(rows[i][UCOLS.PASS] || '').trim();
    if (storedPass !== pass) return { status: 'error', message: 'كلمة مرور غير صحيحة' };

    const name       = String(rows[i][UCOLS.NAME] || '').trim() || em.split('@')[0];
    const role       = String(rows[i][UCOLS.ROLE] || '').trim();
    const isFirstLogin = String(rows[i][UCOLS.FIRST_LOGIN]).trim().toUpperCase() === 'TRUE';
    const isOwner    = role === 'owner';

    // Collect all T-champ names for admin dropdown
    const mapRows  = getMapRows();
    const allNames = [...new Set(
      mapRows.map(r => String(r[MAP.TCHAMP_NICK] || '').trim()).filter(n => n)
    )];

    return { status: 'ok', email: em, name, isOwner, isFirstLogin, allNames };
  }

  return { status: 'error', message: 'البريد غير مسجل' };
}

function changePassword(email, oldPass, newPass) {
  if (!email || !oldPass || !newPass) return { status: 'error', message: 'بيانات ناقصة' };
  const em = email.trim().toLowerCase();

  const { sheet: sh, rows } = getUsersRows();

  for (let i = 0; i < rows.length; i++) {
    const rowEmail = String(rows[i][UCOLS.EMAIL] || '').trim().toLowerCase();
    if (rowEmail !== em) continue;

    const storedPass = String(rows[i][UCOLS.PASS] || '').trim();
    if (storedPass !== String(oldPass).trim()) return { status: 'error', message: 'كلمة المرور القديمة غير صحيحة' };

    const dataRow = i + 2; // +1 for header, +1 for 1-based index
    sh.getRange(dataRow, UCOLS.PASS + 1).setValue(String(newPass).trim());
    sh.getRange(dataRow, UCOLS.FIRST_LOGIN + 1).setValue('FALSE');
    SpreadsheetApp.flush();
    return { status: 'ok' };
  }

  return { status: 'error', message: 'البريد غير موجود' };
}

function isAdminUser(email) {
  const { rows } = getUsersRows();
  for (const r of rows) {
    const rowEmail = String(r[UCOLS.EMAIL] || '').trim().toLowerCase();
    if (rowEmail === email && String(r[UCOLS.ROLE]).trim() === 'owner') return true;
  }
  return false;
}

function resetPassword(adminEmail, targetEmail) {
  if (!adminEmail || !targetEmail) return { status: 'error', message: 'بيانات ناقصة' };
  const admin  = adminEmail.trim().toLowerCase();
  const target = targetEmail.trim().toLowerCase();

  if (!isAdminUser(admin)) return { status: 'unauthorized', message: 'غير مصرح' };

  const { sheet: sh, rows } = getUsersRows();

  for (let i = 0; i < rows.length; i++) {
    const rowEmail = String(rows[i][UCOLS.EMAIL] || '').trim().toLowerCase();
    if (rowEmail !== target) continue;

    const dataRow = i + 2;
    sh.getRange(dataRow, UCOLS.PASS + 1).setValue(DEFAULT_PASS);
    sh.getRange(dataRow, UCOLS.FIRST_LOGIN + 1).setValue('TRUE');
    SpreadsheetApp.flush();
    return { status: 'ok' };
  }

  return { status: 'error', message: 'المستخدم غير موجود' };
}

function getUsers(adminEmail) {
  if (!adminEmail) return { status: 'unauthorized' };
  const admin = adminEmail.trim().toLowerCase();
  if (!isAdminUser(admin)) return { status: 'unauthorized', message: 'غير مصرح' };

  const { rows } = getUsersRows();
  const users = rows.map(r => ({
    email:      String(r[UCOLS.EMAIL]      || '').trim(),
    password:   String(r[UCOLS.PASS]       || '').trim(),
    name:       String(r[UCOLS.NAME]       || '').trim(),
    role:       String(r[UCOLS.ROLE]       || '').trim(),
    isFirstLogin: String(r[UCOLS.FIRST_LOGIN]).trim().toUpperCase() === 'TRUE'
  })).filter(u => u.email);

  return { status: 'ok', users };
}

function addUser(adminEmail, newEmail, name, role) {
  if (!adminEmail || !newEmail || !name) return { status: 'error', message: 'بيانات ناقصة' };
  const admin = adminEmail.trim().toLowerCase();
  const em    = newEmail.trim().toLowerCase();

  if (!isAdminUser(admin)) return { status: 'unauthorized', message: 'غير مصرح' };
  if (!em.includes('@'))   return { status: 'error', message: 'بريد إلكتروني غير صالح' };

  const { sheet: sh, rows } = getUsersRows();

  // Check duplicate
  for (const r of rows) {
    if (String(r[UCOLS.EMAIL] || '').trim().toLowerCase() === em) {
      return { status: 'error', message: 'البريد مسجل مسبقاً' };
    }
  }

  const userRole = (role === 'owner') ? 'owner' : 'tchamp';
  sh.appendRow([em, DEFAULT_PASS, name.trim(), userRole, 'TRUE']);
  SpreadsheetApp.flush();
  return { status: 'ok' };
}

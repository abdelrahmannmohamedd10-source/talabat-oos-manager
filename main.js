'use strict';

// ── Firebase Init ──
const firebaseConfig = {
  apiKey: "AIzaSyCQ-YjSUbjFSlhdcio1PhsETrg_Y8xFxTM",
  authDomain: "oosboda-8f26f.firebaseapp.com",
  projectId: "oosboda-8f26f",
  storageBucket: "oosboda-8f26f.firebasestorage.app",
  messagingSenderId: "313411194103",
  appId: "1:313411194103:web:0ec5595c0ece3d27b597f2"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ── Constants ──
const SS_ID = '1zrqSAAIyaNEBN30y0U7rWDDo4hl9O2Xz8QB9p3gRyGw';
const GVIZ  = `https://docs.google.com/spreadsheets/d/${SS_ID}/gviz/tq?tqx=out:json&sheet=`;

// Master_Database column indices
const MC = { DATE:0, VENDOR:1, BRANCH_ID:2, ORDER_ID:3, SKU:4, ITEM_NAME:5,
             STATUS:6, CHAIN_ID:7, CHAIN_NAME:8, PROC_STATUS:11, TCHAMP:12, IMG_URL:13 };
// chains sheet column indices (chains tab)
const CC = { CHAIN_NAME:0, CHAIN_ID:1, VENDOR_NAME:2, VENDOR_ID:3, TCHAMP_NICK:4 };
// maping sheet column indices (fallback)
const MP = { CHAIN_NAME:0, TCHAMP_NICK:1, CHAIN_ID:2, TCHAMP_EMAIL:3, MGR_NAME:5, MGR_EMAIL:6 };

const ACTIONS = [
  { key:'found',     label:'تم وجوده ✓' },
  { key:'not_found', label:'مش موجود ✗' },
  { key:'partial',   label:'موجود جزئي' },
  { key:'replaced',  label:'استبدال ↔'  },
  { key:'no_access', label:'مش قادر يدخل ⊘' },
];

// ── State ──
const S = {
  user:          null,
  items:         [],
  filtered:      [],
  selections:    {},
  myChains:      [],
  assignments:   {},
  allUsers:      [],
  dashTab:       'users',
  assignPending: {},
};

// ── Utilities ──
function toast(msg, type = 'ok', dur = 3200) {
  const w = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

function showLoader(msg) {
  document.getElementById('loaderText').textContent = msg || 'جاري التحميل...';
  document.getElementById('globalLoader').style.display = 'flex';
}
function hideLoader() {
  document.getElementById('globalLoader').style.display = 'none';
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}

function fmtTs(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ar-EG');
}

// ── GViz Fetch ──
async function fetchGViz(sheet) {
  const res  = await fetch(GVIZ + encodeURIComponent(sheet));
  const text = await res.text();
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  return JSON.parse(text.slice(i, j + 1)).table;
}

function gvizRows(table) {
  if (!table || !table.rows) return [];
  return table.rows.map(r =>
    (r.c || []).map(c => {
      if (!c || c.v == null) return '';
      // GViz date format: "Date(yyyy,m,d)" where m is 0-indexed
      if (typeof c.v === 'string' && c.v.startsWith('Date(')) {
        const m = c.v.match(/Date\((\d+),(\d+),(\d+)\)/);
        if (m) return new Date(+m[1], +m[2], +m[3]);
      }
      // Fallback: use formatted display string if available and looks like a date
      if (c.f && typeof c.f === 'string') {
        const d = new Date(c.f);
        if (!isNaN(d) && d.getFullYear() > 1971) return d;
      }
      return c.v;
    })
  );
}

// ── Firestore helpers ──
async function loadAllUsers() {
  const snap = await db.collection('users').get();
  S.allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return S.allUsers;
}

async function loadAssignments() {
  const snap = await db.collection('assignments').get();
  S.assignments = {};
  snap.docs.forEach(d => { S.assignments[d.data().chainId] = { id: d.id, ...d.data() }; });
  return S.assignments;
}

// ── FIRST-RUN SETUP ──
async function checkFirstRun() {
  try {
    const snap = await db.collection('users').limit(1).get();
    if (snap.empty) {
      hideLoader();
      document.getElementById('setupScreen').style.display = 'flex';
    } else {
      hideLoader();
      document.getElementById('loginScreen').classList.add('on');
    }
  } catch (e) {
    hideLoader();
    document.getElementById('loginScreen').classList.add('on');
  }
}

async function createFirstAdmin() {
  const name  = document.getElementById('setupName').value.trim();
  const email = document.getElementById('setupEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('setupPass').value;
  const err   = document.getElementById('setupError');
  err.style.display = 'none';
  if (!name || !email || pass.length < 6) {
    err.textContent = 'اكمل البيانات (الباسورد 6 احرف على الاقل)';
    err.style.display = 'block';
    return;
  }
  try {
    await db.collection('users').add({ name, email, role: 'admin', password: pass, firstLogin: false });
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('loginScreen').classList.add('on');
    toast('تم انشاء الحساب — سجل دخولك', 'ok');
  } catch (e) {
    err.textContent = 'خطأ في الانشاء — تاكد من Firestore Rules';
    err.style.display = 'block';
  }
}

// ── LOGIN ──
function showLoginError(msg) {
  const el = document.getElementById('authErrorMsg');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('loginPassword').value;
  const btn   = document.getElementById('loginBtn');
  showLoginError('');
  btn.disabled = true; btn.textContent = 'جاري...';
  try {
    const snap = await db.collection('users').where('email', '==', email).get();
    if (snap.empty)                    { showLoginError('الايميل غير موجود'); return; }
    const doc  = snap.docs[0];
    const data = doc.data();
    if (data.password !== pass)        { showLoginError('الباسورد غير صحيح'); return; }
    S.user = { id: doc.id, ...data };
    if (data.firstLogin) {
      document.getElementById('loginScreen').classList.remove('on');
      document.getElementById('changePassModal').style.display = 'flex';
    } else {
      await startApp();
    }
  } catch (err) {
    console.error(err);
    showLoginError('خطأ في الاتصال — تاكد من Firestore Rules');
  } finally {
    btn.disabled = false; btn.textContent = 'دخول';
  }
}

// ── CHANGE PASSWORD ──
async function submitChangePass() {
  const p1  = document.getElementById('cpNew').value;
  const p2  = document.getElementById('cpConfirm').value;
  const err = document.getElementById('cpError');
  err.style.display = 'none';
  if (p1.length < 6) { err.textContent = 'الباسورد لازم 6 احرف على الاقل'; err.style.display = 'block'; return; }
  if (p1 !== p2)     { err.textContent = 'الباسوردين مش متطابقين';           err.style.display = 'block'; return; }
  try {
    await db.collection('users').doc(S.user.id).update({ password: p1, firstLogin: false });
    S.user.password = p1; S.user.firstLogin = false;
    document.getElementById('changePassModal').style.display = 'none';
    await startApp();
  } catch (e) { err.textContent = 'خطأ في الحفظ'; err.style.display = 'block'; }
}

// ── START APP ──
async function startApp() {
  document.getElementById('loginScreen').classList.remove('on');
  document.getElementById('changePassModal').style.display = 'none';
  document.getElementById('appScreen').classList.add('on');
  document.getElementById('headerName').textContent = S.user.name;
  showLoader('جاري تحميل البيانات...');
  try {
    await loadAllUsers();
    await loadAssignments();
    if (S.user.role === 'admin' || S.user.role === 'owner') {
      document.getElementById('btnDashTrigger').style.display = 'inline-block';
      document.getElementById('adminFilterBar').classList.add('show');
      const sel = document.getElementById('adminUserSelect');
      sel.innerHTML = '<option value="">— كل T-Champs —</option>';
      S.allUsers.filter(u => u.role === 'tchamp').forEach(u => {
        sel.innerHTML += `<option value="${u.email}">${u.name}</option>`;
      });
    }
    if (S.user.role === 'tchamp') {
      S.myChains = Object.values(S.assignments)
        .filter(a => a.tchampEmail === S.user.email)
        .map(a => String(a.chainId));
      document.getElementById('btnSummaryTrigger').style.display = 'inline-block';
    }
    await loadOOSItems();
  } catch (err) {
    console.error(err);
    toast('خطأ في تحميل البيانات', 'err');
  } finally {
    hideLoader();
  }
}

function doLogout() {
  S.user = null; S.items = []; S.filtered = []; S.selections = {};
  document.getElementById('appScreen').classList.remove('on');
  document.getElementById('loginScreen').classList.add('on');
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
}

// ── LOAD OOS ITEMS ──
async function loadOOSItems(filterTchampEmail) {
  showLoader('جاري تحميل OOS items من الشيت...');
  try {
    const table = await fetchGViz('Master_Database');
    const rows  = gvizRows(table);

    // Show all rows with an item name
    let filtered = rows.filter(r => r[MC.ITEM_NAME]);

    if (S.user.role === 'tchamp') {
      filtered = filtered.filter(r => S.myChains.includes(String(r[MC.CHAIN_ID])));
    } else if (filterTchampEmail) {
      const chains = Object.values(S.assignments)
        .filter(a => a.tchampEmail === filterTchampEmail)
        .map(a => String(a.chainId));
      filtered = filtered.filter(r => chains.includes(String(r[MC.CHAIN_ID])));
    }

    S.items = filtered.map((r, i) => ({
      key:       `r${i}`,
      date:      r[MC.DATE],
      dateStr:   r[MC.DATE] instanceof Date ? dateKey(r[MC.DATE]) : '',
      vendor:    String(r[MC.VENDOR]    || ''),
      branchId:  String(r[MC.BRANCH_ID] || ''),
      orderId:   String(r[MC.ORDER_ID]  || ''),
      sku:       String(r[MC.SKU]       || ''),
      itemName:  String(r[MC.ITEM_NAME] || ''),
      status:    String(r[MC.STATUS]    || ''),
      chainId:   String(r[MC.CHAIN_ID]  || ''),
      chainName: String(r[MC.CHAIN_NAME]|| ''),
      imgUrl:    String(r[MC.IMG_URL]   || ''),
    }));

    S.selections = {};
    rebuildFilters();
    applyFilters();
  } catch (err) {
    console.error(err);
    toast('خطأ في تحميل بيانات الشيت', 'err');
  } finally {
    hideLoader();
  }
}

function dateKey(d) {
  if (!d || !(d instanceof Date)) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function refreshOOS() {
  const email = document.getElementById('adminUserSelect') ? document.getElementById('adminUserSelect').value : null;
  await loadOOSItems(email || null);
}

async function onAdminUserChange() {
  const email = document.getElementById('adminUserSelect').value;
  await loadOOSItems(email || null);
}

// ── FILTERS ──
function rebuildFilters() {
  const chainNames = [...new Set(S.items.map(i => i.chainName).filter(Boolean))].sort();
  const chainIds   = [...new Set(S.items.map(i => i.chainId).filter(Boolean))].sort();
  const dates      = [...new Set(S.items.map(i => i.dateStr).filter(Boolean))].sort().reverse();
  const s1 = document.getElementById('fChainName');
  const s2 = document.getElementById('fChainId');
  const s3 = document.getElementById('fDate');
  s1.innerHTML = '<option value="">كل Chain Names</option>' + chainNames.map(v => `<option value="${v}">${v}</option>`).join('');
  s2.innerHTML = '<option value="">كل Chain IDs</option>'   + chainIds.map(v => `<option value="${v}">${v}</option>`).join('');
  if (s3) {
    const todayK = today();
    s3.innerHTML = '<option value="">كل التواريخ</option>' + dates.map(v => `<option value="${v}" ${v===todayK?'selected':''}>${v}</option>`).join('');
  }
}

function applyFilters() {
  const cn = document.getElementById('fChainName').value;
  const ci = document.getElementById('fChainId').value;
  const st = document.getElementById('fStatus').value;
  const dt = document.getElementById('fDate') ? document.getElementById('fDate').value : '';
  S.filtered = S.items.filter(i =>
    (!cn || i.chainName === cn) &&
    (!ci || i.chainId   === ci) &&
    (!st || i.status    === st) &&
    (!dt || i.dateStr   === dt)
  );
  renderItems();
}

function clearFilters() {
  ['fChainName','fChainId','fStatus','fDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  applyFilters();
}

// ── RENDER ITEMS ──
function renderItems() {
  const list  = document.getElementById('itemsList');
  const empty = document.getElementById('emptyState');
  const total = S.filtered.length;
  const done  = Object.keys(S.selections).length;
  document.getElementById('summaryTotalCount').textContent     = total;
  document.getElementById('summaryUpdatedCount').textContent   = done;
  document.getElementById('summaryRemainingCount').textContent = total - done;
  document.getElementById('batchTotalCount').textContent       = total;
  document.getElementById('batchCompletedCount').textContent   = done;
  const canSubmit = done > 0 && S.user && S.user.role === 'tchamp';
  document.getElementById('btnBatchSubmit').disabled = !canSubmit;

  if (total === 0) { list.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const readOnly = S.user.role !== 'tchamp';

  list.innerHTML = S.filtered.map(item => {
    const sel         = S.selections[item.key];
    const statusBg    = item.status === 'Not Found' ? 'var(--error-bg)'   : 'var(--warning-bg)';
    const statusColor = item.status === 'Not Found' ? 'var(--error)'      : 'var(--warning)';

    const actionsHtml = readOnly ? '' : ACTIONS.map(a =>
      `<button class="abt ${sel && sel.action === a.key ? 'sel' : ''}"
        onclick="toggleAction('${item.key}','${a.key}')">
        <span>${a.label}</span>
      </button>`).join('');

    const noteHtml = (!readOnly && sel) ?
      `<div class="aip show">
        <input class="input-text-cap" placeholder="ملاحظة اختيارية"
          value="${(sel.notes||'').replace(/"/g,'&quot;')}"
          oninput="updateNote('${item.key}', this.value)">
      </div>` : '';

    const imgHtml = item.imgUrl
      ? `<div class="cb-img-col"><img class="center-product-img" src="${item.imgUrl}"
           onerror="this.parentElement.innerHTML='<span style=color:#9CA3AF;font-size:11px>لا توجد صورة</span>'"></div>`
      : `<div class="cb-img-col"><span style="color:#9CA3AF;font-size:11px">لا توجد صورة</span></div>`;

    return `
      <div class="icard" style="border-color:${sel ? 'var(--primary)' : 'transparent'}">
        <div class="ch">
          <span class="ch-date">${fmtDate(item.date)} · ${item.branchId}</span>
          <span class="ch-badge" style="background:${statusBg};color:${statusColor}">${item.status}</span>
        </div>
        <div class="cb">
          <div class="cb-actions">${actionsHtml}</div>
          ${imgHtml}
          <div class="cb-info">
            <div class="cb-chain-badge">${item.chainName} · ${item.chainId}</div>
            <div class="cb-item-name">${item.itemName}</div>
            <div class="cb-sku">SKU: ${item.sku} | Order: ${item.orderId}</div>
          </div>
        </div>
        ${noteHtml}
      </div>`;
  }).join('');
}

function toggleAction(key, action) {
  if (S.selections[key] && S.selections[key].action === action) {
    delete S.selections[key];
  } else {
    S.selections[key] = { action, notes: (S.selections[key] && S.selections[key].notes) || '' };
  }
  renderItems();
}

function updateNote(key, val) {
  if (S.selections[key]) S.selections[key].notes = val;
}

// ── SUBMIT FEEDBACK ──
async function submitBatch() {
  const keys = Object.keys(S.selections);
  if (!keys.length) return;
  const items = keys.map(k => {
    const item = S.items.find(i => i.key === k);
    return Object.assign({}, item, S.selections[k]);
  });
  const payload = {
    tchampEmail: S.user.email,
    tchampName:  S.user.name,
    date:        today(),
    items: items.map(i => ({
      chainId:   i.chainId,   chainName: i.chainName,
      branchId:  i.branchId, orderId:   i.orderId,
      sku:       i.sku,       itemName:  i.itemName,
      action:    i.action,    notes:     i.notes || '',
    })),
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  const btn = document.getElementById('btnBatchSubmit');
  btn.disabled = true; btn.textContent = 'جاري الارسال...';
  try {
    await db.collection('feedback').add(payload);
    S.selections = {};
    renderItems();
    toast('تم ارسال ' + items.length + ' عنصر بنجاح', 'ok');
  } catch (err) {
    console.error(err); toast('خطأ في الارسال', 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'ارسال الفيدباك';
  }
}

// ── BRANCH SUMMARY MODAL ──
function openSummaryModal() {
  document.getElementById('branchSummaryModal').classList.add('on');
  document.getElementById('sumNotFound').value = 0;
  document.getElementById('sumFound').value    = 0;
  document.getElementById('sumNotes').value    = '';
}
function closeSummaryModal() {
  document.getElementById('branchSummaryModal').classList.remove('on');
}
async function submitSummary() {
  const payload = {
    tchampEmail: S.user.email,
    tchampName:  S.user.name,
    date:        today(),
    chainIds:    S.myChains,
    chainNames:  [...new Set(S.items.map(i => i.chainName).filter(Boolean))],
    notFound:    parseInt(document.getElementById('sumNotFound').value) || 0,
    found:       parseInt(document.getElementById('sumFound').value)    || 0,
    objective:   document.getElementById('sumObjective').value,
    notes:       document.getElementById('sumNotes').value,
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await db.collection('summaries').add(payload);
    closeSummaryModal();
    toast('تم ارسال الملخص بنجاح', 'ok');
  } catch (err) { toast('خطأ في الارسال', 'err'); }
}

// ══════════════════════════════════════
// ADMIN DASHBOARD
// ══════════════════════════════════════
function openDash() {
  document.getElementById('adminDashboardModal').classList.add('on');
  loadDashTab(S.dashTab);
}
function closeDash() {
  document.getElementById('adminDashboardModal').classList.remove('on');
}

function switchDashTab(tab) {
  S.dashTab = tab;
  ['users','feedback','summaries','assign','performance'].forEach(function(t) {
    var cap = t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById('dashTab' + cap).style.display = t === tab ? 'block' : 'none';
    document.getElementById('dtab-' + t).classList.toggle('active', t === tab);
  });
  loadDashTab(tab);
}

function loadDashTab(tab) {
  if      (tab === 'users')       loadUsersTab();
  else if (tab === 'feedback')    loadFeedbackTab();
  else if (tab === 'summaries')   loadSummariesTab();
  else if (tab === 'assign')      loadAssignTab();
  else if (tab === 'performance') loadPerformanceTab();
}

// ── USERS TAB ──
function toggleAddUserForm() {
  var f = document.getElementById('addUserForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function saveNewUser() {
  const name  = document.getElementById('nuName').value.trim();
  const email = document.getElementById('nuEmail').value.trim().toLowerCase();
  const role  = document.getElementById('nuRole').value;
  const pass  = document.getElementById('nuPass').value;
  if (!name || !email || !pass) { toast('اكمل البيانات', 'err'); return; }
  try {
    const ex = await db.collection('users').where('email', '==', email).get();
    if (!ex.empty) { toast('الايميل موجود بالفعل', 'err'); return; }
    await db.collection('users').add({ name, email, role, password: pass, firstLogin: true });
    toast('تم اضافة ' + name, 'ok');
    toggleAddUserForm();
    await loadAllUsers();
    loadUsersTab();
  } catch (err) { toast('خطأ في الاضافة', 'err'); }
}

async function resetUserPass(id, name) {
  try {
    await db.collection('users').doc(id).update({ password: '123456', firstLogin: true });
    toast('تم Reset باسورد ' + name + ' - 123456', 'ok');
    await loadAllUsers(); loadUsersTab();
  } catch (e) { toast('خطأ', 'err'); }
}

async function deleteUser(id, name) {
  if (!confirm('هتحذف ' + name + '؟')) return;
  try {
    await db.collection('users').doc(id).delete();
    toast('تم حذف ' + name, 'ok');
    await loadAllUsers(); loadUsersTab();
  } catch (e) { toast('خطأ في الحذف', 'err'); }
}

async function loadUsersTab() {
  const el = document.getElementById('usersTable');
  el.innerHTML = '<div class="tab-loading">جاري التحميل...</div>';
  try {
    await loadAllUsers();
    if (!S.allUsers.length) { el.innerHTML = '<div class="tab-empty">لا يوجد مستخدمين</div>'; return; }
    const roleLabel = { admin:'مدير', tchamp:'T-Champ', owner:'اونر' };
    el.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<thead><tr style="background:var(--bg);border-bottom:2px solid var(--border);">' +
      '<th style="padding:10px;text-align:right;">الاسم</th>' +
      '<th style="padding:10px;text-align:right;">الايميل</th>' +
      '<th style="padding:10px;text-align:right;">الدور</th>' +
      '<th style="padding:10px;text-align:right;">الباسورد</th>' +
      '<th style="padding:10px;text-align:right;">اجراء</th>' +
      '</tr></thead><tbody>' +
      S.allUsers.map(function(u) {
        var roleBg    = u.role === 'admin' ? '#FEF3C7' : u.role === 'tchamp' ? '#EFF6FF' : '#F0FDF4';
        var roleColor = u.role === 'admin' ? '#92400E' : u.role === 'tchamp' ? '#1D4ED8' : '#166534';
        return '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:10px;font-weight:700;">' + u.name + '</td>' +
          '<td style="padding:10px;color:var(--text-2);font-size:11px;">' + u.email + '</td>' +
          '<td style="padding:10px;"><span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:' + roleBg + ';color:' + roleColor + ';">' + (roleLabel[u.role] || u.role) + '</span></td>' +
          '<td style="padding:10px;font-family:monospace;font-size:11px;">' + (u.password || '-') + '</td>' +
          '<td style="padding:10px;"><div style="display:flex;gap:4px;">' +
          '<button onclick="resetUserPass(\'' + u.id + '\',\'' + u.name + '\')" style="padding:4px 10px;background:var(--warning);color:white;border:none;border-radius:6px;font-family:\'Cairo\';font-size:11px;font-weight:700;cursor:pointer;">Reset</button>' +
          '<button onclick="deleteUser(\'' + u.id + '\',\'' + u.name + '\')" style="padding:4px 10px;background:var(--error);color:white;border:none;border-radius:6px;font-family:\'Cairo\';font-size:11px;font-weight:700;cursor:pointer;">حذف</button>' +
          '</div></td></tr>';
      }).join('') +
      '</tbody></table></div>';
  } catch (e) { el.innerHTML = '<div style="color:var(--error);padding:12px;">خطأ في التحميل</div>'; }
}

// ── FEEDBACK TAB ──
async function loadFeedbackTab() {
  const el = document.getElementById('feedbackList');
  el.innerHTML = '<div class="tab-loading">جاري التحميل...</div>';
  try {
    const snap = await db.collection('feedback').orderBy('submittedAt', 'desc').limit(60).get();
    if (snap.empty) { el.innerHTML = '<div class="tab-empty">لا يوجد فيدباك بعد</div>'; return; }
    el.innerHTML = snap.docs.map(function(doc) {
      var d   = doc.data();
      var cnt = (d.items || []).length;
      var rows = (d.items || []).slice(0,5).map(function(i) {
        var c = i.action === 'found' ? 'var(--success)' : i.action === 'not_found' ? 'var(--error)' : 'var(--warning)';
        return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:11px;"><span>' + i.itemName + '</span><span style="color:' + c + ';font-weight:700;">' + i.action + '</span></div>';
      }).join('') + (cnt > 5 ? '<div style="font-size:10px;color:var(--text-2);margin-top:4px;">+ ' + (cnt-5) + ' عنصر اخر</div>' : '');
      return '<div style="background:white;border:1.5px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<div><span style="font-weight:800;font-size:13px;">' + d.tchampName + '</span>' +
        '<span style="color:var(--text-2);font-size:11px;margin-right:8px;">' + d.date + '</span></div>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
        '<span style="background:#EFF6FF;color:#1D4ED8;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">' + cnt + ' عنصر</span>' +
        '<button onclick="downloadFeedback(\'' + doc.id + '\')" style="padding:4px 10px;background:#1A1A1A;color:white;border:none;border-radius:6px;font-family:\'Cairo\';font-size:11px;font-weight:700;cursor:pointer;">تحميل</button>' +
        '</div></div><div>' + rows + '</div>' +
        '<div style="font-size:10px;color:var(--text-2);margin-top:6px;">' + fmtTs(d.submittedAt) + '</div></div>';
    }).join('');
  } catch (e) { el.innerHTML = '<div style="color:var(--error);padding:12px;">خطأ في التحميل</div>'; }
}

async function downloadFeedback(docId) {
  try {
    const snap = await db.collection('feedback').doc(docId).get();
    const d    = snap.data();
    var csv    = 'T-Champ,Date,Chain,Branch,Order ID,SKU,Item Name,Action,Notes\n';
    (d.items || []).forEach(function(i) {
      csv += '"' + d.tchampName + '","' + d.date + '","' + (i.chainName||'') + '","' + (i.branchId||'') + '","' + (i.orderId||'') + '","' + (i.sku||'') + '","' + (i.itemName||'') + '","' + (i.action||'') + '","' + (i.notes||'') + '"\n';
    });
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'feedback_' + d.tchampName + '_' + d.date + '.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('تم التحميل', 'ok');
  } catch (e) { toast('خطأ في التحميل', 'err'); }
}

// ── SUMMARIES TAB ──
async function loadSummariesTab() {
  const el = document.getElementById('summariesList');
  el.innerHTML = '<div class="tab-loading">جاري التحميل...</div>';
  try {
    const snap = await db.collection('summaries').orderBy('submittedAt', 'desc').limit(60).get();
    if (snap.empty) { el.innerHTML = '<div class="tab-empty">لا يوجد ملخصات بعد</div>'; return; }
    el.innerHTML = snap.docs.map(function(doc) {
      var d = doc.data();
      return '<div style="background:white;border:1.5px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<span style="font-weight:800;font-size:13px;">' + d.tchampName + '</span>' +
        '<span style="font-size:11px;color:var(--text-2);">' + d.date + '</span></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
        '<div style="background:var(--error-bg);border-radius:8px;padding:10px;text-align:center;">' +
        '<div style="font-size:22px;font-weight:900;color:var(--error);">' + d.notFound + '</div>' +
        '<div style="font-size:11px;color:var(--text-2);">Not Found</div></div>' +
        '<div style="background:var(--success-bg);border-radius:8px;padding:10px;text-align:center;">' +
        '<div style="font-size:22px;font-weight:900;color:var(--success);">' + d.found + '</div>' +
        '<div style="font-size:11px;color:var(--text-2);">Found</div></div></div>' +
        (d.objective ? '<div style="font-size:12px;color:var(--text-2);margin-bottom:4px;">' + d.objective + '</div>' : '') +
        (d.notes     ? '<div style="background:var(--bg);border-radius:8px;padding:8px;font-size:12px;">' + d.notes + '</div>' : '') +
        '<div style="font-size:10px;color:var(--text-2);margin-top:6px;">الشينز: ' + ((d.chainNames||[]).join(', ') || '-') + '</div></div>';
    }).join('');
  } catch (e) { el.innerHTML = '<div style="color:var(--error);padding:12px;">خطأ في التحميل</div>'; }
}

// ── ASSIGN TAB ──
var _allChains = [];

async function loadAssignTab() {
  const el = document.getElementById('assignTable');
  el.innerHTML = '<div class="tab-loading">جاري تحميل الشينز...</div>';
  try {
    // Build chain list directly from OOS data (guaranteed matching IDs)
    var srcItems = S.items;
    if (!srcItems.length) {
      var table = await fetchGViz('Master_Database');
      var rows  = gvizRows(table);
      srcItems  = rows.filter(function(r){ return r[MC.ITEM_NAME]; }).map(function(r,i){
        return { chainId: String(r[MC.CHAIN_ID]||''), chainName: String(r[MC.CHAIN_NAME]||'') };
      });
    }
    var seen = {};
    _allChains = [];
    srcItems.forEach(function(item) {
      if (item.chainId && !seen[item.chainId]) {
        seen[item.chainId] = true;
        _allChains.push({ chainId: item.chainId, chainName: item.chainName, defEmail: '', defNick: '' });
      }
    });
    _allChains.sort(function(a,b){ return a.chainName.localeCompare(b.chainName); });
    await loadAssignments();
    if (!S.allUsers.length) await loadAllUsers();
    renderAssignTable(_allChains);
  } catch (e) { el.innerHTML = '<div style="color:var(--error);padding:12px;">خطأ في تحميل الشيت</div>'; }
}

function filterAssignTable() {
  const q = document.getElementById('assignSearch').value.toLowerCase();
  const filtered = _allChains.filter(function(c) {
    return c.chainName.toLowerCase().includes(q) || c.chainId.toLowerCase().includes(q);
  });
  renderAssignTable(filtered);
}

function renderAssignTable(chains) {
  const el      = document.getElementById('assignTable');
  const tchamps = S.allUsers.filter(function(u) { return u.role === 'tchamp'; });
  if (!chains.length) { el.innerHTML = '<div class="tab-empty">لا توجد شينز</div>'; return; }

  var opts = '<option value="">— غير محدد —</option>' +
    tchamps.map(function(t) { return '<option value="' + t.email + '">' + t.name + '</option>'; }).join('');

  el.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
    '<thead><tr style="background:var(--bg);border-bottom:2px solid var(--border);">' +
    '<th style="padding:10px;text-align:right;">Chain ID</th>' +
    '<th style="padding:10px;text-align:right;">اسم الشين</th>' +
    '<th style="padding:10px;text-align:right;">T-Champ المسؤول</th>' +
    '</tr></thead><tbody>' +
    chains.map(function(c) {
      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:10px;font-family:monospace;font-weight:700;">' + c.chainId + '</td>' +
        '<td style="padding:10px;">' + c.chainName + '</td>' +
        '<td style="padding:10px;">' +
        '<select class="assign-select" data-chain="' + c.chainId + '" data-name="' + c.chainName + '" onchange="onAssignChange(this)">' +
        opts + '</select></td></tr>';
    }).join('') +
    '</tbody></table></div>';

  chains.forEach(function(c) {
    var cur   = S.assignments[c.chainId];
    var email = (cur && cur.tchampEmail) || c.defEmail || '';
    if (email) {
      var sel = el.querySelector('[data-chain="' + c.chainId + '"]');
      if (sel) sel.value = email;
    }
  });
}

function onAssignChange(sel) {
  var chainId   = sel.dataset.chain;
  var chainName = sel.dataset.name;
  var email     = sel.value;
  var tchamp    = S.allUsers.find(function(u) { return u.email === email; });
  S.assignPending[chainId] = { chainId: chainId, chainName: chainName, tchampEmail: email, tchampNick: tchamp ? tchamp.name : '' };
  sel.classList.add('changed');
}

async function saveAssignments() {
  var changes = Object.values(S.assignPending);
  if (!changes.length) { toast('لا توجد تغييرات', 'inf'); return; }
  var btn = document.getElementById('btnSaveAssign');
  btn.disabled = true; btn.textContent = 'جاري الحفظ...';
  try {
    var batch = db.batch();
    changes.forEach(function(ch) {
      var ex = S.assignments[ch.chainId];
      if (ex && ex.id) {
        batch.update(db.collection('assignments').doc(ex.id), { tchampEmail: ch.tchampEmail, tchampNick: ch.tchampNick });
      } else {
        batch.set(db.collection('assignments').doc(), ch);
      }
    });
    await batch.commit();
    await loadAssignments();
    S.assignPending = {};
    document.querySelectorAll('.assign-select.changed').forEach(function(s) { s.classList.remove('changed'); });
    toast('تم حفظ ' + changes.length + ' تغيير', 'ok');
  } catch (e) {
    console.error(e); toast('خطأ في الحفظ', 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'حفظ التوزيع';
  }
}

// ── PERFORMANCE TAB ──
async function loadPerformanceTab() {
  var el = document.getElementById('performanceTable');
  el.innerHTML = '<div class="tab-loading">جاري تحميل بيانات الأداء...</div>';
  try {
    var table = await fetchGViz('performance');
    var cols  = (table.cols || []).map(function(c) { return c.label || c.id || ''; });
    var rows  = gvizRows(table);
    if (!rows.length) { el.innerHTML = '<div class="tab-empty">لا توجد بيانات</div>'; return; }

    el.innerHTML = '<div style="overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
      '<thead><tr style="background:var(--bg);border-bottom:2px solid var(--border);">' +
      cols.map(function(c) { return '<th style="padding:8px 10px;text-align:right;white-space:nowrap;">' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function(r, ri) {
        return '<tr style="border-bottom:1px solid var(--border);' + (ri % 2 === 0 ? '' : 'background:#FAFAFA;') + '">' +
          r.map(function(cell) {
            var v = cell instanceof Date ? fmtDate(cell) : (cell || '');
            return '<td style="padding:8px 10px;">' + v + '</td>';
          }).join('') +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';
  } catch(e) {
    console.error(e);
    el.innerHTML = '<div style="color:var(--error);padding:12px;">خطأ في تحميل بيانات الأداء</div>';
  }
}

// ── INIT ──
window.addEventListener('DOMContentLoaded', function() {
  showLoader('جاري التحميل...');
  checkFirstRun();
});

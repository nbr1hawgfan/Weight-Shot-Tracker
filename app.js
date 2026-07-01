// ====== CONFIGURE THIS: your deployed GAS Web App /exec URL ======
const API_URL = 'https://script.google.com/macros/s/AKfycbwC-tA_YkAvp6dq_pDy5nvNQKATsgLiq3Twh_8sMYWCTYbavls5lDLsOfg87j3oB9UA/exec';

const QUEUE_KEY = 'tracker_offline_queue_v1';
const CACHE_DATA_KEY = 'tracker_last_data_v1';

let appData = null;
let currentDate = new Date();
let exportType = '';
let isOnline = navigator.onLine;

// ---------- Service worker registration ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

window.onload = function () {
  document.getElementById('todayLabel').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  setTodayDates();
  loadData();
  updateOfflineBanner();

  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (action === 'shot') openModal('shot');
  if (action === 'water') openModal('water');
  if (action === 'weight') openModal('weight');
};

window.addEventListener('online', () => { isOnline = true; updateOfflineBanner(); flushQueue(); });
window.addEventListener('offline', () => { isOnline = false; updateOfflineBanner(); });

function updateOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  const queue = getQueue();
  if (!isOnline) {
    banner.textContent = "You're offline — entries will save and sync automatically when you're back.";
    banner.className = 'show';
  } else if (queue.length > 0) {
    banner.textContent = 'Syncing ' + queue.length + ' queued entr' + (queue.length === 1 ? 'y' : 'ies') + '...';
    banner.className = 'show syncing';
  } else {
    banner.className = '';
  }
}

function setTodayDates() {
  const today = localDateStr();
  ['shotDate', 'orderDate', 'weightDate', 'stepsDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
}

// Local calendar date as YYYY-MM-DD. Deliberately avoids toISOString(),
// which converts to UTC and rolls over to the next day during evening
// hours in US time zones - that mismatch was hiding same-day entries.
function localDateStr(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- Offline queue ----------
function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; }
}
function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
function queueAction(action, payload) {
  const q = getQueue();
  q.push({ action, payload, queuedAt: new Date().toISOString() });
  saveQueue(q);
  updateOfflineBanner();
}
function flushQueue() {
  const q = getQueue();
  if (q.length === 0 || API_URL.indexOf('PASTE_YOUR') === 0) return;
  updateOfflineBanner();
  apiPost({ action: 'syncBatch', payload: { items: q } })
    .then(() => { saveQueue([]); updateOfflineBanner(); loadData(); })
    .catch(() => { /* still offline or failed - keep queue, try again next online event */ });
}

// ---------- API helpers ----------
// POST uses text/plain to avoid a CORS preflight OPTIONS request (GAS can't handle those).
function apiPost(body) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(r => r.json());
}
function apiGet(action, extraParams) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  if (extraParams) Object.keys(extraParams).forEach(k => url.searchParams.set(k, extraParams[k]));
  return fetch(url.toString()).then(r => r.json());
}

function refreshData() {
  const btn = document.getElementById('refreshBtn');
  const original = btn.textContent;
  btn.textContent = 'Loading...';
  btn.disabled = true;
  loadData().finally(() => { btn.textContent = original; btn.disabled = false; });
}

function loadData() {
  if (API_URL.indexOf('PASTE_YOUR') === 0) {
    // Not configured yet - use any cached demo data so the UI still renders
    const cached = localStorage.getItem(CACHE_DATA_KEY);
    if (cached) { appData = JSON.parse(cached); renderAll(); }
    return Promise.resolve();
  }
  return apiGet('getAllData').then(data => {
    appData = data;
    localStorage.setItem(CACHE_DATA_KEY, JSON.stringify(data));
    document.getElementById('sheetLink').href = data.sheetUrl || '#';
    renderAll();
    flushQueue();
  }).catch(() => {
    const cached = localStorage.getItem(CACHE_DATA_KEY);
    if (cached) { appData = JSON.parse(cached); renderAll(); }
  });
}

function renderAll() {
  updateRings();
  updateDashboardCards();
  updateSparkline();
  updateStreak();
  updateCalendar();
  updateShotsList();
  updateVialsList();
  updateWeightList();
  updateProteinList();
  populateVialSelect();
  updateGoalFields();
  updateWithingsBtn();
}

// ---------- Ring math ----------
function setRing(circleEl, pct) {
  const r = circleEl.getAttribute('r');
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  circleEl.setAttribute('stroke-dasharray', circumference.toFixed(1));
  circleEl.setAttribute('stroke-dashoffset', (circumference * (1 - clamped)).toFixed(1));
}

function todayStr() { return localDateStr(); }

function updateRings() {
  if (!appData) return;
  const cfg = appData.config || {};
  const today = todayStr();

  // Shot cycle ring
  const nextShotDate = cfg['Next Shot Date'];
  if (nextShotDate) {
    const next = new Date(nextShotDate + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((next - now) / 86400000);
    document.getElementById('cycleDaysLeft').textContent = daysLeft;
    document.getElementById('nextShotDate').textContent = next.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    setRing(document.getElementById('cycleRing'), 1 - (daysLeft / 7));
  }
  const currentVialCfg = cfg['Current Vial'];
  if (currentVialCfg) {
    const vial = (appData.vials || []).find(v => v['Vial Number'] === currentVialCfg);
    document.getElementById('currentVialSub').textContent = vial ? (currentVialCfg + ' · ' + parseFloat(vial['Remaining (mg)'] || 0).toFixed(1) + 'mg left') : currentVialCfg;
  }

  // Steps ring
  const stepsGoal = parseFloat(cfg['Steps Goal']) || 8000;
  const stepsToday = (appData.steps || []).find(s => s.Date === today);
  const stepsVal = stepsToday ? parseFloat(stepsToday.Steps) || 0 : 0;
  setRing(document.getElementById('stepsRing'), stepsVal / stepsGoal);
  document.getElementById('stepsRingLabel').textContent = Math.round((stepsVal / stepsGoal) * 100) + '%';
  document.getElementById('stepsDetail').textContent = stepsVal.toLocaleString() + ' / ' + stepsGoal.toLocaleString();

  // Hydration ring
  const hydrationGoal = parseFloat(cfg['Hydration Goal Oz']) || 80;
  const hydrationToday = (appData.hydration || []).filter(h => h.Date === today);
  const hydrationVal = hydrationToday.reduce((sum, h) => sum + (parseFloat(h['Amount (oz)']) || 0), 0);
  setRing(document.getElementById('hydrationRing'), hydrationVal / hydrationGoal);
  document.getElementById('hydrationRingLabel').textContent = Math.round((hydrationVal / hydrationGoal) * 100) + '%';
  document.getElementById('hydrationDetail').textContent = hydrationVal + ' / ' + hydrationGoal + ' oz';

  // Protein ring
  const proteinGoal = parseFloat(cfg['Protein Goal G']) || 120;
  const proteinToday = (appData.protein || []).filter(p => p.Date === today);
  const proteinVal = proteinToday.reduce((sum, p) => sum + (parseFloat(p.Grams) || 0), 0);
  setRing(document.getElementById('proteinRing'), proteinVal / proteinGoal);
  document.getElementById('proteinRingLabel').textContent = Math.round((proteinVal / proteinGoal) * 100) + '%';
  document.getElementById('proteinDetail').textContent = proteinVal + ' / ' + proteinGoal + ' g';
}

function updateDashboardCards() {
  if (!appData) return;
  document.getElementById('totalShots').textContent = (appData.shots || []).length;

  const weights = appData.weight || [];
  if (weights.length > 0) {
    const latest = weights[weights.length - 1];
    const w = parseFloat(latest['Weight (lbs)']) || 0;
    document.getElementById('latestWeight').textContent = w.toFixed(1) + ' lbs';
    if (weights.length > 1) {
      const prev = parseFloat(weights[weights.length - 2]['Weight (lbs)']) || 0;
      const diff = w - prev;
      const label = document.getElementById('weightChangeLabel');
      label.textContent = (diff <= 0 ? '' : '+') + diff.toFixed(1) + ' lbs since last log';
      label.style.color = diff < 0 ? '#10b981' : diff > 0 ? '#dc2626' : '#64748b';
    }
  }

  const cfg = appData.config || {};
  const currentVial = cfg['Current Vial'];
  if (currentVial) {
    const vial = (appData.vials || []).find(v => v['Vial Number'] === currentVial);
    if (vial) document.getElementById('currentVial').textContent = (parseFloat(vial['Remaining (mg)']) || 0).toFixed(1) + 'mg';
  }
}

function updateSparkline() {
  const svg = document.getElementById('sparkline');
  const weights = (appData && appData.weight || []).slice(-20);
  if (weights.length < 2) { svg.innerHTML = ''; return; }
  const values = weights.map(w => parseFloat(w['Weight (lbs)']) || 0);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = 300 / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(55 - ((v - min) / range) * 50).toFixed(1)}`).join(' ');
  svg.innerHTML = `<polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ---------- Streak ----------
function updateStreak() {
  if (!appData) return;
  const daySets = new Set();
  (appData.shots || []).forEach(s => daySets.add(s.Date));
  (appData.weight || []).forEach(w => daySets.add(w.Date));
  (appData.steps || []).forEach(s => daySets.add(s.Date));
  (appData.hydration || []).forEach(h => daySets.add(h.Date));
  (appData.protein || []).forEach(p => daySets.add(p.Date));

  let streak = 0;
  let cursor = new Date();
  while (true) {
    const dStr = localDateStr(cursor);
    if (daySets.has(dStr)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  document.getElementById('streakPill').textContent = '🔥 ' + streak + ' day streak';
}

// ---------- Tabs ----------
function switchTab(event, tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  event.target.closest('.tab').classList.add('active');
  document.getElementById(tabName).classList.add('active');
}

// ---------- Modals ----------
function openModal(type) { document.getElementById(type + 'Modal').classList.add('active'); setTodayDates(); if (type === 'shot') showSiteSuggestion(); }
function closeModal(type) { document.getElementById(type + 'Modal').classList.remove('active'); }

function showSiteSuggestion() {
  const el = document.getElementById('siteSuggestion');
  const suggestion = window.lastSuggestedSite;
  if (suggestion) {
    el.style.display = 'block';
    el.textContent = 'Suggested next site (rotation): ' + suggestion;
  } else {
    el.style.display = 'none';
  }
}

// ---------- Vial select ----------
function populateVialSelect() {
  const select = document.getElementById('shotVial');
  select.innerHTML = '<option value="">Select vial...</option>';
  if (!appData) return;
  (appData.vials || []).filter(v => v.Status !== 'Empty' && (parseFloat(v['Remaining (mg)']) || 0) > 0).forEach(vial => {
    const opt = document.createElement('option');
    opt.value = vial['Vial Number'];
    opt.textContent = vial['Vial Number'] + ' (' + (parseFloat(vial['Remaining (mg)']) || 0).toFixed(1) + 'mg remaining)';
    select.appendChild(opt);
  });
  const cfg = appData.config || {};
  if (cfg['Default Dosage']) document.getElementById('shotDosage').value = cfg['Default Dosage'];
  if (cfg['Current Vial']) select.value = cfg['Current Vial'];
}

function updateGoalFields() {
  if (!appData) return;
  const cfg = appData.config || {};
  document.getElementById('goalSteps').value = cfg['Steps Goal'] || 8000;
  document.getElementById('goalHydration').value = cfg['Hydration Goal Oz'] || 80;
  document.getElementById('goalProtein').value = cfg['Protein Goal G'] || 120;
}

// ---------- Submit handlers ----------
function submitShot(event) {
  event.preventDefault();
  const btn = document.getElementById('shotSubmitBtn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  const payload = {
    date: document.getElementById('shotDate').value,
    vialNumber: document.getElementById('shotVial').value,
    dosage: parseFloat(document.getElementById('shotDosage').value),
    location: document.getElementById('shotLocation').value,
    notes: document.getElementById('shotNotes').value
  };
  submitOrQueue('addShot', payload, () => {
    closeModal('shot'); event.target.reset(); setTodayDates();
    btn.textContent = 'Record Shot'; btn.disabled = false;
    loadData();
  });
}

function submitOrder(event) {
  event.preventDefault();
  const btn = document.getElementById('orderSubmitBtn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  const payload = {
    orderDate: document.getElementById('orderDate').value,
    receivedDate: document.getElementById('receivedDate').value,
    vialCount: parseInt(document.getElementById('vialCount').value),
    dosagePerVial: parseFloat(document.getElementById('dosagePerVial').value)
  };
  submitOrQueue('addOrder', payload, () => {
    closeModal('order'); event.target.reset(); setTodayDates();
    btn.textContent = 'Add Order'; btn.disabled = false;
    loadData();
  });
}

function submitWeight(event) {
  event.preventDefault();
  const btn = document.getElementById('weightSubmitBtn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  const payload = {
    date: document.getElementById('weightDate').value,
    weight: parseFloat(document.getElementById('weightValue').value),
    source: 'manual',
    notes: document.getElementById('weightNotes').value
  };
  submitOrQueue('addWeight', payload, () => {
    closeModal('weight'); event.target.reset(); setTodayDates();
    btn.textContent = 'Log Weight'; btn.disabled = false;
    loadData();
  });
}

function submitSteps(event) {
  event.preventDefault();
  const btn = document.getElementById('stepsSubmitBtn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  const payload = { date: document.getElementById('stepsDate').value, steps: parseInt(document.getElementById('stepsValue').value), source: 'manual' };
  submitOrQueue('addSteps', payload, () => {
    closeModal('steps'); event.target.reset(); setTodayDates();
    btn.textContent = 'Save Steps'; btn.disabled = false;
    loadData();
  });
}

function quickAddWater(oz) {
  submitOrQueue('addHydration', { date: todayStr(), amount: oz }, () => loadData());
}

function submitWater(event) {
  event.preventDefault();
  const btn = document.getElementById('waterSubmitBtn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  const payload = { date: todayStr(), amount: parseFloat(document.getElementById('waterValue').value) };
  submitOrQueue('addHydration', payload, () => {
    closeModal('water'); event.target.reset();
    btn.textContent = 'Log Water'; btn.disabled = false;
    loadData();
  });
}

function submitProtein(event) {
  event.preventDefault();
  const btn = document.getElementById('proteinSubmitBtn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  const payload = { date: todayStr(), grams: parseFloat(document.getElementById('proteinValue').value), notes: document.getElementById('proteinNotes').value };
  submitOrQueue('addProtein', payload, () => {
    closeModal('protein'); event.target.reset();
    btn.textContent = 'Log Protein'; btn.disabled = false;
    loadData();
  });
}

function saveGoals() {
  const payload = {
    stepsGoal: parseInt(document.getElementById('goalSteps').value),
    hydrationGoalOz: parseFloat(document.getElementById('goalHydration').value),
    proteinGoalG: parseFloat(document.getElementById('goalProtein').value)
  };
  submitOrQueue('updateGoals', payload, () => loadData());
}

// Tries the network; if it fails (offline or API unreachable), queues it locally instead.
function submitOrQueue(action, payload, onSettled) {
  if (API_URL.indexOf('PASTE_YOUR') === 0) {
    alert('Set API_URL in app.js to your deployed Web App URL first.');
    onSettled();
    return;
  }
  if (!isOnline) {
    queueAction(action, payload);
    onSettled();
    return;
  }
  apiPost({ action, payload }).then(result => {
    if (result && result.nextSuggestedSite) window.lastSuggestedSite = result.nextSuggestedSite;
    if (result && result.offline) { queueAction(action, payload); }
    onSettled();
  }).catch(() => {
    queueAction(action, payload);
    onSettled();
  });
}

// ---------- Lists ----------
function fmtDate(d) { if (!d) return ''; return localDateStr(new Date(d + 'T00:00:00')); }

function updateShotsList() {
  const el = document.getElementById('shotsList');
  const shots = (appData && appData.shots) || [];
  if (shots.length === 0) { el.innerHTML = '<p style="color:#999;padding:16px;">No shots recorded yet.</p>'; return; }
  let html = '<div style="overflow-x:auto;"><table><tr><th>Date</th><th>Vial</th><th>Dosage</th><th>Location</th></tr>';
  shots.slice().reverse().forEach(s => {
    html += `<tr><td>${fmtDate(s.Date)}</td><td>${s['Vial Number']}</td><td>${(parseFloat(s['Dosage (mg)']) || 0).toFixed(1)}mg</td><td>${s.Location}</td></tr>`;
  });
  html += '</table></div>';
  el.innerHTML = html;
}

function updateVialsList() {
  const el = document.getElementById('vialsList');
  const vials = (appData && appData.vials) || [];
  if (vials.length === 0) { el.innerHTML = '<p style="color:#999;padding:16px;">No vials in inventory.</p>'; return; }
  let html = '<div style="overflow-x:auto;"><table><tr><th>Vial</th><th>Total</th><th>Used</th><th>Remaining</th><th>Status</th></tr>';
  vials.forEach(v => {
    const color = v.Status === 'Empty' ? '#dc2626' : v.Status === 'In Use' ? '#f59e0b' : '#10b981';
    html += `<tr><td>${v['Vial Number']}</td><td>${(parseFloat(v['Total Dosage (mg)']) || 0).toFixed(1)}mg</td><td>${(parseFloat(v['Used (mg)']) || 0).toFixed(1)}mg</td><td>${(parseFloat(v['Remaining (mg)']) || 0).toFixed(1)}mg</td><td><span style="background:${color};color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;">${v.Status}</span></td></tr>`;
  });
  html += '</table></div>';
  el.innerHTML = html;
}

function updateWeightList() {
  const el = document.getElementById('weightList');
  const weights = (appData && appData.weight) || [];
  if (weights.length === 0) { el.innerHTML = '<p style="color:#999;padding:16px;">No weight entries yet.</p>'; return; }
  let html = '<div style="overflow-x:auto;"><table><tr><th>Date</th><th>Weight</th><th>Change</th><th>Source</th></tr>';
  weights.slice().reverse().forEach((entry, index) => {
    let change = '';
    if (index < weights.length - 1) {
      const prev = weights[weights.length - index - 2];
      const diff = (parseFloat(entry['Weight (lbs)']) || 0) - (parseFloat(prev['Weight (lbs)']) || 0);
      const color = diff < 0 ? 'green' : diff > 0 ? 'red' : 'gray';
      change = `<span style="color:${color};">${diff > 0 ? '+' : ''}${diff.toFixed(1)}</span>`;
    }
    html += `<tr><td>${fmtDate(entry.Date)}</td><td><strong>${(parseFloat(entry['Weight (lbs)']) || 0).toFixed(1)} lbs</strong></td><td>${change}</td><td>${entry.Source || 'manual'}</td></tr>`;
  });
  html += '</table></div>';
  el.innerHTML = html;
}

function updateProteinList() {
  const el = document.getElementById('proteinList');
  const today = todayStr();
  const items = ((appData && appData.protein) || []).filter(p => p.Date === today);
  if (items.length === 0) { el.innerHTML = '<p style="color:#999;">Nothing logged today.</p>'; return; }
  el.innerHTML = items.map(p => `<div style="padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:13px;">${p.Time || ''} — <strong>${p.Grams}g</strong> ${p.Notes ? '· ' + p.Notes : ''}</div>`).join('');
}

// ---------- Calendar ----------
function prevMonth() { currentDate.setMonth(currentDate.getMonth() - 1); updateCalendar(); }
function nextMonthFn() { currentDate.setMonth(currentDate.getMonth() + 1); updateCalendar(); }

function updateCalendar() {
  const year = currentDate.getFullYear(), month = currentDate.getMonth();
  document.getElementById('currentMonth').textContent = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
    const h = document.createElement('div');
    h.style.cssText = 'text-align:center;font-weight:700;color:var(--navy-800);padding:4px;';
    h.textContent = d;
    grid.appendChild(h);
  });
  for (let i = firstDay - 1; i >= 0; i--) grid.appendChild(dayCell(daysInPrevMonth - i, true, new Date(year, month - 1, daysInPrevMonth - i)));
  for (let i = 1; i <= daysInMonth; i++) grid.appendChild(dayCell(i, false, new Date(year, month, i)));
  const remaining = 42 - (firstDay + daysInMonth);
  for (let i = 1; i <= remaining; i++) grid.appendChild(dayCell(i, true, new Date(year, month + 1, i)));
}

function dayCell(num, otherMonth, date) {
  const div = document.createElement('div');
  const dateStr = localDateStr(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = date.getTime() === today.getTime();
  div.style.cssText = `aspect-ratio:1;border:1.5px solid ${isToday ? '#3b82f6' : '#e2e8f0'};border-radius:8px;padding:4px;cursor:pointer;background:#fff;${otherMonth ? 'opacity:0.3;' : ''}${isToday ? 'background:#dbeafe;font-weight:700;' : ''}`;
  div.innerHTML = `<div>${num}</div>`;
  if (appData) {
    const dots = [];
    if ((appData.shots || []).some(s => fmtDate(s.Date) === dateStr)) dots.push('<span style="color:#3b82f6;">●</span>');
    if ((appData.weight || []).some(w => fmtDate(w.Date) === dateStr)) dots.push('<span style="color:#f59e0b;">●</span>');
    if ((appData.hydration || []).some(h => h.Date === dateStr)) dots.push('<span style="color:#10b981;">●</span>');
    div.innerHTML += `<div style="font-size:9px;">${dots.join(' ')}</div>`;
  }
  div.addEventListener('click', () => showDayDetails(dateStr, date));
  return div;
}

function showDayDetails(dateStr, date) {
  if (!appData) return;
  document.getElementById('dayModalTitle').textContent = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  let content = '', hasData = false;

  const shots = (appData.shots || []).filter(s => fmtDate(s.Date) === dateStr);
  if (shots.length) { hasData = true; content += '<h3 style="color:var(--navy-800);margin-bottom:8px;">💉 Shots</h3>'; shots.forEach(s => { content += `<div style="background:#f8fafc;padding:10px;border-radius:8px;margin-bottom:8px;"><strong>${s['Vial Number']}</strong> · ${(parseFloat(s['Dosage (mg)']) || 0).toFixed(1)}mg · ${s.Location}</div>`; }); }

  const weights = (appData.weight || []).filter(w => fmtDate(w.Date) === dateStr);
  if (weights.length) { hasData = true; content += '<h3 style="color:#f59e0b;margin-bottom:8px;">⚖️ Weight</h3>'; weights.forEach(w => { content += `<div style="background:#f8fafc;padding:10px;border-radius:8px;margin-bottom:8px;">${(parseFloat(w['Weight (lbs)']) || 0).toFixed(1)} lbs</div>`; }); }

  const hyd = (appData.hydration || []).filter(h => h.Date === dateStr);
  if (hyd.length) { hasData = true; const total = hyd.reduce((s, h) => s + (parseFloat(h['Amount (oz)']) || 0), 0); content += `<h3 style="color:#10b981;margin-bottom:8px;">💧 Water: ${total} oz</h3>`; }

  const pro = (appData.protein || []).filter(p => p.Date === dateStr);
  if (pro.length) { hasData = true; const total = pro.reduce((s, p) => s + (parseFloat(p.Grams) || 0), 0); content += `<h3 style="color:#f59e0b;margin-bottom:8px;">🥩 Protein: ${total} g</h3>`; }

  const steps = (appData.steps || []).find(s => s.Date === dateStr);
  if (steps) { hasData = true; content += `<h3 style="color:#38bdf8;margin-bottom:8px;">👟 Steps: ${parseInt(steps.Steps).toLocaleString()}</h3>`; }

  if (!hasData) content = '<p style="text-align:center;color:#999;padding:30px;">No events recorded for this day.</p>';
  document.getElementById('dayModalContent').innerHTML = content;
  document.getElementById('dayModal').classList.add('active');
}

// ---------- Export ----------
function openExportModal(type) {
  exportType = type;
  document.getElementById('exportModalTitle').textContent = type === 'shots' ? 'Export Shot History' : 'Export Weight Journey';
  document.getElementById('exportModal').classList.add('active');
}

function downloadExport() {
  const rows = exportType === 'shots' ? (appData.shots || []) : (appData.weight || []);
  let csv;
  if (exportType === 'shots') {
    csv = 'Date,Vial Number,Dosage (mg),Location,Notes\n';
    rows.forEach(s => { csv += `${fmtDate(s.Date)},${s['Vial Number']},${(parseFloat(s['Dosage (mg)']) || 0).toFixed(1)},${s.Location},"${(s.Notes || '').replace(/"/g, '""')}"\n`; });
  } else {
    csv = 'Date,Weight (lbs),Source,Notes\n';
    rows.forEach(w => { csv += `${fmtDate(w.Date)},${(parseFloat(w['Weight (lbs)']) || 0).toFixed(1)},${w.Source || ''},"${(w.Notes || '').replace(/"/g, '""')}"\n`; });
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = exportType === 'shots' ? 'shot-history.csv' : 'weight-journey.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  closeModal('export');
}

function emailExport() {
  apiGet('getAllData').then(() => {}); // no-op warm call
  const action = exportType === 'shots' ? 'emailShotsCSV' : 'emailWeightCSV';
  const email = prompt('Send export to which email address?');
  if (!email) return;
  apiPost({ action, payload: { email } }).then(result => {
    alert(result.message || 'Sent.');
    closeModal('export');
  }).catch(() => alert('Could not send email - check your connection.'));
}

// ---------- Withings ----------
function updateWithingsBtn() {
  const btn = document.getElementById('withingsBtn');
  const cfg = (appData && appData.config) || {};
  if (cfg['Withings Access Token']) {
    btn.textContent = 'Sync Withings';
  } else {
    btn.textContent = 'Connect Withings';
  }
}

function withingsAction() {
  const cfg = (appData && appData.config) || {};
  if (cfg['Withings Access Token']) {
    apiGet('withingsSync').then(result => {
      alert(result.message || result.error || 'Sync attempted.');
      if (result.success) loadData();
    });
  } else {
    apiGet('withingsAuthUrl').then(result => {
      if (result.url) {
        window.open(result.url, '_blank');
      } else {
        alert('Withings isn\'t configured yet. See SETUP.md for the Withings developer app steps.');
      }
    });
  }
}

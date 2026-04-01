/* script.js - 敬拜團服事管理系統 (外部講道對接極簡版) */

const API_URL = 'https://script.google.com/macros/s/AKfycbyk_6tUucVg-U4rRQjYHvk632teZyxufDkNX_X1WRUXPMGgsTaemVXD_mv9kBDjuSwOnA/exec';

// --- 全域變數 ---
let currentPositions = []; 
let generatedScheduleData = []; 
let fpInstance = null; 
let uniquePersonnel = []; 
let currentLeaveCard = null; 
let sortablePositions = null; 

// --- 初始化 ---
window.onload = () => {
  const syncTimeEl = document.getElementById('syncTime');
  if (syncTimeEl) syncTimeEl.innerText = new Date().toLocaleTimeString();
  loadDashboard();
};

function formatDateSafe(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return "";
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateSafe(dateStr) {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date();
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

async function callAPI(action, payload) {
  try {
    const response = await fetch(API_URL, { 
      method: 'POST', 
      body: JSON.stringify({ action: action, ...payload }) 
    });
    const rawText = await response.text();
    try {
      return JSON.parse(rawText);
    } catch (parseError) {
      throw new Error("伺服器回傳格式錯誤");
    }
  } catch (networkError) {
    throw networkError;
  }
}

function switchTab(tabId) {
  const content = document.getElementById(tabId);
  if (!content) return;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  content.classList.add('active');
  const activeLink = document.querySelector(`a[onclick="switchTab('${tabId}')"]`);
  if (activeLink) activeLink.classList.add('active');
  
  if(tabId === 'dashboard') loadDashboard();
  if(tabId === 'settings') loadPositions();
  if(tabId === 'schedule') initScheduleTab();
}

// ==========================================
// 1. 公佈欄邏輯
// ==========================================
async function loadDashboard() {
  const container = document.getElementById('dashboardContainer');
  const quarterSelect = document.getElementById('quarterSelect');
  if (!container || !quarterSelect) return;

  const [year, quarter] = quarterSelect.value.split('-');
  container.innerHTML = `<div class="text-center p-5 text-primary"><div class="spinner-border"></div><div class="mt-2">同步 ${year}-${quarter} 資料中...</div></div>`;

  try {
    const result = await callAPI('getSchedule', { year, quarter });
    if (result.status === 'success') {
      const syncTimeEl = document.getElementById('syncTime');
      if (syncTimeEl) syncTimeEl.innerText = new Date().toLocaleTimeString();
      renderDashboardTable(result.data);
    } else {
      container.innerHTML = `<div class="alert alert-warning text-center m-4">⚠️ ${result.message || '查無資料'}</div>`;
    }
  } catch (error) {
    container.innerHTML = `<div class="alert alert-danger text-center m-4">❌ 連線失敗<br><small>${error.message}</small></div>`;
  }
}

function renderDashboardTable(data) {
  const container = document.getElementById('dashboardContainer');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="alert alert-light text-center m-4">📋 本季度暫無排班資料。</div>';
    return;
  }
  const fixedHeaders = ['日期', '聚會名稱', '聚會類別', '牧師', '題目', '經文'];
  const allKeys = Object.keys(data[0]);
  const dynamicHeaders = allKeys.filter(k => !fixedHeaders.includes(k) && !['hasWarning', 'warningMessage', '年度', '季度'].includes(k));
  const finalHeaders = [...fixedHeaders, ...dynamicHeaders];

  let html = `<table class="modern-table"><thead><tr>`;
  finalHeaders.forEach(h => html += `<th>${h}</th>`);
  html += `</tr></thead><tbody>`;
  data.forEach(row => {
    html += `<tr class="${row.hasWarning ? 'warning-row' : ''}">`;
    finalHeaders.forEach(h => {
      let val = row[h] || '';
      if (h === '日期') {
        html += `<td><strong>${val}</strong>${row.hasWarning ? `<span class="warning-text">⚠️ ${row.warningMessage}</span>` : ''}</td>`;
      } else {
        let style = (val === '【待定】') ? 'text-danger fw-bold' : '';
        html += `<td class="${style}">${val || '-'}</td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ==========================================
// 2. 位置與人員設定
// ==========================================
async function loadPositions() {
  const tbody = document.getElementById('positionsTbody');
  if (!tbody) return;
  const result = await callAPI('getPositions', {});
  tbody.innerHTML = ''; 
  if (result.status === 'success') {
    result.data.length === 0 ? addPositionRow('主領', '', '是') : result.data.forEach(i => addPositionRow(i.positionName, i.personnel, i.isRequired || '是'));
    if (sortablePositions) sortablePositions.destroy();
    sortablePositions = new Sortable(tbody, { 
        handle: '.drag-handle', 
        animation: 150,
        filter: 'input, select, button',
        preventOnFilter: false 
    });
  }
}

function addPositionRow(posName, personnel, isRequired = "是") {
  const tbody = document.getElementById('positionsTbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="text-center align-middle drag-handle" style="cursor: grab; color: #adb5bd;">☰</td>
    <td><input type="text" class="form-control form-control-sm pos-name text-center" value="${posName}" onclick="this.select()"></td>
    <td><input type="text" class="form-control form-control-sm pos-personnel" value="${personnel}" onclick="this.select()"></td>
    <td><select class="form-select form-select-sm pos-required"><option value="是" ${isRequired === "是" ? "selected" : ""}>必排</option><option value="否" ${isRequired === "否" ? "selected" : ""}>非必排</option></select></td>
    <td class="text-center"><button class="btn btn-outline-danger btn-sm" onclick="this.closest('tr').remove()">x</button></td>
  `;
  tbody.appendChild(tr);
}

async function savePositionsToServer() {
  const rows = document.querySelectorAll('#positionsTbody tr');
  let positionsData = [];
  rows.forEach(tr => {
    const name = tr.querySelector('.pos-name').value.trim();
    if (name) positionsData.push({ positionName: name, personnel: tr.querySelector('.pos-personnel').value.trim(), isRequired: tr.querySelector('.pos-required').value });
  });
  const btn = document.querySelector('button[onclick="savePositionsToServer()"]');
  btn.disabled = true;
  await callAPI('savePositions', { positionsData });
  alert("✅ 位置設定儲存成功！");
  btn.disabled = false;
}

// ==========================================
// 3. 服事安排 (Modal + 滿版)
// ==========================================
function openNewScheduleModal() {
  bootstrap.Modal.getOrCreateInstance(document.getElementById('newScheduleModal')).show();
  setTimeout(() => { if (fpInstance) fpInstance.redraw(); }, 200);
}

async function initScheduleTab() {
  if (!fpInstance) fpInstance = flatpickr("#multiDatePicker", { mode: "multiple", dateFormat: "Y-m-d", locale: "zh" });
  const result = await callAPI('getPositions', {});
  if (result.status === 'success') {
    currentPositions = result.data;
    let nameSet = new Set();
    currentPositions.forEach(pos => (pos.personnel || '').split(',').forEach(n => n.trim() && nameSet.add(n.trim())));
    uniquePersonnel = Array.from(nameSet).sort();
  }
  if (!generatedScheduleData.length) {
    document.getElementById('previewContainer').style.display = 'none';
    document.getElementById('previewPlaceholder').style.display = 'block';
  }
}

function generateSchedule() {
  const rows = document.querySelectorAll('#dateSettingsContainer .card');
  let inputConditions = [];
  rows.forEach(row => {
    const date = row.querySelector('.s-date').value; 
    if (date) inputConditions.push({ date, type: row.querySelector('.s-type').value.trim(), leaves: row.querySelector('.s-leave').value.split(',').filter(x => x) });
  });
  if (!inputConditions.length) return alert("請先選擇日期");
  inputConditions.sort((a, b) => a.date.localeCompare(b.date));

  let leaderPool = [], previousLeader = null, consecutive = {};
  currentPositions.forEach(p => consecutive[p.positionName] = {});
  generatedScheduleData = [];

  inputConditions.forEach(day => {
    let daily = { '年度': day.date.substring(0,4), '季度': getQuarter(day.date), '日期': day.date, '聚會名稱': '', '聚會類別': day.type }, assigned = [];
    currentPositions.forEach(pos => {
      let name = pos.positionName;
      let candidates = (pos.personnel || '').split(',').map(s => s.trim()).filter(x => x);
      let pick = "";
      if (name === '主領') {
        if (!leaderPool.length) leaderPool = [...candidates];
        let valid = leaderPool.filter(p => !day.leaves.includes(p) && p !== previousLeader);
        if (valid.length) { pick = valid[Math.floor(Math.random()*valid.length)]; leaderPool = leaderPool.filter(p => p !== pick); }
      } else {
        let valid = candidates.filter(p => !day.leaves.includes(p) && !assigned.includes(p) && (consecutive[name][p]||0) < 2);
        if (valid.length) pick = valid[Math.floor(Math.random()*valid.length)];
      }
      pick = pick || (pos.isRequired === '是' ? "【待定】" : "");
      daily[name] = pick;
      if (pick && pick !== "【待定】") assigned.push(pick);
      candidates.forEach(c => consecutive[name][c] = (c === pick ? (consecutive[name][c]||0)+1 : 0));
    });
    previousLeader = daily['主領'];
    generatedScheduleData.push(daily);
  });
  
  renderPreviewTable(generatedScheduleData);
  
  const modalEl = document.getElementById('newScheduleModal');
  if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
}

async function loadScheduleByQuarter() {
  const select = document.getElementById('editQuarterSelect');
  const [year, quarter] = select.value.split('-');
  const placeholder = document.getElementById('previewPlaceholder');
  placeholder.innerHTML = `<div class="p-4 text-center text-success"><div class="spinner-border spinner-border-sm"></div> 讀取 ${year} ${quarter} 資料中...</div>`;
  try {
    const result = await callAPI('getSchedule', { year, quarter });
    if (result.status === 'success' && result.data.length > 0) {
      generatedScheduleData = result.data;
      renderPreviewTable(generatedScheduleData);
    } else {
      placeholder.innerHTML = `<div class="alert alert-warning m-4">查無 ${year} ${quarter} 存檔紀錄。</div>`;
    }
  } catch (error) { alert("讀取失敗"); }
}

async function loadScheduleByDateRange() {
  const start = document.getElementById('queryStartDate').value;
  const end = document.getElementById('queryEndDate').value;
  if (!start || !end) return alert("請先設定起訖日期");
  const placeholder = document.getElementById('previewPlaceholder');
  placeholder.innerHTML = '<div class="p-4 text-center text-primary"><div class="spinner-border spinner-border-sm"></div> 區間資料讀取中...</div>';
  try {
    const result = await callAPI('getScheduleByDateRange', { startDate: start, endDate: end });
    if (result.status === 'success' && result.data && result.data.length > 0) {
      generatedScheduleData = result.data;
      renderPreviewTable(generatedScheduleData);
    } else {
      placeholder.innerHTML = `<div class="alert alert-info m-4">${start} 至 ${end} 無存檔資料。</div>`;
      document.getElementById('previewContainer').style.display = 'none';
      document.getElementById('saveScheduleBtn').style.display = 'none';
    }
  } catch (error) { alert("區間讀取失敗"); }
}

function renderPreviewTable(data) {
  const thead = document.getElementById('previewThead'), tbody = document.getElementById('previewTbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  if (!data.length) return;

  let headers = ['日期', '聚會名稱', '聚會類別', ...currentPositions.map(p => p.positionName)];
  let trH = document.createElement('tr');
  headers.forEach(h => { let th = document.createElement('th'); th.innerText = h; trH.appendChild(th); });
  thead.appendChild(trH);

  data.forEach((row, idx) => {
    let tr = document.createElement('tr');
    headers.forEach(h => {
      let td = document.createElement('td');
      if (h === '日期') {
        td.innerHTML = `<span class="badge bg-secondary">${row[h]}</span>`;
      } 
      else if (h === '聚會名稱' || h === '聚會類別') {
        let input = document.createElement('input'); 
        input.className = `form-control form-control-sm text-center border-0 bg-transparent fw-bold ${h === '聚會名稱' ? 'text-success' : 'text-primary'}`;
        input.value = row[h] || ''; 
        input.onclick = function() { this.select(); };
        input.onchange = (e) => generatedScheduleData[idx][h] = e.target.value.trim();
        td.appendChild(input);
      } else {
        let pos = currentPositions.find(p => p.positionName === h);
        let cands = (pos?.personnel || '').split(',').map(s=>s.trim()).filter(x=>x);
        let sel = document.createElement('select'); sel.className = 'form-select form-select-sm text-center border-0 bg-transparent';
        if (row[h] === '【待定】') sel.classList.add('select-danger');
        sel.innerHTML = `<option value="${pos?.isRequired==='是'?'【待定】':''}">${pos?.isRequired==='是'?'【待定】':'無'}</option>` + cands.map(c => `<option value="${c}" ${row[h]===c?'selected':''}>${c}</option>`).join('');
        sel.onchange = function() {
          generatedScheduleData[idx][h] = this.value;
          this.value === '【待定】' ? this.classList.add('select-danger') : this.classList.remove('select-danger');
        };
        td.appendChild(sel);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  document.getElementById('previewPlaceholder').style.display = 'none';
  document.getElementById('previewContainer').style.display = 'block';
  document.getElementById('saveScheduleBtn').style.display = 'inline-block';
}

async function saveGeneratedSchedule() {
  const btn = document.getElementById('saveScheduleBtn'); 
  btn.disabled = true; btn.innerText = "儲存中...";
  const result = await callAPI('saveSchedule', { scheduleData: generatedScheduleData });
  if (result.status === 'success') { alert("🎉 排班表已成功存檔！"); loadDashboard(); switchTab('dashboard'); }
  btn.disabled = false; btn.innerText = "儲存並發佈至雲端";
}

function addSelectedDates() {
  if (!fpInstance?.selectedDates.length) { alert("請先點選日期"); return; }
  fpInstance.selectedDates.sort((a, b) => a - b).forEach(dateObj => {
    const dStr = formatDateSafe(dateObj);
    const div = document.createElement('div');
    div.className = 'card mb-2 p-2 border-primary border-opacity-25 shadow-sm';
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <input type="date" class="form-control form-control-sm s-date w-50 me-1" value="${dStr}">
        <input type="text" class="form-control form-control-sm s-type w-50 text-primary fw-bold text-center" value="主日" onclick="this.select()">
        <button class="btn btn-sm btn-outline-danger ms-1" onclick="this.closest('.card').remove()">x</button>
      </div>
      <button class="btn btn-outline-secondary btn-sm w-100" onclick="openLeaveModal(this)">🔍 設定請假人員</button>
      <input type="hidden" class="s-leave" value="">
      <div class="leave-badges mt-2"></div>
    `;
    document.getElementById('dateSettingsContainer').appendChild(div);
  });
  fpInstance.clear();
}

function openLeaveModal(btn) {
  currentLeaveCard = btn.closest('.card');
  const currentLeaves = currentLeaveCard.querySelector('.s-leave').value.split(',').filter(x => x);
  let html = '<div class="row g-2">';
  uniquePersonnel.forEach(name => {
    const isChecked = currentLeaves.includes(name) ? 'checked' : '';
    html += `<div class="col-6 col-sm-4"><div class="form-check"><input class="form-check-input leave-checkbox" type="checkbox" value="${name}" id="chk_${name}" ${isChecked}><label class="form-check-label" for="chk_${name}">${name}</label></div></div>`;
  });
  document.getElementById('leaveModalBody').innerHTML = html + '</div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('leaveModal')).show();
}

function confirmLeaveSelection() {
  const selected = Array.from(document.querySelectorAll('.leave-checkbox:checked')).map(cb => cb.value);
  currentLeaveCard.querySelector('.s-leave').value = selected.join(',');
  currentLeaveCard.querySelector('.leave-badges').innerHTML = selected.map(n => `<span class="badge bg-secondary me-1 mb-1" style="font-size:0.7rem;">${n}</span>`).join('');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('leaveModal')).hide();
}

function getQuarter(dateString) { 
  const d = parseDateSafe(dateString);
  return `Q${Math.floor((d.getMonth() + 3) / 3)}`; 
}

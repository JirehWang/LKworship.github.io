/* script.js */
const API_URL = 'https://script.google.com/macros/s/AKfycbyk_6tUucVg-U4rRQjYHvk632teZyxufDkNX_X1WRUXPMGgsTaemVXD_mv9kBDjuSwOnA/exec';

// --- 全域變數 ---
let currentPositions = []; 
let generatedScheduleData = []; 
let fpInstance = null; 
let uniquePersonnel = []; 
let currentLeaveCard = null; 
let sortablePositions = null; 
let currentAbortController = null;

// --- 初始化 ---
window.onload = () => {
  const syncTimeEl = document.getElementById('syncTime');
  if (syncTimeEl) syncTimeEl.innerText = new Date().toLocaleTimeString();
  loadDashboard();
};

// --- 通用 API 呼叫 ---
async function callAPI(action, payload) {
  const response = await fetch(API_URL, { 
    method: 'POST', 
    body: JSON.stringify({ action: action, ...payload }) 
  });
  return await response.json();
}

// --- 頁籤切換邏輯 ---
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
  if(tabId === 'sermon') loadSermonData();
}

// ==========================================
// 1. 公佈欄邏輯 (支援中斷請求)
// ==========================================
async function loadDashboard() {
  const container = document.getElementById('dashboardContainer');
  const quarterSelect = document.getElementById('quarterSelect');
  if (!container || !quarterSelect) return;

  const [year, quarter] = quarterSelect.value.split('-');
  container.innerHTML = `<div class="text-center p-5 text-primary"><div class="spinner-border"></div><div class="mt-2">同步 ${year}-${quarter} 資料中...</div></div>`;

  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();

  try {
    const result = await callAPI('getSchedule', { year, quarter });
    if (result.status === 'success') {
      const syncTimeEl = document.getElementById('syncTime');
      if (syncTimeEl) syncTimeEl.innerText = new Date().toLocaleTimeString();
      renderDashboardTable(result.data);
    }
  } catch (error) {
    if (error.name !== 'AbortError') container.innerHTML = `<div class="alert alert-danger">連線錯誤</div>`;
  }
}

function renderDashboardTable(data) {
  const container = document.getElementById('dashboardContainer');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="alert alert-warning text-center m-4">本季度暫無資料。</div>';
    return;
  }
  const fixedHeaders = ['日期', '聚會類別', '牧師', '題目', '經文'];
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
// 2. 位置設定邏輯
// ==========================================
async function loadPositions() {
  const tbody = document.getElementById('positionsTbody');
  if (!tbody) return;
  const result = await callAPI('getPositions', {});
  tbody.innerHTML = ''; 
  if (result.status === 'success') {
    result.data.length === 0 ? addPositionRow('主領', '', '是') : result.data.forEach(i => addPositionRow(i.positionName, i.personnel, i.isRequired || '是'));
    if (sortablePositions) sortablePositions.destroy();
    sortablePositions = new Sortable(tbody, { handle: '.drag-handle', animation: 150 });
  }
}

function addPositionRow(posName, personnel, isRequired = "是") {
  const tbody = document.getElementById('positionsTbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="text-center align-middle drag-handle" style="cursor: grab; color: #adb5bd;">☰</td>
    <td><input type="text" class="form-control form-control-sm pos-name text-center" value="${posName}"></td>
    <td><input type="text" class="form-control form-control-sm pos-personnel" value="${personnel}"></td>
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
  alert("✅ 儲存成功！");
  btn.disabled = false;
}

// ==========================================
// 3. 服事安排 (排班演算法)
// ==========================================
async function initScheduleTab() {
  if (!fpInstance) fpInstance = flatpickr("#multiDatePicker", { mode: "multiple", dateFormat: "Y-m-d", locale: "zh" });
  const result = await callAPI('getPositions', {});
  if (result.status === 'success') {
    currentPositions = result.data;
    let nameSet = new Set();
    currentPositions.forEach(pos => pos.personnel?.split(',').forEach(n => n.trim() && nameSet.add(n.trim())));
    uniquePersonnel = Array.from(nameSet).sort();
  }
}

function addSelectedDates() {
  if (!fpInstance?.selectedDates.length) { alert("請先點選日期"); return; }
  fpInstance.selectedDates.sort((a, b) => a - b).forEach(dateObj => {
    const dateString = flatpickr.formatDate(dateObj, "Y-m-d");
    const div = document.createElement('div');
    div.className = 'card mb-2 p-2 border-primary border-opacity-25 shadow-sm';
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <input type="date" class="form-control form-control-sm s-date w-50 me-1" value="${dateString}">
        <input type="text" class="form-control form-control-sm s-type w-50 text-primary fw-bold text-center" value="主日">
        <button class="btn btn-sm btn-outline-danger ms-1" onclick="this.closest('.card').remove()">x</button>
      </div>
      <button class="btn btn-outline-secondary btn-sm w-100" onclick="openLeaveModal(this)">🔍 點選請假人員...</button>
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
  currentLeaveCard.querySelector('.leave-badges').innerHTML = selected.map(n => `<span class="badge bg-secondary me-1 mb-1">${n}</span>`).join('');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('leaveModal')).hide();
}

function generateSchedule() {
  const rows = document.querySelectorAll('#dateSettingsContainer .card');
  let inputConditions = [];
  rows.forEach(row => {
    const date = row.querySelector('.s-date').value;
    if (date) inputConditions.push({ date, type: row.querySelector('.s-type').value.trim(), leaves: row.querySelector('.s-leave').value.split(',').filter(x => x) });
  });
  if (!inputConditions.length) return alert("請設定日期");
  inputConditions.sort((a, b) => a.date.localeCompare(b.date));

  let leaderPool = [], previousLeader = null, consecutive = {};
  currentPositions.forEach(p => consecutive[p.positionName] = {});
  generatedScheduleData = [];

  inputConditions.forEach(day => {
    let daily = { '年度': day.date.substring(0,4), '季度': getQuarter(day.date), '日期': day.date, '聚會類別': day.type }, assigned = [];
    currentPositions.forEach(pos => {
      let name = pos.positionName, candidates = pos.personnel.split(',').map(s => s.trim()).filter(x => x), pick = "";
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
}

function renderPreviewTable(data) {
  const thead = document.getElementById('previewThead'), tbody = document.getElementById('previewTbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  let headers = ['日期', '聚會類別', ...currentPositions.map(p => p.positionName)];
  let trH = document.createElement('tr');
  headers.forEach(h => { let th = document.createElement('th'); th.innerText = h; trH.appendChild(th); });
  thead.appendChild(trH);

  data.forEach((row, idx) => {
    let tr = document.createElement('tr');
    headers.forEach(h => {
      let td = document.createElement('td');
      if (h === '日期') td.innerHTML = `<span class="badge bg-secondary">${row[h]}</span>`;
      else if (h === '聚會類別') {
        let input = document.createElement('input'); input.className = 'form-control form-control-sm text-center border-0 bg-transparent fw-bold text-primary';
        input.value = row[h]; input.onchange = (e) => generatedScheduleData[idx][h] = e.target.value.trim();
        td.appendChild(input);
      } else {
        let pos = currentPositions.find(p => p.positionName === h), cands = pos?.personnel.split(',').map(s=>s.trim()).filter(x=>x) || [];
        let sel = document.createElement('select'); sel.className = 'form-select form-select-sm text-center border-0 bg-transparent';
        if (row[h] === '【待定】') sel.classList.add('select-danger');
        sel.innerHTML = `<option value="${pos?.isRequired==='是'?'【待定】':''}">${pos?.isRequired==='是'?'【待定】':'無'}</option>` + cands.map(c => `<option value="${c}" ${row[h]===c?'selected':''}>${c}</option>`).join('');
        sel.onchange = function() {
          let val = this.value;
          if (val && val !== '【待定】') {
            let dups = currentPositions.filter(p => p.positionName !== h && generatedScheduleData[idx][p.positionName] === val);
            if (dups.length && !confirm(`⚠️ ${val} 已安排為 ${dups.map(p=>p.positionName)}，確定重複？`)) return this.value = row[h];
          }
          generatedScheduleData[idx][h] = val;
          val === '【待定】' ? this.classList.add('select-danger') : this.classList.remove('select-danger');
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
  const btn = document.getElementById('saveScheduleBtn'); btn.disabled = true;
  const result = await callAPI('saveSchedule', { scheduleData: generatedScheduleData });
  if (result.status === 'success') { alert("🎉 排班表發佈成功！"); switchTab('dashboard'); }
  btn.disabled = false;
}

// ==========================================
// 4. 牧師登錄 (保留 Excel 貼上 + AI 智慧功能)
// ==========================================

/**
 * 🌟 核心：處理 Excel 直接貼上
 */
function handleSermonPaste(e) {
  let pasteData = (e.clipboardData || window.clipboardData).getData('text');
  
  // 如果內容含有 Tab 鍵，表示是從 Excel 或 Google Sheets 複製來的
  if (pasteData.includes('\t')) {
    e.preventDefault(); // 攔截預設的貼上動作
    pasteData.split(/\r?\n/).forEach(rowStr => {
      let cols = rowStr.split('\t'); 
      if (!cols[0] || cols[0].includes('日期')) return; // 跳過標題行或空行
      
      let d = cols[0].trim().replace(/\//g, '-');
      // 支援 4 欄或 5 欄的 Excel 格式
      if (cols.length >= 5) {
        addSermonRow(d, cols[1]?.trim(), cols[2]?.trim(), cols[3]?.trim(), cols[4]?.trim());
      } else {
        addSermonRow(d, '主日', cols[1]?.trim(), cols[2]?.trim(), cols[3]?.trim());
      }
    });
    e.target.value = ""; // 清空框框
  }
  // 如果沒有 Tab 鍵（例如一般的 Line 訊息），就會順利貼進框框讓 AI 處理
}

/**
 * 🌟 核心：AI 智慧解析
 */
async function aiParseSermon() {
  const textArea = document.getElementById('sermonPasteArea'), text = textArea.value.trim(), btn = document.getElementById('aiBtn');
  if (!text) return alert("請貼入文字");
  btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> 解析中...`;

  try {
    const result = await callAPI('parseSermonWithAI', { text });
    if (result.status === 'success') {
      result.data.forEach(item => {
        let rows = document.querySelectorAll('#sermonTbody tr'), found = false;
        for (let tr of rows) {
          const d = tr.querySelector('.sermon-date').value, t = tr.querySelector('.sermon-type').value.trim();
          if (d === item.日期 && t === item.聚會類別) {
            tr.querySelector('.sermon-pastor').value = item.牧師 || "";
            tr.querySelector('.sermon-title').value = item.題目 || "";
            tr.querySelector('.sermon-scripture').value = item.經文 || "";
            tr.classList.add('table-success-flash'); setTimeout(() => tr.classList.remove('table-success-flash'), 1500);
            found = true; break;
          }
        }
        if (!found) addSermonRow(item.日期, item.聚會類別, item.牧師, item.題目, item.經文);
      });
      textArea.value = "";
    }
  } catch (e) { alert("AI 解析失敗"); }
  btn.disabled = false; btn.innerHTML = "✨ AI 智慧解析";
}

async function loadSermonData() {
  const tbody = document.getElementById('sermonTbody');
  const result = await callAPI('getSermonInfo', {});
  tbody.innerHTML = '';
  result.status === 'success' && result.data.length ? result.data.forEach(r => addSermonRow(r.日期, r.聚會類別, r.牧師, r.題目, r.經文)) : addSermonRow('', '主日', '', '', '');
}

function addSermonRow(date, type, pastor, title, scripture) {
  const tbody = document.getElementById('sermonTbody'), tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="date" class="form-control form-control-sm sermon-date" value="${date}"></td>
    <td><input type="text" class="form-control form-control-sm sermon-type text-center" value="${type || '主日'}"></td>
    <td><input type="text" class="form-control form-control-sm sermon-pastor text-center" value="${pastor}"></td>
    <td><input type="text" class="form-control form-control-sm sermon-title" value="${title}"></td>
    <td><input type="text" class="form-control form-control-sm sermon-scripture" value="${scripture}"></td>
    <td class="text-center"><button class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()">x</button></td>
  `;
  tbody.appendChild(tr);
}

async function saveSermonData() {
  let data = [];
  document.querySelectorAll('#sermonTbody tr').forEach(tr => {
    let d = tr.querySelector('.sermon-date').value;
    if (d) data.push({ '日期': d, '聚會類別': tr.querySelector('.sermon-type').value.trim(), '牧師': tr.querySelector('.sermon-pastor').value.trim(), '題目': tr.querySelector('.sermon-title').value.trim(), '經文': tr.querySelector('.sermon-scripture').value.trim() });
  });
  const btn = document.querySelector('button[onclick="saveSermonData()"]');
  btn.disabled = true;
  await callAPI('saveSermonInfo', { sermonData: data });
  alert("✅ 講員資訊已儲存！"); btn.disabled = false; switchTab('dashboard');
}

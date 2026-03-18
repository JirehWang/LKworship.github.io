/* script.js */
const API_URL = 'https://script.google.com/macros/s/AKfycbyk_6tUucVg-U4rRQjYHvk632teZyxufDkNX_X1WRUXPMGgsTaemVXD_mv9kBDjuSwOnA/exec';

// --- 全域變數 ---
let currentPositions = []; 
let generatedScheduleData = []; 
let fpInstance = null; 
let uniquePersonnel = []; 
let currentLeaveCard = null; 
let sortablePositions = null; 
let currentAbortController = null; // 🌟 新增：用於控制 fetch 中斷

// --- 初始化 ---
window.onload = () => {
  const syncTimeEl = document.getElementById('syncTime');
  if (syncTimeEl) {
    syncTimeEl.innerText = new Date().toLocaleTimeString();
  }
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
// 1. 公佈欄邏輯 (支援中斷與多頁面)
// ==========================================
async function loadDashboard() {
  const container = document.getElementById('dashboardContainer');
  const quarterSelect = document.getElementById('quarterSelect');
  if (!container || !quarterSelect) return;

  const [year, quarter] = quarterSelect.value.split('-');
  
  // 顯示載入動畫並清空舊資料
  container.innerHTML = `
    <div class="text-center p-5 text-primary">
      <div class="spinner-border"></div>
      <div class="mt-2">正在載入 ${year}-${quarter} 最新班表...</div>
    </div>
  `;

  // 🌟 處理連鎖請求：中斷上一個尚未完成的請求
  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getSchedule', year: year, quarter: quarter }),
      signal: signal
    });
    
    const result = await response.json();
    if (result.status === 'success') {
      const syncTimeEl = document.getElementById('syncTime');
      if (syncTimeEl) syncTimeEl.innerText = new Date().toLocaleTimeString();
      renderDashboardTable(result.data);
    } else {
      container.innerHTML = `<div class="alert alert-danger m-3">載入失敗：${result.message}</div>`;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('已捨棄舊的季度請求');
    } else {
      container.innerHTML = `<div class="alert alert-danger m-3">網路連線錯誤！</div>`;
    }
  }
}

function renderDashboardTable(data) {
  const container = document.getElementById('dashboardContainer');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="alert alert-warning text-center m-4">該季度目前沒有排班資料。</div>';
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
        let extraClass = (val === '【待定】') ? 'text-danger fw-bold' : '';
        html += `<td class="${extraClass}">${val || '<span class="text-black-50">-</span>'}</td>`;
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
    if(result.data.length === 0) addPositionRow('主領', '', '是');
    else result.data.forEach(item => addPositionRow(item.positionName, item.personnel, item.isRequired || '是'));
    if (sortablePositions) sortablePositions.destroy();
    sortablePositions = new Sortable(tbody, { handle: '.drag-handle', animation: 150, ghostClass: 'bg-light' });
  }
}

function addPositionRow(posName, personnel, isRequired = "是") {
  const tbody = document.getElementById('positionsTbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="text-center align-middle drag-handle" style="cursor: grab; font-size: 1.2em; color: #adb5bd;">☰</td>
    <td><input type="text" class="form-control form-control-sm pos-name text-center" value="${posName}"></td>
    <td><input type="text" class="form-control form-control-sm pos-personnel" value="${personnel}" placeholder="如：張三,李四"></td>
    <td><select class="form-select form-select-sm pos-required text-center"><option value="是" ${isRequired === "是" ? "selected" : ""}>必排</option><option value="否" ${isRequired === "否" ? "selected" : ""}>非必排</option></select></td>
    <td class="text-center align-middle"><button class="btn btn-outline-danger btn-sm" onclick="this.closest('tr').remove()">刪除</button></td>
  `;
  tbody.appendChild(tr);
}

async function savePositionsToServer() {
  const rows = document.querySelectorAll('#positionsTbody tr');
  let positionsData = [];
  rows.forEach(tr => {
    const nameInput = tr.querySelector('.pos-name').value.trim();
    const personnelInput = tr.querySelector('.pos-personnel').value.trim();
    const reqInput = tr.querySelector('.pos-required').value;
    if (nameInput !== '') positionsData.push({ positionName: nameInput, personnel: personnelInput, isRequired: reqInput });
  });

  const btn = document.querySelector('button[onclick="savePositionsToServer()"]');
  if (btn) { btn.disabled = true; btn.innerText = "儲存中..."; }
  
  await callAPI('savePositions', { positionsData });
  alert("✅ 設定已成功儲存！");
  
  if (btn) { btn.disabled = false; btn.innerText = "儲存設定"; }
}

// ==========================================
// 3. 服事安排邏輯 (含彈窗請假)
// ==========================================
async function initScheduleTab() {
  if (!fpInstance) fpInstance = flatpickr("#multiDatePicker", { mode: "multiple", dateFormat: "Y-m-d", locale: "zh" });
  const result = await callAPI('getPositions', {});
  if (result.status === 'success') {
    currentPositions = result.data;
    let nameSet = new Set();
    currentPositions.forEach(pos => {
      if (pos.personnel) pos.personnel.split(',').forEach(name => {
        let cleanName = name.trim();
        if (cleanName !== '') nameSet.add(cleanName);
      });
    });
    uniquePersonnel = Array.from(nameSet).sort();
  }
}

function addSelectedDates() {
  if (!fpInstance || fpInstance.selectedDates.length === 0) { alert("請先點選日期"); return; }
  const selectedDates = fpInstance.selectedDates.sort((a, b) => a - b);
  selectedDates.forEach(dateObj => {
    const dateString = flatpickr.formatDate(dateObj, "Y-m-d");
    const div = document.createElement('div');
    div.className = 'card mb-2 p-2 border-primary border-opacity-25 shadow-sm';
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <input type="date" class="form-control form-control-sm s-date w-50 me-1" value="${dateString}" required>
        <input type="text" class="form-control form-control-sm s-type w-50 text-primary fw-bold text-center" value="主日" placeholder="聚會類別">
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

function openLeaveModal(btnElement) {
  currentLeaveCard = btnElement.closest('.card');
  const dateVal = currentLeaveCard.querySelector('.s-date').value;
  document.getElementById('leaveModalDate').innerText = `(${dateVal})`;
  const currentLeaves = currentLeaveCard.querySelector('.s-leave').value.split(',').filter(x => x);
  let html = '<div class="row g-2">';
  uniquePersonnel.forEach(name => {
    const isChecked = currentLeaves.includes(name) ? 'checked' : '';
    html += `<div class="col-6 col-sm-4"><div class="form-check"><input class="form-check-input leave-checkbox" type="checkbox" value="${name}" id="chk_${name}" ${isChecked}><label class="form-check-label" for="chk_${name}">${name}</label></div></div>`;
  });
  html += '</div>';
  document.getElementById('leaveModalBody').innerHTML = html;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('leaveModal')).show();
}

function confirmLeaveSelection() {
  if (!currentLeaveCard) return;
  const checkedBoxes = document.querySelectorAll('.leave-checkbox:checked');
  const selectedNames = Array.from(checkedBoxes).map(cb => cb.value);
  currentLeaveCard.querySelector('.s-leave').value = selectedNames.join(',');
  const badgeContainer = currentLeaveCard.querySelector('.leave-badges');
  badgeContainer.innerHTML = selectedNames.map(name => `<span class="badge bg-secondary me-1 mb-1 shadow-sm">${name}</span>`).join('');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('leaveModal')).hide();
}

function getQuarter(dateString) { return `Q${Math.floor((new Date(dateString).getMonth() + 3) / 3)}`; }

function generateSchedule() {
  if (currentPositions.length === 0) { alert("請先至設定頁建立位置資料！"); return; }
  const rows = document.querySelectorAll('#dateSettingsContainer .card');
  let inputConditions = [];
  rows.forEach(row => {
    const dateVal = row.querySelector('.s-date').value;
    if (dateVal) inputConditions.push({ date: dateVal, type: row.querySelector('.s-type').value.trim(), leaves: row.querySelector('.s-leave').value.split(',').map(s=>s.trim()).filter(s=>s) });
  });
  if (inputConditions.length === 0) { alert("請設定至少一天日期！"); return; }
  inputConditions.sort((a, b) => a.date.localeCompare(b.date));

  let leaderObj = currentPositions.find(p => p.positionName === '主領');
  let leaderMasterList = leaderObj ? leaderObj.personnel.split(',').map(s=>s.trim()).filter(s=>s) : [];
  let leaderPool = []; 
  let consecutiveCount = {}; 
  currentPositions.forEach(p => { consecutiveCount[p.positionName] = {}; });
  let previousLeader = null; 
  generatedScheduleData = [];

  inputConditions.forEach(dayInfo => {
    let dailyRecord = { '年度': dayInfo.date.substring(0,4), '季度': getQuarter(dayInfo.date), '日期': dayInfo.date, '聚會類別': dayInfo.type };
    let assignedToday = []; 
    currentPositions.forEach(posObj => {
      let posName = posObj.positionName;
      let candidates = posObj.personnel.split(',').map(s=>s.trim()).filter(s=>s);
      let isReq = posObj.isRequired || '是';
      let selectedPerson = "";
      if (posName === '主領') {
        if (leaderPool.length === 0) leaderPool = [...leaderMasterList];
        let validLeaders = leaderPool.filter(p => !dayInfo.leaves.includes(p) && p !== previousLeader);
        if (validLeaders.length > 0) { selectedPerson = validLeaders[Math.floor(Math.random() * validLeaders.length)]; leaderPool = leaderPool.filter(p => p !== selectedPerson); }
      } else {
        let validCandidates = candidates.filter(p => !dayInfo.leaves.includes(p) && !assignedToday.includes(p) && (consecutiveCount[posName][p]||0)<2);
        if (validCandidates.length > 0) selectedPerson = validCandidates[Math.floor(Math.random() * validCandidates.length)];
      }
      if (selectedPerson === "" && isReq === "是") selectedPerson = "【待定】"; 
      dailyRecord[posName] = selectedPerson;
      if (selectedPerson && selectedPerson !== "【待定】") assignedToday.push(selectedPerson);
      candidates.forEach(person => { if (person === selectedPerson) consecutiveCount[posName][person] = (consecutiveCount[posName][person] || 0) + 1; else consecutiveCount[posName][person] = 0; });
    }); 
    previousLeader = dailyRecord['主領'];
    generatedScheduleData.push(dailyRecord);
  }); 
  renderPreviewTable(generatedScheduleData);
}

async function loadExistingSchedule() {
  const startDate = document.getElementById('editStartDate').value;
  const endDate = document.getElementById('editEndDate').value;
  if (!startDate || !endDate) { alert("請選擇日期區間！"); return; }
  const result = await callAPI('getScheduleByDateRange', { startDate, endDate });
  if (result.status === 'success' && result.data.length > 0) { generatedScheduleData = result.data; renderPreviewTable(generatedScheduleData); } else { alert("查無資料或讀取失敗"); }
}

function renderPreviewTable(data) {
  const container = document.getElementById('previewContainer');
  const thead = document.getElementById('previewThead');
  const tbody = document.getElementById('previewTbody');
  if (!thead || !tbody) return;
  thead.innerHTML = ''; tbody.innerHTML = '';
  let headers = ['日期', '聚會類別', ...currentPositions.map(p => p.positionName)];
  let trHead = document.createElement('tr');
  headers.forEach(h => { let th = document.createElement('th'); th.innerText = h; trHead.appendChild(th); });
  thead.appendChild(trHead);
  data.forEach((row, rowIndex) => {
    let tr = document.createElement('tr');
    headers.forEach(h => {
      let td = document.createElement('td');
      if (h === '日期') td.innerHTML = `<span class="badge bg-secondary fs-6 shadow-sm">${row[h]}</span>`;
      else if (h === '聚會類別') {
        let input = document.createElement('input'); input.className = 'form-control form-control-sm text-center border-0 bg-transparent fw-bold text-primary'; input.value = row[h];
        input.onchange = (e) => { generatedScheduleData[rowIndex][h] = e.target.value.trim(); };
        td.appendChild(input);
      } else {
        let posDef = currentPositions.find(p => p.positionName === h);
        let candidates = posDef ? posDef.personnel.split(',').map(s=>s.trim()).filter(s=>s) : [];
        let select = document.createElement('select'); select.className = 'form-select form-select-sm text-center bg-transparent border-0';
        if(row[h] === '【待定】') select.classList.add('select-danger');
        let optDef = document.createElement('option'); optDef.value = (posDef?.isRequired==='是'?'【待定】':''); optDef.text = (posDef?.isRequired==='是'?'【待定】':'無');
        select.appendChild(optDef);
        candidates.forEach(c => { let opt = document.createElement('option'); opt.value = c; opt.text = c; if(row[h] === c) opt.selected = true; select.appendChild(opt); });
        select.onchange = function() {
          let newValue = this.value;
          if (newValue !== '' && newValue !== '【待定】') {
            let dups = []; 
            currentPositions.forEach(p => { if (p.positionName !== h && generatedScheduleData[rowIndex][p.positionName] === newValue) dups.push(p.positionName); });
            if (dups.length > 0 && !confirm(`⚠️ [${newValue}] 這天已安排為【${dups.join('、')}】。確定要重複安排嗎？`)) { this.value = row[h]; return; }
          }
          generatedScheduleData[rowIndex][h] = newValue;
          if(newValue === '【待定】') this.classList.add('select-danger'); else this.classList.remove('select-danger');
        };
        td.appendChild(select);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  document.getElementById('previewPlaceholder').style.display = 'none';
  container.style.display = 'block'; document.getElementById('saveScheduleBtn').style.display = 'inline-block';
}

async function saveGeneratedSchedule() {
  const btn = document.getElementById('saveScheduleBtn'); 
  if (btn) btn.disabled = true;
  const result = await callAPI('saveSchedule', { scheduleData: generatedScheduleData });
  if (result.status === 'success') { alert("🎉 排班表發佈成功！"); switchTab('dashboard'); }
  if (btn) btn.disabled = false;
}

// ==========================================
// 4. 牧師登錄邏輯
// ==========================================
async function loadSermonData() {
  const tbody = document.getElementById('sermonTbody');
  if (!tbody) return;
  const result = await callAPI('getSermonInfo', {});
  tbody.innerHTML = '';
  if (result.status === 'success' && result.data.length > 0) result.data.forEach(row => addSermonRow(row['日期'], row['牧師'], row['題目'], row['經文']));
  else addSermonRow('', '', '', '');
}

function addSermonRow(date, pastor, title, scripture) {
  const tbody = document.getElementById('sermonTbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="date" class="form-control form-control-sm sermon-date" value="${date}"></td>
    <td><input type="text" class="form-control form-control-sm sermon-pastor text-center" value="${pastor}"></td>
    <td><input type="text" class="form-control form-control-sm sermon-title" value="${title}"></td>
    <td><input type="text" class="form-control form-control-sm sermon-scripture" value="${scripture}"></td>
    <td class="text-center align-middle"><button class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()">x</button></td>
  `;
  tbody.appendChild(tr);
}

function handleSermonPaste(e) {
  e.preventDefault(); 
  let pasteData = (e.clipboardData || window.clipboardData).getData('text');
  pasteData.split(/\r?\n/).forEach(rowStr => {
    let cols = rowStr.split('\t'); if (!cols[0] || cols[0].includes('日期')) return;
    addSermonRow(cols[0].trim().replace(/\//g, '-'), cols[1]?.trim(), cols[2]?.trim(), cols[3]?.trim());
  });
}

async function saveSermonData() {
  let finalSermonData = [];
  document.querySelectorAll('#sermonTbody tr').forEach(tr => {
    let date = tr.querySelector('.sermon-date').value;
    if (date) finalSermonData.push({ '日期': date, '牧師': tr.querySelector('.sermon-pastor').value.trim(), '題目': tr.querySelector('.sermon-title').value.trim(), '經文': tr.querySelector('.sermon-scripture').value.trim() });
  });
  const btn = document.querySelector('button[onclick="saveSermonData()"]');
  if (btn) { btn.disabled = true; btn.innerText = "儲存中..."; }
  await callAPI('saveSermonInfo', { sermonData: finalSermonData });
  alert("✅ 講員資訊儲存成功！"); switchTab('dashboard');
  if (btn) { btn.disabled = false; btn.innerText = "儲存至資料庫"; }
}

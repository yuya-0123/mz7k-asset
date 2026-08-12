// アプリ本体: 画面遷移・状態管理・各画面の描画ロジック。

const PIN_LEN = 6;
const CATEGORY_COLOR_CHOICES = ['#4f9dff', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee', '#facc15'];
function categories() { return STATE.categories; }
function categoryById(id) {
  return STATE.categories.find((c) => c.id === id) || { id: 'unknown', label: 'その他', color: '#a78bfa' };
}

let CURRENT_KEY = null;
let STATE = null;
let recordViewYm = null;
let failedAttempts = 0;
let lockUntilTs = 0;

function pad2(n) { return String(n).padStart(2, '0'); }
function ymOf(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`; }
function ymAdd(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymOf(d);
}
function ymLabelFull(ym) { const [y, m] = ym.split('-').map(Number); return `${y}年${m}月`; }
function ymLabelShort(ym) { const [, m] = ym.split('-').map(Number); return `${m}月`; }
function todayYm() { return ymOf(new Date()); }
function uuid() { return crypto.randomUUID(); }

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2200);
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ---------- 汎用モーダルシート ----------
function openModal(innerHtml) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal-sheet">${innerHtml}</div></div>`;
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function confirmDialog(title, message, confirmLabel = '実行', danger = true) {
  return new Promise((resolve) => {
    openModal(`
      <h3>${title}</h3>
      <p style="color:var(--text-dim);font-size:14px;line-height:1.6;margin-bottom:18px;">${message}</p>
      <button class="btn ${danger ? 'danger' : ''}" id="confirm-yes" style="margin-bottom:10px;">${confirmLabel}</button>
      <button class="btn secondary" id="confirm-no">キャンセル</button>
    `);
    document.getElementById('confirm-yes').addEventListener('click', () => { closeModal(); resolve(true); });
    document.getElementById('confirm-no').addEventListener('click', () => { closeModal(); resolve(false); });
  });
}

// ---------- PINキーパッド ----------
function buildKeypad(container, { onDigit, onDelete, showBiometric = false, onBiometric }) {
  container.innerHTML = '';
  const layout = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'];
  layout.forEach((k) => {
    const btn = document.createElement('button');
    if (k === 'del') {
      btn.textContent = '⌫';
      btn.className = 'ghost';
      btn.addEventListener('click', onDelete);
    } else if (k === 'bio') {
      if (showBiometric) {
        btn.textContent = '🔓';
        btn.className = 'ghost';
        btn.addEventListener('click', onBiometric);
      } else {
        btn.style.visibility = 'hidden';
      }
    } else {
      btn.textContent = k;
      btn.addEventListener('click', () => onDigit(k));
    }
    container.appendChild(btn);
  });
}
function renderPinDots(container, len, errorState = false) {
  container.innerHTML = '';
  for (let i = 0; i < PIN_LEN; i++) {
    const d = document.createElement('div');
    d.className = 'pin-dot' + (i < len ? ' filled' : '') + (errorState ? ' error' : '');
    container.appendChild(d);
  }
}

// ---------- 初回セットアップ ----------
const setup = { stage: 'create', firstPin: '', buffer: '' };

function initSetupScreen() {
  setup.stage = 'create';
  setup.firstPin = '';
  setup.buffer = '';
  document.getElementById('setup-heading').textContent = '資産トラッカーへようこそ';
  document.getElementById('setup-desc').innerHTML = 'NISA・銀行・企業型DC・暗号資産をまとめて記録し、資産の推移をグラフで確認できます。<br>データはこの端末だけに暗号化して保存され、外部には送信されません。<br><br><b style="color:var(--danger)">6桁のPINを作成してください。PINを忘れるとデータは復元できません。</b>';
  document.getElementById('setup-error').textContent = '';
  renderPinDots(document.getElementById('setup-pin-dots'), 0);
  buildKeypad(document.getElementById('setup-keypad'), {
    onDigit: setupOnDigit,
    onDelete: () => { setup.buffer = setup.buffer.slice(0, -1); renderPinDots(document.getElementById('setup-pin-dots'), setup.buffer.length); },
  });
}
async function setupOnDigit(d) {
  if (setup.buffer.length >= PIN_LEN) return;
  setup.buffer += d;
  renderPinDots(document.getElementById('setup-pin-dots'), setup.buffer.length);
  if (setup.buffer.length < PIN_LEN) return;

  if (setup.stage === 'create') {
    setup.firstPin = setup.buffer;
    setup.buffer = '';
    setup.stage = 'confirm';
    document.getElementById('setup-heading').textContent = 'もう一度入力してください';
    document.getElementById('setup-desc').textContent = '確認のため同じPINをもう一度入力してください。';
    setTimeout(() => renderPinDots(document.getElementById('setup-pin-dots'), 0), 120);
  } else {
    if (setup.buffer !== setup.firstPin) {
      renderPinDots(document.getElementById('setup-pin-dots'), PIN_LEN, true);
      document.getElementById('setup-error').textContent = 'PINが一致しません。最初からやり直してください。';
      setTimeout(() => { initSetupScreen(); }, 900);
      return;
    }
    const pin = setup.buffer;
    setup.buffer = '';
    try {
      const result = await Storage.createVault(pin);
      CURRENT_KEY = result.key;
      STATE = result.state;
      await afterUnlockEnterApp(true);
    } catch (e) {
      document.getElementById('setup-error').textContent = '作成に失敗しました: ' + e.message;
    }
  }
}

// ---------- Face ID/Touch ID 有効化オファー ----------
document.getElementById('btn-enable-biometric').addEventListener('click', async () => {
  try {
    await Storage.enableBiometric(CURRENT_KEY);
    showToast('Face ID / Touch IDを有効にしました');
  } catch (e) {
    if (e.message === 'PRF_UNSUPPORTED') {
      showToast('この端末は高速解除に対応していません(PINのみ利用できます)');
    } else {
      showToast('有効化できませんでした');
    }
  }
  enterMainApp();
});
document.getElementById('btn-skip-biometric').addEventListener('click', () => enterMainApp());

async function afterUnlockEnterApp(isFirstRun) {
  if (isFirstRun && (await CryptoModule.platformAuthenticatorAvailable())) {
    showScreen('screen-biometric-offer');
  } else {
    enterMainApp();
  }
}

// ---------- ロック解除 ----------
const unlock = { buffer: '' };
function initUnlockScreen() {
  unlock.buffer = '';
  document.getElementById('unlock-error').textContent = '';
  renderPinDots(document.getElementById('unlock-pin-dots'), 0);
  const bioBtn = document.getElementById('btn-use-biometric');
  const bioEnabled = Storage.isBiometricEnabled();
  bioBtn.classList.toggle('hidden', !bioEnabled);
  buildKeypad(document.getElementById('unlock-keypad'), {
    onDigit: unlockOnDigit,
    onDelete: () => { unlock.buffer = unlock.buffer.slice(0, -1); renderPinDots(document.getElementById('unlock-pin-dots'), unlock.buffer.length); },
    showBiometric: bioEnabled,
    onBiometric: tryBiometricUnlock,
  });
  bioBtn.onclick = tryBiometricUnlock;
  showScreen('screen-unlock');
  if (bioEnabled) tryBiometricUnlock();
}
async function unlockOnDigit(d) {
  if (Date.now() < lockUntilTs) return;
  if (unlock.buffer.length >= PIN_LEN) return;
  unlock.buffer += d;
  renderPinDots(document.getElementById('unlock-pin-dots'), unlock.buffer.length);
  if (unlock.buffer.length < PIN_LEN) return;
  const pin = unlock.buffer;
  unlock.buffer = '';
  try {
    const result = await Storage.unlockWithPin(pin);
    CURRENT_KEY = result.key;
    STATE = result.state;
    failedAttempts = 0;
    enterMainApp();
  } catch (e) {
    failedAttempts++;
    renderPinDots(document.getElementById('unlock-pin-dots'), PIN_LEN, true);
    if (failedAttempts >= 5) {
      const waitSec = Math.min(60, 15 * Math.pow(2, failedAttempts - 5));
      lockUntilTs = Date.now() + waitSec * 1000;
      document.getElementById('unlock-error').textContent = `PINが違います。${waitSec}秒後に再試行してください。`;
      setTimeout(() => { renderPinDots(document.getElementById('unlock-pin-dots'), 0); document.getElementById('unlock-error').textContent = ''; }, waitSec * 1000);
    } else {
      document.getElementById('unlock-error').textContent = 'PINが違います';
      setTimeout(() => renderPinDots(document.getElementById('unlock-pin-dots'), 0), 500);
    }
  }
}
async function tryBiometricUnlock() {
  try {
    const result = await Storage.unlockWithBiometric();
    CURRENT_KEY = result.key;
    STATE = result.state;
    failedAttempts = 0;
    enterMainApp();
  } catch (e) {
    // ユーザーがキャンセルした場合など。PIN入力にフォールバック。
  }
}

function lockApp() {
  CURRENT_KEY = null;
  STATE = null;
  initUnlockScreen();
}
document.getElementById('btn-lock').addEventListener('click', lockApp);
document.getElementById('btn-lock-now').addEventListener('click', lockApp);

// ---------- メインアプリ ----------
function enterMainApp() {
  showScreen('screen-main');
  switchView('home');
}

const VIEW_TITLES = { home: 'ホーム', record: '資産を記録', history: '履歴', accounts: '口座管理', settings: '設定' };
function switchView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('topbar-title').textContent = VIEW_TITLES[view];
  document.querySelector('.content').classList.toggle('no-scroll', view === 'home' || view === 'history');
  if (view === 'home') renderHome();
  if (view === 'record') { recordViewYm = recordViewYm || todayYm(); renderRecordView(); }
  if (view === 'history') renderHistory();
  if (view === 'accounts') renderAccounts();
  if (view === 'settings') renderSettings();
}
document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

async function persist() {
  await Storage.saveState(CURRENT_KEY, STATE);
}

// ---------- 集計ヘルパー ----------
function recordedMonths() {
  const set = new Set(STATE.records.map((r) => r.yearMonth));
  return Array.from(set).sort();
}
function totalForMonth(ym) {
  return STATE.records.filter((r) => r.yearMonth === ym).reduce((s, r) => s + r.balance, 0);
}
function breakdownForMonth(ym) {
  const byCategory = {};
  STATE.records.filter((r) => r.yearMonth === ym).forEach((r) => {
    const acc = STATE.accounts.find((a) => a.id === r.accountId);
    const cat = acc ? acc.category : 'other';
    byCategory[cat] = (byCategory[cat] || 0) + r.balance;
  });
  return categories().map((c) => ({ label: c.label, value: byCategory[c.id] || 0, color: c.color })).filter((x) => x.value !== 0);
}
function latestKnownBalance(accountId, uptoYmExclusiveOrInclusive) {
  const recs = STATE.records.filter((r) => r.accountId === accountId && r.yearMonth <= uptoYmExclusiveOrInclusive).sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1));
  return recs.length ? recs[0].balance : null;
}
function categoryTotalForMonth(catId, ym) {
  const accIds = new Set(STATE.accounts.filter((a) => a.category === catId).map((a) => a.id));
  return STATE.records.filter((r) => r.yearMonth === ym && accIds.has(r.accountId)).reduce((s, r) => s + r.balance, 0);
}

// ---------- ホーム画面 ----------
function renderHome() {
  const months = recordedMonths();
  const latestYm = months[months.length - 1];
  const prevYm = months.length > 1 ? months[months.length - 2] : null;
  const total = latestYm ? totalForMonth(latestYm) : 0;
  document.getElementById('home-total').textContent = Charts.formatYen(total);
  const deltaEl = document.getElementById('home-delta');
  if (latestYm && prevYm) {
    const diff = total - totalForMonth(prevYm);
    const sign = diff > 0 ? '+' : '';
    deltaEl.textContent = `${ymLabelFull(prevYm)}比 ${sign}${Charts.formatYen(diff)}`;
    deltaEl.className = 'total-sub ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
  } else if (latestYm) {
    deltaEl.textContent = `${ymLabelFull(latestYm)}時点`;
    deltaEl.className = 'total-sub';
  } else {
    deltaEl.textContent = 'まだ記録がありません';
    deltaEl.className = 'total-sub';
  }

  // リマインダーバナー
  const banner = document.getElementById('home-banner-slot');
  const day = new Date().getDate();
  const reminderDay = STATE.settings.reminderDay || 25;
  const alreadyThisMonth = months.includes(todayYm());
  if (STATE.accounts.length === 0) {
    banner.innerHTML = `<div class="banner"><div class="emoji">🏦</div><div class="txt"><b>まずは口座を登録</b>「口座」タブからNISA口座や銀行口座などを追加しましょう。</div></div>`;
  } else if (day >= reminderDay && !alreadyThisMonth) {
    banner.innerHTML = `<div class="banner"><div class="emoji">📝</div><div class="txt"><b>今月(${ymLabelFull(todayYm())})の資産を記録しましょう</b>「記録」タブからまとめて入力できます。</div></div>`;
  } else {
    banner.innerHTML = '';
  }

  const points = months.slice(-12).map((ym) => ({ label: ymLabelShort(ym), value: totalForMonth(ym) }));
  Charts.drawLineChart(document.getElementById('home-trend-chart'), points);

  document.getElementById('home-breakdown-month').textContent = latestYm ? ymLabelFull(latestYm) : '-';
  const breakdown = latestYm ? breakdownForMonth(latestYm) : [];
  Charts.drawPieChart(document.getElementById('home-pie-chart'), breakdown);
  const legendEl = document.getElementById('home-pie-legend');
  const breakdownTotal = breakdown.reduce((s, it) => s + it.value, 0) || 1;
  if (breakdown.length === 0) {
    legendEl.innerHTML = '<div class="empty-state" style="padding:8px 0;">データがありません</div>';
  } else {
    legendEl.innerHTML = breakdown.map((it) => {
      const pct = Math.round((it.value / breakdownTotal) * 100);
      return `
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;">
          <span style="width:9px;height:9px;border-radius:50%;background:${it.color};flex-shrink:0;"></span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim);">${escapeHtml(it.label)}</span>
          <span style="font-weight:700;">${pct}%</span>
        </div>`;
    }).join('');
  }
}

// ---------- 記録画面 ----------
function renderRecordView() {
  document.getElementById('record-month-label').textContent = ymLabelFull(recordViewYm);
  const empty = document.getElementById('record-empty');
  const groupsEl = document.getElementById('record-groups');
  const saveBtn = document.getElementById('btn-save-record');
  if (STATE.accounts.length === 0) {
    empty.classList.remove('hidden');
    groupsEl.innerHTML = '';
    saveBtn.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  saveBtn.classList.remove('hidden');

  groupsEl.innerHTML = '';
  categories().forEach((cat) => {
    const accs = STATE.accounts.filter((a) => a.category === cat.id);
    if (accs.length === 0) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h3>${escapeHtml(cat.label)}</h3>`;
    accs.forEach((acc) => {
      const existing = STATE.records.find((r) => r.accountId === acc.id && r.yearMonth === recordViewYm);
      const fallback = latestKnownBalance(acc.id, ymAdd(recordViewYm, -1));
      const prefill = existing ? existing.balance : (fallback !== null ? fallback : '');
      const row = document.createElement('div');
      row.className = 'amount-row';
      row.innerHTML = `
        <div class="label"><span class="name">${escapeHtml(acc.name)}</span></div>
        <input type="number" inputmode="decimal" data-account-id="${acc.id}" placeholder="0" value="${prefill}">
      `;
      card.appendChild(row);
    });
    groupsEl.appendChild(card);
  });
}
document.getElementById('record-prev-month').addEventListener('click', () => { recordViewYm = ymAdd(recordViewYm, -1); renderRecordView(); });
document.getElementById('record-next-month').addEventListener('click', () => { recordViewYm = ymAdd(recordViewYm, 1); renderRecordView(); });
document.getElementById('btn-save-record').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('#record-groups input[data-account-id]');
  let count = 0;
  inputs.forEach((input) => {
    const accountId = input.dataset.accountId;
    const val = input.value === '' ? null : Number(input.value);
    const idx = STATE.records.findIndex((r) => r.accountId === accountId && r.yearMonth === recordViewYm);
    if (val === null) {
      if (idx >= 0) STATE.records.splice(idx, 1);
      return;
    }
    if (idx >= 0) STATE.records[idx].balance = val; else STATE.records.push({ yearMonth: recordViewYm, accountId, balance: val });
    count++;
  });
  await persist();
  showToast(`${ymLabelFull(recordViewYm)}の記録を保存しました`);
  switchView('home');
});

// ---------- 履歴画面 ----------
let historySelectedSeries = 'total';
function usedCategories() {
  return categories().filter((c) => STATE.accounts.some((a) => a.category === c.id));
}
function historySeriesList() {
  return [{ id: 'total', label: '総額', color: '#4f9dff' }, { id: 'all', label: 'すべて', color: '#a1a1aa' }, ...usedCategories()];
}
function renderHistorySeriesPicker() {
  const picker = document.getElementById('history-series-picker');
  const seriesList = historySeriesList();
  if (!seriesList.some((s) => s.id === historySelectedSeries)) historySelectedSeries = 'total';
  picker.innerHTML = seriesList.map((s) => `<button type="button" data-series="${s.id}" class="${s.id === historySelectedSeries ? 'selected' : ''}">${escapeHtml(s.label)}</button>`).join('');
  picker.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { historySelectedSeries = b.dataset.series; renderHistoryChart(); renderHistorySeriesPicker(); });
  });
}
function renderHistoryChart() {
  const months = recordedMonths();
  const seriesList = historySeriesList();
  const series = seriesList.find((s) => s.id === historySelectedSeries) || seriesList[0];
  const deltaEl = document.getElementById('history-series-delta');
  const legendEl = document.getElementById('history-legend');

  if (series.id === 'all') {
    const catSeries = usedCategories().map((c) => ({
      label: c.label,
      color: c.color,
      points: months.map((ym) => ({ label: ymLabelShort(ym), value: categoryTotalForMonth(c.id, ym) })),
    }));
    Charts.drawMultiLineChart(document.getElementById('history-trend-chart'), catSeries);
    deltaEl.textContent = 'カテゴリ別の推移';
    deltaEl.className = 'total-sub';
    legendEl.innerHTML = catSeries.map((s) => `
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);">
        <span style="width:9px;height:9px;border-radius:50%;background:${s.color};flex-shrink:0;"></span>${escapeHtml(s.label)}
      </div>`).join('');
    return;
  }
  legendEl.innerHTML = '';

  const valueForMonth = (ym) => (series.id === 'total' ? totalForMonth(ym) : categoryTotalForMonth(series.id, ym));
  const points = months.map((ym) => ({ label: ymLabelShort(ym), value: valueForMonth(ym) }));
  Charts.drawLineChart(document.getElementById('history-trend-chart'), points, series.color);

  if (points.length >= 2) {
    const diff = points[points.length - 1].value - points[0].value;
    const sign = diff > 0 ? '+' : '';
    deltaEl.textContent = `${ymLabelFull(months[0])} → ${ymLabelFull(months[months.length - 1])}　${sign}${Charts.formatYen(diff)}`;
    deltaEl.className = 'total-sub ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
  } else if (points.length === 1) {
    deltaEl.textContent = `${ymLabelFull(months[0])}時点　${Charts.formatYen(points[0].value)}`;
    deltaEl.className = 'total-sub';
  } else {
    deltaEl.textContent = '';
    deltaEl.className = 'total-sub';
  }
}
function renderHistory() {
  renderHistorySeriesPicker();
  renderHistoryChart();
  const months = recordedMonths();

  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (months.length === 0) {
    list.innerHTML = '<div class="empty-state">まだ記録がありません。「記録」タブから最初の月を記録しましょう。</div>';
    return;
  }
  months.slice().reverse().forEach((ym, i, arr) => {
    const total = totalForMonth(ym);
    const idx = months.indexOf(ym);
    const prevTotal = idx > 0 ? totalForMonth(months[idx - 1]) : null;
    const row = document.createElement('div');
    row.className = 'list-row tappable';
    let deltaHtml = '';
    if (prevTotal !== null) {
      const diff = total - prevTotal;
      const sign = diff > 0 ? '+' : '';
      deltaHtml = `<span class="meta" style="color:${diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-faint)'}">${sign}${Charts.formatYenShort(diff)}</span>`;
    }
    row.innerHTML = `
      <div class="main"><div><div class="name">${ymLabelFull(ym)}</div>${deltaHtml}</div></div>
      <div class="value">${Charts.formatYen(total)}</div>
    `;
    row.addEventListener('click', () => { recordViewYm = ym; switchView('record'); });
    list.appendChild(row);
  });
}

// ---------- 口座管理 ----------
function renderAccounts() {
  const list = document.getElementById('accounts-list');
  list.innerHTML = '';
  if (STATE.accounts.length === 0) {
    list.innerHTML = '<div class="empty-state">口座がまだ登録されていません。<br>上のボタンからNISA口座や銀行口座などを追加してください。</div>';
    return;
  }
  categories().forEach((cat) => {
    const accs = STATE.accounts.filter((a) => a.category === cat.id);
    if (accs.length === 0) return;
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = cat.label;
    list.appendChild(title);
    accs.forEach((acc) => {
      const latest = latestKnownBalance(acc.id, todayYm());
      const row = document.createElement('div');
      row.className = 'list-row tappable';
      row.innerHTML = `
        <div class="main">
          <div class="dot" style="background:${cat.color}"></div>
          <div>
            <div class="name">${escapeHtml(acc.name)}</div>
            ${acc.memo ? `<div class="meta">${escapeHtml(acc.memo)}</div>` : ''}
          </div>
        </div>
        <div class="value small">${latest !== null ? Charts.formatYenShort(latest) : '未記録'}</div>
      `;
      row.addEventListener('click', () => openAccountModal(acc));
      list.appendChild(row);
    });
  });
}
document.getElementById('btn-add-account').addEventListener('click', () => openAccountModal(null));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openAccountModal(existing) {
  const isEdit = !!existing;
  openModal(`
    <h3>${isEdit ? '口座を編集' : '口座を追加'}</h3>
    <div class="field">
      <label>カテゴリ</label>
      <div class="category-picker" id="cat-picker">
        ${categories().map((c) => `<button type="button" data-cat="${c.id}" class="${existing ? (existing.category === c.id ? 'selected' : '') : (c.id === categories()[0].id ? 'selected' : '')}">${escapeHtml(c.label)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>口座名(例: SBI証券 NISA、三菱UFJ銀行)</label>
      <input type="text" id="acc-name" value="${existing ? escapeHtml(existing.name) : ''}" placeholder="口座名を入力">
    </div>
    <div class="field">
      <label>メモ(任意)</label>
      <input type="text" id="acc-memo" value="${existing ? escapeHtml(existing.memo || '') : ''}" placeholder="メモ">
    </div>
    <button class="btn" id="acc-save" style="margin-bottom:10px;">保存</button>
    ${isEdit ? '<button class="btn danger" id="acc-delete" style="margin-bottom:10px;">この口座を削除</button>' : ''}
    <button class="btn secondary" id="acc-cancel">キャンセル</button>
  `);
  let selectedCat = existing ? existing.category : categories()[0].id;
  document.querySelectorAll('#cat-picker button').forEach((b) => {
    b.addEventListener('click', () => {
      selectedCat = b.dataset.cat;
      document.querySelectorAll('#cat-picker button').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
    });
  });
  document.getElementById('acc-cancel').addEventListener('click', closeModal);
  document.getElementById('acc-save').addEventListener('click', async () => {
    const name = document.getElementById('acc-name').value.trim();
    const memo = document.getElementById('acc-memo').value.trim();
    if (!name) { showToast('口座名を入力してください'); return; }
    if (isEdit) {
      existing.name = name; existing.memo = memo; existing.category = selectedCat;
    } else {
      STATE.accounts.push({ id: uuid(), name, memo, category: selectedCat });
    }
    await persist();
    closeModal();
    renderAccounts();
  });
  if (isEdit) {
    document.getElementById('acc-delete').addEventListener('click', async () => {
      const ok = await confirmDialog('口座を削除しますか？', `「${escapeHtml(existing.name)}」に紐づく過去の記録もすべて削除されます。この操作は取り消せません。`, '削除する');
      if (!ok) return;
      STATE.accounts = STATE.accounts.filter((a) => a.id !== existing.id);
      STATE.records = STATE.records.filter((r) => r.accountId !== existing.id);
      await persist();
      renderAccounts();
    });
  }
}

// ---------- カテゴリ管理 ----------
function renderCategoriesSettings() {
  const list = document.getElementById('categories-list');
  list.innerHTML = '';
  categories().forEach((cat) => {
    const count = STATE.accounts.filter((a) => a.category === cat.id).length;
    const row = document.createElement('div');
    row.className = 'list-row tappable';
    row.innerHTML = `
      <div class="main">
        <div class="dot" style="background:${cat.color}"></div>
        <div>
          <div class="name">${escapeHtml(cat.label)}</div>
          <div class="meta">${count}件の口座</div>
        </div>
      </div>
      <span class="chev">›</span>
    `;
    row.addEventListener('click', () => openCategoryModal(cat));
    list.appendChild(row);
  });
}
document.getElementById('btn-add-category').addEventListener('click', () => openCategoryModal(null));

function openCategoryModal(existing) {
  const isEdit = !!existing;
  let selectedColor = existing ? existing.color : CATEGORY_COLOR_CHOICES[0];
  openModal(`
    <h3>${isEdit ? 'カテゴリを編集' : 'カテゴリを追加'}</h3>
    <div class="field">
      <label>カテゴリ名</label>
      <input type="text" id="cat-name" value="${existing ? escapeHtml(existing.label) : ''}" placeholder="例: 不動産、退職金">
    </div>
    <div class="field">
      <label>色</label>
      <div class="category-picker" id="color-picker">
        ${CATEGORY_COLOR_CHOICES.map((c) => `<button type="button" data-color="${c}" style="background:${c};width:32px;height:32px;padding:0;border-radius:50%;border:2px solid ${c === selectedColor ? '#fff' : 'transparent'};"></button>`).join('')}
      </div>
    </div>
    <button class="btn" id="cat-save" style="margin-bottom:10px;">保存</button>
    ${isEdit ? '<button class="btn danger" id="cat-delete" style="margin-bottom:10px;">このカテゴリを削除</button>' : ''}
    <button class="btn secondary" id="cat-cancel">キャンセル</button>
  `);
  document.querySelectorAll('#color-picker button').forEach((b) => {
    b.addEventListener('click', () => {
      selectedColor = b.dataset.color;
      document.querySelectorAll('#color-picker button').forEach((x) => { x.style.border = '2px solid transparent'; });
      b.style.border = '2px solid #fff';
    });
  });
  document.getElementById('cat-cancel').addEventListener('click', closeModal);
  document.getElementById('cat-save').addEventListener('click', async () => {
    const label = document.getElementById('cat-name').value.trim();
    if (!label) { showToast('カテゴリ名を入力してください'); return; }
    if (isEdit) {
      existing.label = label;
      existing.color = selectedColor;
    } else {
      STATE.categories.push({ id: uuid(), label, color: selectedColor });
    }
    await persist();
    closeModal();
    renderCategoriesSettings();
  });
  if (isEdit) {
    document.getElementById('cat-delete').addEventListener('click', async () => {
      if (STATE.categories.length <= 1) { showToast('最後の1つは削除できません'); return; }
      const inUse = STATE.accounts.some((a) => a.category === existing.id);
      if (inUse) { showToast('このカテゴリを使っている口座があります。先に口座のカテゴリを変更してください'); return; }
      const ok = await confirmDialog('カテゴリを削除しますか？', `「${escapeHtml(existing.label)}」を削除します。`, '削除する');
      if (!ok) return;
      STATE.categories = STATE.categories.filter((c) => c.id !== existing.id);
      await persist();
      closeModal();
      renderCategoriesSettings();
    });
  }
}

// ---------- 設定画面 ----------
async function renderSettings() {
  renderCategoriesSettings();
  document.getElementById('setting-reminder-day').value = STATE.settings.reminderDay || 25;
  const bioSwitch = document.getElementById('biometric-switch');
  const bioStatus = document.getElementById('biometric-status-text');
  const enabled = Storage.isBiometricEnabled();
  bioSwitch.classList.toggle('on', enabled);
  const supported = await CryptoModule.platformAuthenticatorAvailable();
  bioStatus.textContent = enabled ? '有効' : (supported ? '無効(タップで有効化)' : 'この端末では利用できません');
  bioSwitch.onclick = async () => {
    if (!enabled) {
      try {
        await Storage.enableBiometric(CURRENT_KEY);
        showToast('Face ID / Touch IDを有効にしました');
      } catch (e) {
        showToast(e.message === 'PRF_UNSUPPORTED' ? 'この端末は対応していません' : '有効化に失敗しました');
      }
    } else {
      Storage.disableBiometric();
      showToast('Face ID / Touch IDを無効にしました');
    }
    renderSettings();
  };
}
document.getElementById('setting-reminder-day').addEventListener('change', async (e) => {
  let v = Number(e.target.value);
  if (!v || v < 1) v = 1;
  if (v > 28) v = 28;
  e.target.value = v;
  STATE.settings.reminderDay = v;
  await persist();
  showToast('リマインダー日を更新しました');
});

document.getElementById('btn-change-pin').addEventListener('click', openChangePinModal);
function openChangePinModal() {
  openModal(`
    <h3>PINを変更</h3>
    <div class="field"><label>現在のPIN</label><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" id="pin-current"></div>
    <div class="field"><label>新しいPIN(6桁の数字)</label><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" id="pin-new"></div>
    <div class="field"><label>新しいPIN(確認)</label><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" id="pin-new2"></div>
    <div class="error-text" id="pin-change-error"></div>
    <button class="btn" id="pin-change-save" style="margin-bottom:10px;">変更する</button>
    <button class="btn secondary" id="pin-change-cancel">キャンセル</button>
  `);
  document.getElementById('pin-change-cancel').addEventListener('click', closeModal);
  document.getElementById('pin-change-save').addEventListener('click', async () => {
    const cur = document.getElementById('pin-current').value;
    const n1 = document.getElementById('pin-new').value;
    const n2 = document.getElementById('pin-new2').value;
    const errEl = document.getElementById('pin-change-error');
    if (n1.length !== PIN_LEN || !/^\d+$/.test(n1)) { errEl.textContent = `新しいPINは${PIN_LEN}桁の数字で入力してください`; return; }
    if (n1 !== n2) { errEl.textContent = '新しいPINが一致しません'; return; }
    try {
      await Storage.unlockWithPin(cur);
    } catch (e) {
      errEl.textContent = '現在のPINが正しくありません';
      return;
    }
    const wasBiometric = Storage.isBiometricEnabled();
    CURRENT_KEY = await Storage.changePin(CURRENT_KEY, STATE, n1);
    closeModal();
    if (wasBiometric) {
      showToast('PINを変更しました。Face ID/Touch IDは再設定が必要です');
    } else {
      showToast('PINを変更しました');
    }
    renderSettings();
  });
}

document.getElementById('btn-export-backup').addEventListener('click', async () => {
  const json = await Storage.exportBackup();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `asset-tracker-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  showToast('バックアップを書き出しました');
});

document.getElementById('btn-import-backup').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  const ok = await confirmDialog('バックアップを読み込みますか？', '現在この端末に保存されているデータは、読み込んだバックアップで置き換えられます。この操作は取り消せません。', '読み込む');
  if (!ok) return;
  try {
    await Storage.importBackupReplace(text);
    showToast('読み込みました。バックアップのPINでロック解除してください');
    lockApp();
  } catch (err) {
    showToast('バックアップファイルが不正です');
  }
});

document.getElementById('btn-wipe-all').addEventListener('click', async () => {
  const ok = await confirmDialog('全データを削除しますか？', '口座情報・記録・PIN設定などすべてのデータが完全に削除されます。事前にバックアップを書き出していない場合、復元できません。', '完全に削除する');
  if (!ok) return;
  const ok2 = await confirmDialog('本当によろしいですか？', 'これは最終確認です。取り消せません。', '削除を実行');
  if (!ok2) return;
  Storage.wipeAll();
  CURRENT_KEY = null;
  STATE = null;
  location.reload();
});

// ---------- 起動 ----------
window.addEventListener('DOMContentLoaded', () => {
  if (Storage.hasVault()) {
    initUnlockScreen();
  } else {
    initSetupScreen();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// アプリ本体: 画面遷移・状態管理・各画面の描画ロジック。

const PIN_LEN = 6;
const ICON_EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 1 11s4 7 11 7a9.26 9.26 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const CATEGORY_COLOR_CHOICES = ['#4f9dff', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee', '#facc15'];
function categories() { return STATE.categories; }
function categoryById(id) {
  return STATE.categories.find((c) => c.id === id) || { id: 'unknown', label: 'その他', color: '#a78bfa' };
}

let CURRENT_KEY = null;
let STATE = null;
let recordViewYm = null;
let recordShowHidden = false; // 記録タブで「記録画面に表示しない」口座も出すか
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
  applyAmountMaskClass();
  showScreen('screen-main');
  switchView('home');
}

const VIEW_TITLES = { home: 'ホーム', record: '資産を記録', history: '履歴', settings: '設定' };
function switchView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('topbar-title').textContent = VIEW_TITLES[view];
  document.querySelector('.content').classList.toggle('no-scroll', view === 'home' || view === 'history' || view === 'record');
  if (view === 'home') renderHome();
  if (view === 'record') { recordViewYm = recordViewYm || todayYm(); recordShowHidden = false; renderRecordView(); }
  if (view === 'history') renderHistory();
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
// カテゴリ内の口座ごとの内訳（その月に記録がある口座だけ、口座の登録順）
function accountBreakdownForMonth(catId, ym) {
  const cat = categories().find((c) => c.id === catId);
  const accs = STATE.accounts.filter((a) => a.category === catId);
  return accs.map((a, i) => {
    const rec = STATE.records.find((r) => r.yearMonth === ym && r.accountId === a.id);
    return rec ? { label: a.name, value: rec.balance, color: accountShade(cat ? cat.color : '#888888', i, accs.length) } : null;
  }).filter(Boolean);
}
// 口座の丸の色: カテゴリの色をベースに、口座ごとに明るさを変える（1つ目はカテゴリ色そのまま）
function accountShade(hex, i, n) {
  if (i === 0 || n <= 1) return hex;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const t = Math.min(0.6, (i / (n - 1)) * 0.6); // 0〜60% 白に寄せる
  const mix = (c) => Math.round(c + (255 - c) * t);
  const r = mix(num >> 16), g = mix((num >> 8) & 255), b = mix(num & 255);
  return `rgb(${r},${g},${b})`;
}
function categoryTotalForMonth(catId, ym) {
  const accIds = new Set(STATE.accounts.filter((a) => a.category === catId).map((a) => a.id));
  return STATE.records.filter((r) => r.yearMonth === ym && accIds.has(r.accountId)).reduce((s, r) => s + r.balance, 0);
}
// 投資元本: 「元本も記録する」をオンにした口座の、その月の元本の合計。
// あわせて、元本を記録した口座の評価額の合計も返す(含み損益の計算用)。元本の記録がなければ null
function principalForMonth(seriesId, ym) {
  const accs = STATE.accounts.filter((a) => a.trackPrincipal && (seriesId === 'total' || a.category === seriesId));
  let principal = 0, value = 0, found = false;
  accs.forEach((a) => {
    const r = STATE.records.find((rr) => rr.accountId === a.id && rr.yearMonth === ym);
    if (r && typeof r.principal === 'number') { principal += r.principal; value += r.balance; found = true; }
  });
  return found ? { principal, value, gain: value - principal } : null;
}
// 元本を固定にした口座(旧NISAなど)用: 指定月より前で最後に記録した元本
function lastPrincipalBefore(accountId, ym) {
  let best = null;
  STATE.records.forEach((r) => {
    if (r.accountId === accountId && r.yearMonth < ym && typeof r.principal === 'number' && (!best || r.yearMonth > best.yearMonth)) best = r;
  });
  return best ? best.principal : null;
}
function seriesTracksPrincipal(seriesId) {
  return STATE.accounts.some((a) => a.trackPrincipal && (seriesId === 'total' || a.category === seriesId));
}
function principalTipText(pr) {
  if (!pr) return '';
  const pct = pr.principal ? ` (${pr.gain >= 0 ? '+' : ''}${((pr.gain / pr.principal) * 100).toFixed(1)}%)` : '';
  return `元本 ${yen(pr.principal)}　損益 ${yenSigned(pr.gain)}${pct}`;
}
function lastRecordedAtForMonth(ym) {
  const stamps = STATE.records.filter((r) => r.yearMonth === ym && r.recordedAt).map((r) => r.recordedAt);
  if (stamps.length === 0) return null;
  return stamps.sort().pop();
}
function formatRecordedDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}に記録`;
}

// ---------- 目隠しモード ----------
// ホームの目のボタンでオンにすると、全タブの金額を「••••」で隠す（記録タブの入力欄はタップ中だけ見える）
const amountsMasked = () => !!(STATE && STATE.settings && STATE.settings.hideAmounts);
const MASK = '¥••••';
const yen = (v) => (amountsMasked() ? MASK : Charts.formatYen(v));
const yenShort = (v) => (amountsMasked() ? MASK : Charts.formatYenShort(v));
const yenSigned = (d, short = false) => `${d > 0 ? '+' : d < 0 ? '-' : ''}${amountsMasked() ? MASK : short ? Charts.formatYenShort(Math.abs(d)) : Charts.formatYen(Math.abs(d))}`;
function applyAmountMaskClass() { document.body.classList.toggle('amounts-masked', amountsMasked()); }

// ---------- ホーム画面 ----------
document.getElementById('btn-toggle-amounts').addEventListener('click', async () => {
  STATE.settings.hideAmounts = !STATE.settings.hideAmounts;
  applyAmountMaskClass();
  await persist();
  renderHome();
});
// 推移グラフの表示期間。最後に記録した月から遡って 1年/3年/全期間 分を毎月描く。
// 目盛りのラベルは 1年=2か月おき / 3年=半年おき / 全期間=長さに合わせて間引き(最後に記録した月を基準)。
// 記録がない月は点を置かず、前後の記録した点を直線で結ぶ。最初の記録より前は描かない。
const HOME_RANGES = { '1y': { months: 12, labelStep: 2 }, '3y': { months: 36, labelStep: 6 } };
let homeRange = '1y';
document.querySelectorAll('#home-range-picker button').forEach((b) => {
  b.addEventListener('click', () => {
    homeRange = b.dataset.range;
    document.querySelectorAll('#home-range-picker button').forEach((x) => x.classList.toggle('selected', x === b));
    renderHomeTrendChart();
  });
});
// 月数に合わせて目盛りの間隔を決める（ラベルが7個程度に収まるように）
function niceLabelStep(n) {
  return [1, 2, 3, 6, 12, 24, 36, 60].find((st) => n / st <= 6) || 120;
}
function ymDiff(a, b) { return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))); }
function homeTrendPoints(range) {
  const months = recordedMonths();
  if (months.length === 0) return [];
  const firstYm = months[0];
  const lastYm = months[months.length - 1];
  const cfg = range === 'all'
    ? { months: ymDiff(firstYm, lastYm), labelStep: niceLabelStep(ymDiff(firstYm, lastYm)) }
    : (HOME_RANGES[range] || HOME_RANGES['1y']);
  const points = [];
  const recorded = new Set(months);
  for (let i = cfg.months; i >= 0; i--) {
    const ym = ymAdd(lastYm, -i);
    if (ym < firstYm) continue;
    const label = `${ym.slice(2, 4)}/${Number(ym.slice(5, 7))}`;
    // 記録がない月は値なし(null)にして、前後の記録した点どうしを直線で結ぶ
    points.push({ label, value: recorded.has(ym) ? totalForMonth(ym) : null, showLabel: i % cfg.labelStep === 0, tip: ymLabelFull(ym) });
  }
  return points;
}
Charts.enableLineChartTap(document.getElementById('home-trend-chart'));
Charts.enableLineChartTap(document.getElementById('history-trend-chart'));
function renderHomeTrendChart() {
  const hidden = !!STATE.settings.hideAmounts;
  Charts.drawLineChart(document.getElementById('home-trend-chart'), homeTrendPoints(homeRange), '#4f9dff', hidden);
}
function renderHome() {
  const hidden = !!STATE.settings.hideAmounts;
  document.getElementById('btn-toggle-amounts').innerHTML = hidden ? ICON_EYE_OFF : ICON_EYE;
  const months = recordedMonths();
  const latestYm = months[months.length - 1];
  const prevYm = months.length > 1 ? months[months.length - 2] : null;
  const total = latestYm ? totalForMonth(latestYm) : 0;
  document.getElementById('home-total').textContent = hidden ? '¥••••••••' : Charts.formatYen(total);
  const deltaEl = document.getElementById('home-delta');
  if (hidden) {
    deltaEl.textContent = latestYm ? `${ymLabelFull(latestYm)}時点（金額は非表示中）` : 'まだ記録がありません';
    deltaEl.className = 'total-sub';
  } else if (latestYm && prevYm) {
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

  // 投資元本と含み損益（元本を記録した最新の月）
  const prEl = document.getElementById('home-principal');
  const prYm = months.slice().reverse().find((ym) => principalForMonth('total', ym));
  if (prYm) {
    const pr = principalForMonth('total', prYm);
    const pct = pr.principal ? `${pr.gain >= 0 ? '+' : ''}${((pr.gain / pr.principal) * 100).toFixed(1)}%` : '';
    prEl.innerHTML = `投資元本 ${yen(pr.principal)}　含み損益 <span class="${pr.gain > 0 ? 'up' : pr.gain < 0 ? 'down' : ''}">${yenSigned(pr.gain)}（${pct}）</span>`;
    prEl.classList.remove('hidden');
  } else {
    prEl.classList.add('hidden');
  }

  renderHomeNisa();

  // リマインダーバナー
  const banner = document.getElementById('home-banner-slot');
  const day = new Date().getDate();
  const reminderDay = STATE.settings.reminderDay || 25;
  const alreadyThisMonth = months.includes(todayYm());
  if (STATE.accounts.length === 0) {
    banner.innerHTML = `<div class="banner"><div class="emoji">🏦</div><div class="txt"><b>まずは口座を登録</b>「設定」タブの口座管理からNISA口座や銀行口座などを追加しましょう。</div></div>`;
  } else if (day >= reminderDay && !alreadyThisMonth) {
    banner.innerHTML = `<div class="banner"><div class="emoji">📝</div><div class="txt"><b>今月(${ymLabelFull(todayYm())})の資産を記録しましょう</b>「記録」タブからまとめて入力できます。</div></div>`;
  } else {
    banner.innerHTML = '';
  }

  renderHomeTrendChart();

  renderHomePie();
}

// 資産配分: ‹ › で記録済みの月を切替(初期は最新の月)
let homePieYm = null;
function shiftHomePie(dir) {
  const months = recordedMonths();
  const i = months.indexOf(homePieYm);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= months.length) return;
  homePieYm = months[j];
  renderHomePie();
}
document.getElementById('home-pie-prev').addEventListener('click', () => shiftHomePie(-1));
document.getElementById('home-pie-next').addEventListener('click', () => shiftHomePie(1));
// 年月ホイール: 年と月を別々に回して選ぶ。記録がない月はグレーで選べない（止まったら近い記録月に寄せる）
document.getElementById('home-pie-month-btn').addEventListener('click', () => openYmPicker());
function openYmPicker() {
  const months = recordedMonths();
  if (months.length === 0) return;
  const has = new Set(months);
  const firstY = Number(months[0].slice(0, 4));
  const lastY = Number(months[months.length - 1].slice(0, 4));
  const years = [];
  for (let y = firstY; y <= lastY; y++) years.push(String(y));
  const ROW = 40;
  let selY = (homePieYm || months[months.length - 1]).slice(0, 4);
  let selM = Number((homePieYm || months[months.length - 1]).slice(5, 7));
  const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  openModal(`
    <div class="ym-picker-head"><button id="ym-cancel">キャンセル</button><span class="title">表示する月</span><button class="done" id="ym-done">完了</button></div>
    <div class="ym-wheels">
      <div class="ym-wheel" id="ym-wheel-y">${years.map((y) => `<div data-v="${y}" class="${months.some((m) => m.startsWith(y)) ? '' : 'off'}">${y}年</div>`).join('')}</div>
      <div class="ym-wheel" id="ym-wheel-m">${Array.from({ length: 12 }, (_, k) => `<div data-v="${k + 1}">${k + 1}月</div>`).join('')}</div>
    </div>
  `);
  const wy = document.getElementById('ym-wheel-y');
  const wm = document.getElementById('ym-wheel-m');
  const paintMonths = () => {
    [...wm.children].forEach((el) => el.classList.toggle('off', !has.has(ymOf(selY, Number(el.dataset.v)))));
  };
  const scrollTo = (wheel, index, smooth) => wheel.scrollTo({ top: index * ROW, behavior: smooth ? 'smooth' : 'auto' });
  // その年で m にいちばん近い記録月
  const nearestMonth = (y, m) => {
    const ok = [];
    for (let k = 1; k <= 12; k++) if (has.has(ymOf(y, k))) ok.push(k);
    if (ok.length === 0) return null;
    return ok.reduce((b, k) => (Math.abs(k - m) < Math.abs(b - m) ? k : b), ok[0]);
  };
  // いちばん近い記録がある年
  const nearestYear = (y) => {
    const ok = years.filter((yy) => months.some((m) => m.startsWith(yy)));
    return ok.reduce((b, yy) => (Math.abs(yy - y) < Math.abs(b - y) ? yy : b), ok[0]);
  };
  const settle = (wheel, fn) => {
    let t = null;
    wheel.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(fn, 120); });
  };
  settle(wy, () => {
    const idx = Math.max(0, Math.min(years.length - 1, Math.round(wy.scrollTop / ROW)));
    let y = years[idx];
    if (!months.some((m) => m.startsWith(y))) { y = nearestYear(Number(y)); scrollTo(wy, years.indexOf(y), true); }
    if (y === selY) return;
    selY = y;
    paintMonths();
    const nm = nearestMonth(selY, selM);
    if (nm !== selM) { selM = nm; scrollTo(wm, selM - 1, true); }
  });
  settle(wm, () => {
    const m = Math.max(1, Math.min(12, Math.round(wm.scrollTop / ROW) + 1));
    const nm = has.has(ymOf(selY, m)) ? m : nearestMonth(selY, m);
    selM = nm;
    if (nm !== m) scrollTo(wm, nm - 1, true);
  });
  wy.addEventListener('click', (e) => { const el = e.target.closest('[data-v]'); if (el) scrollTo(wy, years.indexOf(el.dataset.v), true); });
  wm.addEventListener('click', (e) => { const el = e.target.closest('[data-v]'); if (el) scrollTo(wm, Number(el.dataset.v) - 1, true); });
  paintMonths();
  requestAnimationFrame(() => { scrollTo(wy, years.indexOf(selY), false); scrollTo(wm, selM - 1, false); });
  document.getElementById('ym-cancel').addEventListener('click', closeModal);
  document.getElementById('ym-done').addEventListener('click', () => {
    const ym = ymOf(selY, selM);
    if (has.has(ym)) { homePieYm = ym; renderHomePie(); }
    closeModal();
  });
}
function renderHomePie() {
  const hidden = !!STATE.settings.hideAmounts;
  const months = recordedMonths();
  if (!months.includes(homePieYm)) homePieYm = months.length ? months[months.length - 1] : null;
  const i = months.indexOf(homePieYm);
  document.getElementById('home-pie-prev').disabled = i <= 0;
  document.getElementById('home-pie-next').disabled = i < 0 || i >= months.length - 1;
  document.getElementById('home-breakdown-month').textContent = homePieYm ? ymLabelFull(homePieYm) : '-';
  document.getElementById('home-pie-month-btn').disabled = months.length <= 1;
  const breakdown = homePieYm ? breakdownForMonth(homePieYm) : [];
  Charts.drawPieChart(document.getElementById('home-pie-chart'), breakdown, hidden);
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
  const deleteBtn = document.getElementById('btn-delete-month');
  if (STATE.accounts.length === 0) {
    empty.classList.remove('hidden');
    groupsEl.innerHTML = '';
    saveBtn.classList.add('hidden');
    deleteBtn.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  saveBtn.classList.remove('hidden');
  const hasRecordsThisMonth = STATE.records.some((r) => r.yearMonth === recordViewYm);
  deleteBtn.classList.toggle('hidden', !hasRecordsThisMonth);

  groupsEl.innerHTML = '';
  // 「記録画面に表示しない」口座は、その月に記録があるときか「非表示の口座も表示」を押したときだけ出す
  const hasRec = (acc) => STATE.records.some((r) => r.accountId === acc.id && r.yearMonth === recordViewYm);
  const visible = (acc) => !acc.hideInRecord || recordShowHidden || hasRec(acc);
  const hiddenCount = STATE.accounts.filter((a) => !visible(a)).length;
  categories().forEach((cat) => {
    const accs = STATE.accounts.filter((a) => a.category === cat.id && visible(a));
    if (accs.length === 0) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h3>${escapeHtml(cat.label)}</h3>`;
    accs.forEach((acc) => {
      const existing = STATE.records.find((r) => r.accountId === acc.id && r.yearMonth === recordViewYm);
      const prefill = existing ? existing.balance : '';
      const row = document.createElement('div');
      row.className = 'amount-row';
      row.innerHTML = `
        <div class="label"><span class="name">${escapeHtml(acc.name)}</span></div>
        <input type="number" inputmode="decimal" data-account-id="${acc.id}" placeholder="0" value="${prefill}">
      `;
      card.appendChild(row);
      if (acc.trackPrincipal) {
        let pv = existing && typeof existing.principal === 'number' ? existing.principal : '';
        if (pv === '' && acc.principalFixed) { const last = lastPrincipalBefore(acc.id, recordViewYm); if (last !== null) pv = last; }
        const prow = document.createElement('div');
        prow.className = 'amount-row principal-row';
        prow.innerHTML = `
          <div class="label"><span class="name">└ 元本${acc.principalFixed ? '<small>（固定）</small>' : ''}</span></div>
          <input type="number" inputmode="decimal" data-principal-id="${acc.id}" placeholder="元本" value="${pv}">
        `;
        card.appendChild(prow);
      }
    });
    groupsEl.appendChild(card);
  });
  if (hiddenCount > 0) {
    const more = document.createElement('button');
    more.className = 'record-show-hidden';
    more.textContent = `非表示の口座も表示（${hiddenCount}件）`;
    more.addEventListener('click', () => { recordShowHidden = true; renderRecordView(); });
    groupsEl.appendChild(more);
  }
}
document.getElementById('record-prev-month').addEventListener('click', () => { recordViewYm = ymAdd(recordViewYm, -1); recordShowHidden = false; renderRecordView(); });
document.getElementById('record-next-month').addEventListener('click', () => { recordViewYm = ymAdd(recordViewYm, 1); recordShowHidden = false; renderRecordView(); });
document.getElementById('btn-save-record').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('#record-groups input[data-account-id]');
  const now = new Date().toISOString();
  let count = 0;
  inputs.forEach((input) => {
    const accountId = input.dataset.accountId;
    const val = input.value === '' ? null : Number(input.value);
    const idx = STATE.records.findIndex((r) => r.accountId === accountId && r.yearMonth === recordViewYm);
    if (val === null) {
      if (idx >= 0) STATE.records.splice(idx, 1);
      return;
    }
    const pInput = document.querySelector(`#record-groups input[data-principal-id="${accountId}"]`);
    const principal = pInput && pInput.value !== '' ? Number(pInput.value) : null;
    let rec;
    if (idx >= 0) { rec = STATE.records[idx]; rec.balance = val; rec.recordedAt = now; }
    else { rec = { yearMonth: recordViewYm, accountId, balance: val, recordedAt: now }; STATE.records.push(rec); }
    if (pInput) { if (principal === null) delete rec.principal; else rec.principal = principal; }
    count++;
  });
  await persist();
  showToast(`${ymLabelFull(recordViewYm)}の記録を保存しました`);
  if (STATE.settings.autoBackup) {
    const wantsBackup = await confirmDialog('バックアップを作成しますか？', '今回の記録を含む最新のデータをファイルに書き出して保存します。', '作成する', false);
    if (wantsBackup) {
      await downloadBackupFile('asset-tracker-backup');
      showToast('バックアップを保存しました');
    }
  }
  switchView('home');
});
document.getElementById('btn-delete-month').addEventListener('click', async () => {
  const ok = await confirmDialog('この月の記録を削除しますか？', `${ymLabelFull(recordViewYm)}に記録した全口座のデータを削除します。この操作は取り消せません。`, '削除する');
  if (!ok) return;
  STATE.records = STATE.records.filter((r) => r.yearMonth !== recordViewYm);
  await persist();
  showToast(`${ymLabelFull(recordViewYm)}の記録を削除しました`);
  renderRecordView();
});

// ---------- 履歴画面 ----------
let historySelectedSeries = 'total';
function usedCategories() {
  return categories().filter((c) => STATE.accounts.some((a) => a.category === c.id));
}
function historySeriesOrder() {
  const catIds = new Set(usedCategories().map((c) => c.id));
  const validIds = new Set(['total', ...catIds]);
  let order = (STATE.settings.historySeriesOrder || []).filter((id) => validIds.has(id));
  if (!order.includes('total')) order.unshift('total');
  validIds.forEach((id) => { if (!order.includes(id)) order.push(id); });
  STATE.settings.historySeriesOrder = order;
  return order;
}
function historySeriesList() {
  const dict = { total: { id: 'total', label: '総額', color: '#4f9dff' } };
  usedCategories().forEach((c) => { dict[c.id] = c; });
  return historySeriesOrder().map((id) => dict[id]).filter(Boolean);
}
async function moveHistorySeries(id, dir) {
  const order = historySeriesOrder().slice();
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  STATE.settings.historySeriesOrder = order;
  await persist();
}
function renderHistorySeriesPicker() {
  const picker = document.getElementById('history-series-picker');
  const seriesList = historySeriesList();
  if (!seriesList.some((s) => s.id === historySelectedSeries)) historySelectedSeries = 'total';
  picker.innerHTML = seriesList.map((s) => `<button type="button" data-series="${s.id}" class="${s.id === historySelectedSeries ? 'selected' : ''}">${escapeHtml(s.label)}</button>`).join('');
  picker.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { historySelectedSeries = b.dataset.series; renderHistoryChart(); renderHistorySeriesPicker(); renderHistoryList(); });
  });
}
// 履歴グラフ: 年別=1〜12月の1年分(左右スワイプか ‹ › で年を切替) / 3年=最新の記録月から3年分 / 全期間=記録した全期間。
// 増減は 年別=前年最後の記録と比較(前年がなければその年最初の記録)、全期間=最初の記録と比較。
let historyMode = 'year';
let historyYear = null;
function historyYears(seriesId) {
  return Array.from(new Set(recordedMonths().filter((ym) => seriesHasRecord(seriesId, ym)).map((ym) => ym.slice(0, 4)))).sort();
}
function shiftHistoryYear(dir) {
  const years = historyYears(historySelectedSeries);
  const i = years.indexOf(historyYear);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= years.length) return;
  historyYear = years[j];
  renderHistoryChart();
  renderHistoryList();
}
document.getElementById('history-year-prev').addEventListener('click', () => shiftHistoryYear(-1));
document.getElementById('history-year-next').addEventListener('click', () => shiftHistoryYear(1));
document.querySelectorAll('#history-mode-picker button').forEach((b) => {
  b.addEventListener('click', () => {
    historyMode = b.dataset.mode;
    document.querySelectorAll('#history-mode-picker button').forEach((x) => x.classList.toggle('selected', x === b));
    renderHistoryChart();
    renderHistoryList();
  });
});
(() => {
  const canvas = document.getElementById('history-trend-chart');
  let sx = null, sy = null;
  canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (sx === null || historyMode !== 'year') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) shiftHistoryYear(dx < 0 ? 1 : -1);
  });
})();
function principalPoint(seriesId, ym, has) {
  if (!has) return {};
  const pr = principalForMonth(seriesId, ym);
  // 総額のグラフには銀行なども含まれるので、元本の点線は出さず吹き出しの文字だけ
  if (!pr) return {};
  return seriesId === 'total' ? { tipExtra: principalTipText(pr) } : { sub: pr.principal, tipExtra: principalTipText(pr) };
}
function renderHistoryChart() {
  const seriesList = historySeriesList();
  const series = seriesList.find((s) => s.id === historySelectedSeries) || seriesList[0];
  const deltaEl = document.getElementById('history-series-delta');
  const titleEl = document.getElementById('history-chart-title');
  const navEl = document.getElementById('history-year-nav');
  const canvas = document.getElementById('history-trend-chart');
  document.getElementById('history-legend').innerHTML = '';
  const valueFor = (ym) => (series.id === 'total' ? totalForMonth(ym) : categoryTotalForMonth(series.id, ym));
  const months = recordedMonths().filter((ym) => seriesHasRecord(series.id, ym));
  const setDelta = (text, diff) => {
    deltaEl.textContent = text;
    deltaEl.className = 'total-sub ' + (diff == null ? '' : diff > 0 ? 'up' : diff < 0 ? 'down' : '');
  };
  const signed = (d) => yenSigned(d);
  navEl.classList.toggle('all-mode', historyMode !== 'year');

  if (months.length === 0) {
    titleEl.textContent = historyMode === 'all' ? '全期間' : historyMode === '3y' ? '直近3年' : '-';
    setDelta('', null);
    Charts.drawLineChart(canvas, [], series.color, amountsMasked());
    return;
  }

  if (historyMode === '3y') {
    titleEl.textContent = '直近3年';
    const lastYm = months[months.length - 1];
    const startYm = ymAdd(lastYm, -36);
    const recorded = new Set(months);
    const points = [];
    for (let i = 36; i >= 0; i--) {
      const ym = ymAdd(lastYm, -i);
      points.push({ label: `${ym.slice(2, 4)}/${Number(ym.slice(5, 7))}`, value: recorded.has(ym) ? valueFor(ym) : null, showLabel: i % 6 === 0, tip: ymLabelFull(ym) , ...principalPoint(series.id, ym, recorded.has(ym)) });
    }
    Charts.drawLineChart(canvas, points, series.color, amountsMasked());
    // 3年前(またはそれ以前)の最後の記録と比較。なければ範囲内の最初の記録と比較
    const before = months.filter((ym) => ym <= startYm);
    const baseYm = before.length ? before[before.length - 1] : months.find((ym) => ym > startYm);
    if (baseYm === lastYm) setDelta(`${ymLabelFull(lastYm)}時点　${yen(valueFor(lastYm))}`, null);
    else {
      const diff = valueFor(lastYm) - valueFor(baseYm);
      setDelta(`3年間の増減（${baseYm.slice(2, 4)}年${Number(baseYm.slice(5, 7))}月比）　${signed(diff)}`, diff);
    }
    return;
  }

  if (historyMode === 'all') {
    titleEl.textContent = '全期間';
    const recorded = new Set(months);
    const points = [];
    for (let ym = months[0]; ym <= months[months.length - 1]; ym = ymAdd(ym, 1)) {
      points.push({ label: `${ym.slice(2, 4)}/${Number(ym.slice(5, 7))}`, value: recorded.has(ym) ? valueFor(ym) : null, tip: ymLabelFull(ym) , ...principalPoint(series.id, ym, recorded.has(ym)) });
    }
    Charts.drawLineChart(canvas, points, series.color, amountsMasked());
    const first = months[0], last = months[months.length - 1];
    if (first === last) setDelta(`${ymLabelFull(last)}時点　${yen(valueFor(last))}`, null);
    else {
      const diff = valueFor(last) - valueFor(first);
      setDelta(`${first.slice(2, 4)}年${Number(first.slice(5, 7))}月から　${signed(diff)}`, diff);
    }
    return;
  }

  const years = historyYears(series.id);
  if (!years.includes(historyYear)) historyYear = years[years.length - 1];
  const yi = years.indexOf(historyYear);
  titleEl.textContent = `${historyYear}年`;
  document.getElementById('history-year-prev').disabled = yi <= 0;
  document.getElementById('history-year-next').disabled = yi >= years.length - 1;

  const recorded = new Set(months);
  const points = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${historyYear}-${String(m).padStart(2, '0')}`;
    points.push({ label: String(m), value: recorded.has(ym) ? valueFor(ym) : null, showLabel: true, tip: ymLabelFull(ym) , ...principalPoint(series.id, ym, recorded.has(ym)) });
  }
  Charts.drawLineChart(canvas, points, series.color, amountsMasked(), 'この年の記録はありません');

  const yMonths = months.filter((ym) => ym.slice(0, 4) === historyYear);
  const lastYm = yMonths[yMonths.length - 1];
  const prev = months.filter((ym) => ym.slice(0, 4) < historyYear);
  const baseYm = prev.length ? prev[prev.length - 1] : yMonths[0];
  if (baseYm === lastYm) setDelta(`${ymLabelFull(lastYm)}時点　${yen(valueFor(lastYm))}`, null);
  else {
    const diff = valueFor(lastYm) - valueFor(baseYm);
    setDelta(`年間の増減（${baseYm.slice(2, 4)}年${Number(baseYm.slice(5, 7))}月比）　${signed(diff)}`, diff);
  }
}
function seriesHasRecord(seriesId, ym) {
  if (seriesId === 'total') return STATE.records.some((r) => r.yearMonth === ym);
  const accIds = new Set(STATE.accounts.filter((a) => a.category === seriesId).map((a) => a.id));
  return STATE.records.some((r) => r.yearMonth === ym && accIds.has(r.accountId));
}
function renderHistory() {
  renderHistorySeriesPicker();
  renderHistoryChart();
  renderHistoryList();
}
// 月のリスト: 年別表示ではグラフと同じ年の月だけ、全期間表示では全部の月を新しい順に表示。リストだけスクロール。
function renderHistoryList() {
  const seriesId = historySelectedSeries;
  const valueFor = (ym) => (seriesId === 'total' ? totalForMonth(ym) : categoryTotalForMonth(seriesId, ym));
  const months = recordedMonths().filter((ym) => seriesHasRecord(seriesId, ym));
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  list.scrollTop = 0;
  if (months.length === 0) {
    list.innerHTML = '<div class="empty-state">まだ記録がありません。「記録」タブから最初の月を記録しましょう。</div>';
    return;
  }
  const years = historyYears(seriesId);
  if (!years.includes(historyYear)) historyYear = years[years.length - 1];
  const diffColor = (d) => (d > 0 ? 'var(--success)' : d < 0 ? 'var(--danger)' : 'var(--text-faint)');
  const signed = (d) => yenSigned(d, true);
  const last3 = months.length ? ymAdd(months[months.length - 1], -36) : '';
  const yMonths = historyMode === 'all' ? months
    : historyMode === '3y' ? months.filter((ym) => ym >= last3)
    : months.filter((ym) => ym.slice(0, 4) === historyYear);
  yMonths.slice().reverse().forEach((ym) => {
    const total = valueFor(ym);
    const idx = months.indexOf(ym);
    const prevTotal = idx > 0 ? valueFor(months[idx - 1]) : null;
    const row = document.createElement('div');
    row.className = 'list-row tappable';
    const deltaHtml = prevTotal !== null ? `<div class="meta" style="color:${diffColor(total - prevTotal)}">${signed(total - prevTotal)}</div>` : '';
    const recordedAt = lastRecordedAtForMonth(ym);
    const recordedHtml = recordedAt ? `<div class="meta">${formatRecordedDate(recordedAt)}</div>` : '';
    const items = seriesId === 'total' ? breakdownForMonth(ym) : accountBreakdownForMonth(seriesId, ym);
    const breakdownHtml = (seriesId === 'total' || items.length >= 2)
      ? `<div class="meta breakdown">${items.map((b) => `<span>${b.color ? `<span style="color:${b.color}">●</span>` : ''}${escapeHtml(b.label)} ${yenShort(b.value)}</span>`).join('')}</div>`
      : '';
    const pr = principalForMonth(seriesId, ym);
    let principalHtml = '';
    if (pr) {
      const prevPr = idx > 0 ? principalForMonth(seriesId, months[idx - 1]) : null;
      const dep = prevPr ? pr.principal - prevPr.principal : null;
      principalHtml = `<div class="meta principal-meta"><span>元本 ${yenShort(pr.principal)}${dep !== null && dep !== 0 ? `（入金 ${yenSigned(dep, true)}）` : ''}</span><span>損益 <span style="color:${diffColor(pr.gain)}">${yenSigned(pr.gain, true)}</span></span></div>`;
    }
    row.innerHTML = `
      <div class="main"><div><div class="name">${ymLabelFull(ym)}</div>${breakdownHtml}${principalHtml}${recordedHtml}</div></div>
      <div class="value-col"><div class="value">${yen(total)}</div>${deltaHtml}</div>
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
    list.innerHTML = '<div class="empty-state">口座がまだ登録されていません。<br>下のボタンからNISA口座や銀行口座などを追加してください。</div>';
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
            ${acc.trackPrincipal ? `<div class="meta">元本も記録${acc.principalFixed ? '（固定）' : ''}</div>` : ''}
            ${acc.hideInRecord ? '<div class="meta">記録画面に表示しない</div>' : ''}
          </div>
        </div>
        <div class="value small">${latest !== null ? yenShort(latest) : '未記録'}</div>
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
    <div class="toggle-row" style="padding-top:0;">
      <div class="txt"><b>元本も記録する（投資口座）</b><span>オンにすると、記録タブで評価額と一緒に投資元本(入れた金額の合計)も入力できます</span></div>
      <div class="switch ${existing && existing.trackPrincipal ? 'on' : ''}" id="acc-principal-switch"></div>
    </div>
    <div class="toggle-row sub-toggle" id="acc-fixed-row" style="padding-top:0;${existing && existing.trackPrincipal ? '' : 'display:none;'}">
      <div class="txt"><b>元本を固定（旧NISAなど）</b><span>もう入金しない口座向け。新しい月の元本に前回の値を自動で入れます(書き換えもOK)</span></div>
      <div class="switch ${existing && existing.principalFixed ? 'on' : ''}" id="acc-fixed-switch"></div>
    </div>
    <div class="toggle-row" style="padding-top:0;">
      <div class="txt"><b>記録画面に表示しない</b><span>過去データ用の口座など。記録がある月や「非表示の口座も表示」を押したときだけ出ます</span></div>
      <div class="switch ${existing && existing.hideInRecord ? 'on' : ''}" id="acc-hide-switch"></div>
    </div>
    <button class="btn" id="acc-save" style="margin-bottom:10px;">保存</button>
    ${isEdit && existing.trackPrincipal ? '<button class="btn secondary" id="acc-bulk-principal" style="margin-bottom:10px;">元本をまとめて入力</button>' : ''}
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
  const hideSwitch = document.getElementById('acc-hide-switch');
  hideSwitch.addEventListener('click', () => hideSwitch.classList.toggle('on'));
  const principalSwitch = document.getElementById('acc-principal-switch');
  const fixedSwitch = document.getElementById('acc-fixed-switch');
  const fixedRow = document.getElementById('acc-fixed-row');
  principalSwitch.addEventListener('click', () => {
    principalSwitch.classList.toggle('on');
    fixedRow.style.display = principalSwitch.classList.contains('on') ? '' : 'none';
  });
  fixedSwitch.addEventListener('click', () => fixedSwitch.classList.toggle('on'));
  document.getElementById('acc-cancel').addEventListener('click', closeModal);
  document.getElementById('acc-save').addEventListener('click', async () => {
    const hideInRecord = hideSwitch.classList.contains('on');
    const trackPrincipal = principalSwitch.classList.contains('on');
    const principalFixed = trackPrincipal && fixedSwitch.classList.contains('on');
    const name = document.getElementById('acc-name').value.trim();
    const memo = document.getElementById('acc-memo').value.trim();
    if (!name) { showToast('口座名を入力してください'); return; }
    if (isEdit) {
      existing.name = name; existing.memo = memo; existing.category = selectedCat; existing.hideInRecord = hideInRecord; existing.trackPrincipal = trackPrincipal; existing.principalFixed = principalFixed;
    } else {
      STATE.accounts.push({ id: uuid(), name, memo, category: selectedCat, hideInRecord, trackPrincipal, principalFixed });
    }
    await persist();
    closeModal();
    renderAccounts();
  });
  const bulkBtn = document.getElementById('acc-bulk-principal');
  if (bulkBtn) bulkBtn.addEventListener('click', () => openBulkPrincipalModal(existing));
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

// ---------- 元本のまとめて入力 ----------
// 「2024/01 100000」または「2024/01 100000 101557」(元本 評価額)の行を読み取る。
// 年月は 2024/01・2024-1・2024年1月 など、金額のカンマや「円」、全角数字もOK
function parseBulkPrincipal(text) {
  const items = [], errors = [];
  const seen = new Map();
  const num = (s) => Number(s.replace(/[,，円]/g, ''));
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[／]/g, '/').replace(/　/g, ' ').trim();
    if (!line) return;
    const m = line.match(/^(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*月?[\s,:：]+([\d,，]+)\s*円?(?:[\s\/]+([\d,，]+)\s*円?)?$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) { errors.push(raw.trim()); return; }
    const ym = `${m[1]}-${pad2(Number(m[2]))}`;
    const item = { ym, value: num(m[3]), balance: m[4] !== undefined ? num(m[4]) : null };
    if (seen.has(ym)) items[seen.get(ym)] = item;
    else { seen.set(ym, items.length); items.push(item); }
  });
  items.sort((a, b) => (a.ym < b.ym ? -1 : 1));
  return { items, errors };
}

// 入力内容と今のデータから、保存する内容(プレビュー)を組み立てる。STATEはまだ変えない
function planBulkPrincipal(acc, items, mergedId, restId) {
  const findRec = (id, ym) => STATE.records.find((r) => r.accountId === id && r.yearMonth === ym);
  const rows = [], skipped = [], warnings = [];
  items.forEach(({ ym, value, balance }) => {
    const rec = findRec(acc.id, ym);
    if (rec) {
      rows.push({ ym, kind: 'update', rec, value, balance: rec.balance, before: typeof rec.principal === 'number' ? rec.principal : null });
      return;
    }
    if (balance === null) { skipped.push(ym); return; }
    const row = { ym, kind: 'create', value, balance, before: null };
    const merged = mergedId ? findRec(mergedId, ym) : null;
    if (merged) {
      const rest = merged.balance - balance;
      if (!restId) { warnings.push(`${ymLabelFull(ym)}: 合算の記録があるので、分ける先の口座を選ぶまで追加しません`); return; }
      if (findRec(restId, ym)) { warnings.push(`${ymLabelFull(ym)}: 分ける先の口座にもう記録があるのでスキップ`); return; }
      if (rest < 0) { warnings.push(`${ymLabelFull(ym)}: 合算(${Charts.formatYen(merged.balance)})より評価額が大きいのでスキップ`); return; }
      row.split = { merged, rest };
      if (typeof merged.principal === 'number') row.split.restPrincipal = Math.max(0, merged.principal - value);
    }
    if (!mergedId) {
      const hiddenHit = STATE.accounts.filter((a) => a.id !== acc.id && a.hideInRecord && findRec(a.id, ym));
      hiddenHit.forEach((a) => { if (!warnings.includes(a.name)) warnings.push(a.name); });
    }
    rows.push(row);
  });
  // 非表示の口座(合算など)にも記録がある月を追加すると二重に数えるので注意を出す
  const hiddenNames = mergedId ? [] : warnings.splice(0);
  if (hiddenNames.length) warnings.push(`追加する月に「${hiddenNames.map(escapeHtml).join('」「')}」の記録もあります。合算の記録なら二重に数えないよう、上の「合算口座から分ける」を使ってください`);
  return { rows, skipped, warnings };
}

function applyBulkPrincipal(acc, plan, restId) {
  const now = new Date().toISOString();
  plan.rows.forEach((row) => {
    if (row.kind === 'update') { row.rec.principal = row.value; return; }
    STATE.records.push({ yearMonth: row.ym, accountId: acc.id, balance: row.balance, principal: row.value, recordedAt: now });
    if (row.split) {
      const restRec = { yearMonth: row.ym, accountId: restId, balance: row.split.rest, recordedAt: now };
      if (typeof row.split.restPrincipal === 'number') restRec.principal = row.split.restPrincipal;
      STATE.records.push(restRec);
      STATE.records = STATE.records.filter((r) => r !== row.split.merged);
    }
  });
}

function openBulkPrincipalModal(acc) {
  const others = STATE.accounts.filter((a) => a.id !== acc.id);
  const opts = (ph) => `<option value="">${ph}</option>` + others.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  openModal(`
    <h3>元本をまとめて入力</h3>
    <p class="bulk-help">「${escapeHtml(acc.name)}」の各月の元本を1行に1か月ずつ貼り付けてください。<br>例: <code>2024/01 100000</code><br>評価額も並べると(<code>2024/01 100000 101557</code>)、記録がない月も追加できます。記録がある月は元本だけ書き換え、評価額は変えません。</p>
    <div class="field">
      <textarea id="bulk-principal-text" class="bulk-textarea" rows="8" placeholder="2024/01 100000 101557&#10;2024/02 200000 210094"></textarea>
    </div>
    <details class="bulk-split" id="bulk-split">
      <summary>合算口座から分ける（任意）</summary>
      <p class="bulk-help">昔の記録を複数の口座の合計でまとめていた場合に使います。新しく追加する月は「合算 − この口座の評価額」を分ける先の口座に入れて、その月の合算の記録は消します(合計は変わりません)。</p>
      <div class="field"><label>合算の口座</label><select id="bulk-merged">${opts('使わない')}</select></div>
      <div class="field"><label>差額を入れる口座</label><select id="bulk-rest">${opts('選択してください')}</select></div>
    </details>
    <div id="bulk-principal-preview"></div>
    <button class="btn" id="bulk-principal-check" style="margin-bottom:10px;">確認する</button>
    <button class="btn secondary" id="bulk-principal-cancel">キャンセル</button>
  `);
  const textEl = document.getElementById('bulk-principal-text');
  const mergedEl = document.getElementById('bulk-merged');
  const restEl = document.getElementById('bulk-rest');
  const preview = document.getElementById('bulk-principal-preview');
  const checkBtn = document.getElementById('bulk-principal-check');
  let ready = null;
  const reset = () => { ready = null; preview.innerHTML = ''; checkBtn.textContent = '確認する'; };
  [textEl, mergedEl, restEl].forEach((el) => { el.addEventListener('input', reset); el.addEventListener('change', reset); });
  document.getElementById('bulk-principal-cancel').addEventListener('click', () => openAccountModal(acc));
  checkBtn.addEventListener('click', async () => {
    if (ready) {
      applyBulkPrincipal(acc, ready, restEl.value);
      await persist();
      showToast(`${ready.rows.length}か月分を保存しました`);
      closeModal();
      renderAccounts();
      return;
    }
    const { items, errors } = parseBulkPrincipal(textEl.value);
    const mergedId = mergedEl.value || null;
    const restId = mergedId ? (restEl.value || null) : null;
    if (mergedId && restId === mergedId) { preview.innerHTML = '<div class="bulk-warn">合算の口座と差額を入れる口座は別の口座を選んでください</div>'; return; }
    const plan = planBulkPrincipal(acc, items, mergedId, restId);
    const fmt = (v) => Charts.formatYen(v);
    const restName = restId ? escapeHtml(STATE.accounts.find((a) => a.id === restId).name) : '';
    const hasSplit = plan.rows.some((r) => r.split);
    let html = '';
    if (plan.rows.length) {
      const created = plan.rows.filter((r) => r.kind === 'create').length;
      const changed = plan.rows.filter((r) => r.kind === 'update' && r.before !== r.value).length;
      html += `<div class="bulk-summary">${plan.rows.length}か月分（追加 ${created}・元本の変更 ${changed}）</div>`;
      html += `<div class="bulk-table-wrap"><table class="bulk-table"><thead><tr><th>月</th><th>元本</th><th>評価額</th>${hasSplit ? `<th>${restName}</th>` : ''}</tr></thead><tbody>`;
      html += plan.rows.map((r) => {
        const pr = r.kind === 'update' && r.before !== null && r.before !== r.value ? `<s>${fmt(r.before)}</s><br>${fmt(r.value)}` : fmt(r.value);
        const prCls = r.kind === 'create' || r.before !== r.value ? 'new' : '';
        return `<tr><td>${ymLabelFull(r.ym)}${r.kind === 'create' ? '<span class="bulk-tag">追加</span>' : ''}</td><td class="${prCls}">${pr}</td><td class="${r.kind === 'create' ? 'new' : ''}">${fmt(r.balance)}</td>${hasSplit ? `<td class="new">${r.split ? fmt(r.split.rest) : ''}</td>` : ''}</tr>`;
      }).join('');
      html += '</tbody></table></div>';
    }
    if (plan.skipped.length) html += `<div class="bulk-warn">評価額の記録がないのでスキップ（評価額も並べると追加できます）: ${plan.skipped.map(ymLabelFull).join('、')}</div>`;
    plan.warnings.forEach((w) => { html += `<div class="bulk-warn">${w}</div>`; });
    if (errors.length) html += `<div class="bulk-warn">読み取れなかった行: ${errors.map(escapeHtml).join('、')}</div>`;
    if (!items.length && !errors.length) html = '<div class="bulk-warn">入力がありません</div>';
    preview.innerHTML = html;
    if (plan.rows.length) { ready = plan; checkBtn.textContent = `${plan.rows.length}か月分を保存`; }
  });
}

// ---------- 新NISAの残り枠 ----------
// 年間: つみたて120万・成長240万。生涯: 合計1800万(うち成長は1200万まで)。売却での枠の復活は考えない
const NISA_LIMITS = { tsumitateYear: 1200000, growthYear: 2400000, lifetime: 18000000, growthLifetime: 12000000 };
const NISA_START_YEAR = 2024;
function nisaUsage() { return STATE.settings.nisaUsage || {}; }
function hasNisaUsage() { return Object.values(nisaUsage()).some((u) => (u.tsumitate || 0) > 0 || (u.growth || 0) > 0); }
function nisaSummary(year) {
  const usage = nisaUsage();
  let tsuTotal = 0, groTotal = 0;
  Object.values(usage).forEach((u) => { tsuTotal += u.tsumitate || 0; groTotal += u.growth || 0; });
  const cur = usage[year] || {};
  const lifeLeft = Math.max(0, NISA_LIMITS.lifetime - tsuTotal - groTotal);
  return {
    year,
    tsuYearUsed: cur.tsumitate || 0, groYearUsed: cur.growth || 0,
    tsuYearLeft: Math.max(0, NISA_LIMITS.tsumitateYear - (cur.tsumitate || 0)),
    groYearLeft: Math.max(0, NISA_LIMITS.growthYear - (cur.growth || 0)),
    lifeUsed: tsuTotal + groTotal, lifeLeft,
    groLifeUsed: groTotal, groLifeLeft: Math.min(lifeLeft, Math.max(0, NISA_LIMITS.growthLifetime - groTotal)),
  };
}
function nisaBar(label, used, limit, left) {
  const pct = Math.min(100, (used / limit) * 100);
  return `<div class="nisa-row">
    <div class="nisa-row-head"><span>${label}</span><span>残り <b>${yen(left)}</b></span></div>
    <div class="nisa-bar"><div style="width:${pct}%"></div></div>
    <div class="nisa-row-foot">${yenShort(used)} / ${Charts.formatYenShort(limit)} 使用</div>
  </div>`;
}
function renderHomeNisa() {
  const card = document.getElementById('home-nisa');
  if (!hasNisaUsage()) { card.classList.add('hidden'); return; }
  const y = new Date().getFullYear();
  const s = nisaSummary(y);
  document.getElementById('home-nisa-body').innerHTML = `
    <div class="nisa-section">${y}年</div>
    ${nisaBar('つみたて投資枠', s.tsuYearUsed, NISA_LIMITS.tsumitateYear, s.tsuYearLeft)}
    ${nisaBar('成長投資枠', s.groYearUsed, NISA_LIMITS.growthYear, s.groYearLeft)}
    <div class="nisa-section">生涯</div>
    ${nisaBar('合計', s.lifeUsed, NISA_LIMITS.lifetime, s.lifeLeft)}
    ${nisaBar('うち成長投資枠', s.groLifeUsed, NISA_LIMITS.growthLifetime, s.groLifeLeft)}
  `;
  card.classList.remove('hidden');
}
function openNisaModal() {
  const usage = nisaUsage();
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = NISA_START_YEAR; y <= thisYear; y++) years.push(y);
  openModal(`
    <h3>NISAの利用額</h3>
    <p class="bulk-help">年ごとに、つみたて投資枠・成長投資枠で買った金額(買付額の合計)を入力してください。証券会社の「NISA枠の利用状況」の数字がそのまま使えます。ホームに残り枠が表示されます。</p>
    ${years.map((y) => `
      <div class="nisa-year-title">${y}年</div>
      <div class="nisa-input-row">
        <label>つみたて<input type="number" inputmode="numeric" data-nisa-year="${y}" data-nisa-kind="tsumitate" value="${usage[y] && usage[y].tsumitate ? usage[y].tsumitate : ''}" placeholder="0"></label>
        <label>成長<input type="number" inputmode="numeric" data-nisa-year="${y}" data-nisa-kind="growth" value="${usage[y] && usage[y].growth ? usage[y].growth : ''}" placeholder="0"></label>
      </div>`).join('')}
    <button class="btn" id="nisa-save" style="margin:14px 0 10px;">保存</button>
    <button class="btn secondary" id="nisa-cancel">キャンセル</button>
  `);
  document.getElementById('nisa-cancel').addEventListener('click', closeModal);
  document.getElementById('nisa-save').addEventListener('click', async () => {
    const next = {};
    document.querySelectorAll('[data-nisa-year]').forEach((input) => {
      const v = input.value === '' ? 0 : Math.max(0, Math.round(Number(input.value) || 0));
      if (!v) return;
      const y = input.dataset.nisaYear;
      next[y] = next[y] || { tsumitate: 0, growth: 0 };
      next[y][input.dataset.nisaKind] = v;
    });
    STATE.settings.nisaUsage = next;
    await persist();
    closeModal();
    showToast('NISAの利用額を保存しました');
    renderHomeNisa();
  });
}
document.getElementById('btn-open-nisa').addEventListener('click', openNisaModal);
document.getElementById('btn-edit-nisa').addEventListener('click', openNisaModal);

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

function renderHistoryOrderSettings() {
  const list = document.getElementById('history-order-list');
  const dict = { total: { id: 'total', label: '総額' } };
  usedCategories().forEach((c) => { dict[c.id] = c; });
  const order = historySeriesOrder();
  list.innerHTML = order.map((id, i) => `
    <div class="list-row">
      <div class="main"><span class="name">${escapeHtml(dict[id].label)}</span></div>
      <div style="display:flex;gap:6px;">
        <button class="btn small secondary" data-id="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn small secondary" data-id="${id}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', async () => {
      await moveHistorySeries(b.dataset.id, Number(b.dataset.dir));
      renderHistoryOrderSettings();
    });
  });
}

// ---------- 設定画面 ----------
async function renderSettings() {
  checkAppVersion();
  renderAccounts();
  renderCategoriesSettings();
  renderHistoryOrderSettings();
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

  const autoBackupSwitch = document.getElementById('autobackup-switch');
  autoBackupSwitch.classList.toggle('on', !!STATE.settings.autoBackup);
  autoBackupSwitch.onclick = async () => {
    STATE.settings.autoBackup = !STATE.settings.autoBackup;
    await persist();
    showToast(STATE.settings.autoBackup ? '自動バックアップを有効にしました' : '自動バックアップを無効にしました');
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

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
async function downloadBackupFile(prefix) {
  const json = await Storage.exportBackup();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prefix}-${todayDateStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
document.getElementById('btn-export-backup').addEventListener('click', async () => {
  await downloadBackupFile('asset-tracker-backup');
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

// ---------- バージョン確認 ----------
// 更新のたびに APP_VERSION と version.json の version を同じ値に上げる。
const APP_VERSION = '1.11.0';
document.getElementById('lock-version').textContent = `v${APP_VERSION}`;
async function fetchLatestVersion() {
  const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('bad status');
  return (await res.json()).version;
}
// ロック画面: 新しいバージョンがあれば右上に「更新」ボタンを出す（ロック解除せずに更新できる）
async function checkLockScreenVersion() {
  const btn = document.getElementById('btn-lock-update');
  try {
    const latest = await fetchLatestVersion();
    if (latest && latest !== APP_VERSION) {
      btn.textContent = `v${latest} に更新`;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  } catch (e) {
    // オフライン時は何も出さない
  }
}
checkLockScreenVersion();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkLockScreenVersion(); });
document.getElementById('btn-lock-update').addEventListener('click', () => forceUpdate());
async function checkAppVersion() {
  document.getElementById('version-current').textContent = `v${APP_VERSION}`;
  const el = document.getElementById('version-status');
  el.className = 'version-status';
  el.textContent = '確認中…';
  try {
    const latest = await fetchLatestVersion();
    if (latest === APP_VERSION) {
      el.textContent = '✓ 最新版です';
      el.className = 'version-status ok';
    } else {
      el.textContent = `新しいバージョン v${latest} があります。下のボタンで更新してください。`;
      el.className = 'version-status old';
    }
  } catch (e) {
    el.textContent = 'オフラインのため最新版か確認できませんでした';
  }
}

document.getElementById('btn-force-update').addEventListener('click', () => forceUpdate());
async function forceUpdate() {
  const ok = await confirmDialog('最新版に更新しますか？', 'アプリの表示・機能だけを最新の状態に更新します。口座データや記録、PINなどは一切削除されません。', '更新する', false);
  if (!ok) return;
  const cleanup = (async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      // 一部失敗しても reload は試みる
    }
  })();
  await Promise.race([cleanup, new Promise((resolve) => setTimeout(resolve, 2500))]);
  location.reload();
}

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

// ローカル暗号化ボールトの読み書き。データはこの端末のlocalStorageの外には一切出ない。

const Storage = (() => {
  const VAULT_KEY = 'assetTracker.vault.v1';
  const VERIFY_PLAINTEXT = { ok: true, marker: 'asset-tracker' };

  function loadVault() {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function saveVault(vault) {
    localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  }
  function hasVault() {
    return !!localStorage.getItem(VAULT_KEY);
  }

  function defaultCategories() {
    return [
      { id: 'nisa', label: 'NISA証券口座', color: '#4f9dff' },
      { id: 'bank', label: '銀行口座', color: '#34d399' },
      { id: 'dc', label: '企業型DC', color: '#f59e0b' },
      { id: 'crypto', label: '暗号資産', color: '#f472b6' },
      { id: 'other', label: 'その他', color: '#a78bfa' },
    ];
  }

  function emptyState() {
    return {
      accounts: [],
      records: [],
      categories: defaultCategories(),
      settings: { reminderDay: 25, createdAt: new Date().toISOString() },
    };
  }

  function normalizeState(state) {
    if (!state.categories || state.categories.length === 0) state.categories = defaultCategories();
    if (!state.settings) state.settings = { reminderDay: 25, createdAt: new Date().toISOString() };
    if (!state.accounts) state.accounts = [];
    if (!state.records) state.records = [];
    return state;
  }

  async function createVault(pin) {
    const salt = CryptoModule.randomBytes(16);
    const key = await CryptoModule.deriveKeyFromPin(pin, salt, true);
    const verify = await CryptoModule.encryptJson(key, VERIFY_PLAINTEXT);
    const state = emptyState();
    const data = await CryptoModule.encryptJson(key, state);
    const vault = { version: 1, salt: CryptoModule.b64encode(salt), verify, data, biometric: null };
    saveVault(vault);
    return { state, key };
  }

  async function unlockWithPin(pin) {
    const vault = loadVault();
    if (!vault) throw new Error('NO_VAULT');
    const salt = CryptoModule.b64decode(vault.salt);
    const key = await CryptoModule.deriveKeyFromPin(pin, salt, true);
    try {
      const check = await CryptoModule.decryptJson(key, vault.verify);
      if (!check || check.marker !== 'asset-tracker') throw new Error('BAD_PIN');
    } catch (e) {
      throw new Error('BAD_PIN');
    }
    const state = normalizeState(await CryptoModule.decryptJson(key, vault.data));
    return { state, key };
  }

  function isBiometricEnabled() {
    const vault = loadVault();
    return !!(vault && vault.biometric);
  }

  async function enableBiometric(key) {
    const reg = await CryptoModule.registerBiometric();
    if (!reg.prfSupported) {
      throw new Error('PRF_UNSUPPORTED');
    }
    const masterKeyBytes = await CryptoModule.exportKeyRaw(key);
    const wrappedKey = await CryptoModule.wrapMasterKey(masterKeyBytes, reg.prfKeyBytes);
    const vault = loadVault();
    vault.biometric = { credentialId: reg.credentialId, wrappedKey };
    saveVault(vault);
  }

  function disableBiometric() {
    const vault = loadVault();
    if (vault) {
      vault.biometric = null;
      saveVault(vault);
    }
  }

  async function unlockWithBiometric() {
    const vault = loadVault();
    if (!vault || !vault.biometric) throw new Error('NO_BIOMETRIC');
    const prfKeyBytes = await CryptoModule.getPrfSecret(vault.biometric.credentialId);
    const masterKeyBytes = await CryptoModule.unwrapMasterKey(vault.biometric.wrappedKey, prfKeyBytes);
    const key = await CryptoModule.importAesKey(masterKeyBytes, true);
    const state = normalizeState(await CryptoModule.decryptJson(key, vault.data));
    return { state, key };
  }

  async function saveState(key, state) {
    const vault = loadVault();
    vault.data = await CryptoModule.encryptJson(key, state);
    saveVault(vault);
  }

  async function changePin(currentKey, currentState, newPin) {
    const salt = CryptoModule.randomBytes(16);
    const newKey = await CryptoModule.deriveKeyFromPin(newPin, salt, true);
    const verify = await CryptoModule.encryptJson(newKey, VERIFY_PLAINTEXT);
    const data = await CryptoModule.encryptJson(newKey, currentState);
    const vault = { version: 1, salt: CryptoModule.b64encode(salt), verify, data, biometric: null };
    saveVault(vault);
    return newKey;
  }

  async function exportBackup() {
    const vault = loadVault();
    if (!vault) throw new Error('NO_VAULT');
    const { biometric, ...portable } = vault;
    return JSON.stringify(portable, null, 2);
  }

  async function importBackupReplace(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || !parsed.salt || !parsed.verify || !parsed.data) throw new Error('INVALID_BACKUP');
    const vault = { version: 1, salt: parsed.salt, verify: parsed.verify, data: parsed.data, biometric: null };
    saveVault(vault);
  }

  function wipeAll() {
    localStorage.removeItem(VAULT_KEY);
  }

  return {
    hasVault, createVault, unlockWithPin, saveState, changePin,
    isBiometricEnabled, enableBiometric, disableBiometric, unlockWithBiometric,
    exportBackup, importBackupReplace, wipeAll, emptyState,
  };
})();

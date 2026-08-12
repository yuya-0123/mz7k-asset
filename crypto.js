// 暗号まわり: PIN(パスコード)からAES-256-GCM鍵を導出し、全データをローカルで暗号化する。
// WebAuthnのPRF拡張が使える端末では、Face ID/Touch IDで鍵をラップ/アンラップして高速解除できる。

const CryptoModule = (() => {
  const PBKDF2_ITERATIONS = 250000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64encode(bytes) {
    let bin = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function b64decode(str) {
    const bin = atob(str);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function randomBytes(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return arr;
  }

  async function deriveKeyFromPin(pin, saltBytes, extractable = false) {
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJson(key, obj) {
    const iv = randomBytes(12);
    const plaintext = enc.encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return { iv: b64encode(iv), data: b64encode(cipher) };
  }

  async function decryptJson(key, payload) {
    const iv = b64decode(payload.iv);
    const data = b64decode(payload.data);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(dec.decode(plain));
  }

  async function encryptRaw(key, bytes) {
    const iv = randomBytes(12);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: b64encode(iv), data: b64encode(cipher) };
  }

  async function decryptRaw(key, payload) {
    const iv = b64decode(payload.iv);
    const data = b64decode(payload.data);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new Uint8Array(plain);
  }

  async function exportKeyRaw(key) {
    return new Uint8Array(await crypto.subtle.exportKey('raw', key));
  }
  async function importAesKey(bytes, extractable = false) {
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  }

  // --- WebAuthn PRF (Face ID / Touch ID) ---
  const PRF_SALT = enc.encode('asset-tracker-prf-v1');
  const RP_NAME = '資産トラッカー';

  function webauthnAvailable() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }

  async function platformAuthenticatorAvailable() {
    if (!webauthnAvailable()) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
      return false;
    }
  }

  async function registerBiometric() {
    const userId = randomBytes(16);
    const challenge = randomBytes(32);
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME },
        user: { id: userId, name: 'local-user', displayName: '資産トラッカー' },
        challenge,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
        extensions: { prf: {} },
        timeout: 60000,
      },
    });
    if (!cred) throw new Error('登録がキャンセルされました');
    const ext = cred.getClientExtensionResults();
    const prfSupported = !!(ext && ext.prf && ext.prf.enabled);
    if (!prfSupported) {
      return { credentialId: b64encode(new Uint8Array(cred.rawId)), prfSupported: false };
    }
    const prfKeyBytes = await getPrfSecret(cred.rawId);
    return { credentialId: b64encode(new Uint8Array(cred.rawId)), prfSupported: true, prfKeyBytes };
  }

  async function getPrfSecret(rawIdOrB64, existingChallenge) {
    const rawId = rawIdOrB64 instanceof ArrayBuffer ? rawIdOrB64 : b64decode(rawIdOrB64).buffer;
    const challenge = existingChallenge || randomBytes(32);
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: rawId, type: 'public-key' }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } },
        timeout: 60000,
      },
    });
    const ext = assertion.getClientExtensionResults();
    if (!ext || !ext.prf || !ext.prf.results || !ext.prf.results.first) {
      throw new Error('PRF結果を取得できませんでした');
    }
    const secret = new Uint8Array(ext.prf.results.first);
    // PRF出力(32byte程度)をAES-256鍵として使えるようSHA-256で正規化
    const hash = await crypto.subtle.digest('SHA-256', secret);
    return new Uint8Array(hash);
  }

  async function wrapMasterKey(masterKeyBytes, prfKeyBytes) {
    const wrapKey = await importAesKey(prfKeyBytes, false);
    return encryptRaw(wrapKey, masterKeyBytes);
  }

  async function unwrapMasterKey(wrappedPayload, prfKeyBytes) {
    const wrapKey = await importAesKey(prfKeyBytes, false);
    return decryptRaw(wrapKey, wrappedPayload);
  }

  return {
    randomBytes, b64encode, b64decode,
    deriveKeyFromPin, encryptJson, decryptJson, encryptRaw, decryptRaw,
    exportKeyRaw, importAesKey,
    webauthnAvailable, platformAuthenticatorAvailable,
    registerBiometric, getPrfSecret, wrapMasterKey, unwrapMasterKey,
  };
})();

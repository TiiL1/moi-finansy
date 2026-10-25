/* Мои финансы — облако: вход через Google и база Firestore (Firebase, бесплатный тариф Spark).
   Отдаёт интерфейсу хранилище с тем же устройством, что у базы страницы: doc(path), collection(path),
   get / set / delete / onSnapshot. Все документы лежат под users/<uid>/ — правила базы пускают туда только владельца. */
const V = '10.12.2';
const SDK = name => `https://www.gstatic.com/firebasejs/${V}/firebase-${name}.js`;
const cloud = window.__finCloud;
const gate = document.getElementById('gate');
const gateMsg = document.getElementById('gate-msg');
const gateBtn = document.getElementById('gate-btn');

function showGate(msg, btnText, onClick) {
  gate.hidden = false;
  gateMsg.textContent = msg || '';
  gateBtn.hidden = !btnText;
  if (btnText) { gateBtn.textContent = btnText; gateBtn.onclick = onClick; }
}
const hideGate = () => { gate.hidden = true; };

// Настройки базы лежат в firebase-config.txt рядом с сайтом. Туда можно вставить блок из консоли Firebase целиком,
// как есть: отсюда берутся только значения apiKey, authDomain, projectId и т. д.
const KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
function parseConfig(text) {
  const out = {};
  for (const k of KEYS) { const m = String(text).match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"'\\s]+)["']`)); if (m) out[k] = m[1]; }
  return out.apiKey && out.projectId && out.appId ? out : null;
}
async function loadConfig() {
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) return window.FIREBASE_CONFIG;
  try { const r = await fetch('firebase-config.txt', { cache: 'no-cache' }); return r.ok ? parseConfig(await r.text()) : null; }
  catch (e) { return null; }
}
let cfg = null, configured = false;

// Firestore отвечает своими кодами — переводим в те, что понимает интерфейс
const mapErr = e => ({ code: ({ 'permission-denied': 'invalid_argument', 'unauthenticated': 'invalid_argument', 'resource-exhausted': 'resource_exhausted',
  'unavailable': 'unavailable', 'deadline-exceeded': 'unavailable', 'invalid-argument': 'invalid_argument', 'cancelled': 'unavailable' })[e && e.code] || 'unavailable',
  message: String((e && e.message) || e) });

// Снимок «из копии на устройстве» и ответ сервера с теми же данными различаются только метаданными.
// Без этого флага ответ сервера для пустой коллекции не приходит, и страница ждала бы его вечно.
const META = { includeMetadataChanges: true };
function makeStore(fs, db, uid) {
  const base = `users/${uid}`;
  const wrap = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: s.metadata });
  // Запись сразу попадает в локальную копию базы; ждём ответа сервера, но без интернета не держим форму:
  // через пару секунд считаем записанным, а синхронизация пройдёт сама. Поздний отказ сервера показываем отдельно.
  const settle = p => new Promise((res, rej) => {
    let done = false;
    p.then(() => { if (!done) { done = true; res(); } }, e => { if (!done) { done = true; rej(mapErr(e)); } else cloud.lateError(mapErr(e)); });
    setTimeout(() => { if (!done) { done = true; res(); } }, navigator.onLine ? 6000 : 400);
  });
  const doc = p => {
    const ref = fs.doc(db, `${base}/${p}`);
    return {
      id: p.split('/').pop(), path: p,
      get: async () => { try { return wrap(await fs.getDoc(ref)); } catch (e) { throw mapErr(e); } },
      set: data => settle(fs.setDoc(ref, data)),
      delete: () => settle(fs.deleteDoc(ref)),
      onSnapshot: (next, err) => fs.onSnapshot(ref, META, s => next(wrap(s)), e => err && err(mapErr(e))),
    };
  };
  const collection = p => {
    const ref = fs.collection(db, `${base}/${p}`);
    return {
      path: p, doc: id => doc(`${p}/${id}`),
      onSnapshot: (next, err) => fs.onSnapshot(ref, META, q => next({ docs: q.docs.map(wrap), size: q.size, empty: q.empty, metadata: q.metadata }), e => err && err(mapErr(e))),
    };
  };
  return { doc, collection };
}

async function start() {
  cfg = await loadConfig();
  configured = !!cfg;
  if (!configured) {
    // Без настроек облака страница работает как раньше — данные только в этом браузере
    cloud.resolveDb(null);
    cloud.banner('Облако не подключено: данные сохраняются только в этом браузере. Вставьте настройки Firebase в файл firebase-config.txt (см. ИНСТРУКЦИЯ.md).');
    return;
  }
  let appMod, authMod, fs;
  try { [appMod, authMod, fs] = await Promise.all([import(SDK('app')), import(SDK('auth')), import(SDK('firestore'))]); }
  catch (e) { showGate('Не удалось загрузить облако. Проверьте интернет и обновите страницу.', 'Обновить', () => location.reload()); return; }
  const app = appMod.initializeApp(cfg);
  const auth = authMod.getAuth(app);
  let db;
  try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch (e) { db = fs.getFirestore(app); }   // браузер без IndexedDB — без офлайн-копии
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const signIn = async () => {
    gateBtn.disabled = true; gateMsg.textContent = 'Открываю окно входа Google…';
    try { await authMod.signInWithPopup(auth, provider); }
    catch (e) {
      const c = e && e.code;
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') { try { await authMod.signInWithRedirect(auth, provider); return; } catch (e2) { /* ниже покажем ошибку */ } }
      gateBtn.disabled = false;
      gateMsg.textContent = c === 'auth/unauthorized-domain' ? `Этот адрес (${location.hostname}) не добавлен в Firebase → Authentication → Settings → Authorized domains.`
        : c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' ? 'Окно входа закрыто. Нажмите ещё раз.'
        : `Не получилось войти: ${(e && e.message) || e}`;
    }
  };
  try { await authMod.getRedirectResult(auth); } catch (e) { /* вход через окно — результата перенаправления нет */ }
  let resolved = false;
  authMod.onAuthStateChanged(auth, user => {
    if (!user) {
      if (resolved) { location.reload(); return; }   // вышли из аккаунта — начинаем заново
      showGate('Войдите, чтобы открыть свои данные. Видеть и менять их можете только вы.', 'Войти через Google', signIn);
      gateBtn.disabled = false;
      return;
    }
    hideGate();
    if (resolved) return;
    resolved = true;
    cloud.account(user.email || user.displayName || 'аккаунт Google', () => authMod.signOut(auth));
    cloud.resolveDb(makeStore(fs, db, user.uid));
  });
}
start();

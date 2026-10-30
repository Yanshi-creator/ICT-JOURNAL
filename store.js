// Data layer. Two backends with the same interface:
//  - CloudStore: Firebase Auth + Firestore (real accounts, syncs across devices)
//  - DemoStore: in-memory sample data (?demo), no sign-in needed
//
// Firestore layout (v2):
//   users/{uid}                 profile, accounts, activeAccountId, settings, schemaVersion
//   users/{uid}/trades/{id}     one document per trade (no image)
//   users/{uid}/images/{id}     chart screenshot for that trade
//   users/{uid}/prep/{date}     pre-market prep for that day
//   users/{uid}/legacy/v1       untouched copy of the old single-document journal
//
// v1 kept everything in users/{uid}, which Firestore caps at 1 MB. That broke saving
// after a few dozen screenshots. Old journals are migrated automatically on first load.

import { firebaseConfig } from './firebase-config.js';
import { demoData, DEFAULT_CHECKLIST } from './demo.js';

export const DEFAULT_SETTINGS = {
  checklist: [...DEFAULT_CHECKLIST],
  maxTradesPerDay: 2,
  dailyLossLimit: null,
  instruments: ['NQ', 'MNQ', 'ES', 'MES'],
};

export const newAccount = (o = {}) => ({
  id: 'acc_' + Date.now().toString(36),
  name: 'My account', firm: 'Personal', type: 'Evaluation',
  startBal: 50000, targetBal: 53000, trailingLimit: 2000, ddType: 'trailing', trailLockAt: null,
  ...o,
});

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(message), { code: 'timeout' })), ms); })]).finally(() => clearTimeout(t));
}

function clean(obj) {
  // Firestore rejects undefined values.
  return JSON.parse(JSON.stringify(obj, (k, v) => (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null : v)));
}

/* ---------------- Cloud ---------------- */

class CloudStore {
  constructor() {
    firebase.initializeApp(firebaseConfig);
    this.auth = firebase.auth();
    this.db = firebase.firestore();
    // Offline cache is off: on some browsers it made the first load hang forever.
    this.kind = 'cloud';
    this.uid = null;
  }

  onAuth(cb) {
    this.auth.onAuthStateChanged((u) => { this.uid = u?.uid || null; cb(u ? { uid: u.uid, email: u.email, name: u.displayName } : null); });
  }
  signIn(email, pw) { return this.auth.signInWithEmailAndPassword(email, pw); }
  async signUp(email, pw, name) {
    const cred = await this.auth.createUserWithEmailAndPassword(email, pw);
    if (name) await cred.user.updateProfile({ displayName: name });
    return cred;
  }
  resetPassword(email) { return this.auth.sendPasswordResetEmail(email); }
  signOut() { return this.auth.signOut(); }

  user() { return this.db.collection('users').doc(this.uid); }

  async load(onProgress = () => {}) {
    const ref = this.user();
    const snap = await withTimeout(ref.get(), 20000, 'Firebase took too long to answer. Check your internet connection and reload.');
    let data = snap.exists ? snap.data() : null;

    if (data && (Array.isArray(data.trades) || data.preMarketLogs) && !(data.schemaVersion >= 2)) {
      onProgress('Upgrading your journal to the new storage format…');
      await this.migrate(data);
      data = (await ref.get()).data();
    }

    if (!data) {
      data = { accounts: [newAccount({ name: 'My first account' })], settings: { ...DEFAULT_SETTINGS }, schemaVersion: 2, createdAt: Date.now() };
      data.activeAccountId = data.accounts[0].id;
      await ref.set(clean(data));
    }

    const [tradesSnap, prepSnap] = await withTimeout(Promise.all([ref.collection('trades').get(), ref.collection('prep').get()]), 30000, 'Your trades took too long to load. Reload the page to try again.');
    const trades = tradesSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
    const prep = {};
    prepSnap.docs.forEach((d) => { prep[d.id] = d.data(); });
    const accounts = data.accounts?.length ? data.accounts : [newAccount()];
    return {
      accounts,
      activeAccountId: accounts.some((a) => a.id === data.activeAccountId) ? data.activeAccountId : accounts[0].id,
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
      profile: data.profile || {},
      trades, prep,
    };
  }

  async migrate(old) {
    const ref = this.user();
    // 1. Keep an untouched copy first, so nothing can be lost.
    await ref.collection('legacy').doc('v1').set(clean({ ...old, savedAt: Date.now() }));

    // 2. Fan out trades, images and prep into their own documents.
    const writes = [];
    for (const t of old.trades || []) {
      const { ChartImage, ...rest } = t;
      const id = String(t.id ?? newId());
      writes.push([ref.collection('trades').doc(id), clean({ ...rest, id, hasImage: !!ChartImage })]);
      if (ChartImage) writes.push([ref.collection('images').doc(id), { data: ChartImage }]);
    }
    for (const [date, p] of Object.entries(old.preMarketLogs || {})) writes.push([ref.collection('prep').doc(date), clean(p)]);
    for (let i = 0; i < writes.length; i += 200) {
      const batch = this.db.batch();
      writes.slice(i, i + 200).forEach(([doc, val]) => batch.set(doc, val));
      await batch.commit();
    }

    // 3. Slim the main document down.
    const del = firebase.firestore.FieldValue.delete();
    const accounts = (old.accounts || []).map((a) => ({ ddType: 'trailing', trailLockAt: null, ...a }));
    await ref.set(clean({
      accounts: accounts.length ? accounts : [newAccount()],
      settings: { ...DEFAULT_SETTINGS, ...(old.settings || {}) },
      schemaVersion: 2, migratedAt: Date.now(),
    }), { merge: true });
    await ref.update({ trades: del, preMarketLogs: del });
  }

  saveMeta(patch) { return this.user().set(clean(patch), { merge: true }); }

  async saveTrade(trade, image) {
    const ref = this.user();
    const batch = this.db.batch();
    if (image === null) batch.delete(ref.collection('images').doc(trade.id));
    else if (image) batch.set(ref.collection('images').doc(trade.id), { data: image });
    batch.set(ref.collection('trades').doc(trade.id), clean(trade));
    return batch.commit();
  }

  async deleteTrades(ids) {
    const ref = this.user();
    for (let i = 0; i < ids.length; i += 200) {
      const batch = this.db.batch();
      ids.slice(i, i + 200).forEach((id) => { batch.delete(ref.collection('trades').doc(id)); batch.delete(ref.collection('images').doc(id)); });
      await batch.commit();
    }
  }

  async getImage(id) {
    const d = await this.user().collection('images').doc(id).get();
    return d.exists ? d.data().data : null;
  }

  savePrep(date, p) { return this.user().collection('prep').doc(date).set(clean(p)); }
}

/* ---------------- Demo ---------------- */

class DemoStore {
  constructor() { this.kind = 'demo'; this.images = {}; }
  onAuth(cb) { setTimeout(() => cb({ uid: 'demo', email: 'demo@example.com', name: 'Demo trader' }), 0); }
  signIn() { return Promise.resolve(); }
  signUp() { return Promise.resolve(); }
  resetPassword() { return Promise.resolve(); }
  signOut() { location.href = location.pathname; return Promise.resolve(); }
  async load() { return demoData(); }
  async saveMeta() {}
  async saveTrade(t, image) { if (image) this.images[t.id] = image; if (image === null) delete this.images[t.id]; }
  async deleteTrades() {}
  async getImage(id) { return this.images[id] || null; }
  async savePrep() {}
}

export function createStore() {
  const demo = new URLSearchParams(location.search).has('demo');
  if (demo) return new DemoStore();
  if (typeof firebase === 'undefined') return null; // sync service didn't load (offline on first visit, or blocked)
  return new CloudStore();
}

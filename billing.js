// Windage plans: 30-day free trial, then $7.99/month or $99.99 every 2 years.
// Payments run through Gumroad (product links + license keys). No server needed.
//
// ======== EDIT THESE AFTER YOU SET UP GUMROAD (see SETUP-PAYMENTS.md) ========
export const BILLING = {
  trialDays: 30,
  // checkout:  the product's link, e.g. 'https://windage.gumroad.com/l/monthly'
  // productId: shown in the License key box on the product's Content page in Gumroad
  plans: [
    { id: 'monthly', name: 'Monthly', price: '$7.99', per: 'per month', note: 'Cancel anytime', checkout: 'https://yanshi25.gumroad.com/l/windage-monthly', productId: 'Fta2paimxtBjvisEf45bEA==' },
    { id: 'twoyear', name: '2 Years', price: '$99.99', per: 'every 2 years', note: 'About half the price of monthly', checkout: 'https://yanshi25.gumroad.com/l/windage-2-year', productId: 'cRip8hidygbNeRo8XrtR_g==' },
  ],
  // Accounts that never see the paywall: your own, plus giveaway winners (free lifetime).
  // Stored as SHA-256 codes of the lowercase email so nobody can read the addresses here.
  // To add someone, ask Claude for the code of their email, or run in a terminal:
  //   printf '%s' 'their@email.com' | sha256sum
  freeForever: [
    '4620afb46e8a8b382137c205262ff5bcef4336799d847586a6d2869c0d0af5c5', // owner
  ],
  // Optional: your Google Apps Script license proxy URL (see license-proxy.gs). Only needed if
  // activating a key says it can't reach the payment service.
  proxyUrl: '',
};
// ===========================================================================

const DAY = 86400000;
// Trials count from when the login was created (set by Google, so it can't be edited).
// Accounts made before plans launched start their 30 days on launch day instead.
const LAUNCH_AT = Date.UTC(2026, 10, 20);  // 20 Nov 2026
// Accounts created from this moment start their free month on Gumroad, with a card (Gumroad's 1-month free trial).
// Accounts made before it keep the card-free 30-day trial they were promised.
export const CARD_TRIAL_FROM = Date.UTC(2026, 10, 20, 20, 45);  // 20 Nov 2026, 3:45pm Toronto
const OFFLINE_GRACE = 10 * DAY;  // a paid key keeps working offline this long after the last good check
const VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

export const paymentsReady = () => BILLING.plans.some((p) => p.checkout && p.productId);

/** SHA-256 hex of the lowercase, trimmed email. */
export async function emailCode(email) {
  const data = new TextEncoder().encode(String(email || '').trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Works out where an account stands.
 * billing: { licenseKey, productId, lastValidAt, revoked }   createdAt: when the login was created (ms)
 * Returns { state: 'owner' | 'paid' | 'trial' | 'expired' | 'start', daysLeft, endsAt }
 * 'start' = new account that still has to start its free trial on Gumroad (card required).
 */
export function billingStatus(billing = {}, code = '', now = Date.now(), createdAt = 0) {
  if (code && BILLING.freeForever.includes(code)) return { state: 'owner', daysLeft: Infinity };
  const checked = Number(billing.lastValidAt) || 0;
  if (billing.licenseKey && !billing.revoked && checked <= now + DAY && now - checked < OFFLINE_GRACE) return { state: 'paid', daysLeft: Infinity };
  if (!(Number(createdAt) > 0) || Number(createdAt) >= CARD_TRIAL_FROM) return { state: 'start', daysLeft: 0 };
  const start = Math.max(Number(createdAt), LAUNCH_AT);
  const endsAt = start + BILLING.trialDays * DAY;
  const daysLeft = Math.max(0, Math.ceil((endsAt - now) / DAY));
  return { state: daysLeft > 0 ? 'trial' : 'expired', daysLeft, endsAt };
}

// Paid keys are checked with Gumroad every time the app opens, so a cancelled plan stops right away.
export const needsRecheck = (billing = {}) => !!billing.licenseKey && !billing.revoked;

// Asks Gumroad about a key; if the browser can't reach it (blocked request), retries through the proxy.
async function verify(productId, key, countUse) {
  const params = { product_id: productId, license_key: key, increment_uses_count: countUse ? 'true' : 'false' };
  const direct = () => fetch(VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const viaProxy = () => fetch(BILLING.proxyUrl, { method: 'POST', body: JSON.stringify(params) });
  let res;
  try { res = await direct(); } catch (e) {
    if (!BILLING.proxyUrl) throw Object.assign(new Error('Couldn’t reach the payment service. Check your internet and try again.'), { code: 'network' });
    res = await viaProxy();
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  // The Apps Script proxy always answers 200 and passes Gumroad's status inside.
  const status = data && typeof data._status === 'number' ? data._status : res.status;
  return { status, data: data && data._body !== undefined ? data._body : data };
}

// A purchase stops counting once it's refunded or disputed, or the membership has ended or failed to renew.
// A cancelled membership keeps working until the time they paid for runs out (Gumroad then sets ended_at).
function purchaseActive(p = {}) {
  if (p.refunded || p.disputed || p.chargebacked) return false;
  if (p.subscription_ended_at || p.subscription_failed_at) return false;
  return true;
}

/** Ties a license key to this Windage account. Returns { productId, planId } or throws a readable error. */
export async function activateLicense(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Paste the license key from your Gumroad receipt.');
  const plans = BILLING.plans.filter((p) => p.productId);
  if (!plans.length) throw new Error('Payments aren’t open yet.');
  let reached = false;
  for (const plan of plans) {
    // Look first without counting, so a key for the other plan isn't marked as used.
    const peek = await verify(plan.productId, k, false);
    if (peek.status === 404 || !peek.data?.success) { if (peek.status && peek.status < 500) reached = true; continue; }
    reached = true;
    if (!purchaseActive(peek.data.purchase)) throw new Error('This key isn’t active anymore (refunded or the plan ended). Buy a plan again to get a new key.');
    if ((peek.data.uses || 0) >= 1) throw new Error('This key is already in use on another Windage account. Each purchase works on one account. If that was you, email support@windagejournal.com.');
    await verify(plan.productId, k, true);  // mark it as used
    return { productId: plan.productId, planId: plan.id };
  }
  if (reached) throw new Error('We couldn’t find that key. Check you copied all of it from the Gumroad email.');
  throw new Error('The payment service had a problem. Try again in a minute.');
}

/** true = valid, false = definitely not valid (cancelled, refunded), null = couldn't check right now. */
export async function validateLicense(key, productId) {
  try {
    const ids = productId ? [productId] : BILLING.plans.map((p) => p.productId).filter(Boolean);
    let notFound = 0;
    for (const id of ids) {
      const { status, data } = await verify(id, key, false);
      if (status >= 200 && status < 300 && data?.success) return purchaseActive(data.purchase);
      if (status === 404) { notFound++; continue; }
      return null;
    }
    return ids.length && notFound === ids.length ? false : null;
  } catch (e) { return null; }
}

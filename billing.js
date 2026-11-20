// Windage plans: 30-day free trial, then $7.99/month or $99.99 lifetime.
// Payments run through Dodo Payments (checkout links + license keys). No server needed.
//
// ======== EDIT THESE AFTER YOU SET UP DODO (see SETUP-PAYMENTS.md) ========
export const BILLING = {
  trialDays: 30,
  plans: [
    { id: 'monthly', name: 'Monthly', price: '$7.99', per: 'per month', note: 'Cancel anytime', checkout: '' },
    { id: 'lifetime', name: 'Lifetime', price: '$99.99', per: 'one time', note: 'Pay once, yours forever', checkout: '' },
  ],
  // Accounts that never see the paywall (your own email, lowercase).
  freeForever: [],
  // 'live' for real payments, 'test' while you try it out with Dodo's test cards.
  mode: 'live',
  // Optional: your Google Apps Script license proxy URL (see license-proxy.gs). Only needed if
  // activating a key says it can't reach the payment service.
  proxyUrl: '',
};
// ===========================================================================

const DAY = 86400000;
const RECHECK_EVERY = 3 * DAY;   // re-check a paid key every 3 days
const OFFLINE_GRACE = 10 * DAY;  // keep working offline this long after the last good check
const api = () => `https://${BILLING.mode === 'test' ? 'test' : 'live'}.dodopayments.com`;

export const paymentsReady = () => BILLING.plans.some((p) => p.checkout);

/**
 * Works out where an account stands.
 * billing: { trialStart, licenseKey, instanceId, lastValidAt, revoked }
 * Returns { state: 'owner' | 'paid' | 'trial' | 'expired', daysLeft, endsAt }
 */
export function billingStatus(billing = {}, email = '', now = Date.now()) {
  if (BILLING.freeForever.map((x) => x.toLowerCase()).includes(String(email).toLowerCase())) return { state: 'owner', daysLeft: Infinity };
  if (billing.licenseKey && !billing.revoked && billing.lastValidAt && now - billing.lastValidAt < RECHECK_EVERY + OFFLINE_GRACE) return { state: 'paid', daysLeft: Infinity };
  const start = billing.trialStart || now;
  const endsAt = start + BILLING.trialDays * DAY;
  const daysLeft = Math.max(0, Math.ceil((endsAt - now) / DAY));
  return { state: daysLeft > 0 ? 'trial' : 'expired', daysLeft, endsAt };
}

export const needsRecheck = (billing = {}, now = Date.now()) => !!billing.licenseKey && !billing.revoked && (!billing.lastValidAt || now - billing.lastValidAt > RECHECK_EVERY);

// Calls Dodo directly; if the browser can't reach it (blocked request), retries through the proxy.
async function call(path, body) {
  const direct = () => fetch(api() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const viaProxy = () => fetch(BILLING.proxyUrl, { method: 'POST', body: JSON.stringify({ path, mode: BILLING.mode, body }) });
  let res;
  try { res = await direct(); } catch (e) {
    if (!BILLING.proxyUrl) throw Object.assign(new Error('Couldn’t reach the payment service. Check your internet and try again.'), { code: 'network' });
    res = await viaProxy();
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  // The Apps Script proxy always answers 200 and passes Dodo's status inside.
  const status = data && typeof data._status === 'number' ? data._status : res.status;
  return { status, data: data && data._body !== undefined ? data._body : data };
}

/** Ties a license key to this Windage account. Returns { instanceId } or throws a readable error. */
export async function activateLicense(key, accountLabel) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Paste the license key from your purchase email.');
  const { status, data } = await call('/licenses/activate', { license_key: k, name: String(accountLabel || 'Windage account').slice(0, 100) });
  if (status === 201 || status === 200) return { instanceId: data?.id || null };
  if (status === 422) throw new Error('This key is already in use on another Windage account. Each purchase works on one account.');
  if (status === 403) throw new Error('This key isn’t active. If your subscription ended, buy a plan again to get a new key.');
  if (status === 404) throw new Error('We couldn’t find that key. Check you copied all of it from the email.');
  throw new Error('The payment service had a problem. Try again in a minute.');
}

/** true = valid, false = definitely not valid (cancelled, refunded), null = couldn't check right now. */
export async function validateLicense(key, instanceId) {
  try {
    const { status, data } = await call('/licenses/validate', { license_key: key, ...(instanceId ? { license_key_instance_id: instanceId } : {}) });
    if (status >= 200 && status < 300 && data && typeof data.valid === 'boolean') return data.valid;
    if (status === 404 || status === 403) return false;
    return null;
  } catch (e) { return null; }
}

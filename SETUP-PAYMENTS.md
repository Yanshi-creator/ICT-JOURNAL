# Turning on payments for Windage

Windage gives every new account a 30-day free trial. After that it shows the plans: $7.99/month or $99.99 lifetime.
Payments go through **Dodo Payments**. It's free to sign up and charges a small fee per sale. It handles sales tax and VAT for you, and pays out to Canada or India.
Until you paste in the checkout links (step 4), nobody gets locked out. The app keeps working after 30 days because there's no way to pay yet.

## 1. Make yourself free forever (do this first)

In `billing.js`, put your own login email in `freeForever`:

```js
freeForever: ['your-email@example.com'],
```

## 2. Create your Dodo account

1. Sign up at dodopayments.com and complete the verification.
2. Stay in **Test mode** (the switch in the dashboard) while you set things up.

## 3. Create the two products

**Monthly**
- Type: Subscription. Price: $7.99 USD, billed every month.
- No trial on the Dodo side, because the 30 days happen inside Windage.
- Under **License keys**: turn them on. Activation limit: **1**. Expiry: **No expiration**. The key switches off by itself if they cancel.

**Lifetime**
- Type: One-time payment. Price: $99.99 USD.
- Under **License keys**: turn them on. Activation limit: **1**. Expiry: **No expiration**.

For both products, set the purchase email to include the license key. That's how buyers get it.

## 4. Paste the checkout links into Windage

For each product, copy its **payment link** (checkout URL) and paste it into `billing.js`:

```js
{ id: 'monthly',  ..., checkout: 'https://checkout.dodopayments.com/buy/…' },
{ id: 'lifetime', ..., checkout: 'https://checkout.dodopayments.com/buy/…' },
```

## 5. Test it, then go live

1. Set `mode: 'test'` in `billing.js` and upload the files.
2. Buy each plan with a Dodo test card, copy the key from the email, and paste it into Windage → Settings → Your plan → See plans → Activate.
3. If it says it **couldn't reach the payment service**, set up `license-proxy.gs` (steps inside that file) and paste its URL into `proxyUrl`.
4. When it works, switch Dodo to Live mode, replace the checkout links with the live ones, and set `mode: 'live'`. Upload again.

## How it works

- **Trial:** starts the first time someone opens this version. New sign-ups and existing users both get 30 days.
- **Paying:** the buyer pays on Dodo's page, gets a license key by email, and pastes it into Windage once. The key is tied to their account, so it works on their phone and computer but can't be shared.
- **Cancelling:** Dodo switches the key off. Windage re-checks every 3 days and locks again when it's off. Offline, they keep access for up to 10 days.
- **Locked accounts** can still open Settings to export or back up their data.

## Discount codes for your audience

Create these in Dodo, not in Windage: **Dashboard → Discounts → Create**.

- Pick a code people will remember, like `WINDAGE20` or `SNIPES`.
- Choose a percentage (for example 20%) and which products it applies to (monthly, lifetime, or both).
- Optional: an expiry date or a usage limit, so launch codes don't run forever.

Buyers type the code on Dodo's checkout page. Share it in your Discord and on Instagram.

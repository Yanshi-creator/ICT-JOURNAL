# Turning on payments for Windage (Gumroad)

Windage gives every new account a 30-day free trial. After that it shows the plans: $7.99/month or $99.99 every 2 years.
Payments go through **Gumroad**. It's free to start, and Gumroad keeps about 10% + $0.50 per sale. It handles sales tax and VAT, and pays out to a bank account in India (INR) or Canada (CAD).
Until both product links and product IDs are in `billing.js`, nobody gets locked out.

## 1. Create your Gumroad account
1. Sign up at gumroad.com with support@windagejournal.com (or your own email).
2. **Settings → Payments:** add your bank account (India or Canada) and fill in your tax details. Payouts start once you've earned $100.

## 2. Create the two products
**Products → New product**

**Monthly**: type **Membership**, name "Windage Monthly", price $7.99, billed **monthly**. No free trial on Gumroad (the 30 days happen inside Windage).
**2 Years**: type **Membership**, name "Windage 2-Year", price $99.99, billed **every 2 years**.

For each product:
1. Open the **Content** tab → **Insert → License key**. Gumroad now generates a key for every buyer.
2. The License key box shows the **product ID**. Copy it.
3. In the content, add: "Open windagejournal.com → Settings → Your plan → paste this key → Activate."
4. **Publish**, then copy the product link (e.g. `https://yourname.gumroad.com/l/windage-monthly`).

## 3. Paste them into Windage (`billing.js`)
```js
{ id: 'monthly',  ..., checkout: 'https://…gumroad.com/l/…', productId: '…' },
{ id: 'twoyear', ..., checkout: 'https://…gumroad.com/l/…', productId: '…' },
```
Or just send both links and IDs to Claude.

## 4. Test it
Make a 100%-off discount code in Gumroad (**Checkout → Discounts**), "buy" each plan with it, and activate the key in Windage. Delete the code afterwards.
If activation says it **couldn't reach the payment service**, set up `license-proxy.gs` (steps in that file) and paste its URL into `proxyUrl`.

## How it works
- **Paying:** buyer pays on Gumroad, gets a license key on the receipt, pastes it into Windage once. A key works on one Windage account only (Windage marks it used), but that account works on every device.
- **Cancelling:** buyers cancel in their Gumroad library. Windage checks the key every time it opens and locks once the membership has ended (after the paid time runs out), failed to renew, or was refunded. Offline, access lasts up to 10 days.
- **Locked accounts** can still open Settings to export or back up their data.
- **Someone moved accounts?** Their key already counts as used. The quickest fix is to send them a 100%-off code for a new key (or ask Claude to reset the old key's use count through Gumroad's API).

## Discount codes for your audience
Gumroad → **Checkout → Discounts → New discount**. Pick a code (e.g. `WINDAGE20`), a percentage, which products it covers, and optionally a limit or end date. Share it in Discord and on Instagram.

# Sniping Journal

An ICT trading journal for prop-firm futures traders. Log trades, track your drawdown line, and let the built-in coach show you which sessions, setups and habits are making or losing you money.

Live: https://yanshi-creator.github.io/ICT-JOURNAL/
Demo with sample trades: https://yanshi-creator.github.io/ICT-JOURNAL/?demo

## What's in it

- **Dashboard**: account ladder (liquidation line, balance, target), key stats, balance chart with the liquidation line, P&L calendar with weekly totals, daily guardrail warnings.
- **Trade log**: entry/stop/exit/partials with live R and P&L estimate, checklist grading, mistake tags, emotions, screenshots (paste, drop or pick from your phone). Trades can be edited.
- **Coach**: ranks your money leaks, "what if" scenarios, edge finder, discipline score, week-over-week review, breakdowns by 13 dimensions, rule-by-rule checklist impact. No paid AI; it all runs in the browser.
- **Pre-market prep** with a "does prep pay?" comparison.
- **Multiple accounts** with trailing, end-of-day or static drawdown and an optional trailing lock (Apex style).
- **Installable** on phone and desktop, works offline.
- Excel export, JSON backup and restore.

## One-time Firebase setup

The app uses the existing Firebase project `journal-6f593`.

1. **Firestore rules (required, since other people will sign up).** Firebase console → Firestore Database → Rules. Replace everything with the contents of [`firestore.rules`](firestore.rules) and click **Publish**. This makes sure each trader can only see their own journal.
2. **Sign-in method.** Authentication → Sign-in method → Email/Password should be **Enabled** (it already is if you've been logging in).
3. **Authorized domains.** Authentication → Settings → Authorized domains should include `yanshi-creator.github.io`. Add any custom domain you use later.
4. **Password reset emails** work out of the box. You can edit the email text under Authentication → Templates.

## Upgrading from v1

The first time an existing user signs in, their journal is moved to the new storage layout automatically:

- v1 kept every trade and screenshot in one Firestore document, which has a hard 1 MB limit. Saving silently failed once a journal got big.
- v2 stores each trade, screenshot and prep day as its own document.
- An untouched copy of the old document is kept at `users/{uid}/legacy/v1`.

## Files

```
index.html            app shell
css/app.css           styles
js/app.js             UI and views
js/stats.js           all the math (R, drawdown, breakdowns)
js/coach.js           turns the math into coaching
js/store.js           Firebase storage + migration
js/demo.js            sample data for ?demo
js/firebase-config.js Firebase project keys (public by design)
sw.js, manifest.webmanifest, icons/   installable app
firestore.rules       paste into Firebase console
```

No build step. Edit a file, commit, and GitHub Pages serves it.

# EMILGO — regulatory risk review

**What this is.** An engineering-level map of where this app's features sit
against Nigerian payments regulation, written so a lawyer can be pointed at
specific files instead of the whole codebase. **It is not legal advice, and I am
not a lawyer.** Before launch a Nigerian fintech lawyer has to sign off on §2 and
§3 — that is a few hours of their time and it is the cheapest thing in this
document.

Reviewed against the codebase on **2026-08-21**.

---

## 0. The question you asked, answered first

> *"Does labelling money as `cs` instead of ₦ stop EMILGO being treated as a
> wallet that needs a CBN licence?"*

**On its own, no. Do not rely on it.**

Regulators assess **substance over form**. What decides whether something is
e-money is not the glyph on the screen — it is whether the app holds a balance
that is a **claim on you, redeemable for cash**. A naira balance renamed `cs` is
still a naira balance. If it were ever examined, a rename sitting on top of an
unchanged redeemable balance reads as concealment, which is a worse position than
where you started.

**But the change underneath it works, and you should make it.**

The reason `cs` is worth doing is that it forces the honest version:

| | Before | After |
| --- | --- | --- |
| What the reward balance is | naira you hold for the user | points, in no currency |
| Can it be withdrawn to a bank? | the design pointed that way | **no — by construction** |
| Can it be sent to another user for cash? | gifting would have made it so | **no — in-app spend only** |
| Fixed conversion to fiat? | **`coinsToNaira(c) = c * 0.7`** ← the worst line in the repo | **deleted** |

Once the balance genuinely cannot become cash, it is a **loyalty / rebate
programme** — the same legal shape as airline miles or supermarket points — and
calling it `cs` is then simply accurate rather than evasive.

**Verdict: apply `cs` to the reward layer, and keep real currency on real
payments.** Hiding the amount at a real checkout would not help you with the CBN
— it is a merchant payment either way — and it would actively hurt you: it breaks
bank reconciliation, it contradicts the Paystack sheet (which renders its own
currency and cannot be restyled), and it runs into Apple's and Google's rules
requiring the price a user is about to be charged to be shown plainly.

---

## 1. What actually triggers a CBN licence

Three questions. Any "yes" puts you on the licensed side of the line.

1. **Do you hold customer funds?** — a float: money that is theirs, sitting with
   you.
2. **Do you issue stored value redeemable for cash?**
3. **Do you move money between two other parties on your own account?**

Under the CBN's *New Licence Categorisation for the Nigerian Payments System*,
only a **Mobile Money Operator** may hold customer funds, and that category
carries **₦2bn** in shareholders' funds. **PSSP** is ₦100m and is explicitly
**not permitted to hold customer funds**. You have said you cannot fund a
licence, so the only viable posture is: **answer "no" to all three, by
construction, and be able to show it.**

A marketplace can answer "no" to all three, and EMILGO is a marketplace. The
mechanism is **payment at source**:

> The passenger pays the **driver**, through a licensed processor, in one
> transaction that the processor splits. EMILGO's commission is a **split leg**,
> not a payout EMILGO makes. EMILGO never receives the driver's money and
> therefore never holds it.

This is how ride-hailing and delivery marketplaces operate here without an MMO
licence. Paystack Subaccounts + Transaction Split is exactly this product, and
`src/services/paystack.ts` is already shaped for it (`STATION_SHARE_PERCENT` /
`COMPANY_SHARE_PERCENT`, `station_subaccount`).

**The one thing that must never happen:** collecting the full fare into EMILGO's
own Paystack balance and paying drivers out later. That is a float. Same money,
same UI, completely different licence.

---

## 2. Findings, by feature

Severity is regulatory exposure, not whether the code works.

### 🔴 2.1 `coinsToNaira()` — a published fixed redemption rate

`src/utils/helpers.ts:236` — `coins * 0.7`, rendered to users as `≈ ₦{n}` in
`app/(driver)/index.tsx:54`, `app/(driver)/history.tsx:80`,
`app/(main)/profile.tsx:1231` and `app/(park-owner)/index.tsx:225`.

A fixed, advertised conversion rate from an in-app unit to fiat is close to the
cleanest possible evidence that the unit **is** stored value. It also creates a
consumer expectation of redemption, which is its own problem under the CBN
*Consumer Protection Framework* even if nobody ever redeems.

**Action: delete the function and every "≈ ₦" rendering.** Coins are shown as
`cs` and compared to nothing.

### 🔴 2.2 The passenger pool is described, and behaves, as naira you hold

`src/store/usePoolStore.ts` — its own header says *"The passenger's **money
pool** — real Naira"*. A per-user balance, held by EMILGO, spent to pay a third
party (the driver) and to pay EMILGO's own commission.

The mitigating fact is real and worth keeping in writing: **the user never pays
into it.** It is funded only from EMILGO's advertising revenue, which makes it a
**merchant-funded rebate** rather than a deposit — much closer to a discount
voucher than to a wallet.

That defence survives only if all three of these hold, permanently:

1. it can never be withdrawn to a bank account,
2. it can never be transferred to another person for cash,
3. it can never be refunded in cash — including on account closure.

**Action:** the pool is re-denominated in `cs`, the code stops calling it naira,
and the three rules are enforced in the database rather than in the UI. A
discount applied to a fare is a **price reduction EMILGO grants**, which is why
the fare screen may still show a real price: the user is being charged less, not
spending a balance.

### 🔴 2.3 Credit gifting is P2P value transfer

"Gift your in-app credit to a driver" is, if the credit is redeemable,
**person-to-person money transmission** — question 3 in §1, and the fastest route
to reclassification.

**Action:** gifting moves **`cs` only**, and `cs` is spendable only on in-app
benefits (a driver's fuel benefit at a partner station, a commission waiver). No
cash leg exists at any point. Transfers are recorded, capped per day, and
reversible by support.

### 🟠 2.4 Driver rewards paid to a bank account

`app/(driver)/payout-bank.tsx`, `app/program.tsx` step 5. Fare **settlements** to
a driver's account are fine — that is the driver's own revenue, split at source.

**"Free-fuel / free-ride rewards" paid as cash into that same account are not the
same thing.** That is EMILGO disbursing value it issued: the payout half of a
wallet.

**Action:** driver rewards become **fuel credit redeemed at a partner station**,
where EMILGO pays *the station* as an ordinary supplier. The driver receives
fuel, not money. Same commercial effect, different legal object.

### 🟠 2.5 `constants/devFlags.ts` — `ALLOW_UNVERIFIED_PAYOUT_ACCOUNT = true`

Settling to an account whose name was never matched against the account holder is
an AML control failure under the **Money Laundering (Prevention and Prohibition)
Act 2022**, and it is how mule accounts get paid.

**Action: must be `false` before any real money moves.** Already in STATUS.md §4;
repeated here because this is the file a reviewer will read.

### 🟠 2.6 Identity hashing is not fit for BVN/NIN

`src/services/kyc.ts:20` — `IDENTITY_SALT` is a **constant committed to the
repo**, and the hash is **FNV-1a**: non-cryptographic, 32-bit. That space is
exhaustively searchable in seconds, so `nin_hash` / `bvn_hash` are reversible in
practice by anyone holding the repo.

BVN handling sits under the CBN/NIBSS BVN framework and NIN under NIMC rules;
both are personal data under the **Nigeria Data Protection Act 2023**.

**Action:** salt from a server-side secret and move to SHA-256 — or better, stop
storing a derived identifier at all and keep only the verification *result* from
the KYC provider. Needs the server secret to exist first.

### 🟠 2.7 Emergency contacts process non-users' personal data

You are about to store third parties' names and phone numbers, verify them, and
send them a person's live location. Those people never installed the app and
never agreed to anything. Under the **NDPA 2023** you need a lawful basis; the
practical one is the contact's own consent, captured at verification.

**Action:** a contact is **inactive until they confirm**. The verification
message states who added them and what they will receive, and every message
carries a working opt-out. Nothing is sent to an unverified contact. No bulk
phonebook upload — the user picks individual contacts and only those leave the
device.

### 🟡 2.8 Barter cash amounts

`app/barter/[offerId].tsx` lets two users agree a **cash** top-up alongside a
swap. EMILGO never touches that money, which keeps it outside §1 — but the app is
facilitating a private financial arrangement and currently says nothing about
whose risk it is.

**Action:** a one-line disclaimer at agreement time — cash is settled directly
between the two parties, EMILGO is not a party to it and does not hold it.

### 🟡 2.9 Ad rewards are a deliberate loss

SETUP-KEYS §4.6 — payouts lose ₦5–7 per ad watched, as a growth subsidy. A
commercial decision, not a regulatory one. Listed only so nobody later mistakes
it for a revenue share owed to users. `cs` having no cash value is what stops it
ever becoming one.

### 🟢 2.10 Fare, checkout, premium subscription

Marketplace payments through a licensed processor. **Keep the real currency
visible on these screens.** This is the part of the app where showing the true
amount is a requirement, not a risk.

---

## 3. The rule the codebase now enforces

> **Real currency appears only where a bank moves money.**
> **`cs` appears everywhere value is earned, granted or gifted inside the app.**
> **There is no conversion between them, in either direction, anywhere.**

| Screen | Unit | Why |
| --- | --- | --- |
| Pay fare, checkout, receipts, transactions | user's real currency | a bank is moving this; it must reconcile |
| Driver settlement / payout bank | user's real currency | the driver's own revenue |
| Premium subscription | user's real currency | a real charge |
| Rewards hub, ad earnings | `cs` | granted, never bought |
| Passenger pool, general pool | `cs` | merchant-funded rebate |
| Credit gifting | `cs` | never redeemable, so never a transfer of money |
| Driver fuel benefit | `cs` → litres at a partner station | EMILGO pays the station, not the driver |

**Multi-currency.** Because the app has to work outside Nigeria, real amounts
render in the **user's own currency** (`src/services/currency.ts`) rather than a
hard-coded `₦`. This also strengthens §0: `cs` is not "naira with a different
name" if the app has no single national currency to begin with.

---

## 4. Before you launch

| # | Item | Owner |
| --- | --- | --- |
| 1 | Nigerian fintech lawyer signs off on §2 and §3 | you |
| 2 | Confirm with Paystack that the account is set up for **split at source**, not collect-then-payout | you |
| 3 | `ALLOW_UNVERIFIED_PAYOUT_ACCOUNT = false` | code — one line |
| 4 | Terms of Service stating `cs` has **no cash value**, is non-transferable outside the app, non-refundable, and may expire | you + lawyer |
| 5 | NDPA privacy notice covering emergency contacts (third-party data) | you + lawyer |
| 6 | Move `IDENTITY_SALT` server-side, switch to SHA-256 | code — needs a server secret |
| 7 | Never sell `cs`. The moment a user can buy it, it is Apple IAP **and** it starts to look like stored value again | product decision, forever |

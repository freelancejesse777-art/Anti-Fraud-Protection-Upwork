# Postcheck — full deployment guide (real payments)

This is a genuinely functional payment stack, not a demo: Stripe hosts
the actual checkout and charges the card, a serverless webhook
verifies that with Stripe's cryptographic signature, and a Supabase
table is the one source of truth for who's paid for what. I tested
the webhook's signature verification and error handling locally
(valid signatures pass, forged/invalid ones are rejected with a 400)
before handing this to you, but I could not test against your live
Stripe/Supabase accounts, obviously — that only becomes fully live
once you plug in your own keys below.

**Nobody can process real payments without your own Stripe account.**
That's not a limitation of this code, it's how payment processing
works — the money has to land in an account that's legally yours.

## What's in this folder

```
index.html, pricing.html, checkout.html, dashboard.html, 404.html
assets/css/style.css, assets/js/app.js       Frontend
api/stripe-webhook.js                         Verifies Stripe payments, writes to DB
api/account-status.js                         Dashboard reads real plan from DB
api/session-status.js                         Resolves post-checkout redirect to an email
supabase-schema.sql                           The one database table this needs
package.json                                  Dependencies for the API functions (stripe, @supabase/supabase-js)
```

## Step 1 — Stripe: create products and prices

1. Create a Stripe account (or use an existing one) at stripe.com
2. Dashboard → Product catalog → **Add product**
   - "Postcheck Pro" — recurring price, $8.00/month
   - "Postcheck Team" — recurring price, $16.00/month
3. Copy each price's ID (looks like `price_1AbC...`) — you'll need
   these in Step 4.

## Step 2 — Stripe: create Payment Links

1. Dashboard → **Payment Links** → Create link, one for each price
   from Step 1
2. Under "After payment," choose **Redirect customers to your
   website**, and set the URL to:
   `https://YOUR-DOMAIN/dashboard.html?session_id={CHECKOUT_SESSION_ID}`
   (Stripe substitutes the real session ID automatically — type the
   `{CHECKOUT_SESSION_ID}` part literally)
3. Copy each Payment Link URL (looks like `https://buy.stripe.com/...`)

## Step 3 — Wire the Payment Links into the frontend

Open `assets/js/app.js`, find `POSTCHECK_STRIPE_LINKS`, and replace
the two placeholder URLs with the real ones from Step 2.

## Step 4 — Supabase: create the database

1. Create a free project at supabase.com
2. Project → SQL Editor → paste the contents of `supabase-schema.sql`
   → Run
3. Project → Settings → API — copy the **Project URL** and the
   **service_role key** (not the `anon` key — the service role key is
   what lets the webhook write to the table, and it must never be
   exposed in frontend code, only in server-side env vars)

## Step 5 — Deploy the API functions (Vercel)

This repo's `api/` folder is written in Vercel's serverless function
format, which needs zero config to deploy:

1. Push this whole folder to a GitHub repo
2. Go to vercel.com → **Add New Project** → import that repo → Deploy
   (Vercel auto-detects the `api/` folder and `package.json`)
3. Once deployed, go to the project's **Settings → Environment
   Variables** and add:
   - `STRIPE_SECRET_KEY` — from Stripe Dashboard → Developers → API keys
   - `STRIPE_WEBHOOK_SECRET` — you'll get this in Step 6
   - `SUPABASE_URL` — from Step 4
   - `SUPABASE_SERVICE_ROLE_KEY` — from Step 4
4. Redeploy after adding env vars (Vercel → Deployments → ⋯ →
   Redeploy) so the functions pick them up

Your site is now live at `https://your-project.vercel.app` — this
also serves your static pages, so this replaces GitHub Pages as the
host (you can still keep GitHub for source control, just deploy via
Vercel instead of Pages, since Pages can't run serverless functions).

## Step 6 — Connect the Stripe webhook

1. Stripe Dashboard → Developers → **Webhooks** → Add endpoint
2. Endpoint URL: `https://your-project.vercel.app/api/stripe-webhook`
3. Events to send: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`
4. After creating it, Stripe shows a **signing secret**
   (`whsec_...`) — copy that into the `STRIPE_WEBHOOK_SECRET` env var
   from Step 5, then redeploy

## Step 7 — Map your Price IDs

Open `api/stripe-webhook.js`, find `PRICE_TO_PLAN`, and replace the
two placeholder keys with the real price IDs you copied in Step 1.
Redeploy.

## Step 8 — Test it for real

Stripe gives you test-mode card numbers that don't charge real money
while you're still using test API keys (`sk_test_...`):
`4242 4242 4242 4242`, any future expiry, any CVC. Full list:
https://docs.stripe.com/testing

1. Go through checkout on your live-deployed site using a test card
2. Confirm you land on `dashboard.html` and it shows your real plan
   (this means the webhook fired, Supabase got written to, and the
   dashboard read it back correctly — the whole loop)
3. In Stripe Dashboard → Webhooks → your endpoint, you can see a log
   of every event and whether your server responded 200 — useful for
   debugging if something doesn't show up
4. Once everything works with test keys, swap in your live
   (`sk_live_...`) Stripe key and repeat Steps 1–2 in live mode to get
   live Payment Links, and you're actually taking real payments

## Known limitations, stated plainly

- **No real user authentication.** `dashboard.html` looks up a plan by
  email alone — anyone who knows a customer's email could type it in
  and see their plan status. Fine for an MVP, not fine long-term.
  Adding Supabase Auth (magic-link email login) is the natural next
  step and it's a small addition on top of what's already here.
- **The Chrome extension doesn't check this backend yet.** Paying on
  the website doesn't currently unlock anything inside the actual
  extension — the extension still only tracks its own local 5/day
  free-tier limit. Wiring `background.js` in the extension to call
  `/api/account-status` on startup is the remaining piece to make
  paid features actually functional inside the product itself, not
  just visible on the dashboard.
- **Team seats beyond the included 5 aren't self-serve.** The pricing
  page mentions $6/extra seat, but there's no billing logic for that
  yet — it would need a Stripe "quantity" on the subscription item
  plus a small UI to adjust it.

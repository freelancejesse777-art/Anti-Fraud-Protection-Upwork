/**
 * POST /api/stripe-webhook
 * -------------------------------------------------
 * This is the one piece of the whole system that actually confirms
 * money changed hands. Stripe calls this URL directly (server to
 * server) whenever a checkout completes or a subscription changes —
 * the browser is never trusted to say "I paid," because a browser can
 * lie. We verify Stripe's cryptographic signature on every request
 * before trusting anything in the payload.
 *
 * Deploy target: Vercel serverless function (Node runtime).
 * Required env vars (set in Vercel project settings):
 *   STRIPE_SECRET_KEY        sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    whsec_...  (from Stripe's webhook config screen)
 *   SUPABASE_URL             https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service_role key (NOT the anon key — this
 *                                needs write access and must never be
 *                                exposed to the browser)
 */

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Map your actual Stripe Price IDs to Postcheck plan names.
// Fill these in with the Price IDs you create in the Stripe Dashboard
// (Product catalog -> Add product -> copy the price_... id).
const PRICE_TO_PLAN = {
  "price_1TySaRFkgCyXaPrsjFA7Na3z": "pro",
  "price_1TySH7FkgCyXaPrseVBnRkiz": "team",
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    // req.body must be the RAW request body for signature verification
    // to work. Vercel gives you this via the raw body buffer when the
    // function config below disables the default body parser.
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err.message);
    res.status(400).json({ error: "invalid_signature" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        const customerId = session.customer;

        // Fetch the subscription to know which price (= which plan) was purchased.
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || "free";

        await postcheckUpsertAccount({
          email,
          plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          status: "active",
        });
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || "free";
        const isActive = ["active", "trialing"].includes(subscription.status);

        await postcheckUpsertAccountByCustomerId(subscription.customer, {
          plan: isActive ? plan : "free",
          stripe_subscription_id: subscription.id,
          status: subscription.status,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        await postcheckUpsertAccountByCustomerId(subscription.customer, {
          plan: "free",
          status: "canceled",
        });
        break;
      }

      default:
        // Unhandled event types are fine to ignore — Stripe sends many
        // events this app doesn't need to react to.
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // Return 500 so Stripe retries — this only fires on unexpected
    // errors (e.g. Supabase down), not on bad input.
    res.status(500).json({ error: "internal_error" });
  }
};

// Vercel-specific: disable automatic body parsing so we can access the
// raw request body, which Stripe's signature check requires.
module.exports.config = {
  api: { bodyParser: false },
};

async function postcheckUpsertAccount({ email, plan, stripe_customer_id, stripe_subscription_id, status }) {
  const { error } = await supabase
    .from("accounts")
    .upsert(
      { email, plan, stripe_customer_id, stripe_subscription_id, status, updated_at: new Date().toISOString() },
      { onConflict: "email" }
    );
  if (error) throw error;
}

async function postcheckUpsertAccountByCustomerId(customerId, fields) {
  const { error } = await supabase
    .from("accounts")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("stripe_customer_id", customerId);
  if (error) throw error;
}

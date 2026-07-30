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

let stripe, supabase, initError = null;
try {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY env var");
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("Missing STRIPE_WEBHOOK_SECRET env var");
  if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL env var");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} catch (e) {
  initError = e.message;
}

/**
 * With bodyParser disabled, Vercel does NOT automatically populate req.body
 * with the raw bytes — it just hands you the raw readable stream. Stripe's
 * signature check needs the exact original bytes, so we have to manually
 * read the stream into a Buffer ourselves before verifying. Skipping this
 * step (passing the unbuffered req.body directly) is what was causing
 * every single delivery to fail with "invalid_signature."
 */
async function postcheckBufferRequest(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Map your actual Stripe Price IDs to Postcheck plan names.
// Fill these in with the Price IDs you create in the Stripe Dashboard
// (Product catalog -> Add product -> copy the price_... id).
const PRICE_TO_PLAN = {
  "price_1TySaRFkgCyXaPrsjFA7Na3z": "pro",
  "price_1TySH7FkgCyXaPrseVBnRkiz": "team",
};

/**
 * With NODEJS_HELPERS=0 set (required to get the real raw request body
 * for Stripe's signature check — see postcheckBufferRequest above),
 * Vercel's res.status()/res.json() convenience methods are ALSO gone,
 * not just the body-parsing helper. This is the plain Node.js
 * equivalent of res.status(code).json(data).
 */
function postcheckSendJSON(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  if (initError) {
    console.error("[stripe-webhook] init error:", initError);
    postcheckSendJSON(res, 500, { error: "config_error", detail: initError });
    return;
  }

  if (req.method !== "POST") {
    postcheckSendJSON(res, 405, { error: "method_not_allowed" });
    return;
  }

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await postcheckBufferRequest(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err.message);
    postcheckSendJSON(res, 400, { error: "invalid_signature" });
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

    postcheckSendJSON(res, 200, { received: true });
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // Return 500 so Stripe retries — this only fires on unexpected
    // errors (e.g. Supabase down), not on bad input.
    postcheckSendJSON(res, 500, { error: "internal_error" });
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


/**
 * GET /api/session-status?session_id=cs_test_...
 * -------------------------------------------------
 * After Stripe's hosted checkout completes, it redirects the browser
 * back to dashboard.html?session_id={CHECKOUT_SESSION_ID}. This
 * endpoint takes that session id and asks Stripe directly who paid,
 * so the dashboard can look up the right account without asking the
 * person to type their email in again.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 */

const Stripe = require("stripe");
let stripe, initError = null;
try {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY env var");
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
} catch (e) {
  initError = e.message;
}

/**
 * With NODEJS_HELPERS=0 set, Vercel's res.status()/res.json()
 * convenience methods are gone, not just the body-parsing helper.
 * This is the plain Node.js equivalent of res.status(code).json(data).
 */
function postcheckSendJSON(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  if (initError) {
    postcheckSendJSON(res, 500, { error: "config_error", detail: initError });
    return;
  }

  if (req.method !== "GET") {
    postcheckSendJSON(res, 405, { error: "method_not_allowed" });
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    postcheckSendJSON(res, 400, { error: "missing_session_id" });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const email = session.customer_details?.email || session.customer_email || null;
    postcheckSendJSON(res, 200, { email, paymentStatus: session.payment_status });
  } catch (err) {
    console.error("[session-status] stripe error:", err.message);
    postcheckSendJSON(res, 400, { error: "invalid_session" });
  }
};

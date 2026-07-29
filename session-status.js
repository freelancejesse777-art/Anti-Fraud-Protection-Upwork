/**
 * GET /api/session-status?session_id=cs_test_...
 * -------------------------------------------------
 * After Stripe's hosted checkout completes, it redirects the browser
 * back to dashboard.html?session_id={CHECKOUT_SESSION_ID} (you set
 * that redirect URL in the Stripe Payment Link settings). This
 * endpoint takes that session id and asks Stripe directly who paid,
 * so the dashboard can look up the right account without asking the
 * person to type their email in again.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 */

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const sessionId = req.query.session_id;
  if (!sessionId) {
    res.status(400).json({ error: "missing_session_id" });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const email = session.customer_details?.email || session.customer_email || null;
    res.status(200).json({ email, paymentStatus: session.payment_status });
  } catch (err) {
    console.error("[session-status] stripe error:", err.message);
    res.status(400).json({ error: "invalid_session" });
  }
};

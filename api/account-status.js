
/**
 * GET /api/account-status?email=someone@example.com
 * -------------------------------------------------
 * Returns the real, paid-for plan for an email address, as last
 * confirmed by Stripe via the webhook. This is what makes the
 * dashboard trustworthy — it's reading a row that only Stripe's
 * server-to-server webhook is allowed to write (see stripe-webhook.js),
 * not something the browser set itself.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Note on auth: this endpoint currently trusts whatever email is
 * passed in the query string, which is fine for an MVP demo but is
 * NOT real authentication — anyone who knows a customer's email could
 * query their plan. Before shipping for real, put this behind actual
 * auth (Supabase Auth magic links are the fastest fit here) so a user
 * can only ever query their own email. Flagging this clearly rather
 * than quietly shipping it as if it were secure.
 */

const { createClient } = require("@supabase/supabase-js");

let supabase;
let initError = null;
try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} catch (e) {
  initError = e.message;
}

module.exports = async (req, res) => {
  if (initError) {
    res.status(500).json({ error: "config_error", detail: initError });
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const email = (req.query.email || "").trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "missing_email" });
    return;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("email, plan, status, updated_at")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("[account-status] supabase error:", error);
    res.status(500).json({ error: "internal_error" });
    return;
  }

  if (!data) {
    res.status(200).json({ email, plan: "free", status: "none" });
    return;
  }

  res.status(200).json(data);
};

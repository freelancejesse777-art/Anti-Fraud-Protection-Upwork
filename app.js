/**
 * Postcheck site — shared account logic
 * -------------------------------------------------
 * Real backend calls, not localStorage fakery. Plan status is fetched
 * from /api/account-status, which reads a database row that only
 * Stripe's own signed webhook is allowed to write (see
 * api/stripe-webhook.js) — so what's shown here reflects an actual
 * payment, not something the browser claimed about itself.
 *
 * The one thing still kept in localStorage is *which email to look up*
 * on repeat visits — that's a convenience, not an auth mechanism. See
 * the "Important" note in api/account-status.js: this MVP does not
 * have real login/auth, so don't treat this as production-secure until
 * that's added.
 */

const POSTCHECK_EMAIL_KEY = "postcheck_email";

const POSTCHECK_PLANS = {
  free: { name: "Free", price: 0, seats: 1, dailyScanLimit: 5 },
  pro: { name: "Pro", price: 8, seats: 1, dailyScanLimit: null },
  team: { name: "Team", price: 16, seats: 5, dailyScanLimit: null },
};

// Fill these in with the real Payment Links you create in the Stripe
// Dashboard (Payment Links -> Create link, one per price). No code
// needed on Stripe's side for this part.
const POSTCHECK_STRIPE_LINKS = {
  pro: "https://buy.stripe.com/REPLACE_WITH_YOUR_PRO_PAYMENT_LINK",
  team: "https://buy.stripe.com/REPLACE_WITH_YOUR_TEAM_PAYMENT_LINK",
};

function postcheckGetStoredEmail() {
  try {
    return localStorage.getItem(POSTCHECK_EMAIL_KEY);
  } catch (e) {
    return null;
  }
}

function postcheckSetStoredEmail(email) {
  try {
    localStorage.setItem(POSTCHECK_EMAIL_KEY, email);
  } catch (e) {
    /* ignore */
  }
}

function postcheckLogout() {
  try {
    localStorage.removeItem(POSTCHECK_EMAIL_KEY);
  } catch (e) {
    /* ignore */
  }
}

/**
 * Fetches the REAL plan for an email from the backend. Returns
 * { email, plan, status, updated_at } or null on network failure.
 */
async function postcheckFetchAccountStatus(email) {
  try {
    const res = await fetch(`/api/account-status?email=${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("[postcheck] account-status fetch failed:", e);
    return null;
  }
}

/**
 * After Stripe redirects back post-payment with ?session_id=..., this
 * resolves that session to the email that just paid.
 */
async function postcheckResolveSession(sessionId) {
  try {
    const res = await fetch(`/api/session-status?session_id=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("[postcheck] session-status fetch failed:", e);
    return null;
  }
}

function postcheckHighlightNav() {
  const path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("nav .navlinks a[data-page]").forEach((link) => {
    if (link.dataset.page === path) link.classList.add("active");
  });
}

document.addEventListener("DOMContentLoaded", postcheckHighlightNav);

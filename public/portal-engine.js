// ============================================================
// Net Studio — Customer Portal Engine (Shared)
// Put this in: /public/portal-engine.js
// customer-portal.html must load it with: <script type="module" src="./portal-engine.js"></script>
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ── CONFIG ──
const CONFIG = {
  URL: "https://jdvdgvolfmvlgyfklbwe.supabase.co",
  KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmRndm9sZm12bGd5ZmtsYndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Mjk5MDgsImV4cCI6MjA3OTEwNTkwOH0.xiAOgWof9En3jbCpY1vrYpj3HD-O6jMHbamIHTSflek",
  REDIRECT_URL: null,
};

// ── STATE ──
const state = {
  businessId: null,
  customerId: null,
  supabase: createClient(CONFIG.URL, CONFIG.KEY),
};

// ── DOM REFS ──
const els = {
  overlay: document.getElementById("nsdLoadingOverlay"),
  authView: document.getElementById("nsdAuthView"),
  apptsView: document.getElementById("nsdAppointmentsView"),
  authMsg: document.getElementById("nsdAuthStatusMsg"),
  forms: {
    signin: document.getElementById("nsdSignInForm"),
    signup: document.getElementById("nsdSignUpForm"),
  },
  list: document.getElementById("nsdAppointmentsList"),
  noAppts: document.getElementById("nsdNoAppts"),
};

// ── UTILITIES ──
const Utils = {
  formatPhone: (str) => {
    const cleaned = String(str || "").replace(/\D/g, "");
    if (cleaned.length === 10) return `+1${cleaned}`;
    if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
    return null;
  },

  showError: (msg) => {
    if (!els.authMsg) return;
    els.authMsg.textContent = msg || "Error";
    els.authMsg.classList.remove("success");
    els.authMsg.style.color = "var(--error)";
  },

  showSuccess: (msg) => {
    if (!els.authMsg) return;
    els.authMsg.textContent = msg || "";
    els.authMsg.classList.add("success");
    els.authMsg.style.color = "var(--success)";
  },

  toggleLoading: (isLoading) => {
    if (!els.overlay) return;
    els.overlay.style.opacity = isLoading ? "1" : "0";
    els.overlay.style.pointerEvents = isLoading ? "all" : "none";
  },

  secureEdgeFetch: async (functionName, payload) => {
    const { data: sessionData } = await state.supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session?.access_token) throw new Error("No active session. Please sign in.");

    const url = `${CONFIG.URL}/functions/v1/${functionName}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload || {}),
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      throw new Error(data?.error || data?.message || `Edge error ${res.status}`);
    }
    return data;
  },
};

// ── BUSINESS RESOLUTION ──
// We match your booking redirect:
// /customer-portal.html?business_id=...
function resolveBusinessIdFromUrlOrCache() {
  const qs = new URLSearchParams(location.search);
  const bid = (qs.get("business_id") || "").trim();
  if (bid) {
    try { localStorage.setItem("ns_business_id", bid); } catch {}
    return bid;
  }
  try {
    const cached = (localStorage.getItem("ns_business_id") || "").trim();
    if (cached) return cached;
  } catch {}
  return null;
}

async function resolveBusinessId() {
  // 1) direct
  const direct = resolveBusinessIdFromUrlOrCache();
  if (direct) {
    state.businessId = direct;
    return direct;
  }

  // 2) fallback: custom domain lookup
  const host = location.hostname.toLowerCase();
  const { data, error } = await state.supabase
    .from("business")
    .select("id")
    .eq("custom_domain", host)
    .maybeSingle();

  if (!error && data?.id) {
    state.businessId = data.id;
    return data.id;
  }

  return null;
}

// ── CUSTOMER ──
async function ensureCustomer(user) {
  if (state.customerId) return state.customerId;

  const meta = user?.user_metadata || {};
  const data = await Utils.secureEdgeFetch("ensure_customer_for_portal", {
    email: user.email,
    business_id: state.businessId,
    full_name: meta.full_name || "",
    phone: meta.phone || "",
    sms_opt_in: !!meta.sms_opt_in,
    email_opt_in: null,
    sms_consent_text: meta.sms_consent_text || null,
  });

  state.customerId = data.customer_id;
  return state.customerId;
}

async function fetchCustomerPrefs() {
  const { data, error } = await state.supabase
    .from("customers")
    .select("id, notify_sms_enabled, notify_email_enabled, phone_e164, sms_consent_at, sms_consent_text, user_id")
    .eq("id", state.customerId)
    .eq("business_id", state.businessId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function saveCustomerPrefs(patch) {
  const { error } = await state.supabase
    .from("customers")
    .update(patch)
    .eq("id", state.customerId)
    .eq("business_id", state.businessId);

  if (error) throw error;
}

// ── DASHBOARD ──
function renderAppointments(appts) {
  if (!els.list) return;
  els.list.innerHTML = "";

  if (!appts || appts.length === 0) {
    if (els.noAppts) els.noAppts.style.display = "block";
    return;
  }
  if (els.noAppts) els.noAppts.style.display = "none";

  appts.forEach((a) => {
    const d = new Date(a.start_at);
    const card = document.createElement("div");
    card.className = "nsd-appt-card";
    card.dataset.bookingId = a.id;

    const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeLabel = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const serviceName = a.team_member_menu_items?.name || "Service";
    const status = a.status || "booked";

    card.innerHTML = `
      <h3 style="font-size:15px; margin-bottom:6px;">${dateLabel} @ ${timeLabel}</h3>
      <p style="opacity:0.7; font-size:13px; margin-bottom:12px;">
        <span class="status ${status}">${status}</span> ${serviceName}
      </p>
      <div style="display:flex; gap:10px;">
        <button class="btn-tertiary js-resched" style="flex:1;" type="button">Reschedule</button>
        <button class="btn-tertiary js-cancel btn-action-cancel" style="flex:1;" type="button">Cancel</button>
      </div>
      <div class="js-row-msg" style="margin-top:10px; font-size:12px; font-weight:600; min-height:18px;"></div>
    `;
    els.list.appendChild(card);
  });
}

async function loadDashboard() {
  Utils.toggleLoading(true);

  const { data: sessionData } = await state.supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session) {
    Utils.toggleLoading(false);
    return;
  }

  try {
    const prefs = await fetchCustomerPrefs();
    // If you have prefs UI in your HTML, keep it. If not, no problem.
    if (!prefs) {
      // not fatal
    }

    const { data: appts, error: apptError } = await state.supabase
      .from("bookings")
      .select("id, status, start_at, team_member_menu_items(name)")
      .eq("customer_id", state.customerId)
      .eq("business_id", state.businessId)
      .gte("start_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("start_at");

    if (apptError) throw apptError;

    renderAppointments(appts);

    if (els.authView) els.authView.style.display = "none";
    if (els.apptsView) els.apptsView.style.display = "block";
    document.body.classList.add("mode-dashboard");
  } catch (err) {
    console.error(err);
    Utils.showError("Failed to load dashboard. Please sign in again.");
    await state.supabase.auth.signOut();
    if (els.authView) els.authView.style.display = "block";
    if (els.apptsView) els.apptsView.style.display = "none";
    document.body.classList.remove("mode-dashboard");
  } finally {
    Utils.toggleLoading(false);
  }
}

// ── AUTH ──
async function handleSignIn(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  const fd = new FormData(e.target);

  btn.disabled = true;
  btn.textContent = "Signing In...";

  try {
    const { data, error } = await state.supabase.auth.signInWithPassword({
      email: String(fd.get("email") || "").trim(),
      password: String(fd.get("password") || ""),
    });
    if (error) throw error;

    await ensureCustomer(data.user);
    await loadDashboard();
  } catch (err) {
    Utils.showError(err.message);
    btn.disabled = false;
    btn.textContent = "Sign In";
    const { data: s } = await state.supabase.auth.getSession();
    if (s?.session) await state.supabase.auth.signOut();
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  const fd = new FormData(e.target);

  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  const confirm = String(fd.get("confirm") || "");
  const fullName = String(fd.get("fullName") || "").trim();
  const phone = Utils.formatPhone(fd.get("phone"));

  if (password !== confirm) return Utils.showError("Passwords do not match");
  if (!phone) return Utils.showError("Please enter a valid US mobile number");

  btn.disabled = true;
  btn.textContent = "Creating Account...";

  try {
    const smsOptIn = !!document.getElementById("nsdSmsConsent")?.checked;
    const consentText =
      "I agree to receive SMS texts related to my account and bookings. Msg & data rates may apply. Reply STOP to opt out.";
    const redirectUrl = CONFIG.REDIRECT_URL || `${location.origin}/verified`;

    const { error } = await state.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          sms_opt_in: smsOptIn,
          sms_consent_text: smsOptIn ? consentText : null,
        },
        emailRedirectTo: redirectUrl,
      },
    });
    if (error) throw error;

    Utils.showSuccess("Check your email to verify your account.");
  } catch (err) {
    Utils.showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
}

// ── INIT ──
(async function init() {
  Utils.toggleLoading(true);

  const bId = await resolveBusinessId();
  if (!bId) {
    Utils.toggleLoading(false);
    Utils.showError("Business not found. Missing business_id.");
    return;
  }

  CONFIG.REDIRECT_URL = `${location.origin}/verified`;

  if (els.forms.signin) els.forms.signin.addEventListener("submit", handleSignIn);
  if (els.forms.signup) els.forms.signup.addEventListener("submit", handleSignUp);

  document.querySelectorAll(".nsd-sign-out-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      Utils.toggleLoading(true);
      await state.supabase.auth.signOut();
      location.reload();
    })
  );

  state.supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      if (els.authView) els.authView.style.display = "block";
      if (els.apptsView) els.apptsView.style.display = "none";
      document.body.classList.remove("mode-dashboard");
    }
  });

  const { data: sessionData } = await state.supabase.auth.getSession();
  const session = sessionData?.session;

  if (session) {
    try {
      await ensureCustomer(session.user);
      await loadDashboard();
    } catch {
      await state.supabase.auth.signOut();
      if (els.authView) els.authView.style.display = "block";
      Utils.toggleLoading(false);
    }
  } else {
    if (els.authView) els.authView.style.display = "block";
    if (els.apptsView) els.apptsView.style.display = "none";
    Utils.toggleLoading(false);
  }
})();
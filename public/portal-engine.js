// ============================================================
// Net Studio — Customer Portal Engine (Shared)
// Put this in: /public/portal-engine.js
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ── CONFIG ──
const CONFIG = {
  URL: "https://jdvdgvolfmvlgyfklbwe.supabase.co",
  KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmRndm9sZm12bGd5ZmtsYndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Mjk5MDgsImV4cCI6MjA3OTEwNTkwOH0.xiAOgWof9En3jbCpY1vrYpj3HD-O6jMHbamIHTSflek",
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
  tabNav: document.getElementById("nsdTabNav"),
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
    if (!session?.access_token) throw new Error("No active session.");

    const res = await fetch(`${CONFIG.URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload || {}),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || data?.message || "Function error");
    return data;
  },
};

// ── BUSINESS RESOLUTION ──
function resolveBusinessIdFromUrlOrCache() {
  const qs = new URLSearchParams(location.search);
  const bid = (qs.get("business_id") || "").trim();
  if (bid) {
    try { localStorage.setItem("ns_business_id", bid); } catch {}
    return bid;
  }
  try {
    return (localStorage.getItem("ns_business_id") || "").trim();
  } catch { return null; }
}

async function resolveBusinessId() {
  const direct = resolveBusinessIdFromUrlOrCache();
  if (direct) {
    state.businessId = direct;
    return direct;
  }
  const host = location.hostname.toLowerCase();
  const { data } = await state.supabase
    .from("business")
    .select("id")
    .eq("custom_domain", host)
    .maybeSingle();

  if (data?.id) {
    state.businessId = data.id;
    return data.id;
  }
  return null;
}

// ── CUSTOMER ──
async function ensureCustomer(user) {
  if (state.customerId) return state.customerId;
  const meta = user?.user_metadata || {};
  
  // This edge function links auth.users.id to public.customers.auth_user_id
  const data = await Utils.secureEdgeFetch("ensure_customer_for_portal", {
    email: user.email,
    business_id: state.businessId || meta.business_id,
    full_name: meta.full_name || "",
    phone: meta.phone || "",
    sms_opt_in: !!meta.sms_opt_in,
    sms_consent_text: meta.sms_consent_text || null,
  });
  
  state.customerId = data.customer_id;
  return state.customerId;
}

// ── DASHBOARD ──
function renderAppointments(appts) {
  if (!els.list) return;
  els.list.innerHTML = "";
  if (!appts?.length) {
    if (els.noAppts) els.noAppts.style.display = "block";
    return;
  }
  if (els.noAppts) els.noAppts.style.display = "none";

  appts.forEach((a) => {
    const d = new Date(a.start_at);
    const card = document.createElement("div");
    card.className = "nsd-appt-card";
    const serviceName = a.team_member_menu_items?.name || "Service";
    const status = a.status || "booked";

    card.innerHTML = `
      <h3 style="font-size:15px; margin-bottom:6px;">${d.toLocaleDateString()} @ ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</h3>
      <p style="opacity:0.7; font-size:13px; margin-bottom:12px;"><span class="status ${status}">${status}</span> ${serviceName}</p>
      <div style="display:flex; gap:10px;">
        <button class="btn-tertiary js-resched" style="flex:1;">Reschedule</button>
        <button class="btn-tertiary js-cancel btn-action-cancel" style="flex:1;">Cancel</button>
      </div>
    `;
    els.list.appendChild(card);
  });
}

async function loadDashboard() {
  Utils.toggleLoading(true);
  try {
    const { data: appts, error } = await state.supabase
      .from("bookings")
      .select("id, status, start_at, team_member_menu_items(name)")
      .eq("customer_id", state.customerId)
      .eq("business_id", state.businessId)
      .gte("start_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("start_at");

    if (error) throw error;
    renderAppointments(appts);
    if (els.authView) els.authView.style.display = "none";
    if (els.apptsView) els.apptsView.style.display = "block";
    document.body.classList.add("mode-dashboard");
  } catch (err) {
    Utils.showError("Failed to load dashboard.");
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
      email: fd.get("email").trim(),
      password: fd.get("password"),
    });
    if (error) throw error;
    await ensureCustomer(data.user);
    await loadDashboard();
  } catch (err) {
    Utils.showError(err.message);
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  const fd = new FormData(e.target);
  const phone = Utils.formatPhone(fd.get("phone"));
  
  if (fd.get("password") !== fd.get("confirm")) return Utils.showError("Passwords do not match");
  if (!phone) return Utils.showError("Valid US mobile required");

  btn.disabled = true;
  btn.textContent = "Creating Account...";
  
  try {
    // Dynamic redirect with .html extension
    const redirectUrl = `${location.origin}/verified.html?next=/customer-portal.html&business_id=${state.businessId}`;
    
    const { error } = await state.supabase.auth.signUp({
      email: fd.get("email").trim(),
      password: fd.get("password"),
      options: {
        data: {
          role: "customer", // 👈 Prevents trigger from running "Create Business" logic
          business_id: state.businessId, // 👈 Passed to ensure_customer_for_portal via metadata
          full_name: fd.get("fullName"),
          phone,
          sms_opt_in: !!document.getElementById("nsdSmsConsent")?.checked,
          sms_consent_text: "I agree to receive SMS texts related to my account and bookings.",
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
    Utils.showError("Business context missing.");
    return;
  }

  if (els.tabNav) {
    els.tabNav.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn?.dataset.tab) return;
      els.tabNav.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll("[data-tab-content]").forEach(p => p.classList.remove("active"));
      document.querySelector(`[data-tab-content="${btn.dataset.tab}"]`)?.classList.add("active");
    });
  }

  if (els.forms.signin) els.forms.signin.addEventListener("submit", handleSignIn);
  if (els.forms.signup) els.forms.signup.addEventListener("submit", handleSignUp);

  const { data: { session } } = await state.supabase.auth.getSession();
  if (session) {
    try {
      await ensureCustomer(session.user);
      await loadDashboard();
    } catch {
      await state.supabase.auth.signOut();
    }
  } else {
    if (els.authView) els.authView.style.display = "block";
  }
  Utils.toggleLoading(false);
})();

// ============================================================
//  Net Studio — Customer Portal Engine (Shared)
//  All 5 template portals import this same JS module.
//  Business ID resolves from URL slug, not hardcoded.
// ============================================================

import { createClient } from “https://esm.sh/@supabase/supabase-js@2.39.3”;

// ── CONFIG ──
const CONFIG = {
URL: “https://jdvdgvolfmvlgyfklbwe.supabase.co”,
KEY: “eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmRndm9sZm12bGd5ZmtsYndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Mjk5MDgsImV4cCI6MjA3OTEwNTkwOH0.xiAOgWof9En3jbCpY1vrYpj3HD-O6jMHbamIHTSflek”,
REDIRECT_URL: null // Set dynamically per business
};

// ── SLUG RESOLUTION ──
function nsGetSlugFromHost() {
const qp = new URLSearchParams(location.search).get(“b”);
if (qp) return qp.toLowerCase();
const host = location.hostname.toLowerCase();
if (host.endsWith(”.netstudio.app”)) return host.split(”.”)[0];
// Custom domain: resolve via Cloudflare Worker / business lookup
return null;
}

// ── STATE ──
const state = {
businessId: null,
customerId: null,
slug: nsGetSlugFromHost(),
supabase: createClient(CONFIG.URL, CONFIG.KEY)
};

// ── DOM REFS ──
const els = {
overlay: document.getElementById(“nsdLoadingOverlay”),
authView: document.getElementById(“nsdAuthView”),
apptsView: document.getElementById(“nsdAppointmentsView”),
authMsg: document.getElementById(“nsdAuthStatusMsg”),
forms: {
signin: document.getElementById(“nsdSignInForm”),
signup: document.getElementById(“nsdSignUpForm”)
},
list: document.getElementById(“nsdAppointmentsList”)
};

// ── UTILITIES ──
const Utils = {
formatPhone: (str) => {
const cleaned = (str || “”).replace(/\D/g, “”);
if (cleaned.length === 10) return `+1${cleaned}`;
if (cleaned.length === 11 && cleaned.startsWith(“1”)) return `+${cleaned}`;
return null;
},

showError: (msg) => {
els.authMsg.textContent = msg;
els.authMsg.classList.remove(“success”);
els.authMsg.style.color = “var(–error)”;
},

toggleLoading: (isLoading) => {
els.overlay.style.opacity = isLoading ? “1” : “0”;
els.overlay.style.pointerEvents = isLoading ? “all” : “none”;
},

secureEdgeFetch: async (functionName, payload) => {
const { data: { session } } = await state.supabase.auth.getSession();
if (!session?.access_token) throw new Error(“No active session. Please sign in.”);

```
const url = `${CONFIG.URL}/functions/v1/${functionName}`;
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": CONFIG.KEY,
    "Authorization": `Bearer ${session.access_token}`,
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = { raw: text }; }
if (!res.ok) throw new Error(data?.error || data?.message || `Edge error ${res.status}`);
return data;
```

}
};

// ── DOMAIN HELPERS ──
function isAnyBarber(value) { return String(value || “”) === “any”; }
function slotToIso(slot) {
if (!slot) return null;
if (typeof slot === “string”) return slot;
return slot.start_at || slot.iso || slot.start || null;
}
function slotToBarberId(slot) {
if (!slot || typeof slot !== “object”) return null;
return slot.team_member_id || slot.barber_id || null;
}

async function fetchStoreServices() {
const { data, error } = await state.supabase
.from(“menu_items”).select(“id, name”)
.eq(“business_id”, state.businessId).eq(“is_active”, true);
if (error) throw error;
return (data || []).map(s => ({ id: s.id, name: s.name || “Service” }));
}

async function fetchBarberServices(barberId) {
const { data, error } = await state.supabase
.from(“team_member_menu_items”).select(“id, name”)
.eq(“business_id”, state.businessId).eq(“team_member_id”, barberId);
if (error) throw error;
return (data || []).map(s => ({ id: s.id, name: s.name || “Service” }));
}

// ── RESOLVE BUSINESS ID FROM SLUG OR CUSTOM DOMAIN ──
async function resolveBusinessId() {
// 1) Try slug param
if (state.slug) {
const { data, error } = await state.supabase
.from(“business”).select(“id”).eq(“slug”, state.slug).maybeSingle();
if (data?.id) { state.businessId = data.id; return data.id; }
}

// 2) Try custom domain lookup
const host = location.hostname.toLowerCase();
const { data, error } = await state.supabase
.from(“business”).select(“id”).eq(“custom_domain”, host).maybeSingle();
if (data?.id) { state.businessId = data.id; return data.id; }

return null;
}

// ── CUSTOMER ──
async function ensureCustomer(user) {
if (state.customerId) return state.customerId;
const meta = user.user_metadata || {};

const data = await Utils.secureEdgeFetch(“ensure_customer_for_portal”, {
email: user.email,
business_id: state.businessId,
full_name: meta.full_name || “”,
phone: meta.phone || “”,
sms_opt_in: !!meta.sms_opt_in,
email_opt_in: null,
sms_consent_text: meta.sms_consent_text || null
});

state.customerId = data.customer_id;
return state.customerId;
}

async function fetchCustomerPrefs() {
let { data } = await state.supabase
.from(“customers”)
.select(“id, notify_sms_enabled, notify_email_enabled, phone_e164, sms_consent_at, sms_consent_text, user_id”)
.eq(“id”, state.customerId).eq(“business_id”, state.businessId).maybeSingle();
return data || null;
}

async function saveCustomerPrefs(patch) {
const { error } = await state.supabase
.from(“customers”).update(patch)
.eq(“id”, state.customerId).eq(“business_id”, state.businessId);
if (error) throw error;
}

// ── DASHBOARD ──
async function loadDashboard() {
Utils.toggleLoading(true);
const { data: { session } } = await state.supabase.auth.getSession();
if (!session) { Utils.toggleLoading(false); return; }

try {
const prefs = await fetchCustomerPrefs();
setupPreferencesUI(prefs);

```
const { data: appts, error: apptError } = await state.supabase
  .from("bookings")
  .select("id, status, start_at, team_member_menu_items(name)")
  .eq("customer_id", state.customerId).eq("business_id", state.businessId)
  .gte("start_at", new Date().toISOString())
  .neq("status", "cancelled").order("start_at");

if (apptError) throw apptError;
renderAppointments(appts);

els.authView.style.display = 'none';
els.apptsView.style.display = 'block';
document.body.classList.add('mode-dashboard');
```

} catch (err) {
console.error(err);
Utils.showError(“Failed to load dashboard. Please sign in again.”);
await state.supabase.auth.signOut();
els.authView.style.display = ‘block’;
} finally { Utils.toggleLoading(false); }
}

// ── PREFERENCES UI ──
function setupPreferencesUI(prefs) {
const emailToggle = document.getElementById(“nsdEmailToggle”);
const smsToggle = document.getElementById(“nsdSmsToggle”);
const phoneInput = document.getElementById(“nsdPhoneInput”);
const reWrap = document.getElementById(“nsdReconsentWrap”);
const reBox = document.getElementById(“nsdReconsent”);
const msg = document.getElementById(“nsdPrefsMsg”);
const saveBtn = document.getElementById(“nsdPrefsSave”);

const setMsg = (t, isErr) => { msg.textContent = t || “”; msg.style.color = isErr ? “var(–error)” : “var(–success)”; };

if (!prefs) { setMsg(“Preferences not found.”, true); saveBtn.disabled = true; return; }
if (prefs.id && prefs.id !== state.customerId) state.customerId = prefs.id;

const baseline = {
email: (prefs.notify_email_enabled !== false),
sms: (prefs.notify_sms_enabled === true),
phone: (prefs.phone_e164 || “”)
};

emailToggle.checked = baseline.email;
smsToggle.checked = baseline.sms;
phoneInput.value = baseline.phone;

let pending = { …baseline };
const consentText = “I agree to receive SMS texts related to my account and bookings. Msg & data rates may apply. Reply STOP to opt out.”;

const refreshDirty = () => {
const dirty = (pending.email !== baseline.email) || (pending.sms !== baseline.sms) || ((pending.phone || “”) !== (baseline.phone || “”));
saveBtn.disabled = !dirty;
if (dirty) setMsg(“Unsaved changes”, false); else setMsg(””, false);
};

const shouldShowReconsent = () => {
const phoneNext = Utils.formatPhone(phoneInput.value) || “”;
const phoneChanged = phoneNext && phoneNext !== baseline.phone;
const enablingSms = pending.sms === true;
const needsConsent = enablingSms && (phoneChanged || !baseline.sms || !prefs.sms_consent_at);
reWrap.style.display = needsConsent ? “block” : “none”;
};

emailToggle.onchange = () => { pending.email = !!emailToggle.checked; refreshDirty(); shouldShowReconsent(); };
smsToggle.onchange = () => { pending.sms = !!smsToggle.checked; refreshDirty(); shouldShowReconsent(); };
phoneInput.oninput = () => { pending.phone = Utils.formatPhone(phoneInput.value) || “”; refreshDirty(); shouldShowReconsent(); };

saveBtn.onclick = async () => {
pending.phone = Utils.formatPhone(phoneInput.value) || “”;
if (pending.sms === true) {
if (!pending.phone) { setMsg(“Enter a valid phone to enable SMS.”, true); return; }
if (reWrap.style.display !== “none” && !reBox.checked) { setMsg(“Please confirm SMS consent.”, true); return; }
}

```
saveBtn.disabled = true; saveBtn.textContent = "Saving..."; setMsg("Saving...", false);
try {
  const patch = {
    notify_email_enabled: pending.email,
    notify_sms_enabled: pending.sms,
    phone_e164: pending.phone || null
  };
  if (pending.sms === true && reWrap.style.display !== "none") {
    patch.sms_consent_text = consentText;
    patch.sms_consent_source = "customer_portal_prefs";
    patch.sms_consent_at = new Date().toISOString();
  }
  await saveCustomerPrefs(patch);
  baseline.email = pending.email; baseline.sms = pending.sms; baseline.phone = pending.phone || "";
  reBox.checked = false; shouldShowReconsent(); setMsg("Saved.", false);
  setTimeout(() => setMsg("", false), 2000);
} catch (e) {
  setMsg("Save failed.", true);
  emailToggle.checked = baseline.email; smsToggle.checked = baseline.sms; phoneInput.value = baseline.phone;
  pending = { ...baseline };
} finally { saveBtn.textContent = "Save"; refreshDirty(); }
```

};
shouldShowReconsent();
}

// ── RENDER APPOINTMENTS ──
function renderAppointments(appts) {
els.list.innerHTML = “”;
if (!appts || appts.length === 0) {
document.getElementById(“nsdNoAppts”).style.display = “block”;
} else {
document.getElementById(“nsdNoAppts”).style.display = “none”;
appts.forEach(a => {
const d = new Date(a.start_at);
const card = document.createElement(“div”);
card.className = “nsd-appt-card”;
card.dataset.bookingId = a.id;

```
  card.innerHTML = `
    <h3 style="font-size:15px; margin-bottom:6px;">${d.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})} @ ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</h3>
    <p style="opacity:0.7; font-size:13px; margin-bottom:12px;">
      <span class="status ${a.status}">${a.status}</span> ${a.team_member_menu_items?.name || "Service"}
    </p>
    <div style="display:flex; gap:10px;">
      <button class="btn-tertiary js-resched" style="flex:1;">Reschedule</button>
      <button class="btn-tertiary js-cancel btn-action-cancel" style="flex:1;">Cancel</button>
    </div>
    <div class="js-resched-row" style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08);">
      <label style="margin:0 0 6px 0; opacity:.7;">Choose barber</label>
      <select class="js-barber-select" style="width:100%; margin-bottom:12px;"><option value="">Loading...</option></select>
      <label style="margin:0 0 6px 0; opacity:.7;">Choose service</label>
      <select class="js-service-select" style="width:100%; margin-bottom:12px;"><option value="">Select barber first...</option></select>
      <label style="margin:0 0 6px 0; opacity:.7;">Select a day</label>
      <select class="js-day-select" style="width:100%; margin-bottom:12px;" disabled><option value="">Select barber + service first...</option></select>
      <div class="js-slots" style="display:none; margin-top:10px;"></div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button class="btn-tertiary js-resched-cancel" style="flex:1;">Cancel</button>
      </div>
      <div class="js-row-msg" style="margin-top:10px; font-size:12px; font-weight:600; min-height:18px;"></div>
    </div>
  `;
  els.list.appendChild(card);
});
```

}
}

function renderSlots(card, slots) {
const slotsWrap = card.querySelector(”.js-slots”);
const rowMsg = card.querySelector(”.js-row-msg”);
const setRowMsg = (t, isErr) => { rowMsg.textContent = t || “”; rowMsg.style.color = isErr ? “var(–error)” : “var(–success)”; };

slotsWrap.style.display = “none”;
slotsWrap.innerHTML = “”;
if (!slots || !slots.length) { setRowMsg(“No slots available on this day.”, true); return; }

setRowMsg(””, false);
slotsWrap.style.display = “block”;
slotsWrap.innerHTML = `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;"> ${slots.map((slot) => { const iso = slotToIso(slot); if (!iso) return ""; const barberId = slotToBarberId(slot) || ""; const d = new Date(iso); const label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); return`<button class="js-slot" data-iso="${iso}" data-barber-id="${barberId}" type="button" style="padding:10px; cursor:pointer;">${label}</button>`; }).join("")} </div> `;
}

async function searchDays(card, bookingId) {
const barberId = card.querySelector(”.js-barber-select”).value;
const serviceId = card.querySelector(”.js-service-select”).value;
const daySelect = card.querySelector(”.js-day-select”);
const rowMsg = card.querySelector(”.js-row-msg”);
const row = card.querySelector(”.js-resched-row”);
const slotsWrap = card.querySelector(”.js-slots”);
const setRowMsg = (t, isErr) => { rowMsg.textContent = t || “”; rowMsg.style.color = isErr ? “var(–error)” : “var(–success)”; };

if (!barberId || !serviceId) return;

daySelect.innerHTML = `<option value="">Searching next 30 days...</option>`;
daySelect.disabled = true;
slotsWrap.style.display = “none”;
setRowMsg(“Finding available days…”, false);

const fetchSlotsForDate = async (ymd) => {
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const payload = {
business_id: state.businessId, booking_id: bookingId, date: ymd,
time_zone: timeZone, menu_item_id: serviceId,
any_barber: isAnyBarber(barberId),
…(isAnyBarber(barberId) ? {} : { team_member_id: barberId }),
};
try {
const json = await Utils.secureEdgeFetch(“customer_available_slots”, payload);
return { ok: true, slots: (json.slots || []), error: null };
} catch (e) { return { ok: false, slots: [], error: e.message }; }
};

const found = [];
const start = new Date();
const batchSize = 5;
const daysToCheck = 30;
const dates = [];

for (let i = 0; i < daysToCheck; i++) {
const dt = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
dates.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
}

for (let i = 0; i < dates.length; i += batchSize) {
if (row.style.display === “none”) return;
if (found.length >= 10) break;
const batch = dates.slice(i, i + batchSize);
const results = await Promise.all(batch.map(async (ymd) => ({ ymd, …await fetchSlotsForDate(ymd) })));
results.forEach(res => { if (res.ok && res.slots.length) found.push({ ymd: res.ymd, count: res.slots.length, slots: res.slots }); });
}

if (row.style.display === “none”) return;
if (!found.length) { daySelect.innerHTML = `<option value="">No available days found</option>`; daySelect.disabled = true; setRowMsg(“No available days found.”, true); return; }

daySelect.innerHTML = found.map(d => {
const [y, m, da] = d.ymd.split(”-”).map(Number);
const label = new Date(y, m - 1, da).toLocaleDateString(“en-US”, { weekday: “short”, month: “short”, day: “numeric” });
return `<option value="${d.ymd}">${label} (${d.count} slots)</option>`;
}).join(””);

daySelect.disabled = false;
daySelect.value = found[0].ymd;
setRowMsg(””, false);
renderSlots(card, found[0].slots);
}

// ── EVENT DELEGATION: CHANGE ──
els.list.addEventListener(“change”, async (e) => {
const card = e.target.closest(”.nsd-appt-card”);
if (!card) return;
const bookingId = card.dataset.bookingId;

if (e.target.matches(”.js-barber-select”)) {
const barberId = e.target.value;
const serviceSelect = card.querySelector(”.js-service-select”);
const daySelect = card.querySelector(”.js-day-select”);
const slotsWrap = card.querySelector(”.js-slots”);
serviceSelect.innerHTML = “<option>Loading services…</option>”;
daySelect.innerHTML = “<option>Select barber + service first…</option>”;
daySelect.disabled = true;
slotsWrap.style.display = “none”;
if (!barberId) { serviceSelect.innerHTML = “<option>Select barber first…</option>”; return; }
try {
const services = isAnyBarber(barberId) ? await fetchStoreServices() : await fetchBarberServices(barberId);
if (!services.length) { serviceSelect.innerHTML = “<option>No services found</option>”; }
else { serviceSelect.innerHTML = `<option value="">Select Service...</option>` + services.map(s => `<option value="${s.id}">${s.name}</option>`).join(””); }
} catch { serviceSelect.innerHTML = “<option>Failed to load services</option>”; }
return;
}

if (e.target.matches(”.js-service-select”)) { if (e.target.value) searchDays(card, bookingId); }

if (e.target.matches(”.js-day-select”)) {
const ymd = e.target.value;
const barberId = card.querySelector(”.js-barber-select”).value;
const serviceId = card.querySelector(”.js-service-select”).value;
if (!ymd || !barberId || !serviceId) return;
const rowMsg = card.querySelector(”.js-row-msg”);
rowMsg.textContent = “Loading slots…”;
try {
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const payload = {
business_id: state.businessId, booking_id: bookingId, date: ymd, time_zone: timeZone,
menu_item_id: serviceId, any_barber: isAnyBarber(barberId),
…(isAnyBarber(barberId) ? {} : { team_member_id: barberId }),
};
const json = await Utils.secureEdgeFetch(“customer_available_slots”, payload);
renderSlots(card, json.slots || []);
} catch { rowMsg.textContent = “Error loading slots.”; }
}
});

// ── EVENT DELEGATION: CLICK ──
els.list.addEventListener(“click”, async (e) => {
const card = e.target.closest(”.nsd-appt-card”);
if (!card) return;
const bookingId = card.dataset.bookingId;
const row = card.querySelector(”.js-resched-row”);
const rowMsg = card.querySelector(”.js-row-msg”);
const setRowMsg = (t, isErr) => { rowMsg.textContent = t || “”; rowMsg.style.color = isErr ? “var(–error)” : “var(–success)”; };

if (e.target.closest(”.js-resched”)) {
const isHidden = (row.style.display === “none”);
row.style.display = isHidden ? “block” : “none”;
setRowMsg(””);
if (isHidden) {
const barberSelect = card.querySelector(”.js-barber-select”);
barberSelect.innerHTML = “<option>Loading barbers…</option>”;
const { data, error } = await state.supabase
.from(“team_members”).select(“id, name”)
.eq(“business_id”, state.businessId).eq(“is_active”, true);
if (error || !data?.length) { barberSelect.innerHTML = “<option>No barbers found</option>”; }
else {
barberSelect.innerHTML = `<option value="">Select Barber...</option><option value="any">Any Barber</option>` +
data.map(b => `<option value="${b.id}">${b.name}</option>`).join(””);
}
card.querySelector(”.js-service-select”).innerHTML = `<option value="">Select barber first...</option>`;
card.querySelector(”.js-day-select”).innerHTML = `<option value="">Select barber + service first...</option>`;
card.querySelector(”.js-day-select”).disabled = true;
card.querySelector(”.js-slots”).style.display = “none”;
}
return;
}

if (e.target.closest(”.js-slot”)) {
const btn = e.target.closest(”.js-slot”);
const iso = btn.dataset.iso;
const slotBarberId = btn.dataset.barberId || “”;
if (!iso) return;
if (!confirm(`Reschedule to ${btn.textContent}?`)) return;
try {
setRowMsg(“Confirming…”, false); Utils.toggleLoading(true);
const chosenBarberVal = card.querySelector(”.js-barber-select”).value;
const serviceId = card.querySelector(”.js-service-select”).value;
const payload = {
business_id: state.businessId, booking_id: bookingId, action: “reschedule”,
new_start_at: iso, menu_item_id: serviceId,
time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone
};
if (isAnyBarber(chosenBarberVal)) { payload.team_member_id = null; payload.slot_team_member_id = slotBarberId; }
else { payload.team_member_id = chosenBarberVal; payload.slot_team_member_id = null; }
await Utils.secureEdgeFetch(“customer_booking_action”, payload);
setRowMsg(“Success!”, false);
await loadDashboard();
} catch (err) { setRowMsg(err.message, true); alert(`Failed: ${err.message}`); }
finally { Utils.toggleLoading(false); }
return;
}

if (e.target.closest(”.js-resched-cancel”)) { row.style.display = “none”; setRowMsg(””); return; }

if (e.target.closest(”.js-cancel”)) {
if (!confirm(“Are you sure you want to cancel this appointment?”)) return;
try {
Utils.toggleLoading(true);
await Utils.secureEdgeFetch(“customer_booking_action”, {
business_id: state.businessId, booking_id: bookingId,
action: “cancel”, cancel_reason: “Customer Portal”
});
await loadDashboard();
} catch (err) { alert(“Error: “ + err.message); }
finally { Utils.toggleLoading(false); }
return;
}
});

// ── AUTH HANDLERS ──
async function handleSignIn(e) {
e.preventDefault();
const btn = e.target.querySelector(‘button’);
const fd = new FormData(e.target);
btn.disabled = true; btn.textContent = “Signing In…”;
try {
const { data, error } = await state.supabase.auth.signInWithPassword({
email: fd.get(“email”), password: fd.get(“password”)
});
if (error) throw error;
await ensureCustomer(data.user);
loadDashboard();
} catch (err) {
Utils.showError(err.message);
e.target.classList.add(‘shake’);
setTimeout(() => e.target.classList.remove(‘shake’), 500);
btn.disabled = false; btn.textContent = “Sign In”;
const { data: { session } } = await state.supabase.auth.getSession();
if (session) await state.supabase.auth.signOut();
}
}

async function handleSignUp(e) {
e.preventDefault();
const btn = e.target.querySelector(‘button’);
const fd = new FormData(e.target);
if (fd.get(“password”) !== fd.get(“confirm”)) { Utils.showError(“Passwords do not match”); return; }
const phoneFormatted = Utils.formatPhone(fd.get(“phone”));
if (!phoneFormatted) { Utils.showError(“Please enter a valid US mobile number”); return; }
btn.disabled = true; btn.textContent = “Creating Account…”;
try {
const smsOptIn = document.getElementById(“nsdSmsConsent”).checked;
const consentText = “I agree to receive SMS texts related to my account and bookings. Msg & data rates may apply. Reply STOP to opt out.”;
const redirectUrl = CONFIG.REDIRECT_URL || `${location.origin}/verified`;
const { error } = await state.supabase.auth.signUp({
email: fd.get(“email”), password: fd.get(“password”),
options: {
data: { full_name: fd.get(“fullName”), phone: phoneFormatted, sms_opt_in: smsOptIn, sms_consent_text: smsOptIn ? consentText : null },
emailRedirectTo: redirectUrl
}
});
if (error) throw error;
els.forms.signup.style.display = ‘none’;
document.getElementById(“nsdTabNav”).style.display = ‘none’;
document.getElementById(“nsdSuccessView”).style.display = ‘block’;
} catch (err) { Utils.showError(err.message); btn.disabled = false; btn.textContent = “Create Account”; }
}

// ── INIT ──
(async function init() {
// 1. Resolve business
const bId = await resolveBusinessId();
if (!bId) {
Utils.toggleLoading(false);
Utils.showError(“Business not found.”);
return;
}

// 2. Set redirect URL dynamically
CONFIG.REDIRECT_URL = `${location.origin}/verified`;

// 3. Bind forms
els.forms.signin.addEventListener(“submit”, handleSignIn);
els.forms.signup.addEventListener(“submit”, handleSignUp);

document.querySelectorAll(”.nsd-sign-out-btn”).forEach(b => b.addEventListener(“click”, async () => {
Utils.toggleLoading(true);
await state.supabase.auth.signOut();
location.reload();
}));

document.getElementById(“nsdTabNav”).addEventListener(“click”, (e) => {
const btn = e.target.closest(‘button’);
if (!btn || !btn.dataset.tab) return;
document.querySelectorAll(”[data-tab]”).forEach(b => b.classList.remove(“active”));
btn.classList.add(“active”);
document.querySelectorAll(”[data-tab-content]”).forEach(f => f.classList.remove(“active”));
document.querySelector(`[data-tab-content="${btn.dataset.tab}"]`).classList.add(“active”);
els.authMsg.textContent = “”;
});

state.supabase.auth.onAuthStateChange((event, session) => {
if (event === ‘SIGNED_OUT’ || !session) {
els.authView.style.display = ‘block’;
els.apptsView.style.display = ‘none’;
document.body.classList.remove(‘mode-dashboard’);
}
});

// 4. Check existing session
const { data: { session } } = await state.supabase.auth.getSession();
if (session) {
try { await ensureCustomer(session.user); loadDashboard(); }
catch (e) { await state.supabase.auth.signOut(); els.authView.style.display = ‘block’; Utils.toggleLoading(false); }
} else { els.authView.style.display = ‘block’; Utils.toggleLoading(false); }
})();

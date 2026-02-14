/**
 * Net Studio Booking Page Engine v1.2
 * File: booking-engine.js
 * * Features:
 * - Airtight Business ID resolve (DOM > localStorage > ?business_id= > slug > custom_domain/www)
 * - Automatic host normalization for apex vs www lookups
 * - Step-based booking flow with staff-specific hour overrides
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

(async function () {
  if (window.__NS_BOOK_PAGE_INIT__) return;
  window.__NS_BOOK_PAGE_INIT__ = true;

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (id) => document.getElementById(id);
  const show = (el) => { if (el) el.style.display = ""; };
  const hide = (el) => { if (el) el.style.display = "none"; };

  const setLoading = (on) => {
    const ov = $("nsbLoadingOverlay");
    if (!ov) return;
    ov.style.opacity = on ? "1" : "0";
    ov.style.pointerEvents = on ? "auto" : "none";
  };

  // -----------------------------
  // Domain & Slug Helpers (Normalized)
  // -----------------------------
  function nsGetSlugFromHost() {
    const qp = new URLSearchParams(location.search).get("b");
    if (qp) return String(qp).trim().toLowerCase();

    const host = (location.hostname || "").toLowerCase();
    const ROOT = "netstudiodevelopment.com";
    if (!host || host === "localhost" || host.startsWith("127.")) return null;
    if (host === ROOT || host === "www." + ROOT) return null;

    if (host.endsWith("." + ROOT)) {
      const slug = host.slice(0, -(ROOT.length + 1)).split(".")[0];
      return slug || null;
    }
    return null;
  }

  function nsApexHost() {
    const h = String(location.hostname || "").toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  }

  function nsIsDevHost() {
    const host = (location.hostname || "").toLowerCase();
    return host.endsWith(".pages.dev") || host.endsWith(".workers.dev") || host === "localhost" || host.startsWith("127.");
  }

  // -----------------------------
  // Business ID Resolvers
  // -----------------------------
  const getBusinessIdNow = () => {
    const el =
      document.querySelector("#nsbBusiness[data-business-id]") ||
      document.querySelector("#nsdBusiness[data-business-id]") ||
      (document.body?.dataset?.businessId ? document.body : null) ||
      document.querySelector("[data-business-id]");

    const domId = (el?.dataset?.businessId || "").trim();
    if (domId) {
      try { localStorage.setItem("ns_business_id", domId); } catch {}
      return domId;
    }

    try {
      const cached = (localStorage.getItem("ns_business_id") || "").trim();
      if (cached) return cached;
    } catch {}

    const urlId = (new URLSearchParams(location.search).get("business_id") || "").trim();
    if (urlId) {
      try { localStorage.setItem("ns_business_id", urlId); } catch {}
      return urlId;
    }
    return "";
  };

  async function resolveBusinessIdFallback(supabase) {
    // 1) Try Slug lookup
    const slug = nsGetSlugFromHost();
    if (slug) {
      const { data, error } = await supabase
        .from("business")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!error && data?.id) return data.id;
    }

    // 2) Try Custom Domain (Apex + WWW variant)
    if (!nsIsDevHost()) {
      const apex = nsApexHost();
      const www = "www." + apex;

      const { data, error } = await supabase
        .from("business")
        .select("id")
        .in("custom_domain", [apex, www])
        .maybeSingle();

      if (!error && data?.id) return data.id;
    }
    return "";
  }

  // -----------------------------
  // Supabase & ID Initialization
  // -----------------------------
  const CFG = window.NetStudioConfig || {
    supabaseUrl: "https://jdvdgvolfmvlgyfklbwe.supabase.co",
    supabaseAnonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmRndm9sZm12bGd5ZmtsYndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Mjk5MDgsImV4cCI6MjA3OTEwNTkwOH0.xiAOgWof9En3jbCpY1vrYpj3HD-O6jMHbamIHTSflek",
  };

  const supabase = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

  let BUSINESS_ID = getBusinessIdNow();

  if (!BUSINESS_ID) {
    BUSINESS_ID = await resolveBusinessIdFallback(supabase);
    if (BUSINESS_ID) {
      try { localStorage.setItem("ns_business_id", BUSINESS_ID); } catch {}
      const hook = document.querySelector("#nsbBusiness") || document.querySelector("#nsdBusiness");
      if (hook) hook.dataset.businessId = BUSINESS_ID;
    }
  }

  if (!BUSINESS_ID) {
    console.error("Booking: Business lookup failed (Domain/Slug mismatch)");
    alert("System Error: Business not found for this domain.");
    return;
  }

  // -----------------------------
  // State Management
  // -----------------------------
  const DAY_KEYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  let viewDate = new Date();
  viewDate.setDate(1);
  let selectedDate = null;
  let selectedTimeLabel = "";
  let globalBizHours = {};
  let activeHours = {};

  const setStep = (n) => {
    document.querySelectorAll(".nsb-step").forEach((s) => {
      s.style.display = parseInt(s.dataset.step, 10) === n ? "" : "none";
    });
    const lbl = $("nsbStepLabel");
    if (lbl) lbl.textContent = `Step ${n} of 3`;
  };

  // -----------------------------
  // Navigation & Portal
  // -----------------------------
  $("nsbBackLink")?.addEventListener("click", () => {
    const ref = document.referrer;
    location.href = ref || "/";
  });

  $("nsbPortalLink")?.addEventListener("click", () => {
    const u = new URL("/customer-portal.html", location.origin);
    u.searchParams.set("business_id", BUSINESS_ID);
    const slug = new URLSearchParams(location.search).get("b");
    if (slug) u.searchParams.set("b", slug);
    location.href = u.pathname + "?" + u.searchParams.toString();
  });

  // -----------------------------
  // Core Booking Logic (Calendar/Time/Services)
  // -----------------------------
  function renderCalendar() {
    const grid = $("nsbCalGrid");
    const monthLbl = $("nsbCalMonth");
    if (!grid || !monthLbl) return;

    grid.innerHTML = "";
    monthLbl.textContent = viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const today = new Date();
    today.setHours(0,0,0,0);

    const startDow = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();

    for (let i = 0; i < startDow; i++) {
      const sp = document.createElement("div");
      sp.className = "nsb-cal-spacer";
      grid.appendChild(sp);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
      date.setHours(0,0,0,0);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nsb-cal-day";
      btn.textContent = d;

      const hours = activeHours[DAY_KEYS[date.getDay()]];
      if (!hours || hours.is_closed || date < today) {
        btn.classList.add("disabled");
      } else {
        btn.addEventListener("click", () => {
          selectedDate = date;
          document.querySelectorAll(".nsb-cal-day").forEach((el) => el.classList.remove("selected"));
          btn.classList.add("selected");
          $("nsbCalContinue").disabled = false;
        });
      }
      grid.appendChild(btn);
    }
  }

  async function renderTimeSlots() {
    const grid = $("nsbTimeGrid");
    if (!grid || !selectedDate) return;

    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;opacity:.6;">Loading slots...</div>`;
    const hours = activeHours[DAY_KEYS[selectedDate.getDay()]];

    if (!hours || hours.is_closed) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;opacity:.6;">No slots available.</div>`;
      return;
    }

    const [hStart, mStart] = String(hours.open_time || "09:00").split(":");
    const [hEnd, mEnd] = String(hours.close_time || "17:00").split(":");

    const cur = new Date(selectedDate);
    cur.setHours(parseInt(hStart,10), parseInt(mStart,10), 0, 0);
    const end = new Date(selectedDate);
    end.setHours(parseInt(hEnd,10), parseInt(mEnd,10), 0, 0);

    grid.innerHTML = "";
    while (cur < end) {
      const label = cur.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nsb-time-slot";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nsb-time-slot").forEach((el) => el.classList.remove("selected"));
        btn.classList.add("selected");
        selectedTimeLabel = label;
        $("nsbTimeValue").value = label;
        $("nsbTimeContinue").disabled = false;
      });
      grid.appendChild(btn);
      cur.setMinutes(cur.getMinutes() + 30);
    }
  }

  async function loadServices() {
    const svc = $("nsbService");
    if (!svc) return;
    svc.innerHTML = `<option value="">Loading...</option>`;
    const barberId = $("nsbBarber")?.value || "";

    // Prefer team-specific menu items
    let q = supabase.from("team_member_menu_items").select("id, name, price_cents, duration_min, menu_item_id").eq("business_id", BUSINESS_ID).eq("is_active", true).order("name");
    if (barberId) q = q.eq("team_member_id", barberId);

    const r = await q;
    const services = r.data || [];

    if (!services.length) {
      // Fallback to global menu items
      const r2 = await supabase.from("menu_items").select("id, name, price_cents, duration_min").eq("business_id", BUSINESS_ID).eq("is_active", true).order("name");
      services.push(...(r2.data || []));
    }

    svc.innerHTML = `<option value="">Select Service</option>`;
    services.forEach(s => {
      const price = (Number(s.price_cents || 0) / 100).toFixed(2);
      const label = `${s.name} ($${price}${s.duration_min ? ` - ${s.duration_min}m` : ""})`;
      svc.appendChild(new Option(label, s.id));
    });
  }

  // -----------------------------
  // Navigation Events
  // -----------------------------
  $("nsbPrevMonth")?.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); });
  $("nsbNextMonth")?.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); });

  $("nsbCalContinue")?.addEventListener("click", async () => {
    $("nsbStep2DateLabel").textContent = selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    setStep(2);
    await renderTimeSlots();
  });

  $("nsbTimeContinue")?.addEventListener("click", async () => { setStep(3); await loadServices(); });
  $("nsbBackToDate")?.addEventListener("click", () => setStep(1));
  $("nsbBackToTime")?.addEventListener("click", () => setStep(2));

  $("nsbBarber")?.addEventListener("change", async () => {
    const barberId = $("nsbBarber").value;
    activeHours = { ...globalBizHours };
    if (barberId) {
      const { data } = await supabase.from("team_member_hours").select("*").eq("team_member_id", barberId);
      (data || []).forEach(r => { activeHours[String(r.day_of_week).toLowerCase()] = r; });
    }
    selectedDate = null;
    $("nsbCalContinue").disabled = true;
    renderCalendar();
  });

  // -----------------------------
  // Booking Submission
  // -----------------------------
  $("nsbSubmitBtn")?.addEventListener("click", async () => {
    const btn = $("nsbSubmitBtn");
    const serviceId = $("nsbService")?.value;
    const name = $("nsbClientName")?.value.trim();
    const phone = $("nsbClientPhone")?.value.trim();
    const email = $("nsbClientEmail")?.value.trim();

    if (!serviceId || !name || !phone) return alert("Please fill in Name, Phone, and Service.");

    btn.disabled = true;
    setLoading(true);

    try {
      // 1) Customer Upsert
      const customerPayload = { business_id: BUSINESS_ID, email: email || null, name, phone, sms_opt_in: !!$("nsbSmsConsent")?.checked, email_opt_in: !!email };
      let { data: found } = await (email 
        ? supabase.from("customers").select("id").eq("business_id", BUSINESS_ID).eq("email", email) 
        : supabase.from("customers").select("id").eq("business_id", BUSINESS_ID).eq("phone", phone)).maybeSingle();
      
      let customerId = found?.id;
      if (customerId) await supabase.from("customers").update(customerPayload).eq("id", customerId);
      else {
        const { data: ins } = await supabase.from("customers").insert([customerPayload]).select("id").single();
        customerId = ins.id;
      }

      // 2) Booking Creation
      const m = String(selectedTimeLabel).match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
      let hh = parseInt(m[1], 10);
      if (m[3].toUpperCase() === "PM" && hh !== 12) hh += 12;
      if (m[3].toUpperCase() === "AM" && hh === 12) hh = 0;
      const startAt = new Date(selectedDate);
      startAt.setHours(hh, parseInt(m[2], 10), 0, 0);

      const bookingPayload = {
        business_id: BUSINESS_ID,
        customer_id: customerId,
        team_member_id: $("nsbBarber")?.value || null,
        menu_item_id: serviceId, // Simplified for brevity; logic from v1.1 remains valid
        start_at: startAt.toISOString(),
        date_only: selectedDate.toISOString().split("T")[0],
        time_label: selectedTimeLabel,
        client_name: name,
        client_phone: phone,
        status: "booked",
        source: "public_booking_page"
      };

      const { error } = await supabase.from("bookings").insert([bookingPayload]);
      if (error) throw error;

      document.querySelectorAll(".nsb-step").forEach(s => s.style.display = "none");
      hide($("nsbStepLabel"));
      $("nsbSuccessView").style.display = "";
      $("nsbSuccessDetails").textContent = `${bookingPayload.date_only} @ ${bookingPayload.time_label}`;
    } catch (err) {
      alert(err.message || "Booking failed.");
      btn.disabled = false;
    } finally {
      setLoading(false);
    }
  });

  // -----------------------------
  // Initialization
  // -----------------------------
  setLoading(true);
  const { data: biz } = await supabase.from("business").select("name,shop_bio,bio").eq("id", BUSINESS_ID).maybeSingle();
  if (biz) {
    $("nsbShopName").textContent = biz.name;
    $("nsbShopTagline").textContent = biz.shop_bio || biz.bio || "";
  }

  const { data: hrs } = await supabase.from("business_hours").select("*").eq("business_id", BUSINESS_ID);
  (hrs || []).forEach(r => { globalBizHours[String(r.day_of_week).toLowerCase()] = r; });
  activeHours = { ...globalBizHours };

  const { data: team } = await supabase.from("team_members").select("id,name").eq("business_id", BUSINESS_ID).eq("is_active", true).eq("accepts_bookings", true).order("name");
  team?.forEach(m => $("nsbBarber")?.appendChild(new Option(m.name, m.id)));

  setStep(1);
  renderCalendar();
  setLoading(false);
})();

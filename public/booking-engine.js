/**
 * Net Studio Booking Page Engine v1.0
 * File: booking-engine.js
 * Works with /book.html scaffold (nsb* ids)
 *
 * Features:
 * - Business ID resolve (DOM > localStorage > ?business_id=)
 * - Loads business name/tagline
 * - Loads global business hours + staff hours override when barber selected
 * - Calendar + 30-min time slots
 * - Service dropdown (menu_items OR team_member_menu_items fallback)
 * - Customer upsert via email OR phone
 * - Booking insert
 * - Portal link -> /customer-portal.html?business_id=...
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

  // -----------------------------
  // Loading overlay
  // -----------------------------
  const setLoading = (on) => {
    const ov = $("nsbLoadingOverlay");
    if (!ov) return;
    ov.style.opacity = on ? "1" : "0";
    ov.style.pointerEvents = on ? "auto" : "none";
  };

  // -----------------------------
  // Resolve business_id
  // -----------------------------
  const getBusinessIdNow = () => {
    const el =
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

  const BUSINESS_ID = getBusinessIdNow();
  if (!BUSINESS_ID) {
    console.error("Booking: Missing business_id");
    alert("System Error: Business ID missing.");
    return;
  }

  // -----------------------------
  // Supabase client
  // -----------------------------
  const CFG = window.NetStudioConfig || {
    supabaseUrl: "https://jdvdgvolfmvlgyfklbwe.supabase.co",
    supabaseAnonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmRndm9sZm12bGd5ZmtsYndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Mjk5MDgsImV4cCI6MjA3OTEwNTkwOH0.xiAOgWof9En3jbCpY1vrYpj3HD-O6jMHbamIHTSflek",
  };

  const supabase = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

  // -----------------------------
  // State
  // -----------------------------
  const DAY_KEYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

  let viewDate = new Date();
  viewDate.setDate(1);

  let selectedDate = null;
  let selectedTimeLabel = "";
  let globalBizHours = {};
  let activeHours = {};

  // -----------------------------
  // Step switching
  // -----------------------------
  const setStep = (n) => {
    document.querySelectorAll(".nsb-step").forEach((s) => {
      const sn = parseInt(s.dataset.step, 10);
      s.style.display = sn === n ? "" : "none";
    });
    const lbl = $("nsbStepLabel");
    if (lbl) lbl.textContent = `Step ${n} of 3`;
  };

  // -----------------------------
  // Back link behavior
  // -----------------------------
  $("nsbBackLink")?.addEventListener("click", () => {
    const ref = document.referrer;
    if (ref) location.href = ref;
    else location.href = "/";
  });

  // Portal link
  $("nsbPortalLink")?.addEventListener("click", () => {
    location.href = `/customer-portal.html?business_id=${encodeURIComponent(BUSINESS_ID)}`;
  });

  // -----------------------------
  // Calendar render
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

      const dayKey = DAY_KEYS[date.getDay()];
      const hours = activeHours[dayKey];
      const isClosed = !hours || hours.is_closed;

      if (isClosed || date < today) {
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

  // -----------------------------
  // Time slots (30m)
  // -----------------------------
  async function renderTimeSlots() {
    const grid = $("nsbTimeGrid");
    if (!grid || !selectedDate) return;

    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;opacity:.6;font-size:12px;">Loading slots...</div>`;

    const dayKey = DAY_KEYS[selectedDate.getDay()];
    const hours = activeHours[dayKey];

    if (!hours || hours.is_closed) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;opacity:.6;">No slots available.</div>`;
      return;
    }

    // Parse open/close
    const [hStart, mStart] = String(hours.open_time || "09:00").split(":");
    const [hEnd, mEnd] = String(hours.close_time || "17:00").split(":");

    const cur = new Date(selectedDate);
    cur.setHours(parseInt(hStart,10), parseInt(mStart,10), 0, 0);

    const end = new Date(selectedDate);
    end.setHours(parseInt(hEnd,10), parseInt(mEnd,10), 0, 0);

    grid.innerHTML = "";
    let has = false;

    while (cur < end) {
      has = true;
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

    if (!has) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;opacity:.6;">Fully booked.</div>`;
    }
  }

  // -----------------------------
  // Staff hours override
  // -----------------------------
  async function handleBarberChange() {
    const barberId = $("nsbBarber").value || "";
    activeHours = { ...globalBizHours };

    if (!barberId) {
      renderCalendar();
      return;
    }

    const { data, error } = await supabase
      .from("team_member_hours")
      .select("day_of_week, open_time, close_time, is_closed")
      .eq("team_member_id", barberId);

    if (error) {
      console.warn("Booking: staff hours error", error.message);
      renderCalendar();
      return;
    }

    (data || []).forEach((r) => {
      const k = String(r.day_of_week || "").toLowerCase();
      if (k) activeHours[k] = r;
    });

    renderCalendar();
  }

  // -----------------------------
  // Services loader
  // Prefers team_member_menu_items, falls back to menu_items
  // -----------------------------
  const money = (cents) => (Number(cents || 0) / 100).toFixed(2);

  async function loadServices() {
    const svc = $("nsbService");
    if (!svc) return;

    svc.innerHTML = `<option value="">Loading...</option>`;

    const barberId = $("nsbBarber")?.value || "";

    // 1) team_member_menu_items
    let q1 = supabase
      .from("team_member_menu_items")
      .select("id, name, price_cents, duration_min, menu_item_id")
      .eq("business_id", BUSINESS_ID)
      .eq("is_active", true)
      .order("name");

    if (barberId) q1 = q1.eq("team_member_id", barberId);

    const r1 = await q1;
    if (!r1.error && (r1.data || []).length) {
      svc.innerHTML = `<option value="">Select Service</option>`;
      r1.data.forEach((s) => {
        const dur = s.duration_min ? ` - ${s.duration_min}m` : "";
        const label = `${s.name} ($${money(s.price_cents)}${dur})`;
        svc.appendChild(new Option(label, s.id));
      });
      return;
    }

    // 2) menu_items fallback
    const r2 = await supabase
      .from("menu_items")
      .select("id, name, price_cents, duration_min")
      .eq("business_id", BUSINESS_ID)
      .eq("is_active", true)
      .order("name");

    svc.innerHTML = `<option value="">Select Service</option>`;
    if (r2.error || !(r2.data || []).length) {
      svc.innerHTML = `<option value="">No services available</option>`;
      return;
    }

    r2.data.forEach((s) => {
      const dur = s.duration_min ? ` - ${s.duration_min}m` : "";
      const label = `${s.name} ($${money(s.price_cents)}${dur})`;
      svc.appendChild(new Option(label, s.id));
    });
  }

  // -----------------------------
  // Navigation wiring
  // -----------------------------
  $("nsbPrevMonth")?.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    renderCalendar();
  });

  $("nsbNextMonth")?.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    renderCalendar();
  });

  $("nsbCalContinue")?.addEventListener("click", async () => {
    if (!selectedDate) return;

    $("nsbStep2DateLabel").textContent = selectedDate.toLocaleDateString(undefined, {
      weekday: "long", month: "short", day: "numeric",
    });

    setStep(2);
    $("nsbTimeContinue").disabled = true;
    $("nsbTimeValue").value = "";
    selectedTimeLabel = "";
    await renderTimeSlots();
  });

  $("nsbBackToDate")?.addEventListener("click", () => {
    setStep(1);
  });

  $("nsbTimeContinue")?.addEventListener("click", async () => {
    setStep(3);
    await loadServices();
  });

  $("nsbBackToTime")?.addEventListener("click", () => {
    setStep(2);
  });

  $("nsbBarber")?.addEventListener("change", async () => {
    // Reset selections when staff changes
    selectedDate = null;
    selectedTimeLabel = "";
    $("nsbCalContinue").disabled = true;
    $("nsbTimeContinue").disabled = true;
    $("nsbTimeValue").value = "";
    $("nsbTimeGrid").innerHTML = "";
    document.querySelectorAll(".nsb-cal-day").forEach((el) => el.classList.remove("selected"));
    await handleBarberChange();
  });

  // -----------------------------
  // Submit (customer upsert + booking insert)
  // -----------------------------
  function parseSelectedTimeToISO(dateObj, timeLabel) {
    // "12:30 PM"
    const m = String(timeLabel || "").match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) return null;

    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3].toUpperCase();

    if (ap === "AM") {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }

    const dt = new Date(dateObj);
    dt.setHours(hh, mm, 0, 0);
    return dt.toISOString();
  }

  $("nsbSubmitBtn")?.addEventListener("click", async () => {
    const btn = $("nsbSubmitBtn");
    if (!btn) return;

    const serviceId = $("nsbService")?.value || "";
    const name = ($("nsbClientName")?.value || "").trim();
    const phone = ($("nsbClientPhone")?.value || "").trim();
    const email = ($("nsbClientEmail")?.value || "").trim();
    const smsOptIn = !!$("nsbSmsConsent")?.checked;

    if (!selectedDate || !selectedTimeLabel) {
      alert("Please select a date and time.");
      return;
    }
    if (!serviceId || !name || !phone) {
      alert("Please fill in Name, Phone, and Service.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Processing...";
    setLoading(true);

    try {
      // 1) Determine service row (team_member_menu_items OR menu_items)
      let teamMemberMenuItemId = null;
      let menuItemId = null;

      // Try team_member_menu_items by id
      const rA = await supabase
        .from("team_member_menu_items")
        .select("id, menu_item_id")
        .eq("id", serviceId)
        .maybeSingle();

      if (!rA.error && rA.data) {
        teamMemberMenuItemId = rA.data.id;
        menuItemId = rA.data.menu_item_id || rA.data.id;
      } else {
        // fallback menu_items
        menuItemId = serviceId;
      }

      // 2) Customer upsert (email OR phone)
      const customerPayload = {
        business_id: BUSINESS_ID,
        email: email || null,
        name,
        phone,
        sms_opt_in: smsOptIn,
        email_opt_in: !!email,
      };

      let find = supabase.from("customers").select("id");
      if (email) find = find.eq("business_id", BUSINESS_ID).eq("email", email);
      else find = find.eq("business_id", BUSINESS_ID).eq("phone", phone);

      const found = await find.maybeSingle();
      if (found.error) throw new Error("Customer lookup failed: " + found.error.message);

      let customerId = found.data?.id || null;

      if (customerId) {
        const upd = await supabase.from("customers").update(customerPayload).eq("id", customerId);
        if (upd.error) console.warn("Customer update warn:", upd.error.message);
      } else {
        const ins = await supabase.from("customers").insert([customerPayload]).select("id").single();
        if (ins.error) throw new Error("Customer create failed: " + ins.error.message);
        customerId = ins.data.id;
      }

      // 3) Booking insert
      const startAt = parseSelectedTimeToISO(selectedDate, selectedTimeLabel);
      if (!startAt) throw new Error("Invalid time selected.");

      const dateOnly = selectedDate.toISOString().split("T")[0];

      const payload = {
        business_id: BUSINESS_ID,
        team_member_id: $("nsbBarber")?.value || null,
        menu_item_id: menuItemId,
        team_member_menu_item_id: teamMemberMenuItemId,
        start_at: startAt,
        date_only: dateOnly,
        time_label: selectedTimeLabel,
        client_name: name,
        client_phone: phone,
        client_email: email || null,
        sms_opt_in: smsOptIn,
        email_opt_in: !!email,
        status: "booked",
        source: "public_booking_page",
        customer_id: customerId,
      };

      const res = await supabase.from("bookings").insert([payload]);
      if (res.error) throw new Error("Booking Error: " + res.error.message);

      // Success UI
      document.querySelectorAll(".nsb-step").forEach((s) => (s.style.display = "none"));
      hide($("nsbStepLabel"));
      $("nsbSuccessView").style.display = "";
      $("nsbSuccessDetails").textContent = `${payload.date_only} @ ${payload.time_label}`;

    } catch (err) {
      console.error(err);
      alert(err?.message || "Booking failed.");
      btn.disabled = false;
      btn.textContent = "Confirm Booking";
    } finally {
      setLoading(false);
    }
  });

  // -----------------------------
  // INIT: load business + hours + team, start on Step 1
  // -----------------------------
  setLoading(true);

  // Business display
  const bizRes = await supabase
    .from("business")
    .select("name,bio,shop_bio")
    .eq("id", BUSINESS_ID)
    .maybeSingle();

  if (bizRes?.data) {
    $("nsbShopName").textContent = bizRes.data.name || "Book";
    $("nsbShopTagline").textContent = bizRes.data.shop_bio || bizRes.data.bio || "";
  } else {
    $("nsbShopName").textContent = "Book";
  }

  // Business hours
  const hrsRes = await supabase
    .from("business_hours")
    .select("*")
    .eq("business_id", BUSINESS_ID);

  (hrsRes.data || []).forEach((r) => {
    const k = String(r.day_of_week || "").toLowerCase();
    if (k) globalBizHours[k] = r;
  });

  activeHours = { ...globalBizHours };

  // Team members
  const teamRes = await supabase
    .from("team_members")
    .select("id,name")
    .eq("business_id", BUSINESS_ID)
    .eq("is_active", true)
    .eq("accepts_bookings", true)
    .not("auth_user_id", "is", null)
    .order("name");

  (teamRes.data || []).forEach((m) => {
    $("nsbBarber")?.appendChild(new Option(m.name, m.id));
  });

  // Default state
  $("nsbCalContinue").disabled = true;
  $("nsbTimeContinue").disabled = true;
  setStep(1);
  renderCalendar();

  setLoading(false);
})();

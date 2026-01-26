/**
 * NetStudio Booking Engine v2.8
 * Fixes: Schema Patch (bookings table), Payload Mapping (start_at, menu_item_id), Email Opt-in
 */
(async function () {
  if (window.__NSD_BOOKING_INIT__) return;
  window.__NSD_BOOKING_INIT__ = true;

  // 1. Safe Stubs
  window.openBooking = () => console.warn("NSD Engine: Initializing...");
  window.closeBooking = () => {};

  // 2. Resolve Business ID (DOM > Cache > URL) with Async Wait ✅
  const getBusinessIdNow = () => {
    const el =
      document.querySelector("#nsdBusiness[data-business-id]") ||
      (document.body?.dataset?.businessId ? document.body : null) ||
      document.querySelector("[data-business-id]");

    const domId = (el?.dataset?.businessId || "").trim();
    if (domId) {
      try { localStorage.setItem("ns_business_id", domId); } catch (e) {}
      return domId;
    }

    try {
      const cached = (localStorage.getItem("ns_business_id") || "").trim();
      if (cached) return cached;
    } catch (e) {}

    const urlId = (new URLSearchParams(location.search).get("business_id") || "").trim();
    if (urlId) {
      try { localStorage.setItem("ns_business_id", urlId); } catch (e) {}
      return urlId;
    }
    return "";
  };

  const waitForBusinessId = (timeoutMs = 6000) => {
    const started = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        const id = getBusinessIdNow();
        if (id) return resolve(id);
        if (Date.now() - started >= timeoutMs) return resolve("");
        setTimeout(tick, 50);
      };
      tick();
    });
  };

  const BUSINESS_ID = await waitForBusinessId();
  if (!BUSINESS_ID) {
    console.error("NSD: Critical - No ID found.");
    window.openBooking = () => alert("System Error: Business ID missing.");
    return;
  }

  // 3. Config
  const CFG = window.NetStudioConfig || {
    supabaseUrl: "https://jdvdgvolfmvlgyfklbwe.supabase.co",
    supabaseAnonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmRndm9sZm12bGd5ZmtsYndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1Mjk5MDgsImV4cCI6MjA3OTEwNTkwOH0.xiAOgWof9En3jbCpY1vrYpj3HD-O6jMHbamIHTSflek",
  };

  // 4. State Management
  let selectedDate = null;
  let viewDate = new Date(); viewDate.setDate(1);
  const DAY_KEYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  
  // Base business hours
  let globalBizHours = {}; 
  // Currently active hours (Shop Default + Staff Overrides)
  let activeHours = {}; 

  // 5. UI Injection
  const injectUI = () => {
    const styles = `<style>
      #nsdModalContainer { display:none; position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); overflow-y:auto; padding:20px; align-items:center; justify-content:center; }
      #nsdModalContainer.active { display:flex; }
      .nsd-modal-wrapper { --nsd-gold: rgba(188,147,61,1); --nsd-gold-soft: rgba(188,147,61,0.15); --nsd-glass: rgba(255,255,255,0.06); --nsd-bg: #0a0a0c; color:#fff; font-family:system-ui,-apple-system,sans-serif; width:100%; display:flex; justify-content:center; }
      .nsd-book-card { width:100%; max-width:380px; border-radius:24px; padding:24px 20px; background:linear-gradient(180deg, rgba(30,30,35,0.9) 0%, rgba(10,10,12,1) 100%); border:1px solid rgba(255,255,255,0.12); box-shadow:0 30px 60px rgba(0,0,0,0.6); position:relative; }
      .nsd-close-trigger { position:absolute; top:16px; right:16px; background:none; border:none; color:#fff; font-size:24px; cursor:pointer; opacity:0.5; z-index:10; }
      .nsd-close-trigger:hover { opacity:1; }
      .nsd-book-card h1 { font-size:19px; letter-spacing:0.1em; text-transform:uppercase; text-align:center; margin:0 0 4px; font-weight:800; }
      .nsd-book-card .sub { text-align:center; font-size:12px; opacity:0.6; margin:0 0 16px; min-height:1em; }
      .nsd-step-indicator { display:flex; align-items:center; justify-content:center; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; padding:6px 12px; border-radius:20px; background:var(--nsd-glass); border:1px solid rgba(255,255,255,0.1); margin:0 auto 18px; width:fit-content; }
      .nsd-gate-grid { display:grid; gap:12px; margin-top:16px; }
      .nsd-gate-choice { text-align:left; border-radius:16px; padding:16px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#fff; cursor:pointer; width:100%; transition:0.2s; }
      .nsd-gate-choice:hover { border-color:rgba(255,255,255,0.3); background:rgba(255,255,255,0.07); }
      .nsd-gate-choice.primary { border-color:rgba(188,147,61,0.4); background:var(--nsd-gold-soft); }
      .nsd-input { width:100%; padding:12px; background:#000; border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:12px; margin-bottom:12px; font-size:14px; box-sizing:border-box; }
      .nsd-cal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
      .nsd-nav-btn { background:none; border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:50%; width:30px; height:30px; cursor:pointer; }
      .nsd-cal-grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:6px; }
      .nsd-cal-day, .nsd-cal-spacer { height:38px; display:flex; align-items:center; justify-content:center; font-size:12px; }
      .nsd-cal-day { border-radius:10px; border:none; background:rgba(255,255,255,0.03); color:#fff; cursor:pointer; }
      .nsd-cal-day.selected { background:#fff!important; color:#000!important; font-weight:700; }
      .nsd-cal-day.disabled { opacity:0.1; cursor:not-allowed; }
      .btn-main { width:100%; padding:14px; border-radius:14px; border:none; background:#fff; color:#000; font-weight:800; text-transform:uppercase; cursor:pointer; margin-top:12px; }
      .btn-main:disabled { opacity:0.2; cursor:default; }
      .btn-ghost { width:100%; margin-top:10px; padding:12px; border-radius:14px; background:transparent; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; text-transform:uppercase; cursor:pointer; }
      .nsd-time-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; max-height:280px; overflow-y:auto; padding:4px; }
      .nsd-time-slot { border-radius:12px; padding:12px 5px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#fff; cursor:pointer; font-size:11px; text-align:center; }
      .nsd-time-slot.selected { background:#fff!important; color:#000!important; }
      .nsd-checkbox { display:flex; align-items:center; font-size:12px; margin-bottom:12px; cursor:pointer; opacity:0.8; }
      .nsd-checkbox input { margin-right:8px; accent-color: var(--nsd-gold); width:16px; height:16px; }
      .nsd-checkbox:hover { opacity:1; }
    </style>`;

    const html = `
    <div id="nsdModalContainer">
      <div class="nsd-modal-wrapper">
        <div class="nsd-book-card" id="nsdMainCard">
          <button class="nsd-close-trigger" id="nsdCloseBtn" type="button">×</button>
          <h1 id="nsdShopName">Loading...</h1>
          <p class="sub" id="nsdShopTagline"></p>
          <div class="nsd-step-indicator" id="nsdStepLabel" style="display:none;">Step 1 of 3</div>

          <div class="nsd-step" data-step="0">
            <div class="nsd-gate-grid">
              <button class="nsd-gate-choice" id="nsdGatePortal">
                <div class="t">Returning Client</div>
                <div class="s">Sign in to manage appointments</div>
              </button>
              <button class="nsd-gate-choice primary" id="nsdGateGuest">
                <div class="t">New Guest / Walk-In</div>
                <div class="s">Instant booking for today or later</div>
              </button>
            </div>
          </div>

          <div class="nsd-step" data-step="1" style="display:none;">
            <label style="font-size:10px; text-transform:uppercase; opacity:0.5; margin-bottom:4px; display:block;">Select Professional</label>
            <select id="nsdBarber" class="nsd-input">
              <option value="">Any Available</option>
            </select>
            
            <div class="nsd-cal-header">
              <button id="nsdPrevMonth" class="nsd-nav-btn">‹</button>
              <div id="nsdCalMonth"></div>
              <button id="nsdNextMonth" class="nsd-nav-btn">›</button>
            </div>
            <div class="nsd-cal-grid" id="nsdCalGrid"></div>
            <button class="btn-main" id="nsdCalContinue" disabled>Choose Time</button>
          </div>

          <div class="nsd-step" data-step="2" style="display:none;">
            <p id="nsdStep2DateLabel" style="text-align:center; font-weight:bold; margin-bottom:12px;"></p>
            <div class="nsd-time-grid" id="nsdTimeGrid"></div>
            <input type="hidden" id="nsdTimeValue" />
            <button class="btn-main" id="nsdTimeContinue" disabled>Enter Details</button>
            <button class="btn-ghost" id="nsdBackToDate">Back to Calendar</button>
          </div>

          <div class="nsd-step" data-step="3" style="display:none;">
            <select id="nsdService" class="nsd-input"><option value="">Loading Services...</option></select>
            <input type="text" id="nsdClientName" placeholder="Full Name" class="nsd-input">
            <input type="tel" id="nsdClientPhone" placeholder="Phone Number" class="nsd-input">
            <input type="email" id="nsdClientEmail" placeholder="Email (optional)" class="nsd-input">
            
            <label class="nsd-checkbox">
              <input type="checkbox" id="nsdSmsConsent" checked>
              <span>Receive confirmation & reminders</span>
            </label>

            <button class="btn-main" id="nsdSubmitBtn">Confirm Booking</button>
            <button class="btn-ghost" id="nsdBackToTime">Back</button>
          </div>

          <div id="nsdSuccessInline" style="display:none; text-align:center; padding:20px 0;">
            <div style="background:rgba(34,197,94,0.2); color:#bbf7d0; border:1px solid rgba(34,197,94,0.4); border-radius:12px; padding:16px; margin-bottom:16px;">
              <div style="font-size:24px; margin-bottom:8px;">✓</div>
              <div style="font-weight:bold; text-transform:uppercase; letter-spacing:1px;">Confirmed</div>
              <div id="nsdSuccessDetails" style="font-size:12px; margin-top:4px;"></div>
            </div>
            <button class="btn-main" onclick="location.reload()">Done</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML("beforeend", styles + html);
  };

  injectUI();

  // 6. Supabase Setup
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const supabase = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

  // 7. Logic Helpers & Rendering
  const setStep = (n) => {
    document.querySelectorAll(".nsd-step").forEach((s) => {
      s.style.display = parseInt(s.dataset.step) === n ? "block" : "none";
    });
    const lbl = document.getElementById("nsdStepLabel");
    if (lbl) {
      lbl.style.display = n === 0 ? "none" : "flex";
      lbl.textContent = `Step ${n} of 3`;
    }
  };

  const resetFlow = () => {
    selectedDate = null;
    activeHours = { ...globalBizHours };
    document.getElementById("nsdBarber").value = "";
    document.getElementById("nsdCalContinue").disabled = true;
    document.getElementById("nsdTimeContinue").disabled = true;
    document.getElementById("nsdSuccessInline").style.display = "none";
    document.querySelectorAll(".nsd-cal-day").forEach((el) => el.classList.remove("selected"));
    setStep(0);
  };

  window.openBooking = () => {
    const m = document.getElementById("nsdModalContainer");
    if (!m) return;
    resetFlow();
    m.classList.add("active");
    document.body.style.overflow = "hidden";
    renderCalendar();
  };

  window.closeBooking = () => {
    const m = document.getElementById("nsdModalContainer");
    if (m) {
      m.classList.remove("active");
      document.body.style.overflow = "";
    }
  };

  // 8. Staff Specific Logic
  const handleBarberChange = async () => {
    const barberId = document.getElementById("nsdBarber").value;
    activeHours = { ...globalBizHours }; 

    if (!barberId) {
      renderCalendar();
      return;
    }

    const { data: staffHours, error } = await supabase
      .from("team_member_hours")
      .select("day_of_week, open_time, close_time, is_closed")
      .eq("team_member_id", barberId);

    if (error) {
      console.warn("NSD: Error fetching staff hours", error.message);
      renderCalendar();
      return;
    }

    (staffHours || []).forEach((r) => {
      activeHours[String(r.day_of_week).toLowerCase()] = r;
    });

    renderCalendar();
  };

  document.getElementById("nsdBarber").addEventListener("change", handleBarberChange);

  // 9. Calendar & Time
  const renderCalendar = () => {
    const grid = document.getElementById("nsdCalGrid");
    const monthLbl = document.getElementById("nsdCalMonth");
    grid.innerHTML = "";
    monthLbl.textContent = viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startDow = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();

    for (let i = 0; i < startDow; i++) {
      grid.appendChild(Object.assign(document.createElement("div"), { className: "nsd-cal-spacer" }));
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
      const btn = document.createElement("button");
      btn.className = "nsd-cal-day";
      btn.textContent = d;

      const dayKey = DAY_KEYS[date.getDay()];
      const hours = activeHours[dayKey];
      const isClosed = !hours || hours.is_closed;

      if (isClosed || date < today) {
        btn.classList.add("disabled");
      } else {
        btn.onclick = () => {
          selectedDate = date;
          document.querySelectorAll(".nsd-cal-day").forEach((el) => el.classList.remove("selected"));
          btn.classList.add("selected");
          document.getElementById("nsdCalContinue").disabled = false;
        };
      }
      grid.appendChild(btn);
    }
  };

  const renderTimeSlots = async () => {
    const grid = document.getElementById("nsdTimeGrid");
    grid.innerHTML = "<div style='grid-column:1/-1; text-align:center; opacity:0.5; font-size:12px;'>Loading slots...</div>";

    const dayKey = DAY_KEYS[selectedDate.getDay()];
    const hours = activeHours[dayKey];
    if (!hours) {
        grid.innerHTML = "<div style='grid-column:1/-1; text-align:center;'>No slots available.</div>";
        return;
    }

    let current = new Date(selectedDate);
    const [hStart, mStart] = hours.open_time.split(":");
    const [hEnd, mEnd] = hours.close_time.split(":");
    current.setHours(parseInt(hStart), parseInt(mStart), 0, 0);
    const end = new Date(selectedDate);
    end.setHours(parseInt(hEnd), parseInt(mEnd), 0, 0);

    grid.innerHTML = "";
    let hasSlots = false;
    
    while (current < end) {
      hasSlots = true;
      const slotStr = current.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
      const btn = document.createElement("button");
      btn.className = "nsd-time-slot";
      btn.textContent = slotStr;
      btn.onclick = () => {
        document.querySelectorAll(".nsd-time-slot").forEach((el) => el.classList.remove("selected"));
        btn.classList.add("selected");
        document.getElementById("nsdTimeValue").value = slotStr;
        document.getElementById("nsdTimeContinue").disabled = false;
      };
      grid.appendChild(btn);
      current.setMinutes(current.getMinutes() + 30);
    }
    
    if(!hasSlots) grid.innerHTML = "<div style='grid-column:1/-1; text-align:center;'>Fully Booked</div>";
  };

  // 10. Service Logic (Deterministic: Team Items > All)
  const money = (cents) => {
    const n = Number(cents || 0);
    return (n / 100).toFixed(2);
  };

  const loadServices = async () => {
    const svcDropdown = document.getElementById("nsdService");
    svcDropdown.innerHTML = "<option value=''>Loading...</option>";

    const barberId = document.getElementById("nsdBarber").value;
    let items = [];

    // A) If barber selected -> try team_member_menu_items
    if (barberId) {
      const { data, error } = await supabase
        .from("team_member_menu_items")
        .select("id, name, price_cents, duration_min")
        .eq("business_id", BUSINESS_ID)
        .eq("team_member_id", barberId)
        .eq("is_active", true)
        .order("name");

      if (!error && (data || []).length) items = data || [];
    }

    // B) Fallback
    if (!items.length) {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, price")
        .eq("business_id", BUSINESS_ID)
        .eq("is_active", true)
        .order("name");

      if (!error && (data || []).length) {
        items = (data || []).map(s => ({
          id: s.id,
          name: s.name,
          price_cents: Math.round(Number(s.price || 0) * 100),
          duration_min: null,
        }));
      }
    }

    svcDropdown.innerHTML = "<option value=''>Select Service</option>";

    if (!items.length) {
      svcDropdown.innerHTML = "<option value=''>No services available</option>";
      return;
    }

    items.forEach((s) => {
      const label = `${s.name} ($${money(s.price_cents)})`;
      svcDropdown.appendChild(new Option(label, s.id));
    });
  };

  // 11. Wiring
  document.getElementById("nsdCloseBtn").addEventListener("click", window.closeBooking);
  document.getElementById("nsdGateGuest").onclick = () => setStep(1);
  document.getElementById("nsdGatePortal").onclick = () => {
    window.location.href = `/customer-portal?business_id=${encodeURIComponent(BUSINESS_ID)}`;
  };

  document.getElementById("nsdPrevMonth").onclick = () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); };
  document.getElementById("nsdNextMonth").onclick = () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); };

  document.getElementById("nsdCalContinue").onclick = () => {
    document.getElementById("nsdStep2DateLabel").textContent = selectedDate.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    setStep(2);
    renderTimeSlots();
  };

  document.getElementById("nsdBackToDate").onclick = () => setStep(1);
  document.getElementById("nsdTimeContinue").onclick = () => { setStep(3); loadServices(); };
  document.getElementById("nsdBackToTime").onclick = () => setStep(2);

  // 12. Submit Logic (Schema V2 Patch applied) ✅
  document.getElementById("nsdSubmitBtn").onclick = async () => {
    const btn = document.getElementById("nsdSubmitBtn");
    
    // Data Gathering
    const selectedTimeLabel = document.getElementById("nsdTimeValue").value; // e.g., "10:30 AM"
    const dateOnly = selectedDate.toISOString().split("T")[0]; // "2023-10-27"

    // Construct Robust ISO Timestamp (start_at)
    const combinedDate = new Date(selectedDate);
    const [time, modifier] = selectedTimeLabel.split(" ");
    let [hours, minutes] = time.split(":");
    if (hours === "12") hours = "00";
    if (modifier === "PM") hours = parseInt(hours, 10) + 12;
    combinedDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    const startAt = combinedDate.toISOString();

    const payload = {
      business_id: BUSINESS_ID,
      team_member_id: document.getElementById("nsdBarber").value || null,

      // ID Mapping (Using direct value for now)
      menu_item_id: document.getElementById("nsdService").value,
      team_member_menu_item_id: document.getElementById("nsdService").value,

      start_at: startAt,
      date_only: dateOnly,
      time_label: selectedTimeLabel,

      client_name: document.getElementById("nsdClientName").value.trim(),
      client_phone: document.getElementById("nsdClientPhone").value.trim(),
      client_email: (document.getElementById("nsdClientEmail")?.value || "").trim() || null,

      sms_opt_in: document.getElementById("nsdSmsConsent").checked,
      email_opt_in: !!(document.getElementById("nsdClientEmail")?.value || "").trim(),

      status: "booked",
      source: "public_booking",
    };

    if (!payload.menu_item_id || !payload.client_name || !payload.client_phone) {
      alert("Please fill in Name, Phone, and Service.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Processing...";
    
    // Write to 'bookings' table
    const { error } = await supabase.from("bookings").insert([payload]);

    if (error) {
      alert("Error: " + error.message);
      btn.disabled = false;
      btn.textContent = "Confirm Booking";
    } else {
      document.querySelectorAll(".nsd-step").forEach((s) => (s.style.display = "none"));
      document.getElementById("nsdStepLabel").style.display = "none";
      document.getElementById("nsdSuccessInline").style.display = "block";
      document.getElementById("nsdSuccessDetails").textContent = `${payload.date_only} @ ${payload.time_label}`;
    }
  };

  // 13. Initialization Data
  const { data: biz } = await supabase.from("business").select("name,bio,shop_bio").eq("id", BUSINESS_ID).single();
  if (biz) {
    document.getElementById("nsdShopName").textContent = biz.name || "Booking";
    document.getElementById("nsdShopTagline").textContent = biz.shop_bio || biz.bio || "";
  }

  // Load Base Hours
  const { data: hrs } = await supabase.from("business_hours").select("*").eq("business_id", BUSINESS_ID);
  hrs?.forEach((r) => (globalBizHours[r.day_of_week.toLowerCase()] = r));
  activeHours = { ...globalBizHours }; 

  // Load Active Team (Linked Only)
  const { data: team } = await supabase
    .from("team_members")
    .select("id,name")
    .eq("business_id", BUSINESS_ID)
    .eq("is_active", true)
    .eq("accepts_bookings", true)
    .not("auth_user_id", "is", null)
    .order("name");

  team?.forEach((b) => document.getElementById("nsdBarber").appendChild(new Option(b.name, b.id)));

  renderCalendar();
})();

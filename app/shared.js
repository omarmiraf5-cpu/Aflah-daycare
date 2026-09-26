// Screens used by both portals: the daily sign-in roster, the printable
// children's timesheet, incident reports, and the "at the daycare" check.
import { dayStr, ROOMS, isDemo, locationPermission, SITE_NOT_SET, LOCATION_BLOCKED } from "./data.js";
import {
  $, $$, esc, icon, toast, openDialog, confirmDialog, field, options, emptyState, printSheets,
  fmtClock, fmtDay, fmtLongDay, fmtSheetDate, fmtHours, fmtDateTime, parseDay, addDays, mondayOf,
  attendanceHours, presence, SLOTS, childName, avatar, toIso, timeInput, localInput,
} from "./ui.js";

// Remembers the chosen day / period while moving between screens
export const state = {
  attendanceDay: dayStr(),
  sheetStart: null,
  sheetChild: null,
};

const SLOT_LABELS = { sign_in_1: "Sign in", sign_out_1: "Sign out", sign_in_2: "Sign in", sign_out_2: "Sign out" };
const PRESENCE = {
  in: ["Here now", "c-green"],
  out: ["Signed out", "c-blue"],
  notyet: ["Not signed in", ""],
  absent: ["Absent", "c-red"],
};

export const roomOf = (child) => child.room || ROOMS[child.program] || child.program;

// ---------------------------------------------------------------------------
// "At the daycare" status for staff (sign in and out only work on site)
// ---------------------------------------------------------------------------

export async function siteStatus(ctx, holder) {
  const { api, profile } = ctx;
  if (!holder || profile.role === "admin") return;
  const draw = (status) => {
    if (!holder.isConnected) return stop();
    const retry = (label) => `<button class="btn btn--ghost btn--sm" type="button" data-site-check>${label}</button>`;
    const views = {
      checking: ["geo--checking", "Checking you're at the daycare…", ""],
      here: ["geo--here", "At the daycare. You can sign in and out.", ""],
      away: ["geo--away", status.message, retry("Check again")],
      error: ["geo--warn", status.message, retry("Try again")],
      unset: ["geo--warn", SITE_NOT_SET, ""],
      idle: ["", "Sign in and sign out only work at the daycare. Your location is checked when you tap Sign in or Sign out.", retry("Check now")],
    };
    const view = views[status.state];
    holder.hidden = !view;
    if (view) holder.innerHTML = `<div class="geo ${view[0]}" role="status">${icon("pin")}<span>${esc(view[1])}</span>${view[2]}</div>`;
  };
  const stop = api.onSiteStatus(draw);
  holder.addEventListener("click", (e) => e.target.closest("[data-site-check]") && api.checkSite());

  const settings = await api.getSettings().catch(() => null);
  if (!settings || settings.require_on_site === false) return draw({ state: "off" });
  if (settings.site_lat == null || settings.site_lng == null) return draw({ state: "unset" });
  // Check straight away when it won't pop up a permission question
  const permission = isDemo ? "granted" : await locationPermission();
  if (permission === "granted") api.checkSite({ reuse: true }).then(draw);
  else if (permission === "denied") draw({ state: "error", message: LOCATION_BLOCKED });
  else draw({ state: "idle" });
}

// ---------------------------------------------------------------------------
// Children's sign in / sign out for one day
// ---------------------------------------------------------------------------

export async function renderAttendance(ctx) {
  const { api } = ctx;
  const today = dayStr();
  const day = state.attendanceDay > today ? today : state.attendanceDay;
  const [children, rows] = await Promise.all([api.listChildren(), api.listAttendance(day)]);
  if (!ctx.isCurrent()) return;
  const enrolled = children.filter((c) => c.status === "enrolled");
  const byChild = new Map(rows.map((r) => [r.child_id, r]));
  const isToday = day === today;
  let search = "";
  let room = "";

  ctx.setHeader(
    "Children's sign in",
    fmtLongDay(day) + (isToday ? " · today" : ""),
    `<div class="day-nav">
      <button class="icon-btn" type="button" data-shift-day="-1" aria-label="Previous day">${icon("chevronLeft")}</button>
      <input class="input" type="date" id="day-pick" value="${day}" max="${today}" aria-label="Choose a day">
      <button class="icon-btn" type="button" data-shift-day="1" aria-label="Next day"${isToday ? " disabled" : ""}>${icon("chevronRight")}</button>
      ${isToday ? "" : `<button class="btn btn--ghost btn--sm" type="button" data-today>Today</button>`}
    </div>`
  );

  const rooms = [...new Set(enrolled.map(roomOf))].sort();
  ctx.view.innerHTML = `
    <div id="site-status" hidden></div>
    <div class="summary" id="att-summary"></div>
    <div class="card card--flush">
      <div class="card__head">
        <div class="toolbar" style="margin: 0; flex: 1;">
          <label class="search">${icon("search")}<span class="visually-hidden">Search children</span><input type="search" id="att-search" placeholder="Search children"></label>
          <select id="att-room" aria-label="Room"><option value="">All rooms</option>${rooms.map((r) => `<option>${esc(r)}</option>`).join("")}</select>
        </div>
        <span class="hint">${isToday ? "Tap Sign in or Sign out to record the time now. Tap a time to change it." : "Tap a slot to enter the time for this day."}</span>
      </div>
      <div class="table-wrap"><table class="table table--stack roster">
        <thead><tr><th>Child</th><th class="slot-col">Time sign in</th><th class="slot-col">Time sign out</th><th class="slot-col">Time sign in</th><th class="slot-col">Time sign out</th><th class="num">Hours</th><th></th></tr></thead>
        <tbody id="att-body"></tbody>
      </table></div>
    </div>`;

  const draw = () => {
    const counts = { in: 0, out: 0, notyet: 0, absent: 0 };
    enrolled.forEach((c) => counts[presence(byChild.get(c.id))]++);
    $("#att-summary").innerHTML = Object.entries(PRESENCE)
      .map(([key, [label, cls]]) => `<span class="chip chip--dot ${cls}">${label}: ${counts[key]}</span>`)
      .join("");

    const list = enrolled.filter((c) => (!room || roomOf(c) === room) && childName(c).toLowerCase().includes(search));
    $("#att-body").innerHTML = list.length
      ? list.map((c) => rosterRow(c, byChild.get(c.id))).join("")
      : `<tr><td colspan="7">${emptyState("users", enrolled.length ? "No children match your search." : "No enrolled children yet.")}</td></tr>`;
  };

  const rosterRow = (child, row) => {
    const [label, cls] = PRESENCE[presence(row)];
    const who = `<div class="person">${avatar(childName(child), child.id)}<div><strong>${esc(childName(child))}</strong>
      <small>${esc(roomOf(child))} · <span class="chip chip--dot ${cls}" style="padding: 0.05rem 0.45rem;">${label}</span></small>
      ${child.allergies ? `<span class="allergy" title="${esc(child.allergies)}">${icon("alert")}${esc(child.allergies)}</span>` : ""}</div></div>`;
    if (row?.absent) {
      return `<tr class="is-absent" data-child="${child.id}"><td class="stack-main">${who}</td>
        <td colspan="4" class="absent-cell" data-label="Today">Absent</td><td class="num" data-label="Hours"></td>
        <td class="num"><button class="btn btn--ghost btn--sm" type="button" data-unabsent>Undo absent</button></td></tr>`;
    }
    const next = SLOTS.findIndex((s) => !row?.[s]);
    const cells = SLOTS.map((slot, i) => {
      let inner;
      if (row?.[slot]) inner = `<button class="slot slot--time" type="button" data-edit="${slot}" aria-label="${SLOT_LABELS[slot]} time ${fmtClock(row[slot])}, change">${fmtClock(row[slot])}</button>`;
      else if (i === next) inner = `<button class="slot ${slot.startsWith("sign_in") ? "slot--in" : "slot--out"}" type="button" data-stamp="${slot}">${icon(slot.startsWith("sign_in") ? "arrowIn" : "arrowOut")}${SLOT_LABELS[slot]}</button>`;
      else inner = `<span class="slot slot--empty">—</span>`;
      return `<td class="slot-col" data-label="${SLOT_LABELS[slot]}${i > 1 ? " (2nd)" : ""}">${inner}</td>`;
    }).join("");
    const hours = attendanceHours(row);
    const hasTimes = SLOTS.some((s) => row?.[s]);
    return `<tr data-child="${child.id}"><td class="stack-main">${who}</td>${cells}
      <td class="num" data-label="Hours">${hours ? fmtHours(hours) : ""}</td>
      <td class="num">${hasTimes ? "" : `<button class="btn btn--ghost btn--sm" type="button" data-absent>Absent</button>`}</td></tr>`;
  };

  const save = async (childId, promise, message) => {
    try {
      const row = await promise;
      byChild.set(childId, row);
      draw();
      if (message) toast(message);
    } catch (err) {
      toast(err.message, "error");
      draw();
    }
  };

  const editTime = (child, slot) => {
    const row = byChild.get(child.id);
    const current = row?.[slot];
    openDialog({
      title: `${SLOT_LABELS[slot]}: ${childName(child)}`,
      body: `<p class="muted">${fmtLongDay(day)}</p>${field("Time", `<input type="time" name="time" required value="${timeInput(current) || (isToday ? timeInput(new Date().toISOString()) : "")}">`)}`,
      submitLabel: "Save time",
      extraButton: current ? `<button class="btn btn--danger" type="button" data-clear>Clear time</button>` : "",
      onReady: (dlg, close) =>
        $("[data-clear]", dlg)?.addEventListener("click", async () => {
          await save(child.id, api.setAttendanceTime(child.id, day, slot, null), "Time cleared");
          close(true);
        }),
      onSubmit: async ({ time }) => {
        const row = await api.setAttendanceTime(child.id, day, slot, toIso(day, time));
        byChild.set(child.id, row);
        draw();
        toast(`${SLOT_LABELS[slot]} saved for ${child.first_name}`);
      },
    });
  };

  $("#att-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-child]");
    if (!tr) return;
    const child = enrolled.find((c) => c.id === tr.dataset.child);
    const stamp = e.target.closest("[data-stamp]");
    const edit = e.target.closest("[data-edit]");
    if (stamp) {
      const slot = stamp.dataset.stamp;
      if (!isToday) return editTime(child, slot);
      stamp.disabled = true;
      save(child.id, api.setAttendanceTime(child.id, day, slot, new Date().toISOString()), `${child.first_name} ${slot.startsWith("sign_in") ? "signed in" : "signed out"} at ${fmtClock(new Date().toISOString())}`);
    } else if (edit) {
      editTime(child, edit.dataset.edit);
    } else if (e.target.closest("[data-absent]")) {
      save(child.id, api.setAbsent(child.id, day, true), `${child.first_name} marked absent`);
    } else if (e.target.closest("[data-unabsent]")) {
      save(child.id, api.setAbsent(child.id, day, false));
    }
  });

  $("#att-search").addEventListener("input", (e) => {
    search = e.target.value.trim().toLowerCase();
    draw();
  });
  $("#att-room").addEventListener("change", (e) => {
    room = e.target.value;
    draw();
  });
  const setDay = (d) => {
    state.attendanceDay = d > today ? today : d;
    ctx.refresh();
  };
  $("#day-pick").addEventListener("change", (e) => e.target.value && setDay(e.target.value));
  $$("[data-shift-day]").forEach((b) => b.addEventListener("click", () => setDay(dayStr(addDays(parseDay(day), Number(b.dataset.shiftDay))))));
  $("[data-today]")?.addEventListener("click", () => setDay(today));
  draw();
  siteStatus(ctx, $("#site-status"));
}

// ---------------------------------------------------------------------------
// Children's timesheet (four weeks, Monday to Friday, like the paper form)
// ---------------------------------------------------------------------------

export function sheetHtml(child, rowsByDay, start) {
  let total = 0;
  const today = dayStr();
  const lines = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 0; d < 5; d++) {
      const date = dayStr(addDays(start, w * 7 + d));
      const row = rowsByDay.get(date);
      const hours = attendanceHours(row);
      total += hours;
      const dayName = ["MON", "TUE", "WED", "THU", "FRI"][d];
      const times = row?.absent
        ? `<td colspan="4" class="sheet__absent">Absent</td>`
        : SLOTS.map((s) => `<td>${row?.[s] ? fmtClock(row[s]) : ""}</td>`).join("");
      lines.push(`<tr${date > today ? ' class="is-future"' : ""}><td class="sheet__day">${dayName}</td><td>${row || date <= today ? fmtSheetDate(date) : ""}</td>${times}<td>${hours ? fmtHours(hours) : ""}</td></tr>`);
    }
  }
  const dob = child.date_of_birth ? parseDay(child.date_of_birth).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }) : "";
  return `
    <article class="sheet">
      <p class="sheet__org">Aflah Daycare and Out of School-Care</p>
      <h2 class="sheet__title">Children Timesheet</h2>
      <div class="sheet__fields">
        <div>Child's Full Name: <span>${esc(childName(child))}</span></div>
        <div>Date of Birth: <span>${esc(dob)}</span></div>
        <div>ROOM: <span>${esc(roomOf(child))}</span></div>
      </div>
      <table>
        <thead><tr><th style="width: 9%">DAY</th><th style="width: 13%">DATE</th><th>TIME<br>SIGN IN</th><th>TIME<br>SIGN OUT</th><th>TIME<br>SIGN IN</th><th>TIME<br>SIGN OUT</th><th style="width: 11%">HOURS</th></tr></thead>
        <tbody>${lines.join("")}</tbody>
      </table>
      <div class="sheet__foot"><div>Parents Signature: <span>&nbsp;</span></div><div>TOTAL HOURS: <span>${fmtHours(total)}</span></div></div>
    </article>`;
}

export async function renderTimesheets(ctx, { allowPrintAll = false } = {}) {
  const { api } = ctx;
  state.sheetStart ||= dayStr(addDays(mondayOf(new Date()), -21));
  const start = parseDay(state.sheetStart);
  const end = addDays(start, 25);
  const [children, rows] = await Promise.all([api.listChildren(), api.listAttendanceBetween(dayStr(start), dayStr(end))]);
  if (!ctx.isCurrent()) return;
  const enrolled = children.filter((c) => c.status === "enrolled");
  if (!enrolled.length) {
    ctx.setHeader("Timesheets");
    ctx.view.innerHTML = `<div class="card">${emptyState("users", "Add enrolled children to see their timesheets.")}</div>`;
    return;
  }
  if (!enrolled.some((c) => c.id === state.sheetChild)) state.sheetChild = enrolled[0].id;
  const rowsFor = (childId) => new Map(rows.filter((r) => r.child_id === childId).map((r) => [r.day, r]));
  const child = enrolled.find((c) => c.id === state.sheetChild);
  const period = `${fmtDay(dayStr(start), { month: "short", day: "numeric" })} – ${fmtDay(dayStr(addDays(start, 25)), { month: "short", day: "numeric", year: "numeric" })}`;

  ctx.setHeader(
    "Timesheets",
    `Four weeks, Monday to Friday · ${period}`,
    `<button class="btn btn--ghost" type="button" data-print-one>${icon("file")}Print this timesheet</button>${allowPrintAll ? `<button class="btn" type="button" data-print-all>${icon("file")}Print all children</button>` : ""}`
  );
  ctx.view.innerHTML = `
    <div class="toolbar">
      <select id="sheet-child" aria-label="Child">${options(enrolled.map((c) => [c.id, `${childName(c)} · ${roomOf(c)}`]), child.id)}</select>
      <div class="day-nav">
        <button class="icon-btn" type="button" data-period="-28" aria-label="Previous four weeks">${icon("chevronLeft")}</button>
        <button class="btn btn--ghost btn--sm" type="button" data-period="0">Latest four weeks</button>
        <button class="icon-btn" type="button" data-period="28" aria-label="Next four weeks">${icon("chevronRight")}</button>
      </div>
    </div>
    ${sheetHtml(child, rowsFor(child.id), start)}`;

  $("#sheet-child").addEventListener("change", (e) => {
    state.sheetChild = e.target.value;
    ctx.refresh();
  });
  $$("[data-period]").forEach((b) =>
    b.addEventListener("click", () => {
      const step = Number(b.dataset.period);
      state.sheetStart = step ? dayStr(addDays(start, step)) : dayStr(addDays(mondayOf(new Date()), -21));
      ctx.refresh();
    })
  );
  $("[data-print-one]").addEventListener("click", () => printSheets(sheetHtml(child, rowsFor(child.id), start)));
  $("[data-print-all]")?.addEventListener("click", () => printSheets(enrolled.map((c) => sheetHtml(c, rowsFor(c.id), start)).join("")));
}

// ---------------------------------------------------------------------------
// Incident reports
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  ["injury", "Injury", "c-red"],
  ["illness", "Illness", "c-orange"],
  ["behaviour", "Behaviour", "c-purple"],
  ["allergy", "Allergic reaction", "c-pink"],
  ["other", "Other", "c-blue"],
];
const catOf = (key) => CATEGORIES.find((c) => c[0] === key) || CATEGORIES[4];

export function incidentCard(incident, childrenById, staffById) {
  const [, label, cls] = catOf(incident.category);
  const child = childrenById.get(incident.child_id);
  const reporter = staffById?.get(incident.reported_by);
  return `
    <article class="incident ${cls}" data-incident="${incident.id}" tabindex="0" role="button" aria-label="Open report">
      <div class="incident__top">
        <strong>${esc(child ? childName(child) : "No specific child")}</strong>
        <span class="chip ${cls}">${label}</span>
        <span class="chip ${incident.status === "open" ? "c-orange" : "c-green"}">${incident.status === "open" ? "Waiting for review" : "Reviewed"}</span>
        <span class="muted" style="margin-left: auto; font-size: 0.85rem;">${fmtDateTime(incident.occurred_at)}</span>
      </div>
      <p>${esc(incident.description)}</p>
      ${reporter ? `<small class="muted">Reported by ${esc(reporter.full_name)}${incident.parent_notified ? " · Parent notified" : ""}</small>` : incident.parent_notified ? `<small class="muted">Parent notified</small>` : ""}
    </article>`;
}

// Opens the incident form (new or edit). Admins also see review fields.
export function incidentForm({ api, incident = null, children, isAdmin, onSaved }) {
  const i = incident || {};
  const readOnly = !isAdmin && i.id && i.status !== "open";
  const childOptions = [["", "Not about a specific child"], ...children.filter((c) => c.status === "enrolled" || c.id === i.child_id).map((c) => [c.id, childName(c)])];
  const dis = readOnly ? " disabled" : "";
  const body = `
    ${readOnly ? `<p class="hint" style="margin-bottom: 1rem;">This report has been reviewed by the director, so it can no longer be changed.</p>` : ""}
    <div class="form-grid">
      ${field("Child involved", `<select name="child_id"${dis}>${options(childOptions, i.child_id)}</select>`)}
      ${field("Type of incident", `<select name="category"${dis}>${options(CATEGORIES.map(([k, l]) => [k, l]), i.category || "injury")}</select>`)}
      ${field("Date and time", `<input type="datetime-local" name="occurred_at" required value="${localInput(i.occurred_at)}"${dis}>`)}
      ${field("Where it happened", `<input name="location" placeholder="e.g. Playground, Toddler Room" value="${esc(i.location)}"${dis}>`)}
      ${field("What happened", `<textarea name="description" placeholder="Describe what happened, in order."${readOnly ? " disabled" : " required"}>${esc(i.description)}</textarea>`, "full")}
      ${field("Action taken", `<textarea name="action_taken" placeholder="First aid, comfort, who was called…"${dis}>${esc(i.action_taken)}</textarea>`, "full")}
      ${field("Witnesses", `<input name="witnesses" placeholder="Staff or others who saw it" value="${esc(i.witnesses)}"${dis}>`, "full")}
      <label class="check full"><input type="checkbox" name="parent_notified"${i.parent_notified ? " checked" : ""}${dis}> Parent or guardian has been told</label>
      ${field("When they were told", `<input type="datetime-local" name="parent_notified_at" value="${i.parent_notified_at ? localInput(i.parent_notified_at) : ""}"${dis}>`, "full")}
      ${isAdmin ? `<p class="form-section">Director's review</p>
        ${field("Status", `<select name="status">${options([["open", "Waiting for review"], ["reviewed", "Reviewed"]], i.status || "open")}</select>`)}
        ${field("Director's notes", `<textarea name="admin_notes" placeholder="Follow-up, conversations with parents…">${esc(i.admin_notes)}</textarea>`, "full")}` : ""}
    </div>`;
  return openDialog({
    title: i.id ? "Incident report" : "New incident report",
    body,
    submitLabel: i.id ? "Save changes" : "Submit report",
    extraButton: isAdmin && i.id ? `<button class="btn btn--danger" type="button" data-delete>${icon("trash")}Delete</button>` : "",
    onReady: (dlg, close) =>
      $("[data-delete]", dlg)?.addEventListener("click", async () => {
        if (!(await confirmDialog({ title: "Delete this report?", message: "The report will be removed permanently.", confirmLabel: "Delete", danger: true }))) return;
        await api.deleteIncident(i.id);
        toast("Report deleted");
        close(true);
        onSaved?.();
      }),
    onSubmit: readOnly
      ? null
      : async (values) => {
          const record = {
            ...(i.id ? { id: i.id } : {}),
            child_id: values.child_id || null,
            category: values.category,
            occurred_at: new Date(values.occurred_at).toISOString(),
            location: values.location,
            description: values.description.trim(),
            action_taken: values.action_taken,
            witnesses: values.witnesses,
            parent_notified: values.parent_notified,
            parent_notified_at: values.parent_notified && values.parent_notified_at ? new Date(values.parent_notified_at).toISOString() : null,
          };
          if (!record.description) throw new Error("Please describe what happened.");
          if (isAdmin) Object.assign(record, { status: values.status, admin_notes: values.admin_notes });
          await api.saveIncident(record);
          toast(i.id ? "Report updated" : "Incident report submitted");
          onSaved?.();
        },
  });
}

// Click or press Enter on a report card to open it
export function bindIncidentCards(list, open) {
  if (!list) return;
  list.addEventListener("click", (e) => {
    const card = e.target.closest("[data-incident]");
    if (card) open(card.dataset.incident);
  });
  list.addEventListener("keydown", (e) => {
    const card = e.target.closest("[data-incident]");
    if (card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open(card.dataset.incident);
    }
  });
}

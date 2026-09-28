// Admin (director) portal: dashboard, children, staff, attendance, timesheets,
// staff hours, payments, incident reviews and settings.
import { dayStr, ROOMS, browserPosition, fmtDistance } from "./data.js";
import {
  $, $$, esc, icon, toast, openDialog, confirmDialog, field, options, emptyState, startPortal,
  fmtMoney, fmtDay, fmtClock, fmtHours, fmtDateTime, parseDay, addDays, mondayOf, hoursBetween,
  childName, avatar, ageFrom, presence, toIso, timeInput,
} from "./ui.js";
import { state, roomOf, renderAttendance, renderTimesheets, incidentCard, incidentForm, bindIncidentCards } from "./shared.js";
import { readFile, parseDelimited, buildImport, templateCsv } from "./import.js";

const PROGRAMS = ["Seedlings", "Sprouts", "Saplings", "Branches"];
const PROGRAM_LABEL = { Seedlings: "Seedlings (infants)", Sprouts: "Sprouts (toddlers)", Saplings: "Saplings (preschool)", Branches: "Branches (school age)" };
const STATUS = { enrolled: ["Enrolled", "c-green"], waitlist: ["Waitlist", "c-orange"], withdrawn: ["Withdrawn", ""] };
const METHODS = [["e-transfer", "E-transfer"], ["cash", "Cash"], ["cheque", "Cheque"], ["card", "Card"], ["subsidy", "Subsidy"], ["other", "Other"]];
const methodLabel = (m) => (METHODS.find(([k]) => k === m) || [m, m])[1];

const cents = (n) => Math.round(Number(n || 0) * 100);
const sumCents = (list) => list.reduce((s, x) => s + cents(x.amount), 0);

// Balance for each child: charged, paid, outstanding and whether anything is overdue
function balances(children, charges, payments) {
  const today = dayStr();
  return children
    .map((child) => {
      const ch = charges.filter((c) => c.child_id === child.id);
      const pa = payments.filter((p) => p.child_id === child.id);
      const charged = sumCents(ch);
      const paid = sumCents(pa);
      const balance = charged - paid;
      const overdue = Math.max(0, sumCents(ch.filter((c) => c.due_date < today)) - paid);
      const status = balance > 0 ? (overdue > 0 ? "overdue" : "due") : balance < 0 ? "credit" : "paid";
      return { child, charged: charged / 100, paid: paid / 100, balance: balance / 100, overdue: overdue / 100, status, hasActivity: ch.length + pa.length > 0 };
    })
    .filter((b) => b.hasActivity || b.child.status === "enrolled");
}
const BAL_STATUS = { overdue: ["Overdue", "c-red"], due: ["Due", "c-orange"], paid: ["Paid up", "c-green"], credit: ["In credit", "c-blue"] };

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

async function renderDashboard(ctx) {
  const { api } = ctx;
  const today = dayStr();
  const [children, staff, attendance, shifts, incidents, charges, payments, settings] = await Promise.all([
    api.listChildren(), api.listStaff(), api.listAttendance(today), api.listShifts({ from: addDays(new Date(), -7).toISOString() }),
    api.listIncidents(), api.listCharges(), api.listPayments(), api.getSettings().catch(() => ({})),
  ]);
  if (!ctx.isCurrent()) return;
  const enrolled = children.filter((c) => c.status === "enrolled");
  const byId = new Map(children.map((c) => [c.id, c]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const rows = new Map(attendance.map((r) => [r.child_id, r]));
  const here = enrolled.filter((c) => presence(rows.get(c.id)) === "in");
  const absent = enrolled.filter((c) => presence(rows.get(c.id)) === "absent").length;
  const onShift = shifts.filter((s) => !s.clock_out);
  const pending = staff.filter((s) => s.role === "pending" && s.active);
  const openIncidents = incidents.filter((i) => i.status === "open");
  const bal = balances(children, charges, payments);
  const outstanding = bal.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const overdue = bal.filter((b) => b.status === "overdue").sort((a, b) => b.balance - a.balance);
  const siteMissing = settings.require_on_site !== false && (settings.site_lat == null || settings.site_lng == null);
  ctx.setCount("incidents", openIncidents.length);
  ctx.setCount("staff", pending.length);

  const hello = (ctx.profile.full_name || "").split(" ")[0];
  ctx.setHeader(`Welcome back${hello ? `, ${hello}` : ""}`, new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
  const stat = (href, cls, iconName, value, label) =>
    `<a class="stat ${cls}" href="${href}"><span class="stat__icon">${icon(iconName)}</span><span><span class="stat__value">${value}</span><span class="stat__label">${label}</span></span></a>`;

  ctx.view.innerHTML = `
    <div class="stats">
      ${stat("#children", "c-blue", "users", enrolled.length, `Children enrolled${children.some((c) => c.status === "waitlist") ? ` · ${children.filter((c) => c.status === "waitlist").length} on waitlist` : ""}`)}
      ${stat("#attendance", "c-green", "userCheck", `${here.length}<small style="font-size: 1rem; color: var(--muted);"> / ${enrolled.length}</small>`, `Here now${absent ? ` · ${absent} absent` : ""}`)}
      ${stat("#hours", "c-purple", "clock", onShift.length, `Staff on shift now`)}
      ${stat("#payments", overdue.length ? "c-red" : "c-orange", "wallet", fmtMoney(outstanding), `Outstanding${overdue.length ? ` · ${overdue.length} overdue` : ""}`)}
    </div>
    <div class="grid-2">
      <div class="stack">
        <section class="card">
          <div class="card__head"><h2>Children here now</h2><a class="btn btn--ghost btn--sm" href="#attendance">Sign in and out</a></div>
          ${here.length
            ? `<ul class="list">${here.map((c) => {
                const r = rows.get(c.id);
                const since = r.sign_in_2 && !r.sign_out_2 ? r.sign_in_2 : r.sign_in_1;
                return `<li>${avatar(childName(c), c.id)}<div class="list__main"><strong>${esc(childName(c))}</strong><small>${esc(roomOf(c))}${c.allergies ? ` · <span class="allergy">${icon("alert")}${esc(c.allergies)}</span>` : ""}</small></div><span class="chip chip--dot c-green">In since ${fmtClock(since)}</span></li>`;
              }).join("")}</ul>`
            : emptyState("userCheck", "No children are signed in right now.")}
        </section>
        <section class="card">
          <div class="card__head"><h2>Staff on shift</h2><a class="btn btn--ghost btn--sm" href="#hours">Staff hours</a></div>
          ${onShift.length
            ? `<ul class="list">${onShift.map((s) => {
                const p = staffById.get(s.staff_id) || { full_name: "Staff member" };
                return `<li>${avatar(p.full_name, s.staff_id)}<div class="list__main"><strong>${esc(p.full_name)}</strong><small>${esc(p.position || "")}</small></div><span class="chip chip--dot c-purple">Since ${fmtClock(s.clock_in)}</span></li>`;
              }).join("")}</ul>`
            : emptyState("clock", "Nobody is signed in to a shift.")}
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <div class="card__head"><h2>Needs your attention</h2></div>
          ${!siteMissing && !pending.length && !openIncidents.length && !overdue.length ? emptyState("check", "All caught up. Nothing needs your attention.") : ""}
          <ul class="list" id="attention">
            ${siteMissing ? `<li><span class="stat__icon c-orange" style="width: 36px; height: 36px; border-radius: 10px;">${icon("pin")}</span><div class="list__main"><strong>Set the daycare's location</strong><small>Staff can't sign in or out until it's set</small></div><a class="btn btn--sm" href="#settings">Set it</a></li>` : ""}
            ${pending.map((p) => `<li>${avatar(p.full_name || p.email, p.id)}<div class="list__main"><strong>${esc(p.full_name || p.email)}</strong><small>New staff account waiting for approval</small></div><button class="btn btn--sm" type="button" data-approve="${p.id}">Approve</button></li>`).join("")}
            ${openIncidents.slice(0, 5).map((i) => `<li><span class="stat__icon c-orange" style="width: 36px; height: 36px; border-radius: 10px;">${icon("alert")}</span><div class="list__main"><strong>Incident: ${esc(i.child_id ? childName(byId.get(i.child_id)) : "No specific child")}</strong><small>${fmtDateTime(i.occurred_at)} · ${esc(staffById.get(i.reported_by)?.full_name || "")}</small></div><button class="btn btn--ghost btn--sm" type="button" data-incident="${i.id}">Review</button></li>`).join("")}
            ${overdue.slice(0, 5).map((b) => `<li><span class="stat__icon c-red" style="width: 36px; height: 36px; border-radius: 10px;">${icon("wallet")}</span><div class="list__main"><strong>${esc(childName(b.child))}</strong><small>${fmtMoney(b.overdue)} overdue · ${esc(b.child.guardian_name || "")}</small></div><a class="btn btn--ghost btn--sm" href="#payments">View</a></li>`).join("")}
          </ul>
        </section>
      </div>
    </div>`;

  $("#attention").addEventListener("click", async (e) => {
    const approve = e.target.closest("[data-approve]");
    const inc = e.target.closest("[data-incident]");
    if (approve) {
      approve.disabled = true;
      try {
        await api.saveStaff({ id: approve.dataset.approve, role: "staff" });
        toast("Approved. They can now use the staff portal.");
      } catch (err) {
        toast(err.message, "error");
      }
      ctx.refresh();
    } else if (inc) {
      incidentForm({ api, incident: incidents.find((i) => i.id === inc.dataset.incident), children, isAdmin: true, onSaved: () => ctx.refresh() });
    }
  });
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

let childTab = "enrolled";

async function renderChildren(ctx) {
  const { api } = ctx;
  const [children, charges, payments] = await Promise.all([api.listChildren(), api.listCharges(), api.listPayments()]);
  if (!ctx.isCurrent()) return;
  const balanceOf = new Map(balances(children, charges, payments).map((b) => [b.child.id, b]));
  const counts = { enrolled: 0, waitlist: 0, withdrawn: 0 };
  children.forEach((c) => counts[c.status]++);
  let search = "";

  ctx.setHeader(
    "Children",
    `${counts.enrolled} enrolled · ${counts.waitlist} on the waitlist`,
    `<button class="btn btn--ghost" type="button" data-import>${icon("upload")}Import</button><button class="btn btn--yellow" type="button" data-add>${icon("plus")}Add a child</button>`
  );
  ctx.view.innerHTML = `
    <div class="toolbar">
      <div class="tabs" role="tablist" style="margin: 0;">
        ${[["enrolled", "Enrolled"], ["waitlist", "Waitlist"], ["withdrawn", "Withdrawn"], ["all", "All"]]
          .map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${childTab === k ? "is-active" : ""}" aria-selected="${childTab === k}">${l}${k !== "all" ? ` (${counts[k]})` : ""}</button>`).join("")}
      </div>
      <label class="search">${icon("search")}<span class="visually-hidden">Search</span><input type="search" id="child-search" placeholder="Search by child or parent"></label>
    </div>
    <div class="card card--flush"><div class="table-wrap"><table class="table table--stack">
      <thead><tr><th>Child</th><th>Room</th><th>Parent / guardian</th><th>Health</th><th class="num">Monthly fee</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody id="child-body"></tbody>
    </table></div></div>`;

  const draw = () => {
    const list = children.filter((c) => (childTab === "all" || c.status === childTab) && `${childName(c)} ${c.guardian_name || ""}`.toLowerCase().includes(search));
    $("#child-body").innerHTML = list.length
      ? list.map((c) => {
          const b = balanceOf.get(c.id);
          const [label, cls] = STATUS[c.status];
          return `<tr class="is-clickable" data-child="${c.id}" tabindex="0">
            <td class="stack-main"><div class="person">${avatar(childName(c), c.id)}<div><strong>${esc(childName(c))}</strong><small>${esc(ageFrom(c.date_of_birth))}${c.date_of_birth ? ` · born ${fmtDay(c.date_of_birth, { month: "short", day: "numeric", year: "numeric" })}` : ""}</small></div></div></td>
            <td data-label="Room">${esc(roomOf(c))}<small class="muted" style="display: block;">${esc(c.program)}</small></td>
            <td data-label="Parent">${esc(c.guardian_name || "")}<small class="muted" style="display: block;">${esc(c.guardian_phone || "")}</small></td>
            <td data-label="Health">${c.allergies ? `<span class="allergy">${icon("alert")}${esc(c.allergies)}</span>` : `<span class="muted">None noted</span>`}</td>
            <td class="num" data-label="Monthly fee">${fmtMoney(c.monthly_fee)}</td>
            <td class="num" data-label="Balance">${b && b.balance ? `<span class="chip ${BAL_STATUS[b.status][1]}">${fmtMoney(b.balance)}</span>` : `<span class="muted">${fmtMoney(0)}</span>`}</td>
            <td data-label="Status"><span class="chip ${cls}">${label}</span></td></tr>`;
        }).join("")
      : `<tr><td colspan="7">${emptyState("users", children.length ? "No children match." : "No children yet. Add a child, or import your list from a spreadsheet.")}</td></tr>`;
  };

  const edit = (child) => childForm(ctx, child, () => ctx.refresh());
  $("[data-add]").addEventListener("click", () => edit(null));
  $("[data-import]").addEventListener("click", () => importChildren(ctx, children));
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    childTab = b.dataset.tab;
    ctx.refresh();
  }));
  $("#child-search").addEventListener("input", (e) => {
    search = e.target.value.trim().toLowerCase();
    draw();
  });
  const body = $("#child-body");
  body.addEventListener("click", (e) => {
    const tr = e.target.closest("[data-child]");
    if (tr) edit(children.find((c) => c.id === tr.dataset.child));
  });
  body.addEventListener("keydown", (e) => {
    const tr = e.target.closest("[data-child]");
    if (tr && e.key === "Enter") edit(children.find((c) => c.id === tr.dataset.child));
  });
  draw();
}

// Add many children at once from a spreadsheet file or pasted rows
function importChildren(ctx, existing) {
  const { api } = ctx;
  let rows = null;
  let result = null;
  const choice = { status: "enrolled", program: "Seedlings", dayFirst: false };
  const kids = (n) => `${n} ${n === 1 ? "child" : "children"}`;

  return openDialog({
    title: "Import children",
    body: `
      <div class="import">
        <p>Add your whole list at once from Excel, Numbers or Google Sheets. The first row should be the column headings. Your own headings are fine, like <em>Child's name</em>, <em>Date of birth</em>, <em>Parent</em> and <em>Phone</em>, or <button type="button" class="link-btn" data-template>download the template</button>.</p>
        <div class="import__pick">
          <label class="btn btn--ghost">${icon("upload")}Choose a file<input type="file" class="visually-hidden" data-file accept=".xlsx,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
          <span class="muted" data-file-name>Excel (.xlsx) or CSV file</span>
        </div>
        ${field("Or paste the rows here, headings included", `<textarea data-paste rows="4" placeholder="Copy the rows in your spreadsheet, then paste them here"></textarea>`, "full")}
        <div class="import__options" data-options hidden></div>
        <div data-preview aria-live="polite"></div>
      </div>`,
    submitLabel: "Add children",
    onReady: (dlg) => {
      dlg.classList.add("dlg--wide");
      const submit = $('[type="submit"]', dlg);
      const preview = $("[data-preview]", dlg);
      const optionsBox = $("[data-options]", dlg);
      const paste = $("[data-paste]", dlg);
      const fileInput = $("[data-file]", dlg);
      const fileName = $("[data-file-name]", dlg);

      const showError = (message) => {
        result = null;
        optionsBox.hidden = true;
        preview.innerHTML = `<p class="import__note is-error">${esc(message)}</p>`;
        submit.disabled = true;
        submit.textContent = "Add children";
      };

      const draw = () => {
        result = rows ? buildImport(rows, { ...choice, existing }) : null;
        if (result?.error) return showError(result.error);
        const ready = result ? result.ready.length : 0;
        submit.disabled = !ready;
        submit.textContent = ready ? `Add ${kids(ready)}` : "Add children";
        optionsBox.hidden = !result;
        if (!result) {
          preview.innerHTML = "";
          return;
        }

        // Choices only appear when the file leaves something open
        optionsBox.innerHTML = [
          !result.needsStatus ? "" : field("Children without a status", `<select data-choice="status">${options([["enrolled", "Enrolled"], ["waitlist", "Waitlist"]], choice.status)}</select>`),
          result.needsProgram ? field("Program when there's no program or date of birth", `<select data-choice="program">${options(PROGRAMS.map((p) => [p, PROGRAM_LABEL[p]]), choice.program)}</select>`) : "",
          result.askDateOrder ? field("Dates like 03/04/2021 mean", `<select data-choice="dayFirst">${options([["", "March 4, 2021 (month first)"], ["1", "3 April 2021 (day first)"]], choice.dayFirst ? "1" : "")}</select>`) : "",
        ].join("");

        const skipped = result.items.filter((i) => i.errors.length).length;
        const dupes = result.items.filter((i) => !i.errors.length && i.duplicate).length;
        const toCheck = result.items.filter((i) => i.ok && i.warnings.length).length;
        preview.innerHTML = `
          <p class="import__summary"><strong>${ready ? `${kids(ready)} ready to add` : "Nobody to add yet"}</strong>${dupes ? ` · ${dupes} already in your list` : ""}${skipped ? ` · ${skipped} can't be added` : ""}${toCheck ? ` · ${toCheck} to check` : ""}</p>
          ${result.ignored.length ? `<p class="import__note">Columns not imported: ${result.ignored.map(esc).join(", ")}</p>` : ""}
          <div class="table-wrap import__table"><table class="table table--stack">
            <thead><tr><th>Row</th><th>Child</th><th>Program</th><th>Parent / guardian</th><th>Status</th></tr></thead>
            <tbody>${result.items.map((item) => {
              const c = item.child;
              const notes = [
                ...item.errors.map((e) => `<small class="import__issue is-error">Won't be added: ${esc(e)}</small>`),
                item.duplicate && !item.errors.length ? `<small class="import__issue">Skipped: ${esc(item.duplicate)}</small>` : "",
                ...(item.ok ? item.warnings.map((w) => `<small class="import__issue is-warn">${esc(w)}</small>`) : []),
              ].join("");
              const [label, cls] = STATUS[c.status];
              return `<tr class="${item.ok ? "" : "is-skipped"}">
                <td data-label="Row" class="muted">${item.line}</td>
                <td class="stack-main"><strong>${esc(childName(c) || "No name")}</strong>${c.date_of_birth ? `<small class="muted" style="display: block;">Born ${fmtDay(c.date_of_birth, { month: "short", day: "numeric", year: "numeric" })} · ${esc(ageFrom(c.date_of_birth))}</small>` : ""}${notes}</td>
                <td data-label="Program">${esc(c.program)}${c.room ? `<small class="muted" style="display: block;">${esc(c.room)}</small>` : ""}</td>
                <td data-label="Parent">${esc(c.guardian_name || "")}<small class="muted" style="display: block;">${esc(c.guardian_phone || c.guardian_email || "")}</small></td>
                <td data-label="Status"><span class="chip ${cls}">${label}</span></td></tr>`;
            }).join("")}</tbody>
          </table></div>`;
      };

      optionsBox.addEventListener("change", (e) => {
        const key = e.target.dataset.choice;
        if (!key) return;
        choice[key] = key === "dayFirst" ? e.target.value === "1" : e.target.value;
        draw();
      });

      $("[data-template]", dlg).addEventListener("click", () => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv" }));
        link.download = "aflah-children-template.csv";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      });

      fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;
        fileName.textContent = file.name;
        paste.value = "";
        try {
          rows = await readFile(file);
        } catch (err) {
          rows = null;
          return showError(err.message);
        }
        draw();
      });

      let timer;
      paste.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          fileInput.value = "";
          fileName.textContent = "Excel (.xlsx) or CSV file";
          rows = paste.value.trim() ? parseDelimited(paste.value) : null;
          draw();
        }, 250);
      });

      draw();
    },
    onSubmit: async () => {
      if (!result?.ready?.length) throw new Error("Choose a file or paste your list first.");
      const saved = await api.importChildren(result.ready);
      const statuses = new Set(saved.map((c) => c.status));
      childTab = statuses.size === 1 ? [...statuses][0] : "all";
      toast(`${kids(saved.length)} added`);
      ctx.refresh();
    },
  });
}

function childForm(ctx, child, onSaved) {
  const { api } = ctx;
  const c = child || { program: "Seedlings", status: "enrolled", start_date: dayStr() };
  return openDialog({
    title: child ? childName(child) : "Add a child",
    body: `
      <div class="form-grid">
        ${field("First name", `<input name="first_name" required value="${esc(c.first_name)}">`)}
        ${field("Last name", `<input name="last_name" value="${esc(c.last_name)}">`)}
        ${field("Date of birth", `<input type="date" name="date_of_birth" value="${esc(c.date_of_birth)}">`)}
        ${field("Status", `<select name="status">${options(Object.entries(STATUS).map(([k, [l]]) => [k, l]), c.status)}</select>`)}
        ${field("Program", `<select name="program">${options(PROGRAMS.map((p) => [p, PROGRAM_LABEL[p]]), c.program)}</select>`)}
        ${field("Room", `<input name="room" list="room-list" placeholder="${esc(ROOMS[c.program] || "")}" value="${esc(c.room)}"><datalist id="room-list">${Object.values(ROOMS).map((r) => `<option value="${esc(r)}">`).join("")}</datalist>`)}
        ${field("Start date", `<input type="date" name="start_date" value="${esc(c.start_date)}">`)}
        ${field("Monthly fee", `<input type="number" name="monthly_fee" min="0" step="0.01" inputmode="decimal" value="${esc(c.monthly_fee ?? "")}">`)}
        <p class="form-section">Parent or guardian</p>
        ${field("Name", `<input name="guardian_name" autocomplete="off" value="${esc(c.guardian_name)}">`)}
        ${field("Phone", `<input name="guardian_phone" type="tel" value="${esc(c.guardian_phone)}">`)}
        ${field("Email", `<input name="guardian_email" type="email" value="${esc(c.guardian_email)}">`)}
        ${field("Emergency contact", `<input name="emergency_contact" placeholder="Name and phone" value="${esc(c.emergency_contact)}">`)}
        <p class="form-section">Health and notes</p>
        ${field("Allergies and medical needs", `<textarea name="allergies" placeholder="Leave empty if none">${esc(c.allergies)}</textarea>`, "full")}
        ${field("Notes", `<textarea name="notes">${esc(c.notes)}</textarea>`, "full")}
      </div>`,
    submitLabel: child ? "Save changes" : "Add child",
    extraButton: child
      ? `<button class="btn btn--danger" type="button" data-delete>${icon("trash")}Delete</button><button class="btn btn--ghost" type="button" data-sheet>${icon("file")}Timesheet</button>`
      : "",
    onReady: (dlg, close) => {
      $("[data-delete]", dlg)?.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: `Delete ${childName(child)}?`,
          message: "This permanently removes the child with their timesheets, charges and payments. To keep their records, set their status to Withdrawn instead.",
          confirmLabel: "Delete permanently",
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteChild(child.id);
          toast(`${childName(child)} deleted`);
          close(true);
          onSaved();
        } catch (err) {
          toast(err.message, "error");
        }
      });
      $("[data-sheet]", dlg)?.addEventListener("click", () => {
        state.sheetChild = child.id;
        close(null);
        ctx.go("timesheets");
      });
    },
    onSubmit: async (values) => {
      const saved = await api.saveChild({ ...(child ? { id: child.id } : {}), ...values, monthly_fee: Number(values.monthly_fee || 0), first_name: values.first_name.trim() });
      toast(child ? "Changes saved" : `${saved.first_name} added`);
      onSaved();
    },
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const ROLE = { admin: ["Director / admin", "c-purple"], staff: ["Staff", "c-blue"], pending: ["Waiting for approval", "c-orange"] };

async function renderStaff(ctx) {
  const { api } = ctx;
  const [staff, shifts] = await Promise.all([api.listStaff(), api.listShifts({ from: addDays(new Date(), -7).toISOString() })]);
  if (!ctx.isCurrent()) return;
  const onShift = new Map(shifts.filter((s) => !s.clock_out).map((s) => [s.staff_id, s]));
  const pending = staff.filter((s) => s.role === "pending" && s.active);
  ctx.setCount("staff", pending.length);
  ctx.setHeader("Staff", `${staff.filter((s) => s.role !== "pending" && s.active).length} active staff`);

  ctx.view.innerHTML = `
    ${pending.length ? `<section class="card c-orange" style="border-left: 4px solid var(--c); margin-bottom: 1.25rem;">
      <div class="card__head"><h2>Waiting for your approval</h2></div>
      <ul class="list" id="pending">${pending.map((p) => `<li>${avatar(p.full_name || p.email, p.id)}<div class="list__main"><strong>${esc(p.full_name || "No name given")}</strong><small>${esc(p.email || "")} · signed up ${fmtDay(dayStr(new Date(p.created_at)))}</small></div>
        <button class="btn btn--ghost btn--sm" type="button" data-decline="${p.id}">Decline</button><button class="btn btn--sm" type="button" data-approve="${p.id}">${icon("check")}Approve</button></li>`).join("")}</ul>
    </section>` : ""}
    <section class="card card--flush">
      <div class="card__head"><h2>Team</h2><span class="hint">New staff create their own account in the staff portal, then you approve them here.</span></div>
      <div class="table-wrap"><table class="table table--stack">
        <thead><tr><th>Name</th><th>Position</th><th>Phone</th><th>Access</th><th>Right now</th></tr></thead>
        <tbody id="staff-body">${staff.filter((s) => s.role !== "pending" || !s.active).map((s) => {
          const [label, cls] = ROLE[s.role];
          const shift = onShift.get(s.id);
          return `<tr class="is-clickable" data-staff="${s.id}" tabindex="0">
            <td class="stack-main"><div class="person">${avatar(s.full_name || s.email, s.id)}<div><strong>${esc(s.full_name || "No name")}</strong><small>${esc(s.email || "")}</small></div></div></td>
            <td data-label="Position">${esc(s.position || "")}</td>
            <td data-label="Phone">${esc(s.phone || "")}</td>
            <td data-label="Access">${s.active ? `<span class="chip ${cls}">${label}</span>` : `<span class="chip">Access paused</span>`}</td>
            <td data-label="Right now">${shift ? `<span class="chip chip--dot c-green">On shift since ${fmtClock(shift.clock_in)}</span>` : `<span class="muted">Off shift</span>`}</td></tr>`;
        }).join("")}</tbody>
      </table></div>
    </section>`;

  $("#pending")?.addEventListener("click", async (e) => {
    const approve = e.target.closest("[data-approve]");
    const decline = e.target.closest("[data-decline]");
    if (!approve && !decline) return;
    const id = (approve || decline).dataset[approve ? "approve" : "decline"];
    try {
      if (approve) {
        await api.saveStaff({ id, role: "staff" });
        toast("Approved. They can now use the staff portal.");
      } else {
        if (!(await confirmDialog({ title: "Decline this account?", message: "They won't be able to use the portals. You can turn access back on later from their profile.", confirmLabel: "Decline", danger: true }))) return;
        await api.saveStaff({ id, active: false });
        toast("Account declined");
      }
    } catch (err) {
      toast(err.message, "error");
    }
    ctx.refresh();
  });

  const edit = (person) => {
    const self = person.id === ctx.profile.id;
    openDialog({
      title: person.full_name || person.email,
      body: `<div class="form-grid">
        ${field("Full name", `<input name="full_name" required value="${esc(person.full_name)}">`)}
        ${field("Position", `<input name="position" placeholder="e.g. Early Childhood Educator" value="${esc(person.position)}">`)}
        ${field("Phone", `<input name="phone" type="tel" value="${esc(person.phone)}">`)}
        ${field("Email", `<input value="${esc(person.email)}" readonly>`)}
        ${field("Access", `<select name="role"${self ? " disabled" : ""}>${options(Object.entries(ROLE).map(([k, [l]]) => [k, l]), person.role)}</select>`)}
        <label class="check" style="align-self: end; padding-bottom: 0.6rem;"><input type="checkbox" name="active"${person.active ? " checked" : ""}${self ? " disabled" : ""}> Can sign in</label>
        ${self ? `<p class="hint full">You can't change your own access, so you don't lock yourself out.</p>` : `<p class="hint full">"Director / admin" can see everything, including payments. "Staff" can take attendance, sign in to shifts and write incident reports.</p>`}
      </div>`,
      onSubmit: async (values) => {
        const record = { id: person.id, full_name: values.full_name.trim(), position: values.position, phone: values.phone };
        if (!self) Object.assign(record, { role: values.role, active: values.active });
        await api.saveStaff(record);
        toast("Staff details saved");
        ctx.refresh();
      },
    });
  };
  const body = $("#staff-body");
  body.addEventListener("click", (e) => {
    const tr = e.target.closest("[data-staff]");
    if (tr) edit(staff.find((s) => s.id === tr.dataset.staff));
  });
  body.addEventListener("keydown", (e) => {
    const tr = e.target.closest("[data-staff]");
    if (tr && e.key === "Enter") edit(staff.find((s) => s.id === tr.dataset.staff));
  });
}

// ---------------------------------------------------------------------------
// Staff hours
// ---------------------------------------------------------------------------

let hoursWeek = null;

async function renderHours(ctx) {
  const { api } = ctx;
  hoursWeek ||= dayStr(mondayOf(new Date()));
  const start = parseDay(hoursWeek);
  const end = addDays(start, 7);
  const [staff, shifts] = await Promise.all([api.listStaff(), api.listShifts({ from: start.toISOString(), to: end.toISOString() })]);
  if (!ctx.isCurrent()) return;
  const people = staff.filter((s) => s.role !== "pending" && (s.active || shifts.some((sh) => sh.staff_id === s.id)));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const worked = (s) => hoursBetween(s.clock_in, s.clock_out || new Date().toISOString());
  const isThisWeek = hoursWeek === dayStr(mondayOf(new Date()));
  const total = shifts.reduce((sum, s) => sum + worked(s), 0);

  ctx.setHeader(
    "Staff hours",
    `Week of ${fmtDay(hoursWeek, { month: "long", day: "numeric", year: "numeric" })} · ${fmtHours(total)} hours in total`,
    `<div class="day-nav"><button class="icon-btn" type="button" data-week="-7" aria-label="Previous week">${icon("chevronLeft")}</button>${isThisWeek ? "" : `<button class="btn btn--ghost btn--sm" type="button" data-week="0">This week</button>`}<button class="icon-btn" type="button" data-week="7" aria-label="Next week"${isThisWeek ? " disabled" : ""}>${icon("chevronRight")}</button></div>
     <button class="btn btn--yellow" type="button" data-add-shift>${icon("plus")}Add a shift</button>`
  );
  ctx.view.innerHTML = `
    <section class="card card--flush">
      <div class="card__head"><h2>Hours by day</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Staff</th>${days.map((d) => `<th class="num">${fmtDay(dayStr(d), { weekday: "short", day: "numeric" })}</th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${people.map((p) => {
          const mine = shifts.filter((s) => s.staff_id === p.id);
          const perDay = days.map((d) => mine.filter((s) => dayStr(new Date(s.clock_in)) === dayStr(d)).reduce((sum, s) => sum + worked(s), 0));
          return `<tr><td><div class="person">${avatar(p.full_name, p.id)}<div><strong>${esc(p.full_name)}</strong><small>${esc(p.position || "")}</small></div></div></td>
            ${perDay.map((h) => `<td class="num">${h ? fmtHours(h) : `<span class="muted">·</span>`}</td>`).join("")}<td class="num"><strong>${fmtHours(perDay.reduce((a, b) => a + b, 0))}</strong></td></tr>`;
        }).join("") || `<tr><td colspan="9">${emptyState("users", "No staff yet.")}</td></tr>`}</tbody>
      </table></div>
    </section>
    <section class="card card--flush" style="margin-top: 1.25rem;">
      <div class="card__head"><h2>Shifts</h2><span class="hint">Tap a shift to correct its times.</span></div>
      ${shifts.length ? `<div class="table-wrap"><table class="table table--stack"><thead><tr><th>Staff</th><th>Day</th><th>Signed in</th><th>Signed out</th><th class="num">Hours</th></tr></thead>
        <tbody id="shift-body">${shifts.map((s) => `<tr class="is-clickable" data-shift="${s.id}" tabindex="0">
          <td class="stack-main"><strong>${esc(staffById.get(s.staff_id)?.full_name || "Staff member")}</strong></td>
          <td data-label="Day">${fmtDay(dayStr(new Date(s.clock_in)))}</td>
          <td data-label="Signed in">${fmtClock(s.clock_in)}</td>
          <td data-label="Signed out">${s.clock_out ? fmtClock(s.clock_out) : `<span class="chip chip--dot c-green">On shift</span>`}</td>
          <td class="num" data-label="Hours">${fmtHours(worked(s))}</td></tr>`).join("")}</tbody></table></div>`
        : emptyState("clock", "No shifts recorded this week.")}
    </section>`;

  const shiftForm = (shift) => {
    const s = shift || {};
    const day = s.clock_in ? dayStr(new Date(s.clock_in)) : dayStr(new Date() < end ? new Date() : start);
    openDialog({
      title: shift ? "Correct a shift" : "Add a shift",
      body: `<div class="form-grid">
        ${field("Staff member", `<select name="staff_id" required${shift ? " disabled" : ""}>${options(people.map((p) => [p.id, p.full_name]), s.staff_id)}</select>`, "full")}
        ${field("Day", `<input type="date" name="day" required value="${day}">`, "full")}
        ${field("Signed in", `<input type="time" name="in" required value="${timeInput(s.clock_in)}">`)}
        ${field("Signed out", `<input type="time" name="out" value="${timeInput(s.clock_out)}">`)}
        ${field("Note", `<input name="note" placeholder="Reason for the correction" value="${esc(s.note)}">`, "full")}
        <p class="hint full">Leave "Signed out" empty if they're still on shift.</p>
      </div>`,
      extraButton: shift ? `<button class="btn btn--danger" type="button" data-delete>${icon("trash")}Delete</button>` : "",
      onReady: (dlg, close) =>
        $("[data-delete]", dlg)?.addEventListener("click", async () => {
          if (!(await confirmDialog({ title: "Delete this shift?", message: "The shift will be removed from their hours.", confirmLabel: "Delete", danger: true }))) return;
          await api.deleteShift(shift.id);
          toast("Shift deleted");
          close(true);
          ctx.refresh();
        }),
      onSubmit: async (values) => {
        const clockIn = toIso(values.day, values.in);
        const clockOut = values.out ? toIso(values.day, values.out) : null;
        if (clockOut && clockOut < clockIn) throw new Error("Signed out must be after signed in.");
        await api.saveShift({ ...(shift ? { id: shift.id } : { staff_id: values.staff_id }), clock_in: clockIn, clock_out: clockOut, note: values.note });
        toast(shift ? "Shift corrected" : "Shift added");
        ctx.refresh();
      },
    });
  };
  $$("[data-week]").forEach((b) => b.addEventListener("click", () => {
    const step = Number(b.dataset.week);
    hoursWeek = step ? dayStr(addDays(start, step)) : dayStr(mondayOf(new Date()));
    ctx.refresh();
  }));
  $("[data-add-shift]").addEventListener("click", () => shiftForm(null));
  const body = $("#shift-body");
  body?.addEventListener("click", (e) => {
    const tr = e.target.closest("[data-shift]");
    if (tr) shiftForm(shifts.find((s) => s.id === tr.dataset.shift));
  });
  body?.addEventListener("keydown", (e) => {
    const tr = e.target.closest("[data-shift]");
    if (tr && e.key === "Enter") shiftForm(shifts.find((s) => s.id === tr.dataset.shift));
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

let payTab = "balances";

async function renderPayments(ctx) {
  const { api } = ctx;
  const [children, charges, payments] = await Promise.all([api.listChildren(), api.listCharges(), api.listPayments()]);
  if (!ctx.isCurrent()) return;
  const byId = new Map(children.map((c) => [c.id, c]));
  const bal = balances(children, charges, payments).sort((a, b) => b.balance - a.balance || childName(a.child).localeCompare(childName(b.child)));
  const outstanding = bal.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const overdue = bal.filter((b) => b.status === "overdue");
  const monthStart = dayStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const collected = sumCents(payments.filter((p) => p.paid_on >= monthStart)) / 100;

  ctx.setHeader(
    "Payments",
    "Fees charged, payments received and what's still owed",
    `<button class="btn btn--ghost" type="button" data-bill>${icon("receipt")}Bill monthly tuition</button>
     <button class="btn btn--ghost" type="button" data-charge>${icon("plus")}Add a charge</button>
     <button class="btn btn--yellow" type="button" data-pay>${icon("dollar")}Record a payment</button>`
  );
  ctx.view.innerHTML = `
    <div class="stats">
      <div class="stat c-orange"><span class="stat__icon">${icon("wallet")}</span><span><span class="stat__value">${fmtMoney(outstanding)}</span><span class="stat__label">Outstanding in total</span></span></div>
      <div class="stat c-red"><span class="stat__icon">${icon("alert")}</span><span><span class="stat__value">${overdue.length}</span><span class="stat__label">Families overdue · ${fmtMoney(overdue.reduce((s, b) => s + b.overdue, 0))}</span></span></div>
      <div class="stat c-green"><span class="stat__icon">${icon("check")}</span><span><span class="stat__value">${fmtMoney(collected)}</span><span class="stat__label">Received this month</span></span></div>
    </div>
    <div class="tabs" role="tablist">
      ${[["balances", "Balances"], ["payments", `Payments (${payments.length})`], ["charges", `Charges (${charges.length})`]]
        .map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${payTab === k ? "is-active" : ""}" aria-selected="${payTab === k}">${l}</button>`).join("")}
    </div>
    <div class="card card--flush" id="pay-panel"></div>`;

  const panel = $("#pay-panel");
  const draw = () => {
    if (payTab === "balances") {
      panel.innerHTML = bal.length
        ? `<div class="table-wrap"><table class="table table--stack"><thead><tr><th>Child</th><th>Parent / guardian</th><th class="num">Charged</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
          <tbody>${bal.map((b) => `<tr class="is-clickable" data-statement="${b.child.id}" tabindex="0">
            <td class="stack-main"><div class="person">${avatar(childName(b.child), b.child.id)}<div><strong>${esc(childName(b.child))}</strong><small>${esc(roomOf(b.child))}</small></div></div></td>
            <td data-label="Parent">${esc(b.child.guardian_name || "")}<small class="muted" style="display: block;">${esc(b.child.guardian_phone || "")}</small></td>
            <td class="num" data-label="Charged">${fmtMoney(b.charged)}</td>
            <td class="num" data-label="Paid">${fmtMoney(b.paid)}</td>
            <td class="num" data-label="Balance"><strong>${fmtMoney(b.balance)}</strong></td>
            <td data-label="Status"><span class="chip ${BAL_STATUS[b.status][1]}">${BAL_STATUS[b.status][0]}${b.status === "overdue" ? ` · ${fmtMoney(b.overdue)}` : ""}</span></td>
            <td class="num">${b.balance > 0 ? `<button class="btn btn--sm" type="button" data-pay-child="${b.child.id}">Record payment</button>` : ""}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="4">Total outstanding</td><td class="num">${fmtMoney(outstanding)}</td><td colspan="2"></td></tr></tfoot></table></div>`
        : emptyState("wallet", "No charges yet. Use \"Bill monthly tuition\" to charge this month's fees.");
    } else if (payTab === "payments") {
      panel.innerHTML = payments.length
        ? `<div class="table-wrap"><table class="table table--stack"><thead><tr><th>Date</th><th>Child</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead>
          <tbody>${payments.map((p) => `<tr class="is-clickable" data-payment="${p.id}" tabindex="0"><td class="stack-main"><strong>${fmtDay(p.paid_on, { month: "short", day: "numeric", year: "numeric" })}</strong></td>
            <td data-label="Child">${esc(childName(byId.get(p.child_id)))}</td><td data-label="Method">${esc(methodLabel(p.method))}</td><td data-label="Reference">${esc(p.reference || "")}</td><td class="num" data-label="Amount">${fmtMoney(p.amount)}</td></tr>`).join("")}</tbody></table></div>`
        : emptyState("dollar", "No payments recorded yet.");
    } else {
      panel.innerHTML = charges.length
        ? `<div class="table-wrap"><table class="table table--stack"><thead><tr><th>Due</th><th>Child</th><th>Description</th><th class="num">Amount</th></tr></thead>
          <tbody>${charges.map((c) => `<tr class="is-clickable" data-charge-row="${c.id}" tabindex="0"><td class="stack-main"><strong>${fmtDay(c.due_date, { month: "short", day: "numeric", year: "numeric" })}</strong></td>
            <td data-label="Child">${esc(childName(byId.get(c.child_id)))}</td><td data-label="Description">${esc(c.description)}</td><td class="num" data-label="Amount">${fmtMoney(c.amount)}</td></tr>`).join("")}</tbody></table></div>`
        : emptyState("receipt", "No charges yet.");
    }
  };

  const childOptions = (selected) => options([["", "Choose a child…"], ...children.filter((c) => c.status !== "withdrawn" || c.id === selected).map((c) => [c.id, childName(c)])], selected);

  const paymentForm = (payment, childId) => {
    const p = payment || { child_id: childId || "", paid_on: dayStr(), method: "e-transfer" };
    const due = childId ? bal.find((b) => b.child.id === childId)?.balance : null;
    openDialog({
      title: payment ? "Payment" : "Record a payment",
      body: `<div class="form-grid">
        ${field("Child", `<select name="child_id" required>${childOptions(p.child_id)}</select>`, "full")}
        ${field("Amount", `<input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" required value="${esc(p.amount ?? (due > 0 ? due.toFixed(2) : ""))}">`)}
        ${field("Date received", `<input type="date" name="paid_on" required value="${esc(p.paid_on)}">`)}
        ${field("Method", `<select name="method">${options(METHODS, p.method)}</select>`)}
        ${field("Reference", `<input name="reference" placeholder="e.g. e-transfer or cheque number" value="${esc(p.reference)}">`)}
        ${field("Note", `<input name="note" value="${esc(p.note)}">`, "full")}
      </div>`,
      submitLabel: payment ? "Save changes" : "Record payment",
      extraButton: payment ? `<button class="btn btn--danger" type="button" data-delete>${icon("trash")}Delete</button>` : "",
      onReady: (dlg, close) =>
        $("[data-delete]", dlg)?.addEventListener("click", async () => {
          if (!(await confirmDialog({ title: "Delete this payment?", message: "The family's balance will go back up by this amount.", confirmLabel: "Delete", danger: true }))) return;
          await api.deletePayment(payment.id);
          toast("Payment deleted");
          close(true);
          ctx.refresh();
        }),
      onSubmit: async (values) => {
        if (!(Number(values.amount) > 0)) throw new Error("Please enter an amount above zero.");
        await api.savePayment({ ...(payment ? { id: payment.id } : {}), ...values, amount: Number(values.amount) });
        toast(`Payment of ${fmtMoney(values.amount)} recorded for ${byId.get(values.child_id)?.first_name || "the family"}`);
        ctx.refresh();
      },
    });
  };

  const chargeForm = (charge) => {
    const c = charge || { due_date: dayStr() };
    openDialog({
      title: charge ? "Charge" : "Add a charge",
      body: `<div class="form-grid">
        ${field("Child", `<select name="child_id" required>${childOptions(c.child_id)}</select>`, "full")}
        ${field("Description", `<input name="description" required placeholder="e.g. Registration fee, Field trip" value="${esc(c.description)}">`, "full")}
        ${field("Amount", `<input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" required value="${esc(c.amount ?? "")}">`)}
        ${field("Due date", `<input type="date" name="due_date" required value="${esc(c.due_date)}">`)}
      </div>`,
      submitLabel: charge ? "Save changes" : "Add charge",
      extraButton: charge ? `<button class="btn btn--danger" type="button" data-delete>${icon("trash")}Delete</button>` : "",
      onReady: (dlg, close) =>
        $("[data-delete]", dlg)?.addEventListener("click", async () => {
          if (!(await confirmDialog({ title: "Delete this charge?", message: "The family's balance will go down by this amount.", confirmLabel: "Delete", danger: true }))) return;
          await api.deleteCharge(charge.id);
          toast("Charge deleted");
          close(true);
          ctx.refresh();
        }),
      onSubmit: async (values) => {
        if (!(Number(values.amount) > 0)) throw new Error("Please enter an amount above zero.");
        await api.saveCharge({ ...(charge ? { id: charge.id } : {}), ...values, amount: Number(values.amount) });
        toast(charge ? "Charge updated" : "Charge added");
        ctx.refresh();
      },
    });
  };

  const billForm = () => {
    const now = new Date();
    const months = [0, 1].map((o) => new Date(now.getFullYear(), now.getMonth() + o, 1));
    const label = (d) => d.toLocaleString(undefined, { month: "long", year: "numeric" });
    const plan = (monthIndex) => {
      const d = months[monthIndex];
      const description = `Tuition, ${label(d)}`;
      return children
        .filter((c) => c.status === "enrolled" && Number(c.monthly_fee) > 0)
        .filter((c) => !charges.some((ch) => ch.child_id === c.id && ch.description === description))
        .map((c) => ({ child_id: c.id, description, amount: Number(c.monthly_fee), due_date: dayStr(d) }));
    };
    const summary = (i) => {
      const rows = plan(i);
      return rows.length
        ? `${rows.length} ${rows.length === 1 ? "child" : "children"} will be charged ${fmtMoney(rows.reduce((s, r) => s + r.amount, 0))} in total, due ${fmtDay(dayStr(months[i]), { month: "long", day: "numeric" })}.`
        : "Every enrolled child already has this month's tuition charge.";
    };
    openDialog({
      title: "Bill monthly tuition",
      body: `<div class="form-grid">
        ${field("Month", `<select name="month">${options(months.map((d, i) => [i, label(d)]), 0)}</select>`, "full")}
        <p class="full" id="bill-summary">${summary(0)}</p>
        <p class="hint full">Each enrolled child is charged their monthly fee. Children who already have a tuition charge for that month are skipped, so it's safe to run again.</p>
      </div>`,
      submitLabel: "Create charges",
      onReady: (dlg) => $('[name="month"]', dlg).addEventListener("change", (e) => ($("#bill-summary", dlg).textContent = summary(Number(e.target.value)))),
      onSubmit: async ({ month }) => {
        const rows = plan(Number(month));
        if (!rows.length) throw new Error("There's nothing new to charge for that month.");
        await api.addCharges(rows);
        toast(`Tuition charged to ${rows.length} ${rows.length === 1 ? "family" : "families"}`);
        payTab = "balances";
        ctx.refresh();
      },
    });
  };

  const statement = (childId) => {
    const child = byId.get(childId);
    const entries = [
      ...charges.filter((c) => c.child_id === childId).map((c) => ({ date: c.due_date, text: c.description, amount: Number(c.amount) })),
      ...payments.filter((p) => p.child_id === childId).map((p) => ({ date: p.paid_on, text: `Payment, ${methodLabel(p.method)}${p.reference ? ` (${p.reference})` : ""}`, amount: -Number(p.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    let running = 0;
    const b = bal.find((x) => x.child.id === childId);
    openDialog({
      title: `Statement: ${childName(child)}`,
      body: entries.length
        ? `<p class="muted">${esc(child.guardian_name || "")}${child.guardian_email ? ` · ${esc(child.guardian_email)}` : ""}</p>
          <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>
          ${entries.map((e) => {
            running += e.amount;
            return `<tr><td>${fmtDay(e.date, { month: "short", day: "numeric", year: "numeric" })}</td><td>${esc(e.text)}</td><td class="num">${e.amount < 0 ? "−" : ""}${fmtMoney(Math.abs(e.amount))}</td><td class="num">${fmtMoney(running)}</td></tr>`;
          }).join("")}</tbody>
          <tfoot><tr><td colspan="3">Balance owing</td><td class="num">${fmtMoney(b?.balance || 0)}</td></tr></tfoot></table></div>`
        : emptyState("receipt", "No charges or payments yet."),
      submitLabel: "Record a payment",
      onSubmit: async () => {
        setTimeout(() => paymentForm(null, childId), 0);
      },
    });
  };

  $$("[data-tab]").forEach((btn) => btn.addEventListener("click", () => {
    payTab = btn.dataset.tab;
    $$("[data-tab]").forEach((x) => {
      x.classList.toggle("is-active", x === btn);
      x.setAttribute("aria-selected", x === btn);
    });
    draw();
  }));
  $("[data-pay]").addEventListener("click", () => paymentForm(null));
  $("[data-charge]").addEventListener("click", () => chargeForm(null));
  $("[data-bill]").addEventListener("click", billForm);
  const openRow = (e) => {
    const payChild = e.target.closest("[data-pay-child]");
    if (payChild) return paymentForm(null, payChild.dataset.payChild);
    const st = e.target.closest("[data-statement]");
    if (st) return statement(st.dataset.statement);
    const pay = e.target.closest("[data-payment]");
    if (pay) return paymentForm(payments.find((p) => p.id === pay.dataset.payment));
    const ch = e.target.closest("[data-charge-row]");
    if (ch) return chargeForm(charges.find((c) => c.id === ch.dataset.chargeRow));
  };
  panel.addEventListener("click", openRow);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.target.closest("button")) openRow(e);
  });
  draw();
}

// ---------------------------------------------------------------------------
// Incident reports
// ---------------------------------------------------------------------------

let incidentTab = "open";

async function renderIncidents(ctx) {
  const { api } = ctx;
  const [incidents, children, staff] = await Promise.all([api.listIncidents(), api.listChildren(), api.listStaff()]);
  if (!ctx.isCurrent()) return;
  const childrenById = new Map(children.map((c) => [c.id, c]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const open = incidents.filter((i) => i.status === "open");
  ctx.setCount("incidents", open.length);
  ctx.setHeader("Incident reports", `${open.length} waiting for your review`, `<button class="btn btn--yellow" type="button" data-new>${icon("plus")}New report</button>`);
  const list = incidents.filter((i) => incidentTab === "all" || i.status === incidentTab);
  ctx.view.innerHTML = `
    <div class="tabs" role="tablist">
      ${[["open", `Waiting for review (${open.length})`], ["reviewed", "Reviewed"], ["all", "All"]]
        .map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${incidentTab === k ? "is-active" : ""}" aria-selected="${incidentTab === k}">${l}</button>`).join("")}
    </div>
    ${list.length ? `<div class="incident-list">${list.map((i) => incidentCard(i, childrenById, staffById)).join("")}</div>` : `<div class="card">${emptyState("check", incidentTab === "open" ? "No reports waiting for review." : "No reports here yet.")}</div>`}`;
  const openForm = (incident) => incidentForm({ api, incident, children, isAdmin: true, onSaved: () => ctx.refresh() });
  $("[data-new]").addEventListener("click", () => openForm(null));
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    incidentTab = b.dataset.tab;
    ctx.refresh();
  }));
  bindIncidentCards($(".incident-list"), (id) => openForm(incidents.find((i) => i.id === id)));
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settings: staff sign in and out only at the daycare
// ---------------------------------------------------------------------------

const RADII = [50, 100, 150, 200, 300, 500];

async function renderSettings(ctx) {
  const { api } = ctx;
  const settings = await api.getSettings();
  if (!ctx.isCurrent()) return;
  ctx.setHeader("Settings", "Where staff can sign in and out");
  const radius = settings.site_radius_m || 150;
  ctx.view.innerHTML = `
    <div class="grid-2 settings">
      <section class="card">
        <div class="card__head"><h2>Sign in only at the daycare</h2></div>
        <form class="site-form" id="site-form" novalidate>
          <p class="muted">When this is on, staff can sign in and out of their shifts, and sign children in and out, only while their phone or tablet is at the daycare. Its location is checked each time. You can still correct times from anywhere.</p>
          <label class="check"><input type="checkbox" name="require_on_site"${settings.require_on_site !== false ? " checked" : ""}> Only allow sign in and sign out at the daycare</label>
          <div class="form-section">Daycare location</div>
          <div class="site-form__here">
            <button class="btn btn--ghost" type="button" data-here>${icon("locate")}Use my current location</button>
            <p class="hint" id="here-hint">Stand inside the daycare and tap this. Or, in Google Maps, right-click (or press and hold) the building, tap the numbers to copy them, and paste them into Latitude.</p>
          </div>
          <div class="form-grid">
            ${field("Latitude", `<input name="site_lat" inputmode="decimal" autocomplete="off" placeholder="e.g. 43.65320" value="${settings.site_lat ?? ""}">`)}
            ${field("Longitude", `<input name="site_lng" inputmode="decimal" autocomplete="off" placeholder="e.g. -79.38320" value="${settings.site_lng ?? ""}">`)}
            ${field("Counts as at the daycare within", `<select name="site_radius_m">${options(RADII.map((m) => [m, `${m} m of that spot${m === 150 ? " (recommended)" : ""}`]), radius)}</select>`, "full")}
          </div>
          <p class="hint">Phones are usually accurate to 5 to 50 m, less indoors. If staff inside the building are told they're too far away, choose a bigger distance.</p>
          <p class="form-error" role="alert"></p>
          <div><button class="btn btn--yellow" type="submit">${icon("check")}Save settings</button></div>
        </form>
      </section>
      <section class="card card--flush">
        <div class="card__head"><h2>On the map</h2><a class="btn btn--ghost btn--sm" id="map-link" target="_blank" rel="noopener" hidden>Open in maps</a></div>
        <div class="site-map" id="site-map"></div>
      </section>
    </div>`;

  const form = $("#site-form");
  const error = $(".form-error", form);
  const read = () => {
    const lat = form.site_lat.value.trim() === "" ? null : Number(form.site_lat.value);
    const lng = form.site_lng.value.trim() === "" ? null : Number(form.site_lng.value);
    return { lat, lng, valid: lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) };
  };
  const drawMap = () => {
    const { lat, lng, valid } = read();
    $("#map-link").hidden = !valid;
    if (!valid) {
      $("#site-map").innerHTML = emptyState("pin", "Set the daycare's location to see it on the map.");
      return;
    }
    const d = 0.004;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d * 1.4},${lat - d},${lng + d * 1.4},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
    $("#map-link").href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
    $("#site-map").innerHTML = `<iframe title="Map of the daycare's location" src="${esc(src)}" loading="lazy"></iframe>
      <p class="hint">The pin should be on the daycare's building. Staff count as at the daycare within ${esc(form.site_radius_m.value)} m of it.</p>`;
  };

  // "43.6532, -79.3832" (as Google Maps copies it) fills both boxes
  const splitPair = (text) => {
    const pair = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!pair) return false;
    form.site_lat.value = pair[1];
    form.site_lng.value = pair[2];
    drawMap();
    return true;
  };
  [form.site_lat, form.site_lng].forEach((input) =>
    input.addEventListener("paste", (e) => {
      if (splitPair(e.clipboardData?.getData("text") || "")) e.preventDefault();
    })
  );
  form.addEventListener("change", (e) => {
    if (e.target === form.site_lat || e.target === form.site_lng) splitPair(e.target.value);
    drawMap();
  });

  $("[data-here]").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    const hint = $("#here-hint");
    button.disabled = true;
    hint.textContent = "Finding your location…";
    try {
      const pos = await browserPosition({ maximumAge: 0 });
      form.site_lat.value = pos.lat.toFixed(6);
      form.site_lng.value = pos.lng.toFixed(6);
      hint.textContent = pos.accuracy > 100
        ? `Found, but only accurate to about ${fmtDistance(pos.accuracy)}. Check the pin on the map, or try again on a phone with location turned on.`
        : `Found your location (accurate to about ${fmtDistance(pos.accuracy)}). Check the pin on the map, then save.`;
      drawMap();
    } catch (err) {
      hint.textContent = err.message;
    }
    button.disabled = false;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { lat, lng, valid } = read();
    const requireOnSite = form.require_on_site.checked;
    error.classList.remove("is-shown");
    const fail = (message) => {
      error.textContent = message;
      error.classList.add("is-shown");
    };
    if ((lat !== null || lng !== null) && !valid) return fail("Please check the latitude and longitude. Latitude is between -90 and 90, longitude between -180 and 180.");
    if (requireOnSite && !valid) return fail("Set the daycare's location first. Until it's set, staff can't sign in or out.");
    const submit = $('[type="submit"]', form);
    submit.disabled = true;
    try {
      await api.saveSettings({ require_on_site: requireOnSite, site_lat: lat, site_lng: lng, site_radius_m: Number(form.site_radius_m.value) });
      toast(requireOnSite ? "Saved. Staff can now sign in and out only at the daycare." : "Saved. Staff can sign in and out from anywhere.");
    } catch (err) {
      fail(err.message);
    }
    submit.disabled = false;
  });
  drawMap();
}

startPortal({
  portalName: "Admin portal",
  demoRole: "admin",
  defaultView: "dashboard",
  allow: (profile) => profile.role === "admin",
  otherPortal: `Staff member? <a href="../staff/">Go to the staff portal</a>`,
  views: {
    dashboard: { label: "Dashboard", icon: "grid", render: renderDashboard },
    children: { label: "Children", icon: "baby", render: renderChildren },
    attendance: { label: "Sign in / out", icon: "userCheck", render: renderAttendance },
    timesheets: { label: "Timesheets", icon: "file", render: (ctx) => renderTimesheets(ctx, { allowPrintAll: true }) },
    staff: { label: "Staff", icon: "users", render: renderStaff },
    hours: { label: "Staff hours", icon: "clock", render: renderHours },
    payments: { label: "Payments", icon: "wallet", render: renderPayments },
    incidents: { label: "Incidents", icon: "alert", render: renderIncidents },
    settings: { label: "Settings", icon: "settings", render: renderSettings },
  },
  async onStart(ctx) {
    try {
      const [incidents, staff] = await Promise.all([ctx.api.listIncidents(), ctx.api.listStaff()]);
      ctx.setCount("incidents", incidents.filter((i) => i.status === "open").length);
      ctx.setCount("staff", staff.filter((s) => s.role === "pending" && s.active).length);
    } catch {
      /* counts are a convenience only */
    }
  },
});

// Staff portal: sign in / out of a shift, children's sign in, timesheets and
// incident reports.
import { dayStr } from "./data.js";
import { $, icon, toast, confirmDialog, emptyState, fmtClock, fmtDay, fmtDuration, fmtHours, hoursBetween, mondayOf, startPortal } from "./ui.js";
import { renderAttendance, renderTimesheets, incidentCard, incidentForm, bindIncidentCards, siteStatus } from "./shared.js";

async function renderShift(ctx) {
  const { api, profile } = ctx;
  const weekStart = mondayOf(new Date());
  const [open, shifts] = await Promise.all([api.getOpenShift(), api.listShifts({ staffId: profile.id, from: weekStart.toISOString() })]);
  if (!ctx.isCurrent()) return;
  const firstName = (profile.full_name || "").split(" ")[0];
  ctx.setHeader(`Hi${firstName ? `, ${firstName}` : ""}!`, new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));

  const worked = (s) => hoursBetween(s.clock_in, s.clock_out || new Date().toISOString());
  const today = dayStr();
  const todayHours = () => shifts.filter((s) => dayStr(new Date(s.clock_in)) === today).reduce((sum, s) => sum + worked(s), 0);
  const weekHours = () => shifts.reduce((sum, s) => sum + worked(s), 0);

  ctx.view.innerHTML = `
    <div class="grid-2">
      <section class="card ${open ? "c-green" : "c-orange"}">
        <div class="clock">
          <span class="clock__status">${open ? `On shift since ${fmtClock(open.clock_in)}` : "Not signed in"}</span>
          <span class="clock__now" id="clock-now">${fmtClock(new Date().toISOString())}</span>
          <span class="clock__detail" id="clock-detail"></span>
          <div class="clock__site" id="site-status" hidden></div>
          ${open
            ? `<button class="btn btn--red" type="button" data-clock-out>${icon("logout")}Sign out of my shift</button>`
            : `<button class="btn btn--green" type="button" data-clock-in>${icon("login")}Sign in to my shift</button>`}
        </div>
      </section>
      <section class="card card--flush">
        <div class="card__head"><h2>My hours this week</h2><span class="chip c-blue" id="week-total"></span></div>
        ${shifts.length
          ? `<div class="table-wrap"><table class="table table--stack"><thead><tr><th>Day</th><th>Signed in</th><th>Signed out</th><th class="num">Hours</th></tr></thead><tbody>
              ${shifts.map((s) => `<tr><td class="stack-main"><strong>${fmtDay(dayStr(new Date(s.clock_in)))}</strong></td><td data-label="Signed in">${fmtClock(s.clock_in)}</td>
                <td data-label="Signed out">${s.clock_out ? fmtClock(s.clock_out) : `<span class="chip chip--dot c-green">On shift</span>`}</td><td class="num" data-label="Hours">${fmtHours(worked(s))}</td></tr>`).join("")}
            </tbody></table></div>`
          : emptyState("clock", "No shifts yet this week.")}
      </section>
    </div>`;

  const tick = () => {
    if (!ctx.isCurrent() || !$("#clock-now")) return clearInterval(timer);
    $("#clock-now").textContent = fmtClock(new Date().toISOString());
    $("#clock-detail").textContent = `Today: ${fmtDuration(todayHours())} · This week: ${fmtDuration(weekHours())}`;
    $("#week-total").textContent = `${fmtHours(weekHours())} hours`;
  };
  const timer = setInterval(tick, 20000);
  tick();
  siteStatus(ctx, $("#site-status"));

  $("[data-clock-in]")?.addEventListener("click", async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await api.clockIn();
      toast(`Signed in at ${fmtClock(new Date().toISOString())}. Have a great day!`);
      ctx.refresh();
    } catch (err) {
      toast(err.message, "error");
      button.disabled = false;
    }
  });
  $("[data-clock-out]")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Sign out of your shift?", message: `You'll be signed out at ${fmtClock(new Date().toISOString())}.`, confirmLabel: "Sign out" }))) return;
    try {
      await api.clockOut(open.id);
      toast("Signed out. See you next time!");
      ctx.refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

async function renderIncidents(ctx) {
  const { api } = ctx;
  const [incidents, children] = await Promise.all([api.listIncidents(), api.listChildren()]);
  if (!ctx.isCurrent()) return;
  const childrenById = new Map(children.map((c) => [c.id, c]));
  ctx.setHeader("Incident reports", "Reports you've written. The director reviews every report.", `<button class="btn btn--yellow" type="button" data-new>${icon("plus")}New incident report</button>`);
  ctx.view.innerHTML = incidents.length
    ? `<div class="incident-list">${incidents.map((i) => incidentCard(i, childrenById)).join("")}</div>`
    : `<div class="card">${emptyState("file", "You haven't written any incident reports.")}</div>`;
  const open = (incident) => incidentForm({ api, incident, children, isAdmin: false, onSaved: () => ctx.refresh() });
  $("[data-new]").addEventListener("click", () => open(null));
  bindIncidentCards($(".incident-list"), (id) => open(incidents.find((i) => i.id === id)));
}

startPortal({
  portalName: "Staff portal",
  demoRole: "staff",
  demoLocation: true,
  defaultView: "shift",
  allow: (profile) => ["staff", "admin"].includes(profile.role),
  otherPortal: `Director? <a href="../admin/">Go to the admin portal</a>`,
  views: {
    shift: { label: "My shift", icon: "clock", render: renderShift },
    attendance: { label: "Children's sign in", icon: "userCheck", render: renderAttendance },
    timesheets: { label: "Timesheets", icon: "file", render: (ctx) => renderTimesheets(ctx) },
    incidents: { label: "Incident reports", icon: "alert", render: renderIncidents },
  },
});

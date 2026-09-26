// Shared building blocks for the Aflah Daycare portals: formatting, dialogs,
// toasts, the sign-in screen and the portal frame (sidebar + phone tab bar).
import { icon } from "./icons.js";
import { CONFIG } from "./config.js";
import { getApi, isDemo } from "./data.js";

export { icon };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const money = new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: CONFIG.currency });
export const fmtMoney = (n) => money.format(Number(n || 0));

export function parseDay(day) {
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const fmtDay = (day, options = { weekday: "short", month: "short", day: "numeric" }) =>
  day ? parseDay(day).toLocaleDateString(CONFIG.locale, options) : "";

export const fmtLongDay = (day) => fmtDay(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// "7:35 am", like the paper timesheet
export function fmtClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export const fmtDateTime = (iso) =>
  iso ? `${new Date(iso).toLocaleDateString(CONFIG.locale, { weekday: "short", month: "short", day: "numeric" })}, ${fmtClock(iso)}` : "";

// dd-mm-yy, like the paper timesheet
export const fmtSheetDate = (day) => {
  const d = parseDay(day);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getFullYear()).slice(-2)}`;
};

export const hoursBetween = (from, to) => Math.max(0, (new Date(to) - new Date(from)) / 3600000);
export const fmtHours = (h) => (Math.round(h * 100) / 100).toFixed(2);
export function fmtDuration(hours) {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

// Hours for one timesheet row (complete sign-in/sign-out pairs only)
export function attendanceHours(row) {
  if (!row || row.absent) return 0;
  let hours = 0;
  if (row.sign_in_1 && row.sign_out_1) hours += hoursBetween(row.sign_in_1, row.sign_out_1);
  if (row.sign_in_2 && row.sign_out_2) hours += hoursBetween(row.sign_in_2, row.sign_out_2);
  return hours;
}

export const SLOTS = ["sign_in_1", "sign_out_1", "sign_in_2", "sign_out_2"];

// Is the child here right now?
export function presence(row) {
  if (!row) return "notyet";
  if (row.absent) return "absent";
  if ((row.sign_in_1 && !row.sign_out_1) || (row.sign_in_2 && !row.sign_out_2)) return "in";
  if (row.sign_out_1 || row.sign_out_2) return "out";
  return "notyet";
}

export function ageFrom(dob) {
  if (!dob) return "";
  const birth = parseDay(dob);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)} yr${months >= 24 ? "s" : ""}`;
}

export const childName = (child) => (child ? `${child.first_name} ${child.last_name || ""}`.trim() : "Unknown child");
export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

const AVATAR_COLORS = ["c-blue", "c-green", "c-orange", "c-pink", "c-purple", "c-teal"];
export const avatarColor = (id = "") => AVATAR_COLORS[[...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
export const avatar = (name, id) => `<span class="avatar ${avatarColor(id)}" aria-hidden="true">${esc(initials(name))}</span>`;

export function mondayOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

export const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

// Combine a YYYY-MM-DD day and an HH:MM time into an ISO timestamp
export const toIso = (day, time) => {
  if (!day || !time) return null;
  const [h, m] = time.split(":").map(Number);
  const d = parseDay(day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
export const timeInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const localInput = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const emptyState = (iconName, text) => `<div class="empty">${icon(iconName)}<p>${esc(text)}</p></div>`;

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function toast(message, type = "success") {
  let holder = $(".toasts");
  if (!holder) {
    holder = document.createElement("div");
    holder.className = "toasts";
    holder.setAttribute("role", "status");
    holder.setAttribute("aria-live", "polite");
    document.body.append(holder);
  }
  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " toast--error" : ""}`;
  el.innerHTML = `${icon(type === "error" ? "alert" : "check")}<span>${esc(message)}</span>`;
  holder.append(el);
  setTimeout(() => el.remove(), type === "error" ? 6000 : 3200);
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

// Opens a form dialog. onSubmit(values) may throw to show an error in the dialog.
export function openDialog({ title, body, submitLabel = "Save", submitClass = "", extraButton = "", onSubmit, onReady }) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "dlg";
    dlg.innerHTML = `
      <form novalidate>
        <div class="dlg__head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-close aria-label="Close">${icon("x")}</button></div>
        <div class="dlg__body"><p class="form-error" role="alert"></p>${body}</div>
        <div class="dlg__foot">${extraButton}<button class="btn btn--ghost" type="button" data-close>Cancel</button>${onSubmit ? `<button class="btn ${submitClass}" type="submit">${esc(submitLabel)}</button>` : ""}</div>
      </form>`;
    document.body.append(dlg);
    const form = $("form", dlg);
    const error = $(".form-error", dlg);
    const close = (result) => {
      dlg.close();
      dlg.remove();
      resolve(result);
    };
    $$("[data-close]", dlg).forEach((b) => b.addEventListener("click", () => close(null)));
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const values = Object.fromEntries(new FormData(form));
      $$('input[type="checkbox"]', form).forEach((cb) => (values[cb.name] = cb.checked));
      const submit = $('[type="submit"]', form);
      submit.disabled = true;
      error.classList.remove("is-shown");
      try {
        const result = await onSubmit(values, form);
        close(result ?? true);
      } catch (err) {
        error.textContent = err.message || String(err);
        error.classList.add("is-shown");
        submit.disabled = false;
      }
    });
    onReady?.(dlg, close);
    dlg.showModal();
    const first = $("input:not([type=hidden]), select, textarea", dlg);
    if (first && !first.readOnly) first.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return openDialog({
    title,
    body: `<p>${esc(message)}</p>`,
    submitLabel: confirmLabel,
    submitClass: danger ? "btn--red" : "",
    onSubmit: () => true,
  }).then(Boolean);
}

export const field = (label, control, cls = "") => `<label class="field ${cls}"><span>${label}</span>${control}</label>`;
export const options = (list, selected) =>
  list.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected ?? "") ? " selected" : ""}>${esc(label)}</option>`).join("");

// ---------------------------------------------------------------------------
// Portal start-up: sign in, check role, then the frame with navigation
// ---------------------------------------------------------------------------

const LOGO = "../assets/images/aflah-logo.webp";
const wordmark = `<span class="wordmark" aria-hidden="true"><span>A</span><span>F</span><span>L</span><span>A</span><span>H</span></span>`;

export async function startPortal(config) {
  const root = $("#app");
  root.innerHTML = `<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`;
  let api;
  let session;
  try {
    api = await getApi();
    session = await api.getSession();
  } catch (err) {
    root.innerHTML = `<div class="auth"><div class="auth__card"><h1>Can't connect</h1><p class="auth__lead">${esc(err.message)}</p></div></div>`;
    return;
  }
  if (api.isRecovery && session) return renderNewPassword(root, api, config);
  if (!session) return renderAuth(root, api, config);
  const { profile } = session;
  if (!profile.active) return renderMessage(root, api, config, "Your access is paused", "Your account has been deactivated. Please speak to the daycare director if you think this is a mistake.");
  if (profile.role === "pending")
    return renderMessage(root, api, config, "Waiting for approval", "Thanks for signing up! The director needs to approve your account before you can use the portal. Please check back soon.");
  if (!config.allow(profile)) {
    return renderMessage(root, api, config, "This area is for the director", "Your account can use the staff portal.", `<a class="btn btn--block" href="../staff/">Go to the staff portal</a>`);
  }
  renderShell(root, api, session, config);
}

function authFrame(config, inner) {
  return `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand"><img src="${LOGO}" alt="" width="58" height="58"><div>${wordmark}<span class="auth__portal">${esc(config.portalName)}</span></div></div>
        ${inner}
      </div>
    </div>`;
}

function renderAuth(root, api, config, mode = "signin") {
  const signup = mode === "signup";
  const demo = isDemo
    ? `<div class="demo-box"><strong>Demo mode</strong>The portal isn't connected to a database yet, so it's running with sample children and staff. Nothing you do here leaves this device.
        <button class="btn btn--yellow" type="button" data-demo="${config.demoRole}">${icon("login")}Explore the ${esc(config.portalName.toLowerCase())}</button></div>`
    : "";
  root.innerHTML = authFrame(
    config,
    `${demo}
    <h1>${signup ? "Create your account" : "Welcome back"}</h1>
    <p class="auth__lead">${signup ? "The director will approve your account before you can sign in." : "Sign in with your staff email and password."}</p>
    <form class="form-grid" id="auth-form" novalidate style="grid-template-columns: 1fr; margin-top: 1rem;">
      <p class="form-error" role="alert" style="margin: 0;"></p>
      ${signup ? field("Full name", `<input name="fullName" autocomplete="name" required>`) : ""}
      ${field("Email", `<input name="email" type="email" autocomplete="email" required>`)}
      ${field("Password", `<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required>`)}
      <button class="btn btn--block" type="submit">${signup ? "Create account" : "Sign in"}</button>
      ${signup ? "" : `<p class="auth__switch" style="margin: 0;"><button type="button" data-forgot>Forgot your password?</button></p>`}
    </form>
    <p class="auth__switch">${signup ? "Already have an account?" : "New to the team?"} <button type="button" data-mode="${signup ? "signin" : "signup"}">${signup ? "Sign in" : "Create an account"}</button></p>
    <p class="auth__other">${config.otherPortal}</p>`
  );
  $("[data-mode]", root).addEventListener("click", (e) => renderAuth(root, api, config, e.target.dataset.mode));
  $("[data-forgot]", root)?.addEventListener("click", () => renderForgot(root, api, config));
  $("[data-demo]", root)?.addEventListener("click", async (e) => {
    await api.signInDemo(e.currentTarget.dataset.demo);
    startPortal(config);
  });
  const form = $("#auth-form", root);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    const values = Object.fromEntries(new FormData(form));
    const error = $(".form-error", form);
    const button = $('[type="submit"]', form);
    button.disabled = true;
    error.classList.remove("is-shown");
    try {
      if (signup) {
        const { needsConfirmation } = await api.signUp(values);
        if (needsConfirmation) {
          root.innerHTML = authFrame(config, `<h1>Check your email</h1><p class="auth__lead">We sent a confirmation link to <strong>${esc(values.email)}</strong>. After you confirm, the director will approve your account.</p>`);
          return;
        }
      } else {
        await api.signIn(values.email, values.password);
      }
      startPortal(config);
    } catch (err) {
      error.textContent = err.message;
      error.classList.add("is-shown");
      button.disabled = false;
    }
  });
}

function renderForgot(root, api, config) {
  root.innerHTML = authFrame(
    config,
    `<h1>Reset your password</h1>
    <p class="auth__lead">Enter your email and we'll send you a link to choose a new password.</p>
    <form class="form-grid" id="forgot-form" novalidate style="grid-template-columns: 1fr; margin-top: 1rem;">
      <p class="form-error" role="alert" style="margin: 0;"></p>
      ${field("Email", `<input name="email" type="email" autocomplete="email" required>`)}
      <button class="btn btn--block" type="submit">Send reset link</button>
    </form>
    <p class="auth__switch"><button type="button" data-back>Back to sign in</button></p>`
  );
  $("[data-back]", root).addEventListener("click", () => renderAuth(root, api, config));
  const form = $("#forgot-form", root);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    const { email } = Object.fromEntries(new FormData(form));
    try {
      await api.resetPassword(email);
      root.innerHTML = authFrame(config, `<h1>Check your email</h1><p class="auth__lead">If <strong>${esc(email)}</strong> has an account, a link to choose a new password is on its way.</p><p class="auth__switch"><button type="button" data-back>Back to sign in</button></p>`);
      $("[data-back]", root).addEventListener("click", () => renderAuth(root, api, config));
    } catch (err) {
      $(".form-error", form).textContent = err.message;
      $(".form-error", form).classList.add("is-shown");
    }
  });
}

function renderNewPassword(root, api, config) {
  root.innerHTML = authFrame(
    config,
    `<h1>Choose a new password</h1>
    <form class="form-grid" id="newpw-form" novalidate style="grid-template-columns: 1fr; margin-top: 1rem;">
      <p class="form-error" role="alert" style="margin: 0;"></p>
      ${field("New password", `<input name="password" type="password" autocomplete="new-password" minlength="6" required>`)}
      <button class="btn btn--block" type="submit">Save password</button>
    </form>`
  );
  const form = $("#newpw-form", root);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    try {
      await api.updatePassword(new FormData(form).get("password"));
      toast("Password saved");
      startPortal(config);
    } catch (err) {
      $(".form-error", form).textContent = err.message;
      $(".form-error", form).classList.add("is-shown");
    }
  });
}

function renderMessage(root, api, config, title, text, action = "") {
  root.innerHTML = authFrame(config, `<h1>${esc(title)}</h1><p class="auth__lead">${esc(text)}</p>${action}<p class="auth__other"><button class="btn btn--ghost btn--block" type="button" data-signout>${icon("logout")}Sign out</button></p>`);
  $("[data-signout]", root).addEventListener("click", async () => {
    await api.signOut();
    startPortal(config);
  });
}

function renderShell(root, api, session, config) {
  const { profile } = session;
  const views = config.views;
  const navLinks = (cls) =>
    Object.entries(views)
      .map(([id, v]) => `<a class="${cls}" href="#${id}" data-view="${id}">${icon(v.icon)}<span>${esc(v.label)}</span><span class="side__count" data-count="${id}" hidden></span></a>`)
      .join("");

  root.innerHTML = `
    <div class="shell">
      <aside class="side">
        <a class="side__brand" href="../index.html" title="Back to the website"><img src="${LOGO}" alt="" width="44" height="44"><div>${wordmark}<small>${esc(config.portalName)}</small></div></a>
        <nav class="side__nav" aria-label="Portal">${navLinks("side__link")}</nav>
        <div class="side__user">${avatar(profile.full_name || profile.email, profile.id)}<div><strong>${esc(profile.full_name || profile.email)}</strong><small>${esc(profile.position || profile.role)}</small></div>
          <button class="icon-btn" type="button" data-signout title="Sign out" aria-label="Sign out">${icon("logout")}</button></div>
      </aside>
      <header class="mobile-top"><img src="${LOGO}" alt="" width="36" height="36"><div>${wordmark}<small>${esc(config.portalName)}</small></div>
        <button class="icon-btn" type="button" data-signout aria-label="Sign out">${icon("logout")}</button></header>
      <main class="main" id="main">
        ${isDemo ? `<div class="demo-banner">${icon("info")}<span><strong>Demo mode:</strong> sample data, saved only on this device.</span><button class="btn btn--ghost btn--sm" type="button" data-reset-demo>Reset sample data</button></div>` : ""}
        <div class="topbar"><div><h1 id="view-title"></h1><p id="view-subtitle"></p></div><div class="topbar__actions" id="view-actions"></div></div>
        <div id="view"></div>
      </main>
      <nav class="tabbar" aria-label="Portal">${navLinks("")}</nav>
    </div>`;
  if (!$("#print-root")) {
    const printRoot = document.createElement("div");
    printRoot.id = "print-root";
    document.body.append(printRoot);
  }

  $$("[data-signout]", root).forEach((b) =>
    b.addEventListener("click", async () => {
      await api.signOut();
      location.hash = "";
      startPortal(config);
    })
  );
  $("[data-reset-demo]", root)?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Reset sample data?", message: "This puts the demo back to its original sample children, staff and records.", confirmLabel: "Reset" }))) return;
    await api.resetDemo();
    toast("Sample data reset");
    route();
  });

  const ctx = {
    api,
    session,
    profile,
    view: $("#view", root),
    setHeader(title, subtitle = "", actions = "") {
      $("#view-title").textContent = title;
      $("#view-subtitle").textContent = subtitle;
      $("#view-actions").innerHTML = actions;
      document.title = `${title} · ${config.portalName} · Aflah Daycare`;
    },
    setCount(viewId, n) {
      $$(`[data-count="${viewId}"]`).forEach((el) => {
        el.hidden = !n;
        el.textContent = n;
      });
    },
    go(viewId) {
      location.hash = viewId;
    },
    refresh: () => route(),
  };

  let current = 0;
  async function route() {
    const id = views[location.hash.slice(1)] ? location.hash.slice(1) : config.defaultView;
    $$("[data-view]").forEach((a) => {
      a.classList.toggle("is-active", a.dataset.view === id);
      if (a.dataset.view === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const token = ++current;
    ctx.view.innerHTML = `<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`;
    ctx.setHeader(views[id].label);
    ctx.isCurrent = () => token === current;
    try {
      await views[id].render(ctx);
    } catch (err) {
      if (token === current) ctx.view.innerHTML = `<div class="card">${emptyState("alert", err.message)}</div>`;
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  config.onStart?.(ctx);
  route();
}

// Print one or more timesheets (only the sheets appear on paper)
export function printSheets(html) {
  const holder = $("#print-root");
  holder.innerHTML = html;
  document.body.classList.add("is-printing");
  const done = () => {
    document.body.classList.remove("is-printing");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

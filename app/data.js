// Data layer for the Aflah Daycare portals.
// One interface, two back ends:
//   - Supabase (live): used when app/config.js has a project URL and key.
//   - Demo: sample data kept in this browser only, so the portals can be tried
//     before a database is connected.
import { CONFIG } from "./config.js";

export const isDemo = !CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey;

let apiPromise;
export function getApi() {
  apiPromise ||= isDemo ? Promise.resolve(createDemoApi()) : createSupabaseApi();
  return apiPromise;
}

// Local calendar day as YYYY-MM-DD
export function dayStr(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Sign in only at the daycare
// ---------------------------------------------------------------------------

export const SITE_NOT_SET = "The daycare's location hasn't been set yet, so sign in and sign out are turned off. Ask the director to set it in the admin portal under Settings.";
export const LOCATION_BLOCKED = "Location is blocked for this site. Allow location access in your browser or phone settings, then try again. It's needed to check you're at the daycare.";
const LOCATION_ERRORS = {
  1: LOCATION_BLOCKED,
  2: "Your location isn't available right now. Turn on location services (and Wi-Fi, which helps indoors) and try again.",
  3: "Finding your location took too long. Please try again.",
};
// How long a successful check is reused before checking again (the database
// accepts it for 5 minutes)
const SITE_CHECK_REUSE_MS = 4 * 60 * 1000;

// Distance in metres between two { lat, lng } points
export function distanceM(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const fmtDistance = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

// This device's location from the browser (asks for permission the first time)
export function browserPosition({ maximumAge = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share its location, so it can't be used to sign in or out. Use a phone or tablet with location turned on."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(LOCATION_ERRORS[err.code] || "Couldn't get your location. Please try again.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge }
    );
  });
}

// "granted", "denied", "prompt", or "unknown"
export async function locationPermission() {
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    return "unknown";
  }
}

// Checks the device is at the daycare before staff sign in or out, and keeps a
// recent success so a run of sign-ins doesn't wait for GPS every time.
// The database makes the final decision; this just gets it the location.
function siteGuard({ role, getSettings, locate, verify }) {
  let last = null;
  const listeners = new Set();
  const emit = (status) => listeners.forEach((fn) => fn(status));
  const allowed = (status) => ["exempt", "off", "here"].includes(status.state);

  async function check({ reuse = false } = {}) {
    if (role() === "admin") return { state: "exempt" };
    if (reuse && last && allowed(last.status) && Date.now() - last.at < SITE_CHECK_REUSE_MS) return last.status;
    let status;
    try {
      const settings = await getSettings();
      if (settings.require_on_site === false) status = { state: "off" };
      else if (settings.site_lat == null || settings.site_lng == null) status = { state: "unset", message: SITE_NOT_SET };
      else {
        emit({ state: "checking" });
        const result = await verify(await locate());
        if (result.required === false) status = { state: "off" };
        else if (result.on_site) status = { state: "here", distance: result.distance_m };
        else status = { state: "away", distance: result.distance_m, message: `You're about ${fmtDistance(result.distance_m)} from the daycare. Sign in and sign out only work at the daycare.` };
      }
    } catch (err) {
      status = { state: "error", message: err.message };
    }
    last = { at: Date.now(), status };
    emit(status);
    return status;
  }

  return {
    check,
    reset() {
      last = null;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Runs a sign in / sign out write once the device is confirmed on site
    async run(write) {
      let status = await check({ reuse: true });
      if (!allowed(status)) throw new Error(status.message);
      try {
        return await write();
      } catch (err) {
        if (!err.offSite) throw err;
        status = await check();
        if (!allowed(status)) throw new Error(status.message);
        return write();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const FRIENDLY = [
  [/invalid login credentials/i, "That email and password don't match. Please try again."],
  [/email not confirmed/i, "Please confirm your email address first. Check your inbox for the link."],
  [/user already registered/i, "An account with this email already exists. Try signing in instead."],
  [/one_open_shift_per_staff/i, "You're already signed in to a shift."],
  [/attendance_child_id_day_key|duplicate key.*attendance/i, "This child is already checked in for that day."],
  [/not_on_site/, "Sign in and sign out only work at the daycare."],
  [/site_not_set/, SITE_NOT_SET],
  [/location_required/, "We couldn't read your location. Turn on location and try again."],
  [/row-level security|permission denied/i, "You don't have permission to do that."],
  [/password should be at least/i, "Please choose a password with at least 6 characters."],
  [/failed to fetch|network/i, "Can't reach the server. Check your internet connection and try again."],
];

function friendly(error) {
  const message = error?.message || String(error);
  const match = FRIENDLY.find(([pattern]) => pattern.test(message));
  return match ? match[1] : message;
}

function toError(error) {
  const err = new Error(friendly(error));
  err.offSite = /not_on_site/.test(error?.message || "");
  return err;
}

async function createSupabaseApi() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  // Arriving from a "reset your password" email
  let recovery = /type=recovery/.test(location.hash);
  const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let userId = null;
  let userRole = null;

  const must = ({ data, error }) => {
    if (error) throw toError(error);
    return data;
  };
  // Empty boxes are saved as null, except text columns the database requires
  const KEEP_EMPTY = new Set(["last_name", "full_name"]);
  const cell = (f, v) => (v === "" || v === undefined ? (KEEP_EMPTY.has(f) ? "" : null) : v);
  const save = async (table, row, fields) => {
    const { id } = row;
    const values = Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, cell(f, row[f])]));
    const query = id ? sb.from(table).update(values).eq("id", id) : sb.from(table).insert(values);
    return must(await query.select().single());
  };
  const remove = async (table, id) => must(await sb.from(table).delete().eq("id", id));

  const CHILD_FIELDS = ["first_name", "last_name", "date_of_birth", "program", "room", "status", "start_date", "monthly_fee", "guardian_name", "guardian_phone", "guardian_email", "emergency_contact", "allergies", "notes"];
  const INCIDENT_FIELDS = ["child_id", "occurred_at", "location", "category", "description", "action_taken", "witnesses", "parent_notified", "parent_notified_at", "status", "admin_notes"];

  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") recovery = true;
  });

  const getSettings = async () => must(await sb.from("settings").select("*").eq("id", 1).maybeSingle()) || { require_on_site: true };
  const site = siteGuard({
    role: () => userRole,
    getSettings,
    locate: () => browserPosition(),
    verify: async ({ lat, lng, accuracy }) => must(await sb.rpc("verify_location", { lat, lng, accuracy })),
  });

  return {
    demo: false,
    get isRecovery() {
      return recovery;
    },
    async resetPassword(email) {
      must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }));
    },
    async updatePassword(password) {
      must(await sb.auth.updateUser({ password }));
      recovery = false;
      history.replaceState(null, "", location.pathname);
    },

    async getSession() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      userId = user.id;
      const profile = must(await sb.from("profiles").select("*").eq("id", user.id).maybeSingle());
      userRole = profile?.active ? profile.role : null;
      return { user: { id: user.id, email: user.email }, profile: profile || { id: user.id, email: user.email, full_name: "", role: "pending", active: true } };
    },
    async signIn(email, password) {
      must(await sb.auth.signInWithPassword({ email, password }));
    },
    async signUp({ fullName, email, password }) {
      const data = must(await sb.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: location.href.split("#")[0] } }));
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      await sb.auth.signOut();
      userId = null;
      userRole = null;
      site.reset();
    },

    getSettings,
    saveSettings: async (values) => must(await sb.from("settings").update(values).eq("id", 1).select().single()),
    checkSite: (options) => site.check(options),
    onSiteStatus: (fn) => site.subscribe(fn),

    listChildren: async () => must(await sb.from("children").select("*").order("first_name")),
    saveChild: (child) => save("children", child, CHILD_FIELDS),
    // Many children at once (spreadsheet import), in batches of 200
    async importChildren(list) {
      const rows = list.map((c) => ({ ...Object.fromEntries(CHILD_FIELDS.map((f) => [f, cell(f, c[f])])), monthly_fee: Number(c.monthly_fee || 0) }));
      const saved = [];
      for (let i = 0; i < rows.length; i += 200) saved.push(...must(await sb.from("children").insert(rows.slice(i, i + 200)).select()));
      return saved;
    },
    deleteChild: (id) => remove("children", id),

    listStaff: async () => must(await sb.from("profiles").select("*").order("full_name")),
    saveStaff: (person) => save("profiles", person, ["full_name", "phone", "position", "role", "active"]),

    listAttendance: async (day) => must(await sb.from("attendance").select("*").eq("day", day)),
    listAttendanceBetween: async (from, to) => must(await sb.from("attendance").select("*").gte("day", from).lte("day", to)),
    // Set one of sign_in_1, sign_out_1, sign_in_2, sign_out_2 (or clear it with null)
    setAttendanceTime: (childId, day, field, value) =>
      site.run(async () => must(await sb.from("attendance").upsert({ child_id: childId, day, [field]: value, ...(value ? { absent: false } : {}) }, { onConflict: "child_id,day" }).select().single())),
    setAbsent: (childId, day, absent) =>
      site.run(async () => must(await sb.from("attendance").upsert({ child_id: childId, day, absent, ...(absent ? { sign_in_1: null, sign_out_1: null, sign_in_2: null, sign_out_2: null } : {}) }, { onConflict: "child_id,day" }).select().single())),

    async getOpenShift() {
      return must(await sb.from("shifts").select("*").eq("staff_id", userId).is("clock_out", null).maybeSingle());
    },
    clockIn: () => site.run(async () => must(await sb.from("shifts").insert({}).select().single())),
    clockOut: (shiftId) => site.run(async () => must(await sb.from("shifts").update({ clock_out: nowIso() }).eq("id", shiftId).select().single())),
    async listShifts({ staffId, from, to } = {}) {
      let query = sb.from("shifts").select("*").order("clock_in", { ascending: false });
      if (staffId) query = query.eq("staff_id", staffId);
      if (from) query = query.gte("clock_in", from);
      if (to) query = query.lt("clock_in", to);
      return must(await query);
    },
    saveShift: (shift) => save("shifts", shift, ["staff_id", "clock_in", "clock_out", "note"]),
    deleteShift: (id) => remove("shifts", id),

    listIncidents: async () => must(await sb.from("incidents").select("*").order("occurred_at", { ascending: false })),
    saveIncident: (incident) => save("incidents", incident, INCIDENT_FIELDS),
    deleteIncident: (id) => remove("incidents", id),

    listCharges: async () => must(await sb.from("charges").select("*").order("due_date", { ascending: false })),
    saveCharge: (charge) => save("charges", charge, ["child_id", "description", "amount", "due_date"]),
    async addCharges(rows) {
      return must(await sb.from("charges").insert(rows).select());
    },
    deleteCharge: (id) => remove("charges", id),

    listPayments: async () => must(await sb.from("payments").select("*").order("paid_on", { ascending: false })),
    savePayment: (payment) => save("payments", payment, ["child_id", "amount", "paid_on", "method", "reference", "note"]),
    deletePayment: (id) => remove("payments", id),
  };
}

// ---------------------------------------------------------------------------
// Demo mode (browser storage only)
// ---------------------------------------------------------------------------

const DEMO_KEY = "aflah-portal-demo-v1";
const DEMO_SESSION_KEY = "aflah-portal-demo-user";
const DEMO_WHERE_KEY = "aflah-portal-demo-where";
// A sample location for the demo daycare
const DEMO_SITE = { lat: 43.6532, lng: -79.3832 };
export const DEMO_USERS = { admin: "demo-admin", staff: "demo-staff-1" };

function createDemoApi() {
  const memory = {};
  const storage = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return memory[key] ?? null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { memory[key] = value; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { delete memory[key]; }
    },
  };

  let db;
  try { db = JSON.parse(storage.get(DEMO_KEY)); } catch { db = null; }
  if (!db || !db.children) {
    db = seedDemo();
    storage.set(DEMO_KEY, JSON.stringify(db));
  }
  db.settings ||= demoSettings();
  db.sitePasses ||= {};
  const persist = () => storage.set(DEMO_KEY, JSON.stringify(db));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const me = () => db.profiles.find((p) => p.id === storage.get(DEMO_SESSION_KEY) && p.active);
  const isAdmin = () => me()?.role === "admin";
  const isStaff = () => ["staff", "admin"].includes(me()?.role);
  const need = (ok) => {
    if (!ok) throw new Error("You don't have permission to do that.");
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
  const upsert = (table, row) => {
    const list = db[table];
    if (row.id) {
      const index = list.findIndex((r) => r.id === row.id);
      if (index === -1) throw new Error("That record no longer exists.");
      list[index] = { ...list[index], ...row };
      persist();
      return clone(list[index]);
    }
    const created = { id: uid(), created_at: nowIso(), ...row };
    list.push(created);
    persist();
    return clone(created);
  };
  const drop = (table, id) => {
    db[table] = db[table].filter((r) => r.id !== id);
    persist();
  };
  const blankToNull = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === "" ? null : v]));

  // Same rules as the database: staff need a recent on-site check
  const needOnSite = () => {
    const s = db.settings;
    if (isAdmin() || !s.require_on_site || (db.sitePasses[me().id] || 0) > Date.now()) return;
    const err = new Error(s.site_lat == null ? SITE_NOT_SET : "Sign in and sign out only work at the daycare.");
    err.offSite = s.site_lat != null;
    throw err;
  };
  const demoWhere = () => (storage.get(DEMO_WHERE_KEY) === "away" ? "away" : "here");
  const site = siteGuard({
    role: () => me()?.role,
    getSettings: async () => clone(db.settings),
    // In the demo the location is pretend: at the daycare, or about 3 km away
    async locate() {
      await pause();
      const at = { lat: db.settings.site_lat ?? DEMO_SITE.lat, lng: db.settings.site_lng ?? DEMO_SITE.lng };
      return demoWhere() === "away" ? { lat: at.lat + 0.027, lng: at.lng + 0.012, accuracy: 20 } : { lat: at.lat + 0.0002, lng: at.lng - 0.0002, accuracy: 18 };
    },
    async verify({ lat, lng, accuracy }) {
      need(isStaff());
      const s = db.settings;
      if (!s.require_on_site) return { required: false, on_site: true };
      if (s.site_lat == null) throw new Error(SITE_NOT_SET);
      const d = distanceM({ lat, lng }, { lat: s.site_lat, lng: s.site_lng });
      const here = d - Math.min(Math.max(accuracy || 0, 0), 100) <= s.site_radius_m;
      if (here) db.sitePasses[me().id] = Date.now() + 5 * 60000;
      else delete db.sitePasses[me().id];
      persist();
      return { required: true, on_site: here, distance_m: Math.round(d), radius_m: s.site_radius_m };
    },
  });

  return {
    demo: true,
    get demoWhere() {
      return demoWhere();
    },
    setDemoWhere(where) {
      storage.set(DEMO_WHERE_KEY, where);
      db.sitePasses = {};
      persist();
      site.reset();
    },
    isRecovery: false,
    async resetPassword() {
      throw new Error("Demo mode: password resets work once the portal is connected to the database.");
    },

    async getSession() {
      const profile = me();
      return profile ? { user: { id: profile.id, email: profile.email }, profile: clone(profile) } : null;
    },
    async signIn() {
      throw new Error("Demo mode: use one of the demo buttons below to look around.");
    },
    async signInDemo(role) {
      storage.set(DEMO_SESSION_KEY, DEMO_USERS[role]);
    },
    async signUp() {
      throw new Error("Demo mode: accounts can be created once the portal is connected to the database.");
    },
    async signOut() {
      storage.remove(DEMO_SESSION_KEY);
      site.reset();
    },
    async resetDemo() {
      db = seedDemo();
      db.settings = demoSettings();
      db.sitePasses = {};
      persist();
      site.reset();
    },

    async getSettings() {
      need(isStaff());
      return clone(db.settings);
    },
    async saveSettings(values) {
      need(isAdmin());
      db.settings = { ...db.settings, ...values, id: 1, updated_at: nowIso() };
      persist();
      return clone(db.settings);
    },
    checkSite: (options) => site.check(options),
    onSiteStatus: (fn) => site.subscribe(fn),

    async listChildren() {
      await pause();
      need(isStaff());
      return clone(db.children).sort((a, b) => a.first_name.localeCompare(b.first_name));
    },
    async saveChild(child) {
      need(isAdmin());
      return upsert("children", blankToNull({ ...child, monthly_fee: Number(child.monthly_fee || 0) }));
    },
    async importChildren(list) {
      await pause();
      need(isAdmin());
      return list.map((child) => upsert("children", blankToNull({ ...child, monthly_fee: Number(child.monthly_fee || 0) })));
    },
    async deleteChild(id) {
      need(isAdmin());
      drop("children", id);
      for (const table of ["attendance", "charges", "payments"]) db[table] = db[table].filter((r) => r.child_id !== id);
      db.incidents.forEach((r) => { if (r.child_id === id) r.child_id = null; });
      persist();
    },

    async listStaff() {
      await pause();
      need(isStaff());
      return clone(db.profiles).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
    async saveStaff(person) {
      need(isAdmin() || person.id === me()?.id);
      if (!isAdmin()) {
        const current = db.profiles.find((p) => p.id === person.id);
        need(person.role === undefined || person.role === current.role);
      }
      return upsert("profiles", blankToNull(person));
    },

    async listAttendance(day) {
      await pause();
      need(isStaff());
      return clone(db.attendance.filter((r) => r.day === day));
    },
    async listAttendanceBetween(from, to) {
      need(isStaff());
      return clone(db.attendance.filter((r) => r.day >= from && r.day <= to));
    },
    setAttendanceTime: (childId, day, field, value) => site.run(async () => {
      need(isStaff());
      needOnSite();
      const row = db.attendance.find((r) => r.child_id === childId && r.day === day);
      const changes = { [field]: value, updated_by: me().id, updated_at: nowIso(), ...(value ? { absent: false } : {}) };
      return row ? upsert("attendance", { id: row.id, ...changes }) : upsert("attendance", { ...blankAttendance(childId, day, me().id), ...changes });
    }),
    setAbsent: (childId, day, absent) => site.run(async () => {
      need(isStaff());
      needOnSite();
      const row = db.attendance.find((r) => r.child_id === childId && r.day === day);
      const changes = { absent, updated_by: me().id, updated_at: nowIso(), ...(absent ? { sign_in_1: null, sign_out_1: null, sign_in_2: null, sign_out_2: null } : {}) };
      return row ? upsert("attendance", { id: row.id, ...changes }) : upsert("attendance", { ...blankAttendance(childId, day, me().id), ...changes });
    }),

    async getOpenShift() {
      need(isStaff());
      return clone(db.shifts.find((s) => s.staff_id === me().id && !s.clock_out) || null);
    },
    clockIn: () => site.run(async () => {
      need(isStaff());
      needOnSite();
      if (db.shifts.some((s) => s.staff_id === me().id && !s.clock_out)) throw new Error("You're already signed in to a shift.");
      return upsert("shifts", { staff_id: me().id, clock_in: nowIso(), clock_out: null, note: null });
    }),
    clockOut: (shiftId) => site.run(async () => {
      need(isStaff());
      needOnSite();
      return upsert("shifts", { id: shiftId, clock_out: nowIso() });
    }),
    async listShifts({ staffId, from, to } = {}) {
      await pause();
      need(isStaff());
      const who = isAdmin() ? staffId : me().id;
      return clone(
        db.shifts
          .filter((s) => (!who || s.staff_id === who) && (!from || s.clock_in >= from) && (!to || s.clock_in < to))
          .sort((a, b) => b.clock_in.localeCompare(a.clock_in))
      );
    },
    async saveShift(shift) {
      need(isAdmin());
      return upsert("shifts", blankToNull(shift));
    },
    async deleteShift(id) {
      need(isAdmin());
      drop("shifts", id);
    },

    async listIncidents() {
      await pause();
      need(isStaff());
      return clone(db.incidents.filter((r) => isAdmin() || r.reported_by === me().id)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    },
    async saveIncident(incident) {
      need(isStaff());
      const row = blankToNull(incident);
      if (!isAdmin()) {
        const existing = row.id && db.incidents.find((r) => r.id === row.id);
        need(!existing || (existing.reported_by === me().id && existing.status === "open"));
        row.reported_by = existing ? existing.reported_by : me().id;
        row.status = existing ? existing.status : "open";
        delete row.admin_notes;
      } else if (!row.id) {
        row.reported_by = me().id;
        row.status ||= "open";
      }
      return upsert("incidents", row);
    },
    async deleteIncident(id) {
      need(isAdmin());
      drop("incidents", id);
    },

    async listCharges() {
      await pause();
      need(isAdmin());
      return clone(db.charges).sort((a, b) => b.due_date.localeCompare(a.due_date));
    },
    async saveCharge(charge) {
      need(isAdmin());
      return upsert("charges", blankToNull({ ...charge, amount: Number(charge.amount), created_by: me().id }));
    },
    async addCharges(rows) {
      need(isAdmin());
      return rows.map((row) => upsert("charges", { ...row, amount: Number(row.amount), created_by: me().id }));
    },
    async deleteCharge(id) {
      need(isAdmin());
      drop("charges", id);
    },

    async listPayments() {
      await pause();
      need(isAdmin());
      return clone(db.payments).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
    },
    async savePayment(payment) {
      need(isAdmin());
      return upsert("payments", blankToNull({ ...payment, amount: Number(payment.amount), created_by: me().id }));
    },
    async deletePayment(id) {
      need(isAdmin());
      drop("payments", id);
    },
  };
}

function demoSettings() {
  return { id: 1, site_lat: DEMO_SITE.lat, site_lng: DEMO_SITE.lng, site_radius_m: 150, require_on_site: true, updated_at: nowIso() };
}

function blankAttendance(childId, day, by) {
  return { child_id: childId, day, sign_in_1: null, sign_out_1: null, sign_in_2: null, sign_out_2: null, absent: false, note: null, recorded_by: by, updated_by: by, updated_at: nowIso() };
}

export const ROOMS = { Seedlings: "Infant Room", Sprouts: "Toddler Room", Saplings: "Preschool Room", Branches: "School Age Room" };

function seedDemo() {
  const now = new Date();
  const dayAgo = (n) => dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  const at = (n, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, h, m).toISOString();
  const yearsAgo = (y, extraMonths = 0) => dayStr(new Date(now.getFullYear() - y, now.getMonth() - extraMonths, 12));
  const created = at(60, 9, 0);

  const profiles = [
    { id: "demo-admin", full_name: "Aisha Rahman", email: "aisha@example.com", phone: "(555) 201-0001", position: "Director", role: "admin", active: true, created_at: created },
    { id: "demo-staff-1", full_name: "Fatima Ali", email: "fatima@example.com", phone: "(555) 201-0002", position: "Lead Educator", role: "staff", active: true, created_at: created },
    { id: "demo-staff-2", full_name: "Daniel Brooks", email: "daniel@example.com", phone: "(555) 201-0003", position: "Early Childhood Educator", role: "staff", active: true, created_at: created },
    { id: "demo-staff-3", full_name: "Maryam Yusuf", email: "maryam@example.com", phone: "(555) 201-0004", position: "Assistant Educator", role: "staff", active: true, created_at: created },
    { id: "demo-staff-4", full_name: "Sara Khan", email: "sara@example.com", phone: "", position: "", role: "pending", active: true, created_at: at(1, 18, 20) },
  ];

  const child = (id, first, last, program, dob, fee, guardian, extra = {}) => ({
    id, first_name: first, last_name: last, program, room: ROOMS[program], date_of_birth: dob, monthly_fee: fee,
    status: "enrolled", start_date: dayAgo(200), guardian_name: guardian, guardian_phone: `(555) 310-${id.slice(-4)}`,
    guardian_email: `${guardian.split(" ")[0].toLowerCase()}@example.com`, emergency_contact: "", allergies: "", notes: "", created_at: created, ...extra,
  });
  const children = [
    child("c-0001", "Amira", "Hassan", "Sprouts", yearsAgo(2, 1), 1100, "Leila Hassan"),
    child("c-0002", "Noah", "Chen", "Seedlings", yearsAgo(1), 1250, "Grace Chen", { allergies: "Dairy (milk and cheese)" }),
    child("c-0003", "Yusuf", "Ibrahim", "Saplings", yearsAgo(3, 3), 950, "Khalid Ibrahim"),
    child("c-0004", "Layla", "Ahmed", "Saplings", yearsAgo(3), 950, "Nadia Ahmed", { allergies: "Peanuts and tree nuts. EpiPen is in the office.", emergency_contact: "Omar Ahmed (uncle), (555) 310-9004" }),
    child("c-0005", "Ethan", "Brown", "Branches", yearsAgo(6), 450, "Megan Brown"),
    child("c-0006", "Zainab", "Omar", "Sprouts", yearsAgo(2, 4), 1100, "Huda Omar"),
    child("c-0007", "Liam", "Patel", "Seedlings", yearsAgo(1, 2), 1250, "Priya Patel"),
    child("c-0008", "Hana", "Mohamed", "Branches", yearsAgo(8), 450, "Abdi Mohamed"),
    child("c-0009", "Adam", "Farouk", "Saplings", yearsAgo(3, 1), 950, "Mona Farouk", { status: "waitlist", start_date: dayAgo(-30), notes: "Hoping to start next month." }),
  ];
  const enrolled = children.filter((c) => c.status === "enrolled");

  // Timesheets: the last three weeks of weekdays, plus today in progress.
  // School-age children (Branches) have two pairs: before school and after school.
  const attendance = [];
  const lateEnough = now.getHours() >= 9;
  for (let n = 21; n >= 1; n--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    enrolled.forEach((c, i) => {
      const row = { ...blankAttendance(c.id, dayAgo(n), "demo-staff-1"), id: `a-${n}-${i}` };
      if ((n * 7 + i * 3) % 23 === 0) row.absent = true;
      else if (c.program === "Branches") {
        Object.assign(row, { sign_in_1: at(n, 7, 10 + i), sign_out_1: at(n, 8, 20), sign_in_2: at(n, 15, 35), sign_out_2: at(n, 17, 5 + ((n + i) % 5) * 6) });
      } else {
        Object.assign(row, { sign_in_1: at(n, 7, 30 + ((n + i) % 6) * 7), sign_out_1: at(n, 16, 0 + ((n * 2 + i) % 8) * 7) });
      }
      attendance.push(row);
    });
  }
  enrolled.forEach((c, i) => {
    if (i >= 5) return;
    const signIn = lateEnough ? at(0, 7, 35 + i * 9) : new Date(now.getTime() - (50 - i * 9) * 60000).toISOString();
    const row = { ...blankAttendance(c.id, dayAgo(0), "demo-staff-2"), id: `a-0-${i}`, sign_in_1: signIn };
    if (c.program === "Branches" && lateEnough) row.sign_out_1 = at(0, 8, 20);
    attendance.push(row);
  });

  // Shifts for the last week, plus two educators on shift now
  const shifts = [];
  for (let n = 1; n <= 7; n++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    shifts.push({ id: `s-${n}-1`, staff_id: "demo-staff-1", clock_in: at(n, 7, 0), clock_out: at(n, 15, 5), note: null });
    shifts.push({ id: `s-${n}-2`, staff_id: "demo-staff-2", clock_in: at(n, 8, 55), clock_out: at(n, 17, 32), note: null });
    shifts.push({ id: `s-${n}-3`, staff_id: "demo-staff-3", clock_in: at(n, 10, 2), clock_out: at(n, 18, 4), note: null });
    shifts.push({ id: `s-${n}-a`, staff_id: "demo-admin", clock_in: at(n, 8, 30), clock_out: at(n, 16, 30), note: null });
  }
  const startedAgo = (mins) => new Date(now.getTime() - mins * 60000).toISOString();
  shifts.push({ id: "s-0-2", staff_id: "demo-staff-2", clock_in: lateEnough ? at(0, 7, 2) : startedAgo(95), clock_out: null, note: null });
  shifts.push({ id: "s-0-3", staff_id: "demo-staff-3", clock_in: lateEnough ? at(0, 8, 58) : startedAgo(40), clock_out: null, note: null });

  const incidents = [
    {
      id: "i-1", child_id: "c-0001", occurred_at: at(2, 10, 20), location: "Playground", category: "injury",
      description: "Amira tripped while running near the slide and scraped her left knee.",
      action_taken: "Cleaned the scrape, applied a bandage and a cold pack. Comforted her until she was settled and back to playing.",
      witnesses: "Daniel Brooks", parent_notified: true, parent_notified_at: at(2, 16, 10), reported_by: "demo-staff-1",
      status: "reviewed", admin_notes: "Spoke with Leila at pickup. No further action needed.", created_at: at(2, 10, 45),
    },
    {
      id: "i-2", child_id: "c-0003", occurred_at: at(1, 11, 5), location: "Classroom, circle time", category: "behaviour",
      description: "Yusuf pushed a classmate who took his seat during circle time. The other child was upset but not hurt.",
      action_taken: "Separated the children, talked with Yusuf about gentle hands and using words, and helped him apologise.",
      witnesses: "Fatima Ali", parent_notified: false, parent_notified_at: null, reported_by: "demo-staff-2",
      status: "open", admin_notes: null, created_at: at(1, 11, 30),
    },
  ];

  // Charges: last month and this month's tuition; payments with a few balances outstanding
  const monthStart = (offset) => new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const monthLabel = (d) => d.toLocaleString(CONFIG.locale, { month: "long", year: "numeric" });
  const charges = [];
  const payments = [];
  enrolled.forEach((c, i) => {
    for (const offset of [-1, 0]) {
      const start = monthStart(offset);
      charges.push({ id: `ch-${offset}-${i}`, child_id: c.id, description: `Tuition, ${monthLabel(start)}`, amount: c.monthly_fee, due_date: dayStr(start), created_by: "demo-admin", created_at: start.toISOString() });
    }
    const lastMonthPaid = c.id === "c-0005" ? c.monthly_fee / 2 : c.monthly_fee;
    payments.push({ id: `p-l-${i}`, child_id: c.id, amount: lastMonthPaid, paid_on: dayStr(new Date(monthStart(-1).getTime() + (2 + i) * 86400000)), method: i % 3 === 0 ? "cash" : "e-transfer", reference: i % 3 === 0 ? "" : `ET-${4100 + i}`, note: "", created_by: "demo-admin", created_at: created });
    if (i < 5) {
      const amount = c.id === "c-0004" ? 500 : c.monthly_fee;
      const paidOn = new Date(Math.min(now.getTime(), monthStart(0).getTime() + (1 + i) * 86400000));
      payments.push({ id: `p-t-${i}`, child_id: c.id, amount, paid_on: dayStr(paidOn), method: i === 2 ? "subsidy" : "e-transfer", reference: `ET-${4200 + i}`, note: "", created_by: "demo-admin", created_at: created });
    }
  });

  return { profiles, children, attendance, shifts, incidents, charges, payments };
}

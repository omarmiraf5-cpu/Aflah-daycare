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
// Supabase
// ---------------------------------------------------------------------------

const FRIENDLY = [
  [/invalid login credentials/i, "That email and password don't match. Please try again."],
  [/email not confirmed/i, "Please confirm your email address first. Check your inbox for the link."],
  [/user already registered/i, "An account with this email already exists. Try signing in instead."],
  [/one_open_shift_per_staff/i, "You're already signed in to a shift."],
  [/attendance_child_id_day_key|duplicate key.*attendance/i, "This child is already checked in for that day."],
  [/row-level security|permission denied/i, "You don't have permission to do that."],
  [/password should be at least/i, "Please choose a password with at least 6 characters."],
  [/failed to fetch|network/i, "Can't reach the server. Check your internet connection and try again."],
];

function friendly(error) {
  const message = error?.message || String(error);
  const match = FRIENDLY.find(([pattern]) => pattern.test(message));
  return match ? match[1] : message;
}

async function createSupabaseApi() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  // Arriving from a "reset your password" email
  let recovery = /type=recovery/.test(location.hash);
  const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let userId = null;

  const must = ({ data, error }) => {
    if (error) throw new Error(friendly(error));
    return data;
  };
  const save = async (table, row, fields) => {
    const { id } = row;
    const values = Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f] === "" ? null : row[f]]));
    const query = id ? sb.from(table).update(values).eq("id", id) : sb.from(table).insert(values);
    return must(await query.select().single());
  };
  const remove = async (table, id) => must(await sb.from(table).delete().eq("id", id));

  const CHILD_FIELDS = ["first_name", "last_name", "date_of_birth", "program", "room", "status", "start_date", "monthly_fee", "guardian_name", "guardian_phone", "guardian_email", "emergency_contact", "allergies", "notes"];
  const INCIDENT_FIELDS = ["child_id", "occurred_at", "location", "category", "description", "action_taken", "witnesses", "parent_notified", "parent_notified_at", "status", "admin_notes"];

  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") recovery = true;
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
    },

    listChildren: async () => must(await sb.from("children").select("*").order("first_name")),
    saveChild: (child) => save("children", child, CHILD_FIELDS),
    deleteChild: (id) => remove("children", id),

    listStaff: async () => must(await sb.from("profiles").select("*").order("full_name")),
    saveStaff: (person) => save("profiles", person, ["full_name", "phone", "position", "role", "active"]),

    listAttendance: async (day) => must(await sb.from("attendance").select("*").eq("day", day)),
    listAttendanceBetween: async (from, to) => must(await sb.from("attendance").select("*").gte("day", from).lte("day", to)),
    // Set one of sign_in_1, sign_out_1, sign_in_2, sign_out_2 (or clear it with null)
    setAttendanceTime: async (childId, day, field, value) =>
      must(await sb.from("attendance").upsert({ child_id: childId, day, [field]: value, ...(value ? { absent: false } : {}) }, { onConflict: "child_id,day" }).select().single()),
    setAbsent: async (childId, day, absent) =>
      must(await sb.from("attendance").upsert({ child_id: childId, day, absent, ...(absent ? { sign_in_1: null, sign_out_1: null, sign_in_2: null, sign_out_2: null } : {}) }, { onConflict: "child_id,day" }).select().single()),

    async getOpenShift() {
      return must(await sb.from("shifts").select("*").eq("staff_id", userId).is("clock_out", null).maybeSingle());
    },
    clockIn: async () => must(await sb.from("shifts").insert({}).select().single()),
    clockOut: async (shiftId) => must(await sb.from("shifts").update({ clock_out: nowIso() }).eq("id", shiftId).select().single()),
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

  return {
    demo: true,
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
    },
    async resetDemo() {
      db = seedDemo();
      persist();
    },

    async listChildren() {
      await pause();
      need(isStaff());
      return clone(db.children).sort((a, b) => a.first_name.localeCompare(b.first_name));
    },
    async saveChild(child) {
      need(isAdmin());
      return upsert("children", blankToNull({ ...child, monthly_fee: Number(child.monthly_fee || 0) }));
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
    async setAttendanceTime(childId, day, field, value) {
      need(isStaff());
      const row = db.attendance.find((r) => r.child_id === childId && r.day === day);
      const changes = { [field]: value, updated_by: me().id, updated_at: nowIso(), ...(value ? { absent: false } : {}) };
      return row ? upsert("attendance", { id: row.id, ...changes }) : upsert("attendance", { ...blankAttendance(childId, day, me().id), ...changes });
    },
    async setAbsent(childId, day, absent) {
      need(isStaff());
      const row = db.attendance.find((r) => r.child_id === childId && r.day === day);
      const changes = { absent, updated_by: me().id, updated_at: nowIso(), ...(absent ? { sign_in_1: null, sign_out_1: null, sign_in_2: null, sign_out_2: null } : {}) };
      return row ? upsert("attendance", { id: row.id, ...changes }) : upsert("attendance", { ...blankAttendance(childId, day, me().id), ...changes });
    },

    async getOpenShift() {
      need(isStaff());
      return clone(db.shifts.find((s) => s.staff_id === me().id && !s.clock_out) || null);
    },
    async clockIn() {
      need(isStaff());
      if (db.shifts.some((s) => s.staff_id === me().id && !s.clock_out)) throw new Error("You're already signed in to a shift.");
      return upsert("shifts", { staff_id: me().id, clock_in: nowIso(), clock_out: null, note: null });
    },
    async clockOut(shiftId) {
      need(isStaff());
      return upsert("shifts", { id: shiftId, clock_out: nowIso() });
    },
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

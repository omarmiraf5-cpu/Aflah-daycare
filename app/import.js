// Bulk import of children from a spreadsheet: .csv files, .xlsx files, or rows
// pasted from Excel, Numbers or Google Sheets. Reading and checking only; the
// admin portal shows the preview and saves the rows.

// Columns in the downloadable template, in order
export const TEMPLATE_COLUMNS = [
  "First name", "Last name", "Date of birth", "Program", "Room", "Status", "Start date", "Monthly fee",
  "Parent or guardian", "Parent phone", "Parent email", "Emergency contact", "Allergies and medical needs", "Notes",
];

export const templateCsv = () => `﻿${TEMPLATE_COLUMNS.join(",")}\r\n`;

// ---------------------------------------------------------------------------
// Reading files

// Returns the first sheet as rows of cell text. Dates from .xlsx files come
// back as YYYY-MM-DD.
export async function readFile(file) {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (isZip) return readXlsx(buffer);
  if (/\.(xls|numbers|ods)$/i.test(file.name)) {
    throw new Error("This kind of file can't be read. Save it as an Excel workbook (.xlsx) or CSV (.csv) and try again, or copy the rows and paste them below.");
  }
  return parseDelimited(decodeText(buffer));
}

// Excel's "CSV" (not "CSV UTF-8") is Windows-1252, not UTF-8
function decodeText(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

// CSV, or tab-separated text as pasted from a spreadsheet. Quoted cells may
// contain commas, quotes ("") and line breaks.
export function parseDelimited(text) {
  text = String(text || "").replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const count = (ch) => firstLine.split(ch).length - 1;
  const delim = count("\t") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// A .xlsx file is a zip of XML files. Browsers can inflate zip entries
// themselves (DecompressionStream), so no library is needed.
async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This file couldn't be opened. Is it an Excel workbook (.xlsx)?");
  const entries = new Map();
  let p = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0 && view.getUint32(p, true) === 0x02014b50; n--) {
    const nameLength = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, { method: view.getUint16(p + 10, true), size: view.getUint32(p + 20, true), local: view.getUint32(p + 42, true) });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return async (name) => {
    const entry = entries.get(name.replace(/^\//, ""));
    if (!entry) return null;
    const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
    const data = bytes.subarray(start, start + entry.size);
    if (entry.method === 0) return new TextDecoder().decode(data);
    if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
      throw new Error("This browser can't open Excel files. Save the sheet as CSV (.csv), or copy the rows and paste them below.");
    }
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  };
}

const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
const all = (node, tag) => [...node.getElementsByTagNameNS("*", tag)];
const textOf = (node) => all(node, "t").filter((t) => !t.closest("rPh")).map((t) => t.textContent).join("");

// Number formats that show a date: Excel's built-in ids, or a custom format
// with day, month or year in it (and not just a time).
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);
function isDateFormat(id, code) {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (!code) return false;
  const plain = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dy]/i.test(plain) || (/m/i.test(plain) && !/[hs]/i.test(plain));
}

async function readXlsx(buffer) {
  const read = await unzip(buffer);
  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) throw new Error("This file couldn't be opened. Is it an Excel workbook (.xlsx)?");
  const workbook = xml(workbookXml);
  const sheet = all(workbook, "sheet")[0];
  if (!sheet) return [];
  const date1904 = /^(1|true)$/.test(all(workbook, "workbookPr")[0]?.getAttribute("date1904") || "");
  const relId = [...sheet.attributes].find((a) => a.localName === "id")?.value;
  const rels = xml((await read("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
  const target = all(rels, "Relationship").find((r) => r.getAttribute("Id") === relId)?.getAttribute("Target") || "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? all(xml(sharedXml), "si").map(textOf) : [];
  const stylesXml = await read("xl/styles.xml");
  const dateStyles = [];
  if (stylesXml) {
    const styles = xml(stylesXml);
    const codes = new Map(all(styles, "numFmt").map((f) => [Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode")]));
    const cellXfs = all(styles, "cellXfs")[0];
    (cellXfs ? all(cellXfs, "xf") : []).forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId") || 0);
      dateStyles[i] = isDateFormat(id, codes.get(id));
    });
  }

  const sheetXml = await read(sheetPath);
  if (!sheetXml) return [];
  const rows = [];
  for (const row of all(xml(sheetXml), "row")) {
    const cells = [];
    let next = 0;
    for (const c of all(row, "c")) {
      const ref = c.getAttribute("r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = c.getAttribute("t");
      const v = all(c, "v")[0]?.textContent ?? "";
      let value;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(c);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (type === "d") value = v.slice(0, 10);
      else if (type === "str" || type === "e") value = v;
      else if (v !== "" && dateStyles[Number(c.getAttribute("s") || 0)]) value = serialToDay(Number(v), date1904);
      else value = v;
      cells[col] = value;
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

const columnIndex = (ref) => [...ref.replace(/\d+$/, "").toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function serialToDay(serial, date1904) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Matching columns to fields

const norm = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const HEADERS = {
  first_name: ["first name", "firstname", "first", "given name", "child first name", "childs first name", "child given name"],
  last_name: ["last name", "lastname", "last", "surname", "family name", "child last name", "childs last name", "child surname"],
  full_name: ["name", "child", "child name", "childs name", "full name", "child full name", "childs full name", "student", "student name", "kid", "kids name"],
  date_of_birth: ["date of birth", "dob", "d o b", "birth date", "birthdate", "birthday", "born", "child dob", "childs date of birth"],
  program: ["program", "programme", "program name", "class", "group", "age group"],
  room: ["room", "classroom", "room name"],
  status: ["status", "enrolment status", "enrollment status", "enrolled"],
  start_date: ["start date", "start", "starting date", "date started", "enrolment date", "enrollment date", "first day"],
  monthly_fee: ["monthly fee", "fee", "fees", "tuition", "monthly tuition", "monthly rate", "rate", "cost", "monthly cost"],
  guardian_name: ["parent", "parent name", "parents name", "guardian", "guardian name", "parent or guardian", "parent guardian", "parent guardian name", "parent or guardian name", "parents", "mother", "father", "mom", "dad"],
  guardian_phone: ["phone", "parent phone", "guardian phone", "phone number", "parent phone number", "contact number", "cell", "cell phone", "mobile", "telephone", "tel"],
  guardian_email: ["email", "e mail", "parent email", "guardian email", "email address", "parent email address"],
  emergency_contact: ["emergency contact", "emergency", "emergency contact name", "emergency name", "emergency phone", "emergency contact phone", "emergency number"],
  allergies: ["allergies", "allergy", "medical", "medical needs", "health", "allergies and medical needs", "allergies medical", "medical conditions", "medical notes", "health notes", "health conditions"],
  notes: ["notes", "note", "comments", "comment", "other", "other notes", "additional notes"],
};
const EXACT = new Map(Object.entries(HEADERS).flatMap(([field, names]) => names.map((n) => [n, field])));

function fieldFor(header) {
  const h = norm(header);
  if (!h) return null;
  if (EXACT.has(h)) return EXACT.get(h);
  const has = (...words) => words.some((w) => h.includes(w));
  if (has("emergency")) return "emergency_contact";
  if (has("birth", "dob")) return "date_of_birth";
  if (has("email", "e mail")) return "guardian_email";
  if (has("phone", "cell", "mobile")) return "guardian_phone";
  if (has("allerg", "medical", "health")) return "allergies";
  if (has("fee", "tuition")) return "monthly_fee";
  if (has("parent", "guardian", "mother", "father")) return "guardian_name";
  if (has("first")) return "first_name";
  if (has("last name", "surname", "family name")) return "last_name";
  if (has("start")) return "start_date";
  if (has("program")) return "program";
  if (has("room")) return "room";
  if (has("status")) return "status";
  if (has("note", "comment")) return "notes";
  if (/\bname\b/.test(h)) return "full_name";
  return null;
}

// ---------------------------------------------------------------------------
// Reading values

const PROGRAM_WORDS = [
  ["Seedlings", ["seedling", "infant", "baby", "babies", "nursery"]],
  ["Sprouts", ["sprout", "toddler"]],
  ["Saplings", ["sapling", "preschool", "pre school", "pre k", "prek", "junior"]],
  ["Branches", ["branch", "school age", "schoolage", "out of school", "oosc", "before and after", "after school", "kindergarten"]],
];
function programFrom(value) {
  const v = norm(value);
  if (!v) return null;
  return PROGRAM_WORDS.find(([, words]) => words.some((w) => v.includes(w)))?.[0] || null;
}

// Program by age: 0–18 months, 18 months–2.5 years, 2.5–4 years, 4–12 years
export function programForAge(dob, today = new Date()) {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  let months = (today.getFullYear() - y) * 12 + today.getMonth() + 1 - m;
  if (today.getDate() < d) months -= 1;
  if (months < 18) return "Seedlings";
  if (months < 30) return "Sprouts";
  if (months < 48) return "Saplings";
  return "Branches";
}

function statusFrom(value) {
  const v = norm(value);
  if (!v) return null;
  if (/wait/.test(v)) return "waitlist";
  if (/withdr|left|leav|inactive|former|past|ended|^no$|^not\b/.test(v)) return "withdrawn";
  if (/enrol|active|current|attending|yes|registered/.test(v)) return "enrolled";
  return undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n) => String(n).padStart(2, "0");
const fullYear = (y) => (y < 100 ? (y <= new Date().getFullYear() % 100 + 1 ? 2000 + y : 1900 + y) : y);
function validDay(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return y > 1900 && y < 2200 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// Numbers like 03/04/2021 could be either way round
const slashParts = (value) => String(value || "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);

// Returns YYYY-MM-DD, or null if it can't be read
export function dayFrom(value, dayFirst = false) {
  const v = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!v) return null;
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = slashParts(v);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], fullYear(+m[3])];
    if (a > 12) return validDay(y, b, a);
    if (b > 12) return validDay(y, a, b);
    return dayFirst ? validDay(y, b, a) : validDay(y, a, b);
  }
  const month = (word) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
  m = v.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i); // March 4, 2021
  if (m && month(m[1])) return validDay(+m[3], month(m[1]), +m[2]);
  m = v.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?,? (\d{4})$/i); // 4 March 2021
  if (m && month(m[2])) return validDay(+m[3], month(m[2]), +m[1]);
  m = v.match(/^(\d{1,2})-([a-z]{3,})-(\d{2}|\d{4})$/i); // 04-Mar-21
  if (m && month(m[2])) return validDay(fullYear(+m[3]), month(m[2]), +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(v)) return serialToDay(Number(v), false); // an Excel date number
  return null;
}

function moneyFrom(value) {
  const v = String(value ?? "").replace(/[$\s,]|CAD/gi, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function splitName(full) {
  const v = String(full || "").trim().replace(/\s+/g, " ");
  if (v.includes(",")) {
    const [last, first] = v.split(",").map((s) => s.trim());
    return { first_name: first || last, last_name: first ? last : "" };
  }
  const parts = v.split(" ");
  return parts.length > 1 ? { first_name: parts.slice(0, -1).join(" "), last_name: parts.at(-1) } : { first_name: v, last_name: "" };
}

// Columns that can appear more than once and are combined
const JOIN = { guardian_name: ", ", guardian_phone: ", ", emergency_contact: ", ", allergies: "; ", notes: "; " };

const key = (c) => `${norm(c.first_name)}|${norm(c.last_name)}|${c.date_of_birth || ""}`;

// ---------------------------------------------------------------------------
// Turning rows into children

// rows: cells from readFile/parseDelimited, heading row first.
// options: { status, program, dayFirst, existing (children already saved) }
export function buildImport(rows, options = {}) {
  const table = rows.map((r) => r.map((c) => String(c ?? "").trim()));
  const headerAt = table.findIndex((r) => r.some(Boolean));
  if (headerAt < 0) return { error: "There's nothing to import yet." };
  const headers = table[headerAt];
  const columns = headers.map(fieldFor);
  const mapped = new Set(columns.filter(Boolean));
  if (!mapped.has("first_name") && !mapped.has("full_name")) {
    return { error: "The first row should be the column headings, including one for the child's name (like First name and Last name). Download the template to see the headings." };
  }
  const ignored = headers.filter((h, i) => h && !columns[i]);

  // Which way round are dates like 03/04/2021? Decide from the whole file.
  const dateCells = table.slice(headerAt + 1).flatMap((r) => columns.flatMap((f, i) => (f === "date_of_birth" || f === "start_date" ? [r[i]] : [])));
  let dayFirstSeen = false;
  let monthFirstSeen = false;
  let ambiguous = false;
  for (const cell of dateCells) {
    const m = slashParts(cell);
    if (!m) continue;
    if (+m[1] > 12) dayFirstSeen = true;
    else if (+m[2] > 12) monthFirstSeen = true;
    else ambiguous = true;
  }
  const dayFirst = dayFirstSeen && !monthFirstSeen ? true : monthFirstSeen && !dayFirstSeen ? false : Boolean(options.dayFirst);
  const askDateOrder = ambiguous && dayFirstSeen === monthFirstSeen;

  const existing = new Set((options.existing || []).map(key));
  const seen = new Set();
  let needsProgram = false;
  let needsStatus = false;
  const items = [];

  table.slice(headerAt + 1).forEach((cells, index) => {
    if (!cells.some(Boolean)) return;
    const raw = {};
    columns.forEach((field, i) => {
      const value = cells[i] || "";
      if (!field || !value) return;
      if (!raw[field]) raw[field] = value;
      else if (JOIN[field]) raw[field] += JOIN[field] + value; // e.g. two parent columns
    });
    const errors = [];
    const warnings = [];
    const names = raw.first_name ? { first_name: raw.first_name, last_name: raw.last_name || "" } : splitName(raw.full_name);
    const child = {
      first_name: names.first_name.trim(),
      last_name: names.last_name.trim(),
      date_of_birth: null,
      program: null,
      room: raw.room || null,
      status: options.status || "enrolled",
      start_date: null,
      monthly_fee: 0,
      guardian_name: raw.guardian_name || null,
      guardian_phone: raw.guardian_phone || null,
      guardian_email: raw.guardian_email || null,
      emergency_contact: raw.emergency_contact || null,
      allergies: raw.allergies || null,
      notes: raw.notes || null,
    };
    if (!child.first_name) errors.push("No name");

    for (const [field, label] of [["date_of_birth", "date of birth"], ["start_date", "start date"]]) {
      if (!raw[field]) continue;
      const day = dayFrom(raw[field], dayFirst);
      if (day) child[field] = day;
      else warnings.push(`Couldn't read the ${label} “${raw[field]}”, so it was left empty`);
    }
    if (child.date_of_birth && child.date_of_birth > new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10)) {
      warnings.push("Date of birth is in the future");
    }

    if (raw.program) {
      child.program = programFrom(raw.program);
      if (!child.program) warnings.push(`Program “${raw.program}” isn't one of ours`);
    }
    if (!child.program) child.program = programForAge(child.date_of_birth);
    if (!child.program) {
      child.program = options.program || "Seedlings";
      needsProgram = true;
    }

    const status = statusFrom(raw.status);
    if (status) child.status = status;
    else needsStatus = true;
    if (raw.status && !status) warnings.push(`Status “${raw.status}” not recognised, so it was set to ${options.status === "waitlist" ? "Waitlist" : "Enrolled"}`);

    if (raw.monthly_fee) {
      const fee = moneyFrom(raw.monthly_fee);
      if (Number.isNaN(fee) || fee < 0) warnings.push(`Couldn't read the fee “${raw.monthly_fee}”, so it was set to $0`);
      else child.monthly_fee = fee;
    }

    let duplicate = "";
    if (child.first_name) {
      const k = key(child);
      if (existing.has(k)) duplicate = "Already in your list";
      else if (seen.has(k)) duplicate = "Listed twice in this file";
      seen.add(k);
    }
    items.push({ line: headerAt + index + 2, child, errors, warnings, duplicate, ok: !errors.length && !duplicate });
  });

  return { items, ignored, askDateOrder, dayFirst, needsProgram, needsStatus, ready: items.filter((i) => i.ok).map((i) => i.child) };
}

// Scope helpers for the staff portal. Every staff page derives its
// permissions from the staff member's bluebell_staff row + their
// bluebell_staff_assignments for the CURRENT academic session:
//   class_teacher of X  → full access to class X (all subjects, students, results)
//   subject_teacher X/S → access to subject S in class X only
//   no assignments      → "general staff" mode: profile/announcements only

import { supabase } from "../supabaseClient.js";
import { authorField } from "./ownership.js";

// date_of_appointment lives in a column added by
// bluebellschool/src/api/bluebell_staff_date_of_appointment.sql. Older databases that
// predate it must not fail the whole staff-scope lookup (every portal page
// resolves through here), so a select that is rejected for an unknown column
// is retried with the appointment date dropped.
const STAFF_COLS_BASE =
  "id, name, staff_no, sex, designation, department, email, phone, address, class_assigned, subjects, profile_pic, status, auth_user_id";
const STAFF_COLS =
  "id, name, staff_no, sex, designation, department, email, phone, address, class_assigned, subjects, profile_pic, date_of_appointment, status, auth_user_id";
const isMissingColumn = (err) => /date_of_appointment|does not exist|column .* does not/i.test(String(err?.message || ""));

export async function fetchStaffScope(email, userId) {
  if (!email && !userId) return null;
  // Prefer the auth-user link: staff can replace their login email on the
  // Profile page, and their scope must keep resolving either way.
  let staff = null;
  let error = null;
  let cols = STAFF_COLS;
  if (userId) {
    ({ data: staff, error } = await supabase
      .from("bluebell_staff")
      .select(cols)
      .eq("auth_user_id", userId)
      .limit(1)
      .maybeSingle());
    if (error && isMissingColumn(error)) {
      cols = STAFF_COLS_BASE;
      ({ data: staff, error } = await supabase
        .from("bluebell_staff")
        .select(cols)
        .eq("auth_user_id", userId)
        .limit(1)
        .maybeSingle());
    }
    if (error) throw error;
  }
  if (!staff && email) {
    ({ data: staff, error } = await supabase
      .from("bluebell_staff")
      .select(cols)
      .ilike("email", email)
      .limit(1)
      .maybeSingle());
    if (error && isMissingColumn(error)) {
      cols = STAFF_COLS_BASE;
      ({ data: staff, error } = await supabase
        .from("bluebell_staff")
        .select(cols)
        .ilike("email", email)
        .limit(1)
        .maybeSingle());
    }
    if (error) throw error;
  }
  if (!staff) return null;

  // current session + term for page-level filtering
  let session = "";
  let term = "";
  try {
    const { data: settings } = await supabase.from("bluebell_settings").select("session, term").limit(1);
    session = settings?.[0]?.session || "";
    term = settings?.[0]?.term || "";
  } catch (_) {/* optional */}

  let assignments = [];
  try {
    const { data } = await supabase
      .from("bluebell_staff_assignments")
      .select("id, class, subject, assignment_type, academic_session")
      .eq("staff_id", staff.id);
    // keep rows without a session set (legacy) or matching the current session
    assignments = (data || []).filter((a) => !a.academic_session || !session || a.academic_session === session);
  } catch (_) {/* table may be empty/missing — general mode */}

  // Legacy fallback: an admin may have assigned a class/subjects directly on the
  // staff form (bluebell_staff.class_assigned / .subjects) without creating
  // bluebell_staff_assignments rows. Surface that so the portal still reflects it.
  if (assignments.length === 0) {
    const legacyClass = String(staff.class_assigned || "").trim();
    const legacySubjects = (
      Array.isArray(staff.subjects) ? staff.subjects : String(staff.subjects || "").split(/[,;]/)
    )
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    if (legacyClass) {
      // A bare class_assigned means the teacher is in charge of that class
      // (form teacher → every subject, roster, attendance). Once subjects are
      // listed the record is describing SUBJECT teaching: they may only score
      // their own rows in Results, and the roster/attendance stay with the
      // class's form teacher — the same split bluebell_staff_assignments encodes.
      assignments = legacySubjects.length
        ? legacySubjects.map((sub, i) => ({
            id: `legacy-sub-${i}`, class: legacyClass, subject: sub,
            assignment_type: "subject_teacher", academic_session: session,
          }))
        : [
            { id: "legacy-ct", class: legacyClass, subject: null, assignment_type: "class_teacher", academic_session: session },
          ];
    }
  }

  const classTeacherClasses = [
    ...new Set(assignments.filter((a) => a.assignment_type === "class_teacher").map((a) => a.class)),
  ];
  const subjectPairs = assignments
    .filter((a) => a.assignment_type === "subject_teacher" && a.subject)
    .map((a) => ({ class: a.class, subject: a.subject }));
  const allClasses = [...new Set(assignments.map((a) => a.class))];

  return {
    staff,
    session,
    term,
    assignments,
    classTeacherClasses,
    // Explicit allow-list for student-info surfaces (roster, attendance,
    // parent contacts): only FORM (class) teachers see student records.
    // Subject teachers get names only inside their own Results/CBT classes.
    rosterClasses: classTeacherClasses,
    mayViewRoster: (cls) => classTeacherClasses.some((c) => normCls(c) === normCls(cls)),
    subjectPairs,
    allClasses,
    isGeneral: assignments.length === 0,
    // Non-Academic staff (minders, assistants, security, cleaners…) may not
    // touch anything academic-related, even if a class assignment exists.
    isAcademic: String(staff.department || "").toLowerCase() !== "non-academic",
    isClassTeacherOf: (cls) => classTeacherClasses.includes(cls),
    // subjects a staff may touch in a given class (class teacher → null = all)
    subjectsOf: (cls) => {
      if (classTeacherClasses.includes(cls)) return null; // all subjects
      return subjectPairs.filter((p) => p.class === cls).map((p) => p.subject);
    },
    mayTeach: (cls, subject) =>
      classTeacherClasses.includes(cls) ||
      subjectPairs.some((p) => p.class === cls && p.subject === subject),
  };
}

// Class names are spelled differently across the schema ("Year 1" in
// bluebell_staff_assignments vs "Year1" in bluebell_result). Normalize before any
// scope comparison so the guard matches regardless of source formatting.
export function normCls(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function normSub(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Tables spell class labels differently ("Year 1" in bluebell_staff_assignments vs
// "Year1" in bluebell_result / legacy pickers). Expand each allowed label into its
// known stored spellings: itself, the space-stripped twin ("Year 1" → "Year1"),
// the spaced twin ("Year1" → "Year 1") and the hyphenated early-years forms
// ("PreNursery1" ⇄ "Pre-Nursery 1").
export function classVariants(classes) {
  const out = new Set();
  const push = (v) => {
    const s = String(v ?? "").trim();
    if (s) out.add(s);
  };
  for (const raw of classes || []) {
    const label = String(raw || "").trim();
    if (!label) continue;
    push(label);
    // a couple of passes reach the combined spellings ("Pre-Nursery 2")
    for (let i = 0; i < 3; i++) {
      for (const v of [...out]) {
        push(v.replace(/\s+/g, "")); // "Year 1" → "Year1"
        push(v.replace(/^(.*?[a-zA-Z])(\d.*)$/, "$1 $2")); // "Year1" → "Year 1"
        if (/^PreNursery/i.test(v)) push(v.replace(/^Pre/, "Pre-"));
        else if (/^Pre-Nursery/i.test(v)) push(v.replace(/^Pre-/, "Pre"));
      }
    }
  }
  return [...out].filter((v) => normCls(v));
}

// Apply a class allow-list to a query, case-insensitively. Stored rows are
// spelled inconsistently ("Year 5" / "Year5" / "PRE-NURSERY 2"), and .in() is an
// exact case-sensitive match, so narrowing with it would silently drop pupils
// the older whole-table fetch used to show. ilike per variant keeps the fetch
// narrow WITHOUT changing which rows a teacher is allowed to see; pages must
// still keep their defensive normCls filter so an unknown spelling can never
// widen access. Empty allow-list → matches nothing.
export function whereClassIn(query, column, classes) {
  const variants = classVariants(classes)
    // wildcards/commas in a label would corrupt the .or() filter syntax
    .map((v) => v.replace(/[%,]/g, ""))
    .filter(Boolean);
  if (!variants.length) return query.in(column, []);
  return query.or(variants.map((v) => `${column}.ilike.${v}`).join(","));
}

// Is a stored row from the CURRENT academic session? Rows with no session
// tag (legacy) are kept so older data does not silently disappear; anything
// explicitly tagged to a different session is hidden once a session is set.
export function inCurrentSession(row, session) {
  const s = String(row?.academic_session || "").trim();
  if (!s || !session) return true;
  return s === session;
}

// Subject-level integrity for result writes.
//
// guardWrite() is synchronous (writeGuard patches the builder before the
// request fires) so it cannot diff an incoming bluebell_result row against the
// stored one to see which subjects actually changed. Instead it enforces the
// CLASS here, and Result.jsx does the merge-preserving save. This helper is
// the explicit pre-flight the page calls BEFORE saving: given a class and the
// list of subject names the teacher is about to write with a score, it returns
// any subject that falls outside their assignment. Class teachers own the whole
// class, so they are never blocked.
export function resultSubjectGuard(scope, cls, subjectNames) {
  const list = (subjectNames || []).filter(Boolean);
  if (!scope || scope.isGeneral) {
    return { ok: false, blocked: list, reason: "No class assignment — result editing is disabled." };
  }
  if (!cls || !scope.allClasses.some((c) => normCls(c) === normCls(cls))) {
    return { ok: false, blocked: list, reason: `You may only edit results for your assigned classes (${scope.allClasses.join(", ")}).` };
  }
  const isFormTeacher = scope.classTeacherClasses.some((c) => normCls(c) === normCls(cls));
  if (isFormTeacher) return { ok: true, blocked: [], reason: "" };
  const allowed = scope.subjectPairs
    .filter((p) => normCls(p.class) === normCls(cls))
    .map((p) => p.subject);
  const blocked = list.filter((s) => !allowed.some((a) => normSub(a) === normSub(s)));
  if (blocked.length) {
    return {
      ok: false,
      blocked,
      reason: `You are not assigned ${blocked.join(", ")} for ${cls}. Your subjects in this class: ${allowed.join(", ") || "none"}.`,
    };
  }
  return { ok: true, blocked: [], reason: "" };
}

// Defensive re-check for verbatim-copied pages (Result, CbtQuestions):
// returns true when `scope` may write this row of `table`, plus a reason.
// `op` is the builder method ("insert" | "update" | "upsert") when known.
export function guardWrite(scope, table, rows, op) {
  if (!scope || scope.isGeneral) return { ok: false, reason: "No class assignment — portal write access is disabled." };
  const email = String(scope.staff?.email || "").toLowerCase();
  const t = String(table || "").toLowerCase();
  const ACADEMIC_TABLES = ["bluebell_result", "bluebell_notes", "bluebell_assignments", "bluebell_lesson_plans", "bluebell_attendance"];
  if (scope.isAcademic === false && (t.startsWith("bluebell_cbt") || ACADEMIC_TABLES.includes(t))) {
    return { ok: false, reason: "Non-academic staff cannot use academic features — ask the administrator if your department is wrong." };
  }
  const list = Array.isArray(rows) ? rows : [rows];
  const mayClass = (cls) => !!cls && scope.allClasses.some((c) => normCls(c) === normCls(cls));
  const mayPair = (cls, subject) => {
    if (!mayClass(cls)) return false;
    if (scope.classTeacherClasses.some((c) => normCls(c) === normCls(cls))) return true;
    return scope.subjectPairs.some(
      (p) => normCls(p.class) === normCls(cls) && normSub(p.subject) === normSub(subject)
    );
  };
  // A payload may never claim another teacher as the author, and a new
  // notes/assignment/lesson-plan row must be attributed to the writer.
  const authorOk = (row) => {
    const field = authorField(t);
    const owner = String(row?.[field] || "").trim().toLowerCase();
    if (owner && owner !== email) {
      return { ok: false, reason: `Only the teacher who created this entry can change it (${field} must be your own account).` };
    }
    if (!owner && op === "insert" && ["bluebell_notes", "bluebell_assignments", "bluebell_lesson_plans"].includes(t)) {
      return { ok: false, reason: `New entries must record their author in the ${field} column.` };
    }
    return { ok: true };
  };

  for (const raw of list) {
    const row = raw || {};
    if (t === "bluebell_auditlogs" || t === "bluebell_staff_attendance") continue; // logging + own gate record
    if (t === "bluebell_result") {
      // Class-level only. Subject-level integrity is enforced by
      // resultSubjectGuard() + the merge-preserving save in Result.jsx, because
      // this synchronous guard cannot compare against the stored term array.
      const cls = row.studentClass ?? row.class;
      if (!mayClass(cls)) {
        return {
          ok: false,
          reason: `You may only upload results for your assigned classes (${scope.allClasses.join(", ")}).${
            scope.classTeacherClasses.length
              ? ` You are form teacher of: ${scope.classTeacherClasses.join(", ")}.`
              : ""
          }`,
        };
      }
    } else if (t.startsWith("bluebell_cbt")) {
      if (!mayPair(row.class, row.subject)) {
        return { ok: false, reason: `You may only create CBT sessions for: ${scope.subjectPairs.map((p) => `${p.subject} (${p.class})`).join(", ") || scope.allClasses.join(", ")}.` };
      }
      const a = authorOk(row);
      if (!a.ok) return a;
    } else if (t === "bluebell_announcements") {
      const aud = String(row.audience || "");
      const cls = aud.startsWith("class:") ? aud.slice(6) : null;
      // staff may post to all staff, all students, or one of their assigned classes
      if (aud !== "all_staff" && aud !== "all_students" && !(cls && mayClass(cls))) {
        return { ok: false, reason: "Announcements may target all staff, all students, or one of your assigned classes only." };
      }
      if (row.created_by && String(row.created_by).toLowerCase() !== email) {
        return { ok: false, reason: "Announcements must be created under your own account." };
      }
    } else if (t === "bluebell_notes" || t === "bluebell_assignments" || t === "bluebell_lesson_plans") {
      const subjectOk =
        scope.classTeacherClasses.some((c) => normCls(c) === normCls(row.class)) ||
        scope.subjectPairs.some((p) => normCls(p.class) === normCls(row.class) && normSub(p.subject) === normSub(row.subject));
      if (!mayClass(row.class) || !subjectOk) {
        return { ok: false, reason: `This resource targets a class/subject outside your assignment (${row.class} · ${row.subject}).` };
      }
      const a = authorOk(row);
      if (!a.ok) return a;
    } else if (t === "bluebell_attendance") {
      // class attendance — class teachers only
      if (!scope.classTeacherClasses.some((c) => normCls(c) === normCls(row.class))) {
        return { ok: false, reason: "Only class teachers may take attendance for a class." };
      }
    }
    // other tables: student profile edits etc. — allowed, pages validate
  }
  return { ok: true };
}

export async function signOutSupabase() {
  try { await supabase.auth.signOut(); } catch (_) {/* best effort */}
}

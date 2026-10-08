// Record-level ownership for the staff portal.
//
// Being assigned to a class+subject is not enough to touch a resource: the
// teacher must also be the one who created it. Two other teachers may both
// own "Year 7 · Mathematics" and each must see only their own notes,
// assignments, lesson plans and CBT sets.
//
// The author column is spelled differently per table, so the mapping lives
// here and every surface reads it from one place:
//   bluebell_notes.uploaded_by · bluebell_assignments.created_by
//   bluebell_lesson_plans.submitted_by · bluebell_cbt*/created_by
//
// The CBT tables only gained `created_by` through an optional SQL paste, so a
// row can arrive without the key at all. That case is treated as "not yet
// tagged" and falls back to class+subject scoping, which keeps the page
// working before the migration is run and locks it down the moment it is.

import { supabase } from "../supabaseClient.js";

const AUTHOR_FIELDS = {
  bluebell_notes: "uploaded_by",
  bluebell_assignments: "created_by",
  bluebell_lesson_plans: "submitted_by",
  bluebell_cbtquestions: "created_by",
  bluebell_cbt_completion: "created_by",
  bluebell_cbt_essay: "created_by",
};

// Column that stores the authoring email for a table (defaults to created_by).
export function authorField(table) {
  return AUTHOR_FIELDS[String(table || "").toLowerCase()] || "created_by";
}

const normEmail = (v) => String(v || "").trim().toLowerCase();

// Does this stored row belong to the signed-in staff member?
// `undefined` (the column is not in the row at all) means the table has not
// been tagged yet → allowed, so the caller's class/subject scope still applies.
export function ownedByMe(scope, table, row) {
  if (!row) return false;
  const field = authorField(table);
  if (!(field in row)) return true;
  const owner = normEmail(row[field]);
  if (!owner) return false; // tagged column, no author (legacy / admin-authored)
  return owner === normEmail(scope?.staff?.email);
}

// Pre-flight used by the pages before an edit or delete, on the row they hold.
export function assertOwnership(scope, table, row) {
  if (ownedByMe(scope, table, row)) return { ok: true, reason: "" };
  const field = authorField(table);
  const owner = normEmail(row?.[field]);
  return {
    ok: false,
    reason: owner
      ? `Only the teacher who created this entry can change it (${owner}).`
      : `Only the teacher who created this entry can change it — this one has no author recorded.`,
  };
}

// Column existence is metadata and never changes within a session, so probe
// once per table and remember it (keeps the write paths to a single request).
const columnCache = new Map();

export async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key);
  let ok = false;
  try {
    const { error } = await supabase.from(table).select(column).limit(1);
    // 42703 = undefined_column. Anything else (a denied read, a network blip)
    // is treated as "the column is there" so the write still carries the author
    // and fails loudly rather than silently storing an owner-less row.
    ok = !error || error.code !== "42703";
  } catch (_) {
    ok = true;
  }
  columnCache.set(key, ok);
  return ok;
}

// Stamp the authoring email onto a fresh insert, but only when the table
// actually has the column — otherwise the write would fail with 42703.
export async function withAuthor(table, payload, email) {
  const field = authorField(table);
  if (!email || payload[field]) return payload;
  if (await hasColumn(table, field)) return { ...payload, [field]: email };
  return payload;
}

// Canonical class list — single source of truth for class ordering/filters in
// the staff portal, kept byte-identical to jmischool/src/utils/classOptions.js
// and mirrored into Spring/Bluebell.
// Stored class values in Supabase are inconsistent ("YEAR 7", "nursery1",
// "Year 5"), so compare/filter through canonClass() instead of raw string
// equality against these labels.
export const CLASS_OPTIONS = [
  "Creche", "PreNursery1", "PreNursery2", "Nursery 1", "Nursery 2",
  "Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Year 6",
  "Year 7", "Year 8", "Year 9", "Year 10", "Year 11", "Year 12",
];

// "nursery1", "NURSERY 1", " Nursery-1 " all resolve to the canonical label.
// Values outside the canonical set (e.g. legacy "Daycare") are returned
// trimmed but unchanged.
const BY_KEY = new Map(
  CLASS_OPTIONS.map((c) => [c.toLowerCase().replace(/[^a-z0-9]/g, ""), c])
);

export function canonClass(value) {
  if (!value) return "";
  const s = String(value).trim();
  return BY_KEY.get(s.toLowerCase().replace(/[^a-z0-9]/g, "")) || s;
}

// Unique canonical labels for a list of raw stored values, ordered by the
// canonical sequence first, then any non-canonical leftovers alphabetically.
export function canonicalizeClasses(values) {
  const rank = new Map(CLASS_OPTIONS.map((c, i) => [c, i]));
  const uniq = [...new Set((values || []).map(canonClass).filter(Boolean))];
  return uniq.sort(
    (a, b) =>
      (rank.has(a) ? rank.get(a) : 999) - (rank.has(b) ? rank.get(b) : 999) ||
      a.localeCompare(b)
  );
}

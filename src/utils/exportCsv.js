// Dependency-free CSV download used by the read-only Records view
// (src/pages_components/StaffRecords.jsx). Builds a quoted CSV from a column
// spec and triggers a browser download via the Blob + <a download> idiom used
// elsewhere in the app. The leading BOM keeps Excel/LibreOffice from mangling
// non-ASCII names when opening the file.

// columns: [{ key, label?, get? }] — `get(row)` wins over `row[key]` for
// derived cells (amount formatting, joined lists, etc.).
export function downloadCsv(filename, columns, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = columns.map((c) => esc(c.label ?? c.key)).join(",");
  const body = (rows || []).map((r) =>
    columns.map((c) => esc(typeof c.get === "function" ? c.get(r) : r[c.key])).join(",")
  );
  const csv = [header, ...body].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default downloadCsv;

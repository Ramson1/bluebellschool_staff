"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { downloadCsv } from "../utils/exportCsv.js";
import { CLASS_OPTIONS, canonClass } from "../utils/classOptions.js";
import {
  RiTeamLine,
  RiGroupLine,
  RiPriceTagLine,
  RiTimeLine,
  RiBarChartBoxLine,
  RiDraftLine,
  RiQuestionAnswerLine,
  RiBookOpenLine,
  RiFileTextLine,
  RiSearchLine,
  RiRefreshLine,
  RiDownloadLine,
  RiForbidLine,
} from "react-icons/ri";
import "../styles/AdminPages.css";

// School-wide READ-ONLY records views for admin/secretarial designations
// (see RECORDS_VIEWER_DESIGNATIONS in src/utils/scope.js). Each dataset is its
// own sidebar button/route (/records/<id>) — this component renders ONE
// dataset, chosen by the `dataset` prop. The signed-in staff member sees EVERY
// record across all classes for that dataset and can download the filtered
// rows as CSV. No insert/update/delete is issued: a Secretary has no class
// assignment so stays isGeneral and the write guard keeps rejecting mutations;
// this page simply never attempts one. Data is fetched school-wide on purpose
// (no roster filter) — the gate is the designation, checked below.

const PASSPORT_BUCKET = "passport";
const PASSPORT_PLACEHOLDER = "placeholder.png";
function passportSrc(value) {
  const v = String(value || "").trim();
  if (!v) {
    return supabase.storage.from(PASSPORT_BUCKET).getPublicUrl(PASSPORT_PLACEHOLDER).data.publicUrl;
  }
  if (/^https?:\/\//i.test(v)) return v;
  return supabase.storage.from(PASSPORT_BUCKET).getPublicUrl(v).data.publicUrl;
}

// Canonical Creche → Year 12 rank for ordering class labels/values. Unknown
// labels sort after the ladder, alphabetically.
const CLASS_RANK = new Map(CLASS_OPTIONS.map((c, i) => [c, i]));
const classRank = (v) => {
  const c = canonClass(v);
  return CLASS_RANK.has(c) ? CLASS_RANK.get(c) : 999;
};

// bluebell_result stores one array of subject rows per term. Flatten to a compact
// readable string for the table + CSV, e.g. "Mathematics 80(A); English 75(B)".
function fmtSubjects(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list
    .map((s) => {
      const name = s.subjectName || s.subject || "?";
      const total = s.total != null && s.total !== "" ? ` ${s.total}` : "";
      const grade = s.grade ? `(${s.grade})` : "";
      return `${name}${total}${grade}`.trim();
    })
    .join("; ");
}

const joinList = (v) => (Array.isArray(v) ? v.join(", ") : String(v || ""));
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : "—");
const openLink = (url) => (url ? <a href={url} target="_blank" rel="noopener noreferrer">open</a> : "—");
const sessionTerm = (r) => [r.academic_session, r.term].filter(Boolean).join(" · ") || r.term || "—";

const Trunc = ({ text, width = 300 }) => (
  <span title={text} style={{ display: "inline-block", maxWidth: width, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
    {text || "—"}
  </span>
);

// One config per dataset: how to fetch, the class/term filter fields (null = no
// such filter), the fields the search box matches, an optional rowSort, and the
// columns shared by the table (render) and the CSV export (get).
const DATASETS = [
  {
    id: "staff",
    label: "Staff Records",
    icon: RiTeamLine,
    classKey: null,
    termKey: null,
    photo: { key: "profile_pic" },
    searchKeys: ["name", "staff_no", "designation", "department", "class_assigned", "email", "phone"],
    fetch: () =>
      supabase
        .from("bluebell_staff")
        .select("id, staff_no, name, sex, designation, department, email, phone, class_assigned, subjects, status, profile_pic")
        .order("name", { ascending: true }),
    columns: [
      { key: "staff_no", label: "Staff No" },
      { key: "name", label: "Name" },
      { key: "sex", label: "Sex" },
      { key: "designation", label: "Designation" },
      { key: "department", label: "Department" },
      { key: "class_assigned", label: "Class", get: (r) => r.class_assigned || "—" },
      { key: "subjects", label: "Subjects", get: (r) => joinList(r.subjects) || "—" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      {
        key: "status",
        label: "Status",
        render: (r) => (
          <span className={"ap-badge " + (r.status === "active" || !r.status ? "ok" : r.status === "suspended" ? "warn" : "danger")}>
            {r.status || "active"}
          </span>
        ),
      },
    ],
  },
  {
    id: "students",
    label: "Student Records",
    icon: RiGroupLine,
    classKey: "class",
    termKey: null,
    photo: { key: "passport" },
    searchKeys: ["name", "class", "sex", "parentcontact"],
    // Ordered Creche → Year 12, then by pupil name within each class.
    rowSort: (a, b) => classRank(a.class) - classRank(b.class) || String(a.name || "").localeCompare(String(b.name || "")),
    fetch: () =>
      supabase
        .from("bluebell_student")
        .select("id, name, class, sex, parentcontact, passport, token")
        .order("name", { ascending: true }),
    columns: [
      { key: "name", label: "Name" },
      { key: "class", label: "Class", get: (r) => canonClass(r.class) || r.class || "—" },
      { key: "sex", label: "Sex", get: (r) => r.sex || "—" },
      { key: "parentcontact", label: "Parent Contact", get: (r) => r.parentcontact || "—" },
      { key: "token", label: "Result Token", get: (r) => (r.token ? "Issued" : "None") },
    ],
  },
  {
    id: "payments",
    label: "Payments",
    icon: RiPriceTagLine,
    classKey: "class",
    termKey: "currentterm",
    searchKeys: ["name", "class", "description"],
    fetch: () => supabase.from("bluebell_paymentsinfo").select("*").order("date", { ascending: false }),
    columns: [
      { key: "name", label: "Student" },
      { key: "class", label: "Class", get: (r) => r.class || "—" },
      { key: "description", label: "Payment Type", get: (r) => r.description || "—" },
      { key: "amountpaid", label: "Amount", get: (r) => r.amountpaid ?? "—" },
      { key: "currentterm", label: "Term", get: (r) => r.currentterm || "—" },
      { key: "date", label: "Date", get: (r) => r.date || "—" },
    ],
  },
  {
    id: "attendance",
    label: "Attendance",
    icon: RiTimeLine,
    classKey: "class",
    termKey: "term",
    searchKeys: ["student_name", "class", "status"],
    fetch: () =>
      supabase
        .from("bluebell_attendance")
        .select("student_name, class, term, date, status, check_in_time, check_out_time, method")
        .order("date", { ascending: false })
        .limit(5000),
    columns: [
      { key: "student_name", label: "Student", get: (r) => r.student_name || "(unknown)" },
      { key: "class", label: "Class", get: (r) => r.class || "—" },
      { key: "term", label: "Term", get: (r) => r.term || "—" },
      { key: "date", label: "Date", get: (r) => r.date || "—" },
      {
        key: "status",
        label: "Status",
        render: (r) => {
          const s = String(r.status || "present").toLowerCase();
          return <span className={"ap-badge " + (s === "absent" ? "red" : s === "late" ? "warn" : "ok")} style={{ textTransform: "capitalize" }}>{s}</span>;
        },
        get: (r) => r.status || "present",
      },
      { key: "check_in_time", label: "Check-in", get: (r) => r.check_in_time || "—" },
      { key: "check_out_time", label: "Check-out", get: (r) => r.check_out_time || "—" },
      { key: "method", label: "Method", get: (r) => r.method || "—" },
    ],
  },
  {
    id: "results",
    label: "Results",
    icon: RiBarChartBoxLine,
    classKey: "studentClass",
    termKey: null, // one row holds all three terms, so a term filter is not meaningful
    searchKeys: ["studentName", "studentClass"],
    fetch: () =>
      supabase
        .from("bluebell_result")
        .select("studentName, studentClass, term1Subjects, term2Subjects, term3Subjects")
        .order("studentName", { ascending: true })
        .limit(5000),
    columns: [
      { key: "studentName", label: "Student" },
      { key: "studentClass", label: "Class", get: (r) => r.studentClass || "—" },
      { key: "term1Subjects", label: "1st Term", render: (r) => <Trunc text={fmtSubjects(r.term1Subjects)} width={240} />, get: (r) => fmtSubjects(r.term1Subjects) },
      { key: "term2Subjects", label: "2nd Term", render: (r) => <Trunc text={fmtSubjects(r.term2Subjects)} width={240} />, get: (r) => fmtSubjects(r.term2Subjects) },
      { key: "term3Subjects", label: "3rd Term", render: (r) => <Trunc text={fmtSubjects(r.term3Subjects)} width={240} />, get: (r) => fmtSubjects(r.term3Subjects) },
    ],
  },
  {
    id: "lesson_plans",
    label: "Lesson Plans",
    icon: RiDraftLine,
    classKey: "class",
    termKey: "term",
    searchKeys: ["topic", "class", "subject", "submitted_by"],
    fetch: () => supabase.from("bluebell_lesson_plans").select("*").order("created_at", { ascending: false }).limit(5000),
    columns: [
      { key: "topic", label: "Topic", get: (r) => r.topic || r.objectives || "—" },
      { key: "class", label: "Class", get: (r) => r.class || "—" },
      { key: "subject", label: "Subject", get: (r) => r.subject || "—" },
      { key: "week", label: "Week", get: (r) => r.week || "—" },
      { key: "lesson_date", label: "Date", get: (r) => r.lesson_date || "—" },
      { key: "submitted_by", label: "Submitted by", get: (r) => r.submitted_by || "—" },
      { key: "created_at", label: "Added", render: (r) => fmtDate(r.created_at), get: (r) => fmtDate(r.created_at) },
    ],
  },
  {
    id: "cbt",
    label: "CBT Questions",
    icon: RiQuestionAnswerLine,
    classKey: "class",
    termKey: "term",
    searchKeys: ["question", "class", "subject", "sessionType", "created_by"],
    // Questions live across three tables (objective/completion/essay); merge
    // them into one list tagged with its session type, the same way the CBT
    // page presents them. select("*") keeps this safe on legacy schemas.
    fetch: async () => {
      const [o, c, e] = await Promise.all([
        supabase.from("bluebell_cbtQuestions").select("*"),
        supabase.from("bluebell_cbt_completion").select("*"),
        supabase.from("bluebell_cbt_essay").select("*"),
      ]);
      const rows = [
        ...(o.data || []).map((r) => ({ ...r, sessionType: "objective" })),
        ...(c.data || []).map((r) => ({ ...r, sessionType: "completion" })),
        ...(e.data || []).map((r) => ({ ...r, sessionType: "essay" })),
      ];
      return { data: rows, error: o.error || c.error || e.error || null };
    },
    columns: [
      { key: "sessionType", label: "Type", render: (r) => <span className="ap-badge info" style={{ textTransform: "capitalize" }}>{r.sessionType}</span>, get: (r) => r.sessionType },
      { key: "class", label: "Class", get: (r) => r.class || "—" },
      { key: "subject", label: "Subject", get: (r) => r.subject || "—" },
      { key: "question", label: "Question", render: (r) => <Trunc text={String(r.question || "")} width={360} />, get: (r) => String(r.question || "") },
      { key: "created_by", label: "Created by", get: (r) => r.created_by || "—" },
      { key: "created_at", label: "Added", render: (r) => fmtDate(r.created_at), get: (r) => fmtDate(r.created_at) },
    ],
  },
  {
    id: "notes",
    label: "E-Notes",
    icon: RiBookOpenLine,
    classKey: "class",
    termKey: "term",
    searchKeys: ["title", "class", "subject", "uploaded_by"],
    fetch: () => supabase.from("bluebell_notes").select("*").order("created_at", { ascending: false }).limit(5000),
    columns: [
      { key: "title", label: "Title", get: (r) => r.title || "—" },
      { key: "class", label: "Class", get: (r) => r.class || "—" },
      { key: "subject", label: "Subject", get: (r) => r.subject || "—" },
      { key: "term", label: "Session · Term", render: (r) => sessionTerm(r), get: sessionTerm },
      { key: "file_url", label: "File", render: (r) => openLink(r.file_url), get: (r) => r.file_url || "—" },
      { key: "uploaded_by", label: "Uploaded by", get: (r) => r.uploaded_by || "—" },
      { key: "created_at", label: "Added", render: (r) => fmtDate(r.created_at), get: (r) => fmtDate(r.created_at) },
    ],
  },
  {
    id: "assignments",
    label: "Assignments",
    icon: RiFileTextLine,
    classKey: "class",
    termKey: "term",
    searchKeys: ["title", "class", "subject", "assignment_type", "created_by"],
    fetch: () => supabase.from("bluebell_assignments").select("*").order("created_at", { ascending: false }).limit(5000),
    columns: [
      { key: "title", label: "Title", get: (r) => r.title || "—" },
      { key: "class", label: "Class", get: (r) => r.class || "—" },
      { key: "subject", label: "Subject", get: (r) => r.subject || "—" },
      { key: "assignment_type", label: "Type", get: (r) => r.assignment_type || "—" },
      { key: "due_date", label: "Due", get: (r) => r.due_date || "—" },
      { key: "attachment_url", label: "File", render: (r) => openLink(r.attachment_url), get: (r) => r.attachment_url || "—" },
      { key: "created_by", label: "Created by", get: (r) => r.created_by || "—" },
    ],
  },
];

export default function StaffRecords({ dataset }) {
  const scope = useContext(StaffContext);
  const ds = DATASETS.find((d) => d.id === dataset) || DATASETS[0];
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState("");
  const [term, setTerm] = useState("");
  // Fullscreen passport viewer: { src, name } while open, null when closed.
  const [viewer, setViewer] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    Promise.resolve()
      .then(() => ds.fetch())
      .then(({ data, error: err }) => {
        if (err) { setError(err.message); setRows([]); }
        else setRows(data || []);
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false));
  };

  // Refetch whenever the dataset route param changes.
  useEffect(() => {
    if (!scope?.recordsAccess) return;
    load();
    setSearch("");
    setCls("");
    setTerm("");
    setViewer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds.id, scope?.recordsAccess]);

  // Class + term option lists, derived from the loaded rows (no external
  // class-list dependency for values, so nothing drifts), ordered by the
  // canonical Creche → Year 12 ladder for classes.
  const classOptions = useMemo(() => {
    if (!ds.classKey) return [];
    return [...new Set(rows.map((r) => r[ds.classKey]).filter(Boolean))].sort(
      (a, b) => classRank(a) - classRank(b) || String(a).localeCompare(String(b))
    );
  }, [rows, ds]);
  const termOptions = useMemo(() => {
    if (!ds.termKey) return [];
    return [...new Set(rows.map((r) => r[ds.termKey]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  }, [rows, ds]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (ds.classKey && cls && String(r[ds.classKey] || "") !== cls) return false;
      if (ds.termKey && term && String(r[ds.termKey] || "") !== term) return false;
      if (!q) return true;
      return ds.searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q));
    });
    if (ds.rowSort) list = [...list].sort(ds.rowSort);
    return list;
  }, [rows, search, cls, term, ds]);

  if (!scope) return null;

  // Authoritative gate: the nav button is only the convenience layer. Anyone
  // reaching this route without the designation gets the restricted card.
  if (!scope.recordsAccess) {
    return (
      <div className="ap-card">
        <div className="ap-card-head"><RiForbidLine /> Restricted</div>
        <div className="ap-empty pad">
          The Records overview is available only to administrative designations
          (Secretary, Registrar, Administrative Officer, Bursar, Accountant). If
          you believe you should have access, ask the school administrator to
          update your staff designation.
        </div>
      </div>
    );
  }

  const onDownload = () => {
    const fname = `bluebell-${ds.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(fname, ds.columns, visible);
  };

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><ds.icon /></span>{ds.label}</h1>
          <p className="ap-sub">
            School-wide, read-only view. You can view and download any record,
            but editing is not available from this page.
          </p>
        </div>
        <div className="ap-actions">
          <span className="ap-pill blue">{visible.length} record{visible.length === 1 ? "" : "s"}</span>
          <button className="ap-btn" onClick={onDownload} disabled={visible.length === 0}>
            <RiDownloadLine /> Download CSV
          </button>
        </div>
      </div>

      <div className="ap-toolbar">
        <div className="ap-search">
          <RiSearchLine />
          <input className="ap-input" placeholder={`Search ${ds.label.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {ds.classKey && (
          <select className="ap-input" value={cls} onChange={(e) => setCls(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">All classes</option>
            {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {ds.termKey && (
          <select className="ap-input" value={term} onChange={(e) => setTerm(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All terms</option>
            {termOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button className="ap-btn" onClick={load}><RiRefreshLine /> Refresh</button>
      </div>

      <div className="ap-card">
        <div className="ap-card-head">
          <span className="ic"><ds.icon /></span> {ds.label}
        </div>
        {loading ? (
          <div className="ap-loading"><div className="ap-spinner" /> Loading {ds.label.toLowerCase()}…</div>
        ) : error ? (
          <div className="ap-empty pad">Could not load {ds.label.toLowerCase()}: {error}</div>
        ) : (
          <div className="ap-tablewrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>#</th>
                  {ds.photo && <th>Photo</th>}
                  {ds.columns.map((c) => <th key={c.key}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={ds.columns.length + 1 + (ds.photo ? 1 : 0)} className="ap-empty">No records match the current filters.</td></tr>
                ) : (
                  visible.map((r, i) => (
                    <tr key={r.id ?? `${ds.id}-${i}`}>
                      <td>{i + 1}</td>
                      {ds.photo && (
                        <td>
                          <img
                            src={passportSrc(r[ds.photo.key])}
                            alt={`${r.name || "record"}'s passport`}
                            title="Click to view full screen"
                            onClick={() => setViewer({ src: passportSrc(r[ds.photo.key]), name: r.name || "" })}
                            style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", background: "#e9edf2", cursor: "zoom-in" }}
                          />
                        </td>
                      )}
                      {ds.columns.map((c) => (
                        <td key={c.key}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewer && (
        <div
          onClick={() => setViewer(null)}
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 16, maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}
          >
            {viewer.name ? <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{viewer.name}</div> : null}
            <img
              src={viewer.src}
              alt={viewer.name ? `${viewer.name}'s passport` : "Passport"}
              style={{ maxWidth: "82vw", maxHeight: "70vh", width: "auto", height: "auto", objectFit: "contain", borderRadius: 10, background: "#e9edf2" }}
            />
            <button className="ap-btn" onClick={() => setViewer(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Button } from "react-bootstrap";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { normCls, normSub, inCurrentSession } from "../utils/scope.js";
import { authorField, ownedByMe, assertOwnership } from "../utils/ownership.js";
import { logAction } from "../api/auditLog.js";
import { schoolSubjects } from "../utils/subjectUtils.js";
import { toast } from "react-toastify";
import {
  RiAddLine,
  RiSearchLine,
  RiRefreshLine,
  RiEditLine,
  RiDeleteBinLine,
  RiUploadCloud2Line,
  RiAttachmentLine,
  RiCloseLine,
} from "react-icons/ri";
import "../styles/AdminPages.css";

export const TERMS = ["First Term", "Second Term", "Third Term"];

// Every subject the school teaches — used when a class teacher picks a subject.
export const ALL_SUBJECTS = Array.from(new Set(Object.values(schoolSubjects).flat())).sort();

// Upload resource files to the existing 'cbt' bucket under academics/.
export async function uploadAcademicFile(file, folder = "misc") {
  const ext = file.name.split(".").pop() || "bin";
  const path = `academics/${folder}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  const { error } = await supabase.storage.from("cbt").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("cbt").getPublicUrl(path);
  return data.publicUrl;
}

// Classes/subjects the signed-in staff member may attach resources to.
export function useScopedOptions() {
  const scope = useContext(StaffContext);
  if (!scope) return { scope: null, classes: [], subjectsFor: () => [] };
  const classes = scope.allClasses;
  const subjectsFor = (cls) => {
    if (!cls) return ALL_SUBJECTS;
    if (scope.classTeacherClasses.some((c) => normCls(c) === normCls(cls))) return ALL_SUBJECTS;
    return scope.subjectPairs.filter((p) => normCls(p.class) === normCls(cls)).map((p) => p.subject);
  };
  return { scope, classes, subjectsFor };
}

// Theme-aware drag & drop attachment picker that replaces the raw browser
// file input: click (or Enter/Space) opens the native dialog, dropping a file
// runs the same upload. Once attached the file shows as a chip with an open
// link and a remove button; a paste-a-link fallback stays available below.
// (Ported verbatim from the admin portal's AdminAcademicsKit.jsx.)
function FileDrop({ value, name, busy, onFile, onClear }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const fileName = name || (value ? decodeURIComponent(value.split("/").pop().split("?")[0]) : "");
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && !busy) onFile(f);
  };
  if (value && !busy) {
    return (
      <div className="ap-filechip">
        <RiAttachmentLine />
        <a href={value} target="_blank" rel="noopener noreferrer" title={fileName}>
          {fileName || "Attached file"}
        </a>
        <button type="button" className="ap-filechip-x" title="Remove attachment" onClick={onClear}>
          <RiCloseLine />
        </button>
      </div>
    );
  }
  return (
    <>
      <div
        className={`ap-dropzone${drag ? " drag" : ""}${busy ? " busy" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Attach a file"
        onClick={() => { if (!busy) inputRef.current?.click(); }}
        onKeyDown={(e) => { if (!busy && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click(); } }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!busy) setDrag(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!busy) setDrag(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); }}
        onDrop={handleDrop}
      >
        <RiUploadCloud2Line className="ap-dropzone-ic" />
        <div>
          <div className="ap-dropzone-title">{busy ? "Uploading, please wait…" : "Drag & drop a file here"}</div>
          <div className="ap-dropzone-sub">or click to browse (PDF, DOCX, images, video…)</div>
        </div>
      </div>
      <input
        ref={inputRef} type="file" hidden
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }}
      />
    </>
  );
}

/**
 * Config-driven CRUD screen for the staff-portal academic tables.
 * config: {
 *   table, title, icon, blurb,              -- basics
 *   columns: [{key, label, type, options, required, full, placeholder}]
 *   listColumns: [{key, label, render?}]    -- table view
 *   withTerm, withSession, withFile(fileKey) -- common extras folded into columns
 * }
 */
export function makeAcademicsPage(config) {
  return function AcademicsPage() {
    const { scope, classes, subjectsFor } = useScopedOptions();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [clsFilter, setClsFilter] = useState("");
    const [show, setShow] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({});
    const [fileBusy, setFileBusy] = useState(false);
    const [fileNames, setFileNames] = useState({});

    const load = () => {
      if (!config.table) return;
      setLoading(true);
      supabase
        .from(config.table)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500)
        .then(({ data, error }) => {
          if (error) toast.error(`Could not load ${config.title.toLowerCase()}: ${error.message}`);
          // Defensive scope filter — only my classes (and my subjects when
          // pair-scoped) AND only the rows I authored. Two teachers assigned to
          // the same class+subject each see just their own entries; anything a
          // colleague or the admin created stays in the admin portal.
          const mine = (data || []).filter((r) =>
            inCurrentSession(r, scope?.session) &&
            classes.some((c) => normCls(c) === normCls(r.class)) &&
            (scope?.classTeacherClasses.some((c) => normCls(c) === normCls(r.class)) ||
              scope?.subjectPairs.some((p) => normCls(p.class) === normCls(r.class) && normSub(p.subject) === normSub(r.subject))) &&
            ownedByMe(scope, config.table, r)
          );
          setRows(mine);
        })
        .finally(() => setLoading(false));
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);

    // Build the effective column list (folds withTerm/withSession/withFile in).
    const columns = useMemo(() => {
      const cols = [...(config.columns || [])];
      const idx = cols.findIndex((c) => c.key === "subject") + 1 || 2;
      const extras = [];
      if (config.withSession) extras.push({ key: "academic_session", label: "Academic Session", type: "text", placeholder: scope?.session || "" });
      if (config.withTerm) extras.push({ key: "term", label: "Term", type: "select", options: TERMS });
      cols.splice(idx, 0, ...extras);
      if (config.withFile) cols.push({ key: config.withFile, label: "Attachment (PDF/Word/Image)", type: "file" });
      return cols;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    const openNew = () => {
      const initial = { class: classes[0] || "", created_by: scope?.staff?.email };
      for (const c of columns) if (c.key === "academic_session" && scope?.session) initial[c.key] = scope.session;
      setForm(initial);
      setEditing(null);
      setShow(true);
    };
    const openEdit = (r) => {
      const own = assertOwnership(scope, config.table, r);
      if (!own.ok) { toast.warn(own.reason); return; }
      setForm({ ...r }); setEditing(r); setShow(true);
    };
    const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const onPickFile = async (key, file) => {
      if (!file) return;
      setFileBusy(true);
      try {
        const url = await uploadAcademicFile(file, config.table);
        setField(key, url);
        setFileNames((n) => ({ ...n, [key]: file.name }));
        toast.success("File uploaded.");
      } catch (e) {
        toast.error("Upload failed: " + e.message);
      } finally {
        setFileBusy(false);
      }
    };

    const validate = () => {
      if (!form.class) return "Select a class.";
      if (columns.some((c) => c.key === "subject") && !form.subject) return "Select a subject.";
      for (const c of columns) {
        if (c.required && !String(form[c.key] ?? "").trim()) return `${c.label} is required.`;
      }
      if (!scope?.mayTeach?.(form.class, form.subject || "")) {
        return "That class/subject is outside your assignment.";
      }
      return null;
    };

    const save = async () => {
      const err = validate();
      if (err) { toast.warn(err); return; }
      setSaving(true);
      const payload = {};
      for (const c of columns) {
        let v = form[c.key];
        if (v === undefined) continue;
        if (c.type === "number") v = v === "" ? null : Number(v);
        payload[c.key] = v;
      }
      payload.class = classes.find((c) => normCls(c) === normCls(payload.class)) || payload.class; // canonical spelling
      if (payload.subject) {
        const opts = subjectsFor(payload.class);
        payload.subject = opts.find((s) => normSub(s) === normSub(payload.subject)) || payload.subject;
      }
      // Attribute the record to the writer (bluebell_notes → uploaded_by,
      // bluebell_assignments → created_by). The network guard refuses a payload
      // naming another teacher, and refuses a new row with no author at all,
      // so an account without an email fails loudly instead of storing a row
      // nobody owns.
      const authorKey = config.authorField || authorField(config.table);
      if (editing) {
        const owned = assertOwnership(scope, config.table, editing);
        if (!owned.ok) { toast.warn(owned.reason); setSaving(false); return; }
      }
      payload[authorKey] = scope?.staff?.email || null;
      const { data, error } = editing
        ? await supabase.from(config.table).update(payload).eq("id", editing.id).select()
        : await supabase.from(config.table).insert([payload]).select();
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      logAction(supabase, {
        email: scope?.staff?.email, name: scope?.staff?.name, role: "staff",
        action: editing ? `${config.table}_update` : `${config.table}_add`,
        targetTable: config.table, recordId: data?.[0]?.id,
        details: { class: payload.class, subject: payload.subject, title: payload.title || payload.topic || "" },
      });
      setShow(false);
      if (editing) setRows((rs) => rs.map((r) => (r.id === editing.id ? { ...r, ...data[0] } : r)));
      else setRows((rs) => [data[0], ...rs]);
      toast.success(editing ? "Updated." : "Saved.");
    };

    const remove = async (r) => {
      const own = assertOwnership(scope, config.table, r);
      if (!own.ok) { toast.warn(own.reason); return; }
      if (!window.confirm(`Delete this entry for ${r.class}${r.subject ? " · " + r.subject : ""}?`)) return;
      const { error } = await supabase.from(config.table).delete().eq("id", r.id);
      if (error) { toast.error(error.message); return; }
      logAction(supabase, { email: scope?.staff?.email, name: scope?.staff?.name, role: "staff", action: `${config.table}_delete`, targetTable: config.table, recordId: r.id, details: { class: r.class, subject: r.subject } });
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      toast.success("Deleted.");
    };

    const visible = useMemo(() => {
      const q = search.trim().toLowerCase();
      return rows.filter((r) => {
        if (clsFilter && normCls(r.class) !== normCls(clsFilter)) return false;
        if (!q) return true;
        return JSON.stringify(r).toLowerCase().includes(q);
      });
    }, [rows, search, clsFilter]);

    if (!scope) return null;

    const Icon = config.icon;
    return (
      <div>
        <div className="ap-head">
          <div>
            <h1 className="ap-title"><span className="ap-title-ic"><Icon /></span>{config.title}</h1>
            <p className="ap-sub">{config.blurb}</p>
          </div>
          <div className="ap-actions">
            <span className="ap-pill blue">{visible.length} record{visible.length === 1 ? "" : "s"}</span>
            <button className="ap-btn primary" onClick={openNew}><RiAddLine /> New</button>
          </div>
        </div>

        <div className="ap-toolbar">
          <div className="ap-search">
            <RiSearchLine />
            <input className="ap-input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="ap-input" value={clsFilter} onChange={(e) => setClsFilter(e.target.value)}>
            <option value="">All my classes</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="ap-btn" onClick={load}><RiRefreshLine /> Refresh</button>
        </div>

        <p className="ap-hint ap-owned-note">
          Only the {config.title.toLowerCase()} you created are listed here — a colleague's entry for the same class and subject stays in their own view.
        </p>

        <div className="ap-card">
          {loading ? (
            <div className="ap-loading"><div className="ap-spinner" /> Loading…</div>
          ) : (
            <div className="ap-tablewrap">
              <table className="ap-table">
                <thead>
                  <tr>
                    {(config.listColumns || []).map((c) => <th key={c.key}>{c.label}</th>)}
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={(config.listColumns || []).length + 1} className="ap-empty">Nothing here yet — use “New” to add your first entry.</td></tr>
                  ) : visible.map((r) => (
                    <tr key={r.id}>
                      {(config.listColumns || []).map((c) => (
                        <td key={c.key}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>
                      ))}
                      <td className="text-end">
                        <button className="ap-btn sm" onClick={() => openEdit(r)}><RiEditLine /></button>{" "}
                        <button className="ap-btn sm danger" onClick={() => remove(r)}><RiDeleteBinLine /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Modal show={show} onHide={() => setShow(false)} size="lg" centered>
          <Modal.Header className="ap-modal-head" closeButton closeVariant="white">
            <Modal.Title style={{ fontSize: "1.05rem", fontWeight: 800 }}>{editing ? "Edit" : "New"} {config.title.replace(/s$/, "").toLowerCase()}</Modal.Title>
          </Modal.Header>
          <Modal.Body className="ap-modal-body">
            <div className="row g-3">
              {columns.map((c) => (
                <div className={c.full ? "col-12" : "col-md-6"} key={c.key}>
                  <label className="ap-label">{c.label}{c.required ? " *" : ""}</label>
                  {c.type === "textarea" ? (
                    <textarea className="ap-input" rows={c.rows || 4} value={form[c.key] || ""} placeholder={c.placeholder} onChange={(e) => setField(c.key, e.target.value)} />
                  ) : c.type === "select" ? (
                    <select className="ap-input" value={form[c.key] || ""} onChange={(e) => setField(c.key, e.target.value)}>
                      <option value="">Select…</option>
                      {(c.key === "class" ? classes : c.key === "subject" ? subjectsFor(form.class) : c.options || []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : c.type === "file" ? (
                    <div>
                      <FileDrop
                        value={form[c.key]}
                        name={fileNames[c.key]}
                        busy={fileBusy}
                        onFile={(file) => onPickFile(c.key, file)}
                        onClear={() => { setField(c.key, ""); setFileNames((n) => ({ ...n, [c.key]: "" })); }}
                      />
                      <div className="ap-or">or paste a link</div>
                      <input
                        className="ap-input" placeholder="https://… (file link)"
                        value={form[c.key] || ""} onChange={(e) => setField(c.key, e.target.value)}
                      />
                    </div>
                  ) : (
                    <input className="ap-input" type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"} value={form[c.key] ?? ""} placeholder={c.placeholder} onChange={(e) => setField(c.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          </Modal.Body>
          <Modal.Footer className="ap-modal-foot">
            <Button variant="light" onClick={() => setShow(false)}>Cancel</Button>
            <Button variant="success" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  };
}

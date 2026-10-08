"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { Modal, Button } from "react-bootstrap";
import { toast } from "react-toastify";
import { StaffContext } from "../components/StaffShell.jsx";
import { useScopedOptions, TERMS } from "./AcademicsKit.jsx";
import { normCls, normSub, inCurrentSession } from "../utils/scope.js";
import { ownedByMe, assertOwnership } from "../utils/ownership.js";
import { logAction } from "../api/auditLog.js";
import { supabase } from "../supabaseClient.js";
import {
  TABLE,
  emptyPlan,
  listPlans,
  savePlan,
  deletePlan,
} from "../utils/lessonPlanApi.js";
import LessonPlanDoc from "../components/LessonPlanDoc.jsx";
import { exportLessonPlanToDocx } from "../utils/lessonPlanDocx.js";
import "../styles/AdminPages.css";
import {
  RiDraftLine,
  RiAddLine,
  RiSearchLine,
  RiRefreshLine,
  RiEditLine,
  RiDeleteBinLine,
  RiPrinterLine,
  RiCloseLine,
  RiDeleteBackLine,
  RiSaveLine,
  RiEyeLine,
  RiFileTextLine,
} from "react-icons/ri";

const STATUS_BADGE = { approved: "ok", reviewed: "info", revision: "warn", pending: "neutral" };

export default function LessonPlansPage() {
  const scope = useContext(StaffContext);
  const { classes, subjectsFor } = useScopedOptions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [clsFilter, setClsFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyPlan());
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState(null); // normalized plan to print

  const load = () => {
    setLoading(true);
    listPlans()
      .then((data) => {
        // My classes/subjects AND only the plans I submitted — another teacher's
        // plan for the same pair stays out of this list (and out of reach).
        const mine = (data || []).filter((r) =>
          inCurrentSession(r, scope?.session) &&
          classes.some((c) => normCls(c) === normCls(r.class)) &&
          (scope?.classTeacherClasses?.some((c) => normCls(c) === normCls(r.class)) ||
            scope?.subjectPairs?.some((p) => normCls(p.class) === normCls(r.class) && normSub(p.subject) === normSub(r.subject))) &&
          ownedByMe(scope, TABLE, r)
        );
        setRows(mine);
      })
      .catch((e) => toast.error("Could not load lesson plans: " + e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (scope) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setStep = (i, k, v) =>
    setForm((f) => {
      const steps = f.steps.map((s, idx) => (idx === i ? { ...s, [k]: v } : s));
      return { ...f, steps };
    });
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, { step: `Step / Activity ${f.steps.length}`, time: "", teacher: "", student: "" }] }));
  const removeStep = (i) => setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }));

  const openNew = () => {
    setForm({ ...emptyPlan(), class: classes[0] || "", academic_session: scope?.session || "", teacher_name: scope?.staff?.name || "" });
    setEditing(null);
    setShowForm(true);
  };
  const openEdit = (r) => {
    const own = assertOwnership(scope, TABLE, r);
    if (!own.ok) { toast.warn(own.reason); return; }
    setForm({ ...emptyPlan(), ...r }); setEditing(r); setShowForm(true);
  };

  const validate = () => {
    if (!form.class) return "Select a class.";
    if (!form.subject) return "Select a subject.";
    if (!scope?.mayTeach?.(form.class, form.subject)) return "That class/subject is outside your assignment.";
    if (!String(form.topic || form.objectives || "").trim()) return "Add at least a topic or objective.";
    return null;
  };

  const doSave = async ({ andPreview } = {}) => {
    const err = validate();
    if (err) { toast.warn(err); return; }
    setSaving(true);
    try {
      const saved = await savePlan(form, { editing, authorEmail: scope?.staff?.email });
      logAction(supabase, {
        email: scope?.staff?.email, role: "staff",
        action: editing ? "jmis_lesson_plans_update" : "jmis_lesson_plans_add",
        targetTable: "jmis_lesson_plans", recordId: saved?.id,
        details: { class: saved?.class, subject: saved?.subject, topic: saved?.topic || "" },
      });
      if (editing) setRows((rs) => rs.map((r) => (r.id === editing.id ? saved : r)));
      else setRows((rs) => [saved, ...rs]);
      toast.success("Lesson plan saved.");
      setShowForm(false);
      if (andPreview && saved) setPreview(saved);
    } catch (e) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    const own = assertOwnership(scope, TABLE, r);
    if (!own.ok) { toast.warn(own.reason); return; }
    if (!window.confirm(`Delete this lesson plan for ${r.class} · ${r.subject}?`)) return;
    try {
      await deletePlan(r.id);
      logAction(supabase, { email: scope?.staff?.email, role: "staff", action: "jmis_lesson_plans_delete", targetTable: "jmis_lesson_plans", recordId: r.id, details: { class: r.class, subject: r.subject } });
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      toast.success("Deleted.");
    } catch (e) { toast.error(e.message); }
  };

  // Save a single plan to the user's device as a Word (.docx) file that mirrors
  // the printable LessonPlanDoc layout.
  const downloadDocx = async (plan) => {
    try {
      await exportLessonPlanToDocx(plan, { name: "Bluebell International School", location: "BLUEBELL_LOCATION_PLACEHOLDER", logo: "/logo.jpg" });
      toast.success("Lesson plan saved as DOCX.");
    } catch (e) {
      toast.error("DOCX export failed: " + (e?.message || e));
    }
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

  const subjectOptions = subjectsFor(form.class);

  return (
    <div className="ap-page">
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiDraftLine /></span>Lesson Plans</h1>
          <p className="ap-sub">Prepare a full lesson plan in the school's format, preview it and print / save as PDF. Academic admin reviews each submission.</p>
        </div>
        <div className="ap-actions">
          <span className="ap-pill blue">{visible.length} plan{visible.length === 1 ? "" : "s"}</span>
          <button className="ap-btn primary" onClick={openNew}><RiAddLine /> New Lesson Plan</button>
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
        Only the lesson plans you submitted are listed here — a colleague&rsquo;s plan for the same class and subject stays in their own view.
      </p>

      <div className="ap-card">
        {loading ? (
          <div className="ap-loading"><div className="ap-spinner" /> Loading…</div>
        ) : (
          <div className="ap-tablewrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>Class</th><th>Subject</th><th>Topic</th>
                  <th>Term</th><th>Week</th><th>Review</th><th>Updated</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={8} className="ap-empty">No lesson plans yet — use “New Lesson Plan” to create one.</td></tr>
                ) : visible.map((r) => (
                  <tr key={r.id}>
                    <td>{r.class || "—"}</td>
                    <td>{r.subject || "—"}</td>
                    <td>{r.topic || r.objectives || "—"}</td>
                    <td>{[r.academic_session, r.term].filter(Boolean).join(" · ") || "—"}</td>
                    <td>{r.week != null ? `Wk ${r.week}` : "—"}</td>
                    <td><span className={"ap-badge " + (STATUS_BADGE[r.review_status] || "neutral")}>{r.review_status || "pending"}</span></td>
                    <td>{r.updated_at ? new Date(r.updated_at).toLocaleDateString() : "—"}</td>
                    <td className="text-end">
                      <button className="ap-btn sm" title="Preview / Print" onClick={() => setPreview(r)}><RiEyeLine /></button>{" "}
                      <button className="ap-btn sm" title="Download as Word (.docx)" onClick={() => downloadDocx(r)}><RiFileTextLine /></button>{" "}
                      <button className="ap-btn sm" title="Edit" onClick={() => openEdit(r)}><RiEditLine /></button>{" "}
                      <button className="ap-btn sm danger" title="Delete" onClick={() => remove(r)}><RiDeleteBinLine /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- Editor ---------------- */}
      <Modal show={showForm} onHide={() => setShowForm(false)} size="xl" centered className="lp-editor">
        <Modal.Header className="ap-modal-head" closeButton closeVariant="white">
          <Modal.Title style={{ fontSize: "1.05rem", fontWeight: 800 }}>{editing ? "Edit" : "New"} Lesson Plan</Modal.Title>
        </Modal.Header>
        <Modal.Body className="ap-modal-body">
          <div className="row g-3">
            <Field md={3} label="Class *">
              <select className="ap-input" value={form.class} onChange={(e) => { set("class", e.target.value); set("subject", ""); }}>
                <option value="">Select…</option>
                {classes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field md={3} label="Subject *">
              <select className="ap-input" value={form.subject} onChange={(e) => set("subject", e.target.value)}>
                <option value="">Select…</option>
                {subjectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field md={3} label="Academic Session"><input className="ap-input" value={form.academic_session || ""} placeholder={scope.session || ""} onChange={(e) => set("academic_session", e.target.value)} /></Field>
            <Field md={3} label="Term">
              <select className="ap-input" value={form.term || ""} onChange={(e) => set("term", e.target.value)}>
                <option value="">Select…</option>
                {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>

            <Field md={3} label="Topic"><input className="ap-input" value={form.topic || ""} onChange={(e) => set("topic", e.target.value)} /></Field>
            <Field md={3} label="Sub-topic"><input className="ap-input" value={form.sub_topic || ""} onChange={(e) => set("sub_topic", e.target.value)} /></Field>
            <Field md={2} label="Week"><input className="ap-input" type="number" value={form.week ?? ""} onChange={(e) => set("week", e.target.value)} /></Field>
            <Field md={2} label="Lesson"><input className="ap-input" value={form.lesson_no || ""} placeholder="e.g. 3" onChange={(e) => set("lesson_no", e.target.value)} /></Field>
            <Field md={2} label="Time / Duration"><input className="ap-input" value={form.duration || ""} placeholder="e.g. 35 minutes" onChange={(e) => set("duration", e.target.value)} /></Field>
            <Field md={2} label="Age"><input className="ap-input" value={form.age || ""} placeholder="e.g. 5 years" onChange={(e) => set("age", e.target.value)} /></Field>

            <Field md={12} label="Objective(s)"><textarea className="ap-input" rows={2} value={form.objectives || ""} placeholder="At the end of the lesson, the learners should be able to…" onChange={(e) => set("objectives", e.target.value)} /></Field>
            <Field md={12} label="Prior knowledge"><textarea className="ap-input" rows={2} value={form.prior_knowledge || ""} placeholder="The learners already know…" onChange={(e) => set("prior_knowledge", e.target.value)} /></Field>
            <Field md={6} label="Instructional materials / Resources"><textarea className="ap-input" rows={2} value={form.resources || ""} onChange={(e) => set("resources", e.target.value)} /></Field>
            <Field md={6} label="Possible problems & solutions"><textarea className="ap-input" rows={2} value={form.possible_problems || ""} onChange={(e) => set("possible_problems", e.target.value)} /></Field>

            {/* Lesson structure editor */}
            <div className="col-12">
              <div className="lp-steps-head">
                <label className="ap-label" style={{ margin: 0 }}>Lesson Structure</label>
                <button className="ap-btn sm" onClick={addStep}><RiAddLine /> Add step</button>
              </div>
              <div className="lp-steps-editor">
                <div className="lp-step-row lp-step-row--head">
                  <span>Step / Activity</span><span>Time</span><span>Teacher Activities</span><span>Student Activities</span><span></span>
                </div>
                {form.steps.map((st, i) => (
                  <div className="lp-step-row" key={i}>
                    <input className="ap-input" value={st.step} placeholder="Lead in / Motivation" onChange={(e) => setStep(i, "step", e.target.value)} />
                    <input className="ap-input" value={st.time} placeholder="5 mins" onChange={(e) => setStep(i, "time", e.target.value)} />
                    <textarea className="ap-input" rows={2} value={st.teacher} placeholder="The teacher…" onChange={(e) => setStep(i, "teacher", e.target.value)} />
                    <textarea className="ap-input" rows={2} value={st.student} placeholder="The learners…" onChange={(e) => setStep(i, "student", e.target.value)} />
                    <button className="ap-btn sm danger" title="Remove step" onClick={() => removeStep(i)}><RiDeleteBackLine /></button>
                  </div>
                ))}
              </div>
            </div>

            <Field md={6} label="Evaluation (Teacher)"><textarea className="ap-input" rows={2} value={form.evaluation || ""} onChange={(e) => set("evaluation", e.target.value)} /></Field>
            <Field md={6} label="Homework"><textarea className="ap-input" rows={2} value={form.homework || ""} onChange={(e) => set("homework", e.target.value)} /></Field>

            <Field md={4} label="Teacher"><input className="ap-input" value={form.teacher_name || ""} onChange={(e) => set("teacher_name", e.target.value)} /></Field>
            <Field md={4} label="The Head / Teacher Section"><input className="ap-input" value={form.head_teacher || ""} onChange={(e) => set("head_teacher", e.target.value)} /></Field>
            <Field md={4} label="Sign / Date"><input className="ap-input" value={form.lesson_date || ""} placeholder="Date" onChange={(e) => set("lesson_date", e.target.value)} /></Field>
          </div>
        </Modal.Body>
        <Modal.Footer className="ap-modal-foot">
          <Button variant="light" onClick={() => setShowForm(false)}>Cancel</Button>
          <Button variant="outline-success" disabled={saving} onClick={() => doSave({ andPreview: true })}><RiEyeLine /> Save &amp; Preview</Button>
          <Button variant="success" disabled={saving} onClick={() => doSave()}>{saving ? "Saving…" : <><RiSaveLine /> Save</>}</Button>
        </Modal.Footer>
      </Modal>

      {/* ---------------- Preview / Print ---------------- */}
      {preview && (
        <div className="lp-overlay">
          <div className="lp-overlay-bar no-print">
            <b>Lesson Plan Preview</b>
            <div>
              <button className="ap-btn primary" onClick={() => window.print()}><RiPrinterLine /> Print / Save as PDF</button>
              <button className="ap-btn" onClick={() => downloadDocx(preview)}><RiFileTextLine /> Save as DOCX</button>
              <button className="ap-btn" onClick={() => setPreview(null)}><RiCloseLine /> Close</button>
            </div>
          </div>
          <div className="lp-overlay-scroll">
            <LessonPlanDoc plan={preview} school={{ name: "Bluebell International School", logo: "/logo.jpg" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ md, label, children }) {
  return (
    <div className={`col-md-${md} col-12`}>
      <label className="ap-label">{label}</label>
      {children}
    </div>
  );
}

"use client";

import React, { useContext, useEffect, useState } from "react";
import { Modal, Button } from "react-bootstrap";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { logAction } from "../api/auditLog.js";
import { toast } from "react-toastify";
import { RiMegaphoneLine, RiAddLine, RiDeleteBinLine, RiRefreshLine, RiPushpinLine } from "react-icons/ri";
import "../styles/AdminPages.css";

// Announcements: staff see posts for all-staff, all-students and for their own
// classes. Any staff may post to all_staff or all_students; class/subject
// teachers may also post to a class in their assignment.
export default function AnnouncementsPage() {
  const scope = useContext(StaffContext);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", audience: "all_staff", pinned: false });

  const myClasses = scope?.allClasses || [];
  const isClassTeacher = (scope?.classTeacherClasses || []).length > 0;

  const load = () => {
    if (!scope) return;
    setLoading(true);
    const auds = ["all_staff", "all_students", ...myClasses.map((c) => `class:${c}`)];
    supabase
      .from("jmis_announcements")
      .select("id, title, body, audience, pinned, created_by, created_at")
      .in("audience", auds)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) toast.error("Could not load announcements: " + error.message);
        setRows(data || []);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);

  const openNew = () => {
    setForm({ title: "", body: "", audience: isClassTeacher ? `class:${myClasses[0] || ""}` : "all_students", pinned: false });
    setShow(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) { toast.warn("Title and message are required."); return; }
    setSaving(true);
    const { data, error } = await supabase
      .from("jmis_announcements")
      .insert([{ ...form, created_by: scope?.staff?.email }])
      .select();
    setSaving(false);
    if (error) { toast.error(error.message); return; } // writeGuard may have blocked it
    logAction(supabase, { email: scope?.staff?.email, role: "staff", action: "announcement_add", targetTable: "jmis_announcements", recordId: data?.[0]?.id, details: { audience: form.audience, title: form.title } });
    setShow(false);
    setRows((rs) => [data[0], ...rs]);
    toast.success("Announcement posted.");
  };

  const remove = async (r) => {
    if (r.created_by !== scope?.staff?.email) { toast.warn("You can only delete your own announcements."); return; }
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    const { error } = await supabase.from("jmis_announcements").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    logAction(supabase, { email: scope?.staff?.email, role: "staff", action: "announcement_delete", targetTable: "jmis_announcements", recordId: r.id, details: { title: r.title } });
    setRows((rs) => rs.filter((x) => x.id !== r.id));
  };

  if (!scope) return null;

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiMegaphoneLine /></span>Announcements</h1>
          <p className="ap-sub">Notices for all students, all staff, and for your classes{isClassTeacher ? " — as a class teacher you can post to your own class" : ""}.</p>
        </div>
        <div className="ap-actions">
          <button className="ap-btn primary" onClick={openNew}><RiAddLine /> New announcement</button>
        </div>
      </div>

      <div className="ap-toolbar">
        <button className="ap-btn" onClick={load}><RiRefreshLine /> Refresh</button>
      </div>

      <div className="ap-card">
        {loading ? (
          <div className="ap-loading"><div className="ap-spinner" /> Loading…</div>
        ) : rows.length === 0 ? (
          <div className="ap-empty">No announcements yet.</div>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="ann-row">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                {a.pinned && <span className="ap-badge warn"><RiPushpinLine /> Pinned</span>}
                <b>{a.title}</b>
                <span className="ap-badge neutral">{a.audience === "all_staff" ? "All staff" : a.audience === "all_students" ? "All students" : String(a.audience || "").replace("class:", "")}</span>
                <span className="ap-muted ms-auto" style={{ fontSize: "0.75rem" }}>
                  {a.created_at ? new Date(a.created_at).toLocaleString() : ""}
                  {a.created_by ? ` · ${a.created_by}` : ""}
                </span>
                {a.created_by === scope.staff?.email && (
                  <button className="ap-btn sm danger" onClick={() => remove(a)} title="Delete"><RiDeleteBinLine /></button>
                )}
              </div>
              <p className="ap-muted mb-0" style={{ whiteSpace: "pre-wrap" }}>{a.body}</p>
            </div>
          ))
        )}
      </div>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Modal.Header className="ap-modal-head" closeButton closeVariant="white">
          <Modal.Title style={{ fontSize: "1.05rem", fontWeight: 800 }}>New announcement</Modal.Title>
        </Modal.Header>
        <Modal.Body className="ap-modal-body">
          <div className="mb-3">
            <label className="ap-label">Title *</label>
            <input className="ap-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="mb-3">
            <label className="ap-label">Message *</label>
            <textarea className="ap-input" rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </div>
          <div className="row g-3">
            <div className="col-md-8">
              <label className="ap-label">Audience</label>
              <select className="ap-input" value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
                <option value="all_students">All students</option>
                <option value="all_staff">All staff</option>
                {myClasses.map((c) => (
                  <option key={c} value={`class:${c}`}>{c} (my class)</option>
                ))}
              </select>
            </div>
            <div className="col-md-4 d-flex align-items-end">
              <label className="ap-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} /> Pin
              </label>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer className="ap-modal-foot">
          <Button variant="light" onClick={() => setShow(false)}>Cancel</Button>
          <Button variant="success" disabled={saving} onClick={save}>{saving ? "Posting…" : "Post"}</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

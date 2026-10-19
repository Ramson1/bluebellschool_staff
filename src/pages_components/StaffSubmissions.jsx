"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { useScopedOptions } from "./AcademicsKit.jsx";
import { normCls, normSub, inCurrentSession } from "../utils/scope.js";
import { ownedByMe } from "../utils/ownership.js";
import { logAction } from "../api/auditLog.js";
import { toast } from "react-toastify";
import {
  RiInboxLine,
  RiSearchLine,
  RiRefreshLine,
  RiCheckLine,
  RiDownloadLine,
} from "react-icons/ri";
import "../styles/AdminPages.css";

// Req 10 (staff side): review the work students have submitted against the
// assignments/assessments/projects this teacher published to their classes.
// Loads only this teacher's scoped assignments, then the submissions whose
// assignment_id belongs to that set, grouped per assignment. bluebell_assignment_
// submissions is intentionally NOT in guardWrite's ACADEMIC_TABLES, so the
// status update flows through the write guard unblocked.
export default function StaffSubmissions() {
  const scope = useContext(StaffContext);
  const { classes } = useScopedOptions();
  const [assignments, setAssignments] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = () => {
    if (!scope) return;
    setLoading(true);
    (async () => {
      try {
        const { data: asg, error: e1 } = await supabase
          .from("bluebell_assignments")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500);
        if (e1) throw e1;
        // Defensive scope filter — my classes/subjects AND only the assignments
        // I posted, so submissions to a colleague's (or the admin's) assignment
        // do not land in my inbox.
        const mine = (asg || []).filter((r) =>
          inCurrentSession(r, scope?.session) &&
          classes.some((c) => normCls(c) === normCls(r.class)) &&
          (scope?.classTeacherClasses.some((c) => normCls(c) === normCls(r.class)) ||
            scope?.subjectPairs.some((p) => normCls(p.class) === normCls(r.class) && normSub(p.subject) === normSub(r.subject))) &&
          ownedByMe(scope, "bluebell_assignments", r)
        );
        setAssignments(mine);
        if (!mine.length) { setSubs([]); return; }
        const ids = mine.map((a) => a.id);
        const { data: sub, error: e2 } = await supabase
          .from("bluebell_assignment_submissions")
          .select("*")
          .in("assignment_id", ids)
          .order("submitted_at", { ascending: false });
        if (e2) throw e2;
        setSubs(sub || []);
      } catch (e) {
        toast.error("Could not load submissions: " + e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  useEffect(() => { if (scope) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);

  const grouped = useMemo(() => {
    const byAsg = {};
    for (const s of subs) (byAsg[s.assignment_id] ||= []).push(s);
    const q = search.trim().toLowerCase();
    return assignments
      .map((a) => ({ a, rows: (byAsg[a.id] || []).filter((s) => !q || JSON.stringify(s).toLowerCase().includes(q)) }))
      .filter((g) => g.rows.length);
  }, [assignments, subs, search]);

  const totalPending = useMemo(() => subs.filter((s) => s.status !== "reviewed").length, [subs]);

  const markReviewed = async (s) => {
    const { error } = await supabase
      .from("bluebell_assignment_submissions")
      .update({ status: "reviewed", updated_at: new Date().toISOString() })
      .eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    logAction(supabase, {
      email: scope?.staff?.email, role: "staff",
      action: "bluebell_assignment_submissions_review", targetTable: "bluebell_assignment_submissions",
      recordId: s.id, details: { student: s.student_name, assignment_id: s.assignment_id },
    });
    setSubs((list) => list.map((x) => (x.id === s.id ? { ...x, status: "reviewed" } : x)));
    toast.success(`Marked ${s.student_name}'s work reviewed.`);
  };

  if (!scope) return null;

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiInboxLine /></span>Submissions</h1>
          <p className="ap-sub">Student work submitted against your assignments, assessments and projects.</p>
        </div>
        <div className="ap-actions">
          <span className="ap-pill amber">{totalPending} to review</span>
          <span className="ap-pill blue">{subs.length} total</span>
        </div>
      </div>

      <div className="ap-toolbar">
        <div className="ap-search">
          <RiSearchLine />
          <input className="ap-input" placeholder="Search by student…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="ap-btn" onClick={load}><RiRefreshLine /> Refresh</button>
      </div>

      {loading ? (
        <div className="ap-card"><div className="ap-loading"><div className="ap-spinner" /> Loading…</div></div>
      ) : grouped.length === 0 ? (
        <div className="ap-card"><div className="ap-empty">No submissions yet for your assignments.</div></div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {grouped.map(({ a, rows }) => (
            <div className="ap-card" key={a.id}>
              <div className="ap-card-head">
                <span>{a.title || "Untitled"}</span>
                <span className="ap-muted ms-auto" style={{ fontSize: "0.78rem" }}>
                  {[a.class, a.subject, a.assignment_type && a.assignment_type !== "assignment" ? a.assignment_type : null]
                    .filter(Boolean).join(" · ")} · {rows.length} submission{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="ap-tablewrap">
                <table className="ap-table">
                  <thead>
                    <tr><th>Student</th><th>Answer</th><th>File</th><th>Submitted</th><th>Status</th><th className="text-end">Action</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td><b>{s.student_name}</b></td>
                        <td style={{ maxWidth: 360 }}>
                          <span style={{ whiteSpace: "pre-wrap", display: "-webkit-box", overflow: "hidden", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                            {s.submission_text || <span className="ap-muted">—</span>}
                          </span>
                        </td>
                        <td>
                          {(() => {
                            const list = Array.isArray(s.attachments) && s.attachments.length
                              ? s.attachments
                              : s.file_url
                                ? [{ url: s.file_url, name: "attached file", type: "file" }]
                                : [];
                            if (!list.length) return <span className="ap-muted">—</span>;
                            return (
                              <div className="d-flex flex-wrap gap-1" style={{ maxWidth: 260 }}>
                                {list.map((att, i) =>
                                  att.type === "image" ? (
                                    <a key={att.url + i} href={att.url} target="_blank" rel="noopener noreferrer" title={att.name || "image"}>
                                      <img src={att.url} alt={att.name || "image"} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #e5e7eb", display: "block" }} />
                                    </a>
                                  ) : (
                                    <a key={att.url + i} className="ap-btn sm ghost" href={att.url} target="_blank" rel="noopener noreferrer" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      <RiDownloadLine /> {att.name || "Open"}
                                    </a>
                                  )
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td>{s.submitted_at ? new Date(s.submitted_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                        <td><span className={"ap-badge " + (s.status === "reviewed" ? "info" : "neutral")}>{s.status || "submitted"}</span></td>
                        <td className="text-end">
                          {s.status !== "reviewed" && (
                            <button className="ap-btn sm primary" onClick={() => markReviewed(s)}><RiCheckLine /> Reviewed</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { normCls, whereClassIn } from "../utils/scope.js";
import { toast } from "react-toastify";
import { RiTimeLine, RiSearchLine, RiRefreshLine } from "react-icons/ri";
import "../styles/AdminPages.css";

// Read-only class attendance viewer.
//
// Attendance is captured school-wide by the admin portal / the mobile
// attendance app (QR or manual sign-in). Every check-in writes ONE row to
// jmis_attendance per pupil per day (with check_in_time / check_out_time and
// the current session + term). Teachers here no longer TAKE attendance — they
// simply VIEW those records for the classes they are FORM teacher of and see
// each pupil's attendance COUNT for the selected term, plus the daily log.
// (Attendance writes were already class-teacher-only via guardWrite; the read
// side follows the same policy — subject teachers get no attendance view.)
//
// A pupil's "days present" for a term = the number of jmis_attendance rows for
// them in that term (matching how Result.jsx derives attendance). Days absent
// are estimated from jmis_settings.schoolOpened when that figure is available.

const TERMS = ["1st Term", "2nd Term", "3rd Term"];

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtDay = (d) => {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

export default function StaffAttendancePage() {
  const scope = useContext(StaffContext);
  const myClasses = scope?.rosterClasses || []; // form-teacher classes only

  const [cls, setCls] = useState("");
  const [term, setTerm] = useState(scope?.term || "");
  const [roster, setRoster] = useState([]);   // students enrolled in the class
  const [records, setRecords] = useState([]); // jmis_attendance rows (class + term)
  const [schoolDays, setSchoolDays] = useState(null); // schoolOpened days this term
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(""); // student_name whose daily log is open

  // Default to the first form-teacher class and the current term once scope resolves.
  useEffect(() => {
    if (!scope) return;
    if (!cls && myClasses.length) setCls(myClasses[0]);
    // prune a stale selection if the teacher's assignment changed mid-session
    if (cls && !myClasses.some((c) => normCls(c) === normCls(cls))) {
      setCls(myClasses.length ? myClasses[0] : "");
    }
    if (!term && scope.term) setTerm(scope.term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const load = () => {
    // Form-teacher allow-list re-check (attendance writes are class-teacher
    // only in guardWrite; the read side matches).
    if (!cls || !scope?.mayViewRoster?.(cls)) { setRoster([]); setRecords([]); return; }
    setLoading(true);
    Promise.all([
      whereClassIn(supabase.from("jmis_student").select("id, name, class"), "class", [cls]),
      whereClassIn(supabase.from("jmis_attendance").select("*"), "class", [cls]).order("date", { ascending: false }),
      supabase.from("jmis_settings").select("schoolOpened, term, session").limit(1),
    ])
      .then(([stu, att, set]) => {
        if (stu.error) throw stu.error;
        const s = (set.data && set.data[0]) || {};
        setSchoolDays(Number.isFinite(parseInt(s.schoolOpened, 10)) ? parseInt(s.schoolOpened, 10) : null);
        // defensive: roster only ever holds the selected class
        setRoster((stu.data || []).filter((x) => normCls(x.class) === normCls(cls)));
        // Keep the selected term's rows. When a term is chosen, only rows tagged
        // with that term (case/space-insensitive) count; "All terms" keeps every
        // record so a teacher can still review history across the session.
        const wanted = normCls(term);
        const rows = (att.data || []).filter((r) => !wanted || normCls(r.term || "") === wanted);
        setRecords(rows);
      })
      .catch((e) => toast.error("Load failed: " + e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cls, term]);

  // Group the day-records under each pupil name.
  const byStudent = useMemo(() => {
    const map = {};
    for (const r of records) {
      const key = r.student_name || "(unknown)";
      (map[key] ||= []).push(r);
    }
    return map;
  }, [records]);

  // The list to display: the enrolled roster, plus any name that has records
  // but is missing from the roster (e.g. a pupil who moved class) so their
  // attendance is never silently hidden.
  const students = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const s of roster) {
      if (s.name && !seen.has(s.name)) { seen.add(s.name); list.push({ name: s.name, id: s.id }); }
    }
    for (const name of Object.keys(byStudent)) {
      if (!seen.has(name)) { seen.add(name); list.push({ name, id: null }); }
    }
    const q = search.trim().toLowerCase();
    return q ? list.filter((x) => x.name.toLowerCase().includes(q)) : list;
  }, [roster, byStudent, search]);

  const totals = useMemo(() => {
    let present = 0;
    for (const r of records) if (r.status !== "absent") present += 1;
    return { present };
  }, [records]);

  if (!scope) return null;

  if (myClasses.length === 0) {
    return (
      <div className="ap-card">
        <div className="ap-card-head"><RiTimeLine /> Attendance</div>
        <div className="ap-empty pad">
          {(scope.subjectPairs || []).length > 0
            ? "Attendance is managed by each class's form teacher. As a subject teacher you have no class register to view here."
            : "No classes are assigned to you yet, so there is no attendance to display. Once the administrator assigns you as a form teacher, your pupils' attendance records will appear here."}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiTimeLine /></span>Class Attendance</h1>
          <p className="ap-sub">
            Attendance recorded school-wide via the attendance app / admin sign-in. View each
            pupil&apos;s attendance for the selected term — this page does not take attendance.
          </p>
        </div>
        <div className="ap-actions">
          <span className="ap-pill blue">{students.length} pupils · {totals.present} check-in{totals.present === 1 ? "" : "s"}{term ? ` (${term})` : ""}</span>
        </div>
      </div>

      <div className="ap-toolbar">
        <select className="ap-input" value={cls} onChange={(e) => { setCls(e.target.value); setExpanded(""); }}>
          {myClasses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="ap-input" value={term} onChange={(e) => { setTerm(e.target.value); setExpanded(""); }} style={{ maxWidth: 180 }}>
          <option value="">All terms</option>
          {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="ap-search">
          <RiSearchLine />
          <input className="ap-input" placeholder="Search student…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="ap-btn" onClick={load}><RiRefreshLine /> Refresh</button>
      </div>

      <div className="ap-card">
        <div className="ap-card-head">
          <span className="ic"><RiTimeLine /></span> {cls} — {term || "All terms"}
          {schoolDays ? ` · ${schoolDays} school days this term` : ""}
        </div>
        {loading ? (
          <div className="ap-loading"><div className="ap-spinner" /> Loading attendance records…</div>
        ) : (
          <div className="ap-tablewrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student</th>
                  <th style={{ width: 130 }}>Present</th>
                  <th style={{ width: 130 }}>Absent</th>
                  <th style={{ width: 130 }}>Attendance</th>
                  <th>Last check-in</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr><td colSpan={7} className="ap-empty">No attendance records for {cls}{term ? ` (${term})` : ""} yet.</td></tr>
                ) : students.map((s, i) => {
                  const recs = byStudent[s.name] || [];
                  const present = recs.length;
                  const absent = schoolDays != null ? Math.max(schoolDays - present, 0) : null;
                  const pct = schoolDays ? Math.round((present / schoolDays) * 100) : null;
                  const last = recs[0]; // records ordered date desc
                  const isOpen = expanded === s.name;
                  return (
                    <React.Fragment key={s.id ?? s.name}>
                      <tr>
                        <td>{i + 1}</td>
                        <td><b>{s.name}</b></td>
                        <td><span className="ap-badge ok">{present} day{present === 1 ? "" : "s"}</span></td>
                        <td>{absent == null ? <span className="ap-muted">—</span> : <span className="ap-badge red">{absent}</span>}</td>
                        <td>{pct == null ? <span className="ap-muted">—</span> : `${pct}%`}</td>
                        <td>{last ? <span>{fmtDay(last.date)} · {fmtTime(last.check_in_time)}</span> : <span className="ap-muted">Never</span>}</td>
                        <td>
                          {recs.length > 0 && (
                            <button
                              type="button"
                              className="ap-btn sm"
                              onClick={() => setExpanded(isOpen ? "" : s.name)}
                            >
                              {isOpen ? "Hide" : "History"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: "rgba(0,0,0,0.02)", padding: 0 }}>
                            <div style={{ padding: "8px 14px 12px" }}>
                              <div className="ap-muted" style={{ marginBottom: 6 }}>
                                Daily attendance log — {s.name} ({recs.length} day{recs.length === 1 ? "" : "s"})
                              </div>
                              <table className="ap-table">
                                <thead>
                                  <tr>
                                    <th style={{ width: 160 }}>Date</th>
                                    <th>Check-in</th>
                                    <th>Check-out</th>
                                    <th>Method</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recs.map((r, j) => (
                                    <tr key={`${r.id ?? j}`}>
                                      <td>{fmtDay(r.date)}</td>
                                      <td>{fmtTime(r.check_in_time)}</td>
                                      <td>{fmtTime(r.check_out_time)}</td>
                                      <td><span style={{ textTransform: "capitalize" }}>{r.method || "—"}</span></td>
                                      <td>
                                        {r.status
                                          ? <span className={`ap-badge ${r.status === "absent" ? "red" : r.status === "late" ? "warn" : "ok"}`} style={{ textTransform: "capitalize" }}>{r.status}</span>
                                          : <span className="ap-badge ok">present</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

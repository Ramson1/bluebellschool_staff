"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { normCls, whereClassIn } from "../utils/scope.js";
import { RiGroupLine, RiSearchLine, RiRefreshLine } from "react-icons/ri";
import { toast } from "react-toastify";
import "../styles/AdminPages.css";

// Student passport images are stored in bluebell_student.passport as a BARE
// FILENAME inside the public 'passport' storage bucket (same contract the
// admin FullStudent page uses), so render them via the bucket's public URL.
// Legacy rows that already hold a full URL are used as-is; empty falls back
// to the shared placeholder so an avatar is always shown.
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

// Read-only student roster. Student records are form-teacher only: a staff
// member sees the roster of the classes where they are the class teacher
// (scope.rosterClasses). Subject teachers only ever see student names inside
// their own Results/CBT classes — the same policy guardWrite enforces on
// attendance writes.
export default function StaffStudents() {
  const scope = useContext(StaffContext);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState("");

  const myClasses = scope?.rosterClasses || [];

  useEffect(() => {
    if (!scope) return;
    if (!cls && myClasses.length) setCls(myClasses[0]);
    // prune a stale selection if the teacher's assignment changed mid-session
    if (cls && !myClasses.some((c) => normCls(c) === normCls(cls))) {
      setCls(myClasses.length ? myClasses[0] : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const load = () => {
    // rosterClasses is the allow-list; mayViewRoster re-checks the selected
    // label against it so a stale/direct-URL class can never load a roster
    // this teacher does not own.
    if (!cls || !scope?.mayViewRoster?.(cls)) { setRows([]); return; }
    setLoading(true);
    // Narrowed server-side across the known class-label spellings; the
    // client-side normCls filter below stays the authoritative gate.
    whereClassIn(
      supabase
        .from("bluebell_student")
        .select("id, name, class, sex, parentcontact, passport, token"),
      "class",
      [cls]
    )
      .then(({ data, error }) => {
        if (error) { toast.error("Could not load students: " + error.message); setRows([]); }
        // defensive: keep only the selected class even if the query changes
        setRows((data || []).filter((s) => normCls(s.class) === normCls(cls)));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  useEffect(() => { load(); }, [cls]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((s) => s.name?.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  if (!scope) return null;

  if (myClasses.length === 0) {
    return (
      <div className="ap-card">
        <div className="ap-card-head"><RiGroupLine /> Students</div>
        <div className="ap-empty pad">
          {(scope.subjectPairs || []).length > 0
            ? "Rosters are managed by each class's form teacher. You can enter scores for your subjects under Results."
            : "No classes are assigned to you yet. Once the administrator assigns you as a form teacher, your student roster will appear here."}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiGroupLine /></span>Students</h1>
          <p className="ap-sub">Roster for the class(es) you are form teacher of.</p>
        </div>
        <div className="ap-actions">
          <span className="ap-pill blue">{visible.length} student{visible.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="ap-toolbar">
        <div className="ap-search">
          <RiSearchLine />
          <input className="ap-input" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="ap-input" value={cls} onChange={(e) => setCls(e.target.value)}>
          {myClasses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="ap-btn" onClick={load}><RiRefreshLine /> Refresh</button>
      </div>

      <div className="ap-card">
        <div className="ap-card-head"><span className="ic"><RiGroupLine /></span> {cls || "—"} roster</div>
        {loading ? (
          <div className="ap-loading"><div className="ap-spinner" /> Loading students…</div>
        ) : (
          <div className="ap-tablewrap">
            <table className="ap-table">
              <thead>
                <tr><th>#</th><th>Student</th><th>Class</th><th>Sex</th><th>Parent contact</th><th>Result token</th></tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={6} className="ap-empty">No students match in {cls || "this class"}.</td></tr>
                ) : (
                  visible.map((s, i) => (
                    <tr key={s.id ?? `${s.name}-${i}`}>
                      <td>{i + 1}</td>
                      <td>
                        <div className="enq-row-name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <img
                            src={passportSrc(s.passport)}
                            alt={`${s.name}'s passport`}
                            style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", background: "#e9edf2" }}
                          />
                          <b>{s.name}</b>
                        </div>
                      </td>
                      <td>{s.class}</td>
                      <td>{s.sex || "—"}</td>
                      <td>{s.parentcontact || "—"}</td>
                      <td><span className="ap-badge neutral">{s.token ? "Issued" : "None"}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

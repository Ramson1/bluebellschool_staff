"use client";

import React, { useContext } from "react";
import Link from "next/link";
import { StaffContext } from "../components/StaffShell.jsx";
import { RiSchoolLine, RiGroupLine, RiTimeLine, RiBarChartBoxLine } from "react-icons/ri";
import "../styles/AdminPages.css";

// Cards for every assignment: one per class (class teacher) or per
// (class, subject) pair (subject teacher).
export default function MyClasses() {
  const scope = useContext(StaffContext);
  if (!scope) return null;

  const { classTeacherClasses, subjectPairs, isGeneral, session } = scope;

  if (isGeneral) {
    return (
      <div className="ap-card">
        <div className="ap-card-head"><RiSchoolLine /> My Classes</div>
        <div className="ap-empty pad">
          No class or subject has been assigned to you yet. Once the school admin assigns you a class,
          it will appear here with students, attendance, results and CBT tools.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiSchoolLine /></span>My Classes</h1>
          <p className="ap-sub">Classes you own{session ? ` — ${session}` : ""}.</p>
        </div>
      </div>

      <div className="row g-3">
        {classTeacherClasses.map((cls) => (
          <div className="col-md-6 col-xl-4" key={`ct-${cls}`}>
            <div className="class-card">
              <h5>{cls}</h5>
              <span className="ap-badge ok">Class teacher</span>
              <p className="ap-muted scope-note mt-2 mb-2">
                Full access: students, attendance, all subjects, results and CBT for this class.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Link className="ap-btn sm" href={`/students?class=${encodeURIComponent(cls)}`}><RiGroupLine /> Students</Link>
                <Link className="ap-btn sm" href={`/attendance?class=${encodeURIComponent(cls)}`}><RiTimeLine /> Attendance</Link>
                <Link className="ap-btn sm" href={`/results?class=${encodeURIComponent(cls)}`}><RiBarChartBoxLine /> Results</Link>
              </div>
            </div>
          </div>
        ))}
        {subjectPairs.map((p, i) => (
          <div className="col-md-6 col-xl-4" key={`st-${p.class}-${p.subject}-${i}`}>
            <div className="class-card">
              <h5>{p.class} · {p.subject}</h5>
              <span className="ap-badge info">Subject teacher</span>
              <p className="ap-muted scope-note mt-2 mb-2">
                Access limited to {p.subject} in {p.class}: results, CBT questions, notes
                and assignments for this subject only.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Link className="ap-btn sm" href={`/results?class=${encodeURIComponent(p.class)}&subject=${encodeURIComponent(p.subject)}`}><RiBarChartBoxLine /> Results</Link>
                <Link className="ap-btn sm" href={`/notes?class=${encodeURIComponent(p.class)}&subject=${encodeURIComponent(p.subject)}`}>Notes</Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

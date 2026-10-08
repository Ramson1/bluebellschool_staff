"use client";

import React from "react";
import "../styles/LessonPlanDoc.css";

// Professional, print-ready rendering of a lesson plan that mirrors the
// school's paper LESSON PLAN form. Purely presentational — pass a normalized
// plan row (see lessonPlanApi.normalize) + optional school branding.
//
// To print: render this inside an element with id="lp-print" and call
// window.print(); the @media rules in LessonPlanDoc.css hide everything else.

const DEFAULT_SCHOOL = {
  name: "Bluebell International School",
  location: "BLUEBELL_LOCATION_PLACEHOLDER",
  logo: "/logo.jpg",
};

function val(v) {
  return v == null || String(v).trim() === "" ? "" : String(v);
}

export default function LessonPlanDoc({ plan = {}, school }) {
  const s = { ...DEFAULT_SCHOOL, ...(school || {}) };
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const P = (k) => val(plan[k]);

  return (
    <div className="lp-doc" id="lp-print">
      {/* ---------- Header ---------- */}
      <div className="lp-head">
        {s.logo ? <img className="lp-logo" src={s.logo} alt="logo" crossOrigin="anonymous" /> : null}
        <div className="lp-head-text">
          <div className="lp-school">{s.name}</div>
          {s.location ? <div className="lp-location">{s.location}</div> : null}
        </div>
        {s.logo ? <img className="lp-logo lp-logo-right" src={s.logo} alt="" crossOrigin="anonymous" /> : null}
      </div>
      <div className="lp-title">LESSON PLAN</div>

      {/* ---------- Info grid ---------- */}
      <table className="lp-grid">
        <tbody>
          <tr>
            <td className="lp-k">Subject</td><td className="lp-v">{P("subject")}</td>
            <td className="lp-k">Class</td><td className="lp-v">{P("class")}</td>
          </tr>
          <tr>
            <td className="lp-k">Topic</td><td className="lp-v" colSpan={3}>{P("topic")}</td>
          </tr>
          <tr>
            <td className="lp-k">Sub-topic</td><td className="lp-v" colSpan={3}>{P("sub_topic")}</td>
          </tr>
          <tr>
            <td className="lp-k">Term</td><td className="lp-v">{P("term")}</td>
            <td className="lp-k">Week</td><td className="lp-v">{P("week")}</td>
          </tr>
          <tr>
            <td className="lp-k">Lesson</td><td className="lp-v">{P("lesson_no")}</td>
            <td className="lp-k">Time</td><td className="lp-v">{P("duration")}</td>
          </tr>
          <tr>
            <td className="lp-k">Age</td><td className="lp-v">{P("age")}</td>
            <td className="lp-k">Session</td><td className="lp-v">{P("academic_session")}</td>
          </tr>
          <tr>
            <td className="lp-k">Objective(s)</td>
            <td className="lp-v" colSpan={3}>{P("objectives")}</td>
          </tr>
          <tr>
            <td className="lp-k">Prior knowledge</td>
            <td className="lp-v" colSpan={3}>{P("prior_knowledge")}</td>
          </tr>
          <tr>
            <td className="lp-k">Instructional materials / Resources</td>
            <td className="lp-v" colSpan={3}>{P("resources")}</td>
          </tr>
          <tr>
            <td className="lp-k">Possible problems &amp; solutions</td>
            <td className="lp-v" colSpan={3}>{P("possible_problems")}</td>
          </tr>
        </tbody>
      </table>

      {/* ---------- Lesson structure ---------- */}
      <div className="lp-section-title">Lesson Structure</div>
      <table className="lp-steps">
        <thead>
          <tr>
            <th style={{ width: "20%" }}>Step / Activity</th>
            <th style={{ width: "10%" }}>Time</th>
            <th style={{ width: "35%" }}>Teacher Activities</th>
            <th style={{ width: "35%" }}>Student Activities</th>
          </tr>
        </thead>
        <tbody>
          {steps.length === 0 ? (
            <tr><td className="lp-empty" colSpan={4}>—</td></tr>
          ) : (
            steps.map((st, i) => (
              <tr key={i}>
                <td className="lp-step-name">{val(st.step)}</td>
                <td className="lp-step-time">{val(st.time)}</td>
                <td>{val(st.teacher)}</td>
                <td>{val(st.student)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ---------- Evaluation / Homework ---------- */}
      <table className="lp-grid lp-grid-bottom">
        <tbody>
          <tr>
            <td className="lp-k">Evaluation (Teacher)</td>
            <td className="lp-v">{P("evaluation")}</td>
          </tr>
          <tr>
            <td className="lp-k">Homework</td>
            <td className="lp-v">{P("homework")}</td>
          </tr>
        </tbody>
      </table>

      {/* ---------- Sign-off ---------- */}
      <table className="lp-sign">
        <tbody>
          <tr>
            <td>
              <div className="lp-sign-label">Teacher</div>
              <div className="lp-sign-line">{P("teacher_name")}</div>
            </td>
            <td>
              <div className="lp-sign-label">The Head / Teacher Section</div>
              <div className="lp-sign-line">{P("head_teacher")}</div>
            </td>
            <td>
              <div className="lp-sign-label">Sign / Date</div>
              <div className="lp-sign-line">{P("lesson_date")}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

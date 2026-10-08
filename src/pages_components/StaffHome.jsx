"use client";

import React, { useContext, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { normCls, normSub, inCurrentSession, whereClassIn } from "../utils/scope.js";
import { ownedByMe } from "../utils/ownership.js";
import { listConversations } from "../utils/chatApi.js";
import {
  RiSchoolLine,
  RiMegaphoneLine,
  RiTimeLine,
  RiArrowRightLine,
  RiGroupLine,
  RiBarChartBoxLine,
  RiQuestionAnswerLine,
  RiInboxLine,
  RiFileTextLine,
  RiBookOpenLine,
  RiDraftLine,
  RiChatNewLine,
} from "react-icons/ri";
import "../styles/AdminPages.css";

// Staff dashboard: scope summary, today's gate status, announcements for the
// staff member's classes (or all staff) and a scope-filtered "activity
// overview" of the teacher's own students, attendance, assignments, E-notes,
// lesson plans, CBT questions, results and the latest messages.
export default function StaffHome() {
  const scope = useContext(StaffContext);
  const [today, setToday] = useState(null); // own staff attendance row
  const [announcements, setAnnouncements] = useState([]);
  const [activity, setActivity] = useState({
    students: 0,
    attendance: { present: 0, absent: 0, late: 0 },
    assignments: [],
    notes: [],
    lessonPlans: [],
    cbt: [],
    results: [],
    messages: [],
  });

  const {
    staff,
    classTeacherClasses = [],
    subjectPairs = [],
    allClasses = [],
    isGeneral,
    session,
  } = scope || {};

  useEffect(() => {
    if (!staff) return;
    const d = new Date().toISOString().slice(0, 10);

    // Can this staff member see a class/subject row? Class teachers see all
    // subjects in their classes; subject teachers only their assigned pairs.
    const canSee = (cls, sub) => {
      const c = normCls(cls);
      if (classTeacherClasses.some((x) => normCls(x) === c)) return true;
      if (!sub) return allClasses.some((x) => normCls(x) === c);
      return subjectPairs.some((p) => normCls(p.class) === c && normSub(p.subject) === normSub(sub));
    };

    // Each scoped recent-activity loader pulls a bounded page then filters to
    // the teacher's own classes/subjects client-side (handles class-name drift
    // between assignment spelling and stored data) AND to the records they
    // authored, matching the CRUD pages: a colleague's note is not my activity.
    const recent = (table, filterCls = "class", filterSub = "subject") =>
      supabase
        .from(table)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(150)
        .then(({ data }) =>
          (data || [])
            .filter((r) =>
              inCurrentSession(r, session) &&
              canSee(r[filterCls], filterSub ? r[filterSub] : "") &&
              ownedByMe(scope, table, r)
            )
            .slice(0, 5)
        )
        .catch(() => []);

    Promise.all([
      supabase
        .from("bluebell_staff_attendance")
        .select("date, check_in_time, check_out_time, method")
        .eq("staff_id", staff.id)
        .eq("date", d)
        .maybeSingle(),
      supabase
        .from("bluebell_announcements")
        .select("title, body, created_at, audience, pinned")
        .or(
          `audience.eq.all_staff${allClasses.length ? "," + allClasses.map((c) => `audience.eq.class:${c}`).join(",") : ""}`
        )
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(6),
      // my students (in the classes I own / teach) — whereClassIn because
      // stored class labels vary in case/spacing, and an exact .in() would
      // quietly under-count the roster card.
      allClasses.length
        ? whereClassIn(supabase.from("bluebell_student").select("id, name, class"), "class", allClasses).limit(500)
        : Promise.resolve({ data: [] }),
      // today's classroom register summary (class teachers only)
      classTeacherClasses.length
        ? whereClassIn(supabase.from("bluebell_attendance").select("student_name, status"), "class", classTeacherClasses).eq("date", d)
        : Promise.resolve({ data: [] }),
      recent("bluebell_assignments"),
      recent("bluebell_notes"),
      recent("bluebell_lesson_plans"),
      recent("bluebell_cbtQuestions"),
      // recent results (scoped by studentClass ∈ my classes)
      allClasses.length
        ? supabase
            .from("bluebell_result")
            .select("*")
            .order("id", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [] }),
      listConversations({ teacherStaffId: staff.id }).catch(() => []),
    ])
      .then(([att, ann, stu, reg, asg, nts, lp, cbt, res, msgs]) => {
        setToday(att.data || null);
        setAnnouncements(ann.data || []);

        const myStudents = (stu.data || []).filter((s) => allClasses.some((c) => normCls(c) === normCls(s.class)));
        const counts = { present: 0, absent: 0, late: 0 };
        for (const r of reg.data || []) if (counts[r.status] !== undefined) counts[r.status] += 1;
        const myResults = (res.data || []).filter((r) => allClasses.some((c) => normCls(c) === normCls(r.studentClass))).slice(0, 5);

        setActivity({
          students: myStudents.length,
          attendance: counts,
          assignments: asg,
          notes: nts,
          lessonPlans: lp,
          cbt,
          results: myResults,
          messages: (msgs || []).slice(0, 5),
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id]);

  if (!staff) return null;

  const statusChip = !today
    ? { text: "Not signed in yet", cls: "ap-badge warn" }
    : today.check_out_time
      ? { text: `Signed out ${new Date(today.check_out_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, cls: "ap-badge neutral" }
      : { text: `In since ${new Date(today.check_in_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, cls: "ap-badge ok" };

  const act = activity;

  // A compact recent-activity panel: title + jump link + list of rows.
  const Panel = ({ icon, title, href, count, rows, rowKey, render }) => (
    <div className="ap-card pad activity-panel">
      <div className="d-flex align-items-center gap-2 mb-2">
        <span className="ap-label mb-0">{icon} {title}</span>
        <span className="ap-badge neutral ms-auto">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="ap-muted mb-0" style={{ fontSize: "0.85rem" }}>Nothing yet.</p>
      ) : (
        <div className="activity-rows">
          {rows.map((r, i) => (
            <div key={rowKey ? rowKey(r, i) : i} className="activity-row">{render(r)}</div>
          ))}
        </div>
      )}
      <Link href={href} className="panel-link" style={{ color: "#022aa1", fontWeight: 700, textDecoration: "none", fontSize: "0.8rem" }}>
        Open <RiArrowRightLine style={{ verticalAlign: "middle" }} />
      </Link>
    </div>
  );

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title">Welcome, {staff.name.split(" ")[0]} 👋</h1>
          <p className="ap-sub">
            {staff.designation || "Staff member"}{staff.staff_no ? ` · ${staff.staff_no}` : ""}{session ? ` · ${session}` : ""}
          </p>
        </div>
        <div className="ap-actions">
          <span className={statusChip.cls}><RiTimeLine /> {statusChip.text}</span>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-md-6 col-xl-3">
          <div className="ap-card pad">
            <h6 className="ap-label"><RiSchoolLine /> My classes</h6>
            {isGeneral ? (
              <p className="ap-muted mb-0">General staff — the admin has not assigned you a class yet. Your portal shows your profile and announcements only.</p>
            ) : (
              <>
                <div className="stat-big">{allClasses.length}</div>
                <p className="ap-muted mb-0">
                  {classTeacherClasses.length ? `Class teacher: ${classTeacherClasses.join(", ")}. ` : ""}
                  {subjectPairs.length ? `Subject teacher: ${subjectPairs.map((p) => `${p.subject} (${p.class})`).join(", ")}.` : ""}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="col-md-6 col-xl-3">
          <div className="ap-card pad">
            <h6 className="ap-label"><RiGroupLine /> My students</h6>
            <div className="stat-big">{act.students}</div>
            <p className="ap-muted mb-0">learners across your assigned classes</p>
          </div>
        </div>
        <div className="col-md-6 col-xl-3">
          <div className="ap-card pad">
            <h6 className="ap-label"><RiTimeLine /> Today at the gate</h6>
            <p className="mb-0">{today?.check_in_time ? "Checked in ✔" : "No sign-in recorded yet — the front desk QR scanner records your arrival."}</p>
          </div>
        </div>
        <div className="col-md-6 col-xl-3">
          <div className="ap-card pad">
            <h6 className="ap-label"><RiInboxLine /> Announcements</h6>
            <div className="stat-big">{announcements.length}</div>
            <p className="ap-muted mb-0">recent for staff & your classes</p>
          </div>
        </div>
      </div>

      {!isGeneral && classTeacherClasses.length > 0 && (
        <div className="ap-card mt-3">
          <div className="ap-card-head"><RiTimeLine /> Class register today</div>
          <div className="pad d-flex flex-wrap gap-3">
            <span className="ap-badge ok">{act.attendance.present} present</span>
            <span className="ap-badge danger">{act.attendance.absent} absent</span>
            <span className="ap-badge warn">{act.attendance.late} late</span>
            <Link className="ap-btn sm ghost ms-auto" href="/attendance">Take attendance <RiArrowRightLine /></Link>
          </div>
        </div>
      )}

      {!isGeneral && (
        <div className="ap-card mt-4">
          <div className="ap-card-head"><RiInboxLine /> Jump to a module</div>
          <div className="d-flex flex-wrap gap-2 pad">
            <Link className="ap-btn" href="/classes"><RiSchoolLine /> My Classes</Link>
            {classTeacherClasses.length > 0 && (
              <>
                <Link className="ap-btn" href="/students"><RiGroupLine /> Students</Link>
                <Link className="ap-btn" href="/attendance"><RiTimeLine /> Take Attendance</Link>
              </>
            )}
            <Link className="ap-btn" href="/results"><RiBarChartBoxLine /> Results</Link>
            <Link className="ap-btn" href="/cbt_questions"><RiQuestionAnswerLine /> CBT Questions</Link>
            <Link className="ap-btn" href="/notes"><RiBookOpenLine /> E-Notes</Link>
          </div>
        </div>
      )}

      {!isGeneral && (
        <div className="row g-3 mt-4 activity-grid">
          <div className="col-md-6 col-xl-4">
            <Panel
              icon={<RiFileTextLine />} title="Assignments" href="/assignments" count={act.assignments.length}
              rows={act.assignments} rowKey={(r) => r.id}
              render={(r) => (<><b>{r.title}</b> <span className="ap-muted">· {r.class}{r.subject ? ` · ${r.subject}` : ""}</span></>)}
            />
          </div>
          <div className="col-md-6 col-xl-4">
            <Panel
              icon={<RiBookOpenLine />} title="E-Notes" href="/notes" count={act.notes.length}
              rows={act.notes} rowKey={(r) => r.id}
              render={(r) => (<><b>{r.title}</b> <span className="ap-muted">· {r.class}{r.subject ? ` · ${r.subject}` : ""}</span></>)}
            />
          </div>
          <div className="col-md-6 col-xl-4">
            <Panel
              icon={<RiDraftLine />} title="Lesson Plans" href="/lesson_plans" count={act.lessonPlans.length}
              rows={act.lessonPlans} rowKey={(r) => r.id}
              render={(r) => (<><b>{r.topic || r.objectives || "Untitled"}</b> <span className="ap-muted">· {r.class} · {r.subject}</span></>)}
            />
          </div>
          <div className="col-md-6 col-xl-4">
            <Panel
              icon={<RiQuestionAnswerLine />} title="CBT Questions" href="/cbt_questions" count={act.cbt.length}
              rows={act.cbt} rowKey={(r) => r.id}
              render={(r) => (<><b>{String(r.question || "").slice(0, 45) || "Question"}</b> <span className="ap-muted">· {r.class} · {r.subject}</span></>)}
            />
          </div>
          <div className="col-md-6 col-xl-4">
            <Panel
              icon={<RiBarChartBoxLine />} title="Results" href="/results" count={act.results.length}
              rows={act.results} rowKey={(r) => r.id}
              render={(r) => (<><b>{r.studentName}</b> <span className="ap-muted">· {r.studentClass}</span></>)}
            />
          </div>
          <div className="col-md-6 col-xl-4">
            <Panel
              icon={<RiChatNewLine />} title="Messages" href="/chat" count={act.messages.length}
              rows={act.messages} rowKey={(r) => r.id}
              render={(r) => (
                <>
                  <b>{r.school_type === "admin" ? (r.school_label || "School Admin/Office") : (r.student_name || "Parent")}</b>{" "}
                  <span className="ap-muted">{r.created_at ? `· ${new Date(r.updated_at || r.created_at).toLocaleDateString()}` : ""}</span>
                </>
              )}
            />
          </div>
        </div>
      )}

      <div className="ap-card mt-4">
        <div className="ap-card-head">
          <RiMegaphoneLine /> Latest announcements
          <span className="ms-auto"><Link className="panel-link" href="/announcements" style={{ color: "#022aa1", fontWeight: 700, textDecoration: "none" }}>All <RiArrowRightLine /> </Link></span>
        </div>
        {announcements.length === 0 ? (
          <div className="ap-empty">No announcements yet.</div>
        ) : (
          announcements.map((a, i) => (
            <div key={a.id ?? i} className="ann-row">
              <div className="d-flex align-items-center gap-2">
                {a.pinned && <span className="ap-badge warn">Pinned</span>}
                <b>{a.title}</b>
                <span className="ap-muted ms-auto" style={{ fontSize: "0.75rem" }}>
                  {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                </span>
              </div>
              <p className="ap-muted mb-0" style={{ whiteSpace: "pre-wrap" }}>{a.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

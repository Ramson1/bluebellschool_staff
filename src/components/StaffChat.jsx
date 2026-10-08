"use client";

import React, { useMemo } from "react";
import Chat from "./Chat.jsx";
import { useStaff } from "./StaffShell.jsx";
import { supabase } from "../supabaseClient.js";
import { whereClassIn } from "../utils/scope.js";
import "../styles/Chat.css";

// Teacher view of the shared chat. Parent/guardian threads are student info, so
// they follow the roster policy: only FORM (class) teachers may contact the
// parents of pupils in the classes they own (scope.rosterClasses). Subject
// teachers keep the School Admin / Office thread, which needs no class.
export default function StaffChat() {
  const scope = useStaff();
  const staff = scope?.staff;
  const classes = scope?.rosterClasses || [];

  const me = useMemo(
    () => ({ side: "school", key: `staff:${staff?.id}`, name: staff?.name || "Teacher" }),
    [staff?.id, staff?.name]
  );
  const listFilter = useMemo(() => ({ teacherStaffId: staff?.id }), [staff?.id]);

  const loadContacts = async () => {
    // Req 5: let the teacher start a thread to the Admin/Office. This uses the
    // exact pair-key contract the admin Messages page already writes
    // (student_id=`staff:<id>`, school_type='admin', teacher_staff_id=<staffId>)
    // so openConversation converges on the single shared thread — no DDL, no
    // admin-side change. Prepended so it is available even to staff with no class.
    const officeContact = staff
      ? [{
          key: "office", kind: "office",
          title: "School Admin / Office", subtitle: "Send a message to administration",
          studentId: `staff:${staff.id}`, studentName: staff.name, studentClass: staff.designation || "Staff",
          schoolType: "admin", teacherStaffId: staff.id, schoolLabel: "School Admin/Office",
        }]
      : [];
    if (!staff?.id || !classes.length) return officeContact;
    // Narrowed to the classes this teacher is form teacher of, across the
    // known class-label spellings
    const { data: students, error } = await whereClassIn(
      supabase.from("bluebell_student").select("id, name, class"),
      "class",
      classes
    ).limit(500);
    if (error) throw error;
    const studentContacts = (students || []).map((s) => ({
      key: `stu:${s.id}`, kind: "student",
      title: s.name, subtitle: s.class,
      studentId: s.id, studentName: s.name, studentClass: s.class,
      schoolType: "teacher", teacherStaffId: staff.id, schoolLabel: staff.name,
    }));
    return [...officeContact, ...studentContacts];
  };

  // In a parent<->teacher thread the peer is the parent (student_name/class).
  // In an office<->staff thread (started from the admin dashboard) the staff is
  // stored in student_name, so the peer the teacher sees is the school office.
  const getPeer = (conv) =>
    conv.school_type === "admin"
      ? { title: conv.school_label || "School Admin/Office", subtitle: "School office" }
      : { title: conv.student_name || "Parent", subtitle: conv.student_class || "" };

  if (!staff) return null;
  return <Chat me={me} listFilter={listFilter} loadContacts={loadContacts} getPeer={getPeer} placeholder="Message the parent…" />;
}

"use client";

import React from "react";
import { RiFileTextLine } from "react-icons/ri";
import { makeAcademicsPage } from "./AcademicsKit.jsx";

// Homework / assessments / projects per class+subject.
const AssignmentsPage = makeAcademicsPage({
  table: "jmis_assignments",
  authorField: "created_by",
  title: "Assignments",
  icon: RiFileTextLine,
  blurb: "Give homework, assessments or projects with a due date. Students see them in their portal.",
  withTerm: true,
  withSession: true,
  withFile: "attachment_url",
  columns: [
    { key: "class", label: "Class", type: "select", required: true },
    { key: "subject", label: "Subject", type: "select", required: true },
    { key: "title", label: "Title", required: true },
    { key: "assignment_type", label: "Type", type: "select", options: ["assignment", "assessment", "project"] },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "instructions", label: "Instructions", type: "textarea", full: true, rows: 5 },
  ],
  listColumns: [
    { key: "title", label: "Title" },
    { key: "class", label: "Class" },
    { key: "subject", label: "Subject" },
    { key: "assignment_type", label: "Type" },
    { key: "due_date", label: "Due", render: (r) => (r.due_date || "—") },
    { key: "attachment_url", label: "File", render: (r) => (r.attachment_url ? <a href={r.attachment_url} target="_blank" rel="noopener noreferrer">open</a> : "—") },
  ],
});
export default AssignmentsPage;

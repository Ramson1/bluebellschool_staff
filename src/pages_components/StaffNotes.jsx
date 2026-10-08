"use client";

import React from "react";
import { RiBookOpenLine } from "react-icons/ri";
import { makeAcademicsPage } from "./AcademicsKit.jsx";

// Lesson notes / documents shared with a class (+subject).
const NotesPage = makeAcademicsPage({
  table: "bluebell_notes",
  // bluebell_notes has no created_by column — the author lives in uploaded_by.
  authorField: "uploaded_by",
  title: "Notes",
  icon: RiBookOpenLine,
  blurb: "Upload lesson notes and materials for your classes. Students see these in their portal.",
  withTerm: true,
  withSession: true,
  withFile: "file_url",
  columns: [
    { key: "class", label: "Class", type: "select", required: true },
    { key: "subject", label: "Subject", type: "select", required: true },
    { key: "title", label: "Title", required: true },
    { key: "content", label: "Note text / summary", type: "textarea", full: true },
  ],
  listColumns: [
    { key: "title", label: "Title" },
    { key: "class", label: "Class" },
    { key: "subject", label: "Subject" },
    { key: "term", label: "Term", render: (r) => [r.academic_session, r.term].filter(Boolean).join(" · ") || "—" },
    { key: "file_url", label: "File", render: (r) => (r.file_url ? <a href={r.file_url} target="_blank" rel="noopener noreferrer">open</a> : "—") },
    { key: "created_at", label: "Added", render: (r) => (r.created_at ? new Date(r.created_at).toLocaleDateString() : "—") },
  ],
});
export default NotesPage;

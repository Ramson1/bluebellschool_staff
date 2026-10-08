// Generate a Word (.docx) document for a single lesson plan and trigger a local
// download. Mirrors the printable LessonPlanDoc.jsx layout so what a teacher
// previews/prints on screen is what lands in the exported file. Uses the same
// dynamic `import("docx")` idiom as the admin token export (see FullStudent.jsx)
// so the ~heavyweight library stays out of the initial bundle.
//
// @param plan    normalized lesson-plan row (see lessonPlanApi.normalize)
// @param school  optional { name, location, logo } branding overrides
// @param fileName optional download name; defaults to a descriptive one

const DEFAULT_SCHOOL = {
  name: "Bluebell International School",
  location: "BLUEBELL_LOCATION_PLACEHOLDER",
};

const val = (v) => (v == null ? "" : String(v));

export async function exportLessonPlanToDocx(plan = {}, school = {}, fileName) {
  const {
    Document, Table, TableRow, TableCell, Paragraph, TextRun,
    WidthType, AlignmentType, ShadingType, BorderStyle,
  } = await import("docx");

  const s = { ...DEFAULT_SCHOOL, ...(school || {}) };
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const P = (k) => val(plan[k]);

  // ---------- helpers bound to the imported docx classes ----------
  const cellP = (t, run = {}) =>
    val(t)
      .split(/\r?\n/)
      .map((line) => new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: line, size: 20, ...run })] }));

  const labelCell = (t) =>
    new TableCell({
      width: { size: 24, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: "eef2ee" },
      children: cellP(t, { bold: true }),
    });
  const valueCell = (t, span) =>
    new TableCell({
      columnSpan: span,
      children: cellP(val(t).trim() ? t : "—"),
    });
  const kvRow = (cells) => new TableRow({ children: cells });

  const th = (t) =>
    new TableCell({
      shading: { type: ShadingType.CLEAR, fill: "1e5128" },
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", size: 20 })] })],
    });
  const td = (t) => new TableCell({ children: cellP(val(t).trim() ? t : "—") });

  // ---------- info grid ----------
  const infoRows = [
    kvRow([labelCell("Subject"), valueCell(P("subject")), labelCell("Class"), valueCell(P("class"))]),
    kvRow([labelCell("Topic"), valueCell(P("topic"), 3)]),
    kvRow([labelCell("Sub-topic"), valueCell(P("sub_topic"), 3)]),
    kvRow([labelCell("Term"), valueCell(P("term")), labelCell("Week"), valueCell(P("week"))]),
    kvRow([labelCell("Lesson"), valueCell(P("lesson_no")), labelCell("Time"), valueCell(P("duration"))]),
    kvRow([labelCell("Age"), valueCell(P("age")), labelCell("Session"), valueCell(P("academic_session"))]),
    kvRow([labelCell("Objective(s)"), valueCell(P("objectives"), 3)]),
    kvRow([labelCell("Prior knowledge"), valueCell(P("prior_knowledge"), 3)]),
    kvRow([labelCell("Instructional materials / Resources"), valueCell(P("resources"), 3)]),
    kvRow([labelCell("Possible problems & solutions"), valueCell(P("possible_problems"), 3)]),
  ];

  // ---------- lesson structure ----------
  const stepRows = [
    new TableRow({
      tableHeader: true,
      children: [th("Step / Activity"), th("Time"), th("Teacher Activities"), th("Student Activities")],
    }),
    ...(steps.length
      ? steps.map((st) => new TableRow({ children: [td(st.step), td(st.time), td(st.teacher), td(st.student)] }))
      : [new TableRow({ children: [new TableCell({ columnSpan: 4, children: cellP("—") })] })]),
  ];

  // ---------- evaluation / homework ----------
  const evalRows = [
    kvRow([labelCell("Evaluation (Teacher)"), valueCell(P("evaluation"), 3)]),
    kvRow([labelCell("Homework"), valueCell(P("homework"), 3)]),
  ];

  // ---------- sign-off ----------
  const signCell = (label, value) =>
    new TableCell({
      children: [
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: label, bold: true, size: 18, color: "555555" })] }),
        ...cellP(val(value).trim() ? value : ""),
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
          children: [new TextRun({ text: "" })],
        }),
      ],
    });
  const signRow = new TableRow({
    children: [signCell("Teacher", P("teacher_name")), signCell("The Head / Teacher Section", P("head_teacher")), signCell("Sign / Date", P("lesson_date"))],
  });

  const fullTable = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });

  const doc = new Document({
    creator: s.name,
    title: "Lesson Plan",
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.name, bold: true, size: 30 })] }),
          s.location
            ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.location, italics: true, size: 18, color: "666666" })] })
            : new Paragraph({ children: [] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 160 }, children: [new TextRun({ text: "LESSON PLAN", bold: true, size: 26 })] }),
          fullTable(infoRows),
          new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "Lesson Structure", bold: true, size: 22 })] }),
          fullTable(stepRows),
          new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "Evaluation & Homework", bold: true, size: 22 })] }),
          fullTable(evalRows),
          new Paragraph({ spacing: { before: 260 }, children: [] }),
          fullTable([signRow]),
        ],
      },
    ],
  });

  const blob = await (await import("docx")).Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug =
    fileName ||
    `lesson-plan-${[P("class"), P("subject"), P("topic")].filter(Boolean).join("-").replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "plan"}.docx`;
  a.download = slug;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob;
}

export default exportLessonPlanToDocx;

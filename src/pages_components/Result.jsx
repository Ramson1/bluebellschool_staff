import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { useSearchParams } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { abbreviateSubject, getStandardRemarks, normalizeSubjectName, schoolSubjects } from '../utils/subjectUtils';
import { useStaff } from "../components/StaffShell.jsx";
import { normCls, normSub, resultSubjectGuard, whereClassIn } from "../utils/scope.js";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Card from "react-bootstrap/Card";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import ProgressBar from "react-bootstrap/ProgressBar";
import Spinner from "react-bootstrap/Spinner";
import emailjs from '@emailjs/browser';
import { sendEmailNotification } from '../api/emailNotificationService';
import { resolveResultRecipients } from '../utils/resultRecipients';
import { logAction } from '../api/auditLog';
import * as XLSX from 'xlsx';
import { FaFileExcel } from 'react-icons/fa';
import {
  RiUploadCloud2Line,
  RiEyeLine,
  RiBarChart2Line,
  RiDownloadLine,
  RiUserLine,
  RiGraduationCapLine,
  RiTimeLine,
  RiGroupLine,
  RiClipboardLine,
  RiAwardLine,
  RiStarLine,
  RiCheckLine,
  RiCloseLine,
  RiInformationLine,
  RiEmotionHappyLine,
  RiRunLine,
  RiBankLine,
} from 'react-icons/ri';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import '../styles/Result.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);
// import { sendEmailNotification as sendEmailNotificationClient, getAdminEmail } from '../api/emailClient';
// EMAIL FUNCTIONALITY COMMENTED OUT FOR VERCEL DEPLOYMENT

// Function to send email notification using both EmailJS and Gmail service
// EMAIL FUNCTIONALITY COMMENTED OUT FOR VERCEL DEPLOYMENT
// const sendEmailNotification = async (subject, message) => {
//   console.log('Email functionality is disabled for Vercel deployment');
//   console.log('Subject:', subject);
//   console.log('Message:', message);
//   // Return early without sending email
//   return;
// }; // Unused

// Function to send email notification using our Gmail service
// EMAIL FUNCTIONALITY COMMENTED OUT FOR VERCEL DEPLOYMENT
// const sendEmailNotificationGmail = async (subject, text) => {
//   console.log('Email functionality is disabled for Vercel deployment');
//   console.log('Subject:', subject);
//   console.log('Text:', text);
//   // Return early without sending email
//   return;
// }; // Unused

// Predefined subjects for each class category
// schoolSubjects are imported from subjectUtils.js

// Function to determine class level group - now using primary grading for all
// levels including early years. The year number is parsed, not matched by
// substring, so Year 10-12 stay secondary instead of collapsing onto "year1".
const getClassLevelGroup = (classKey) => {
  const lowerClassKey = String(classKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const m = lowerClassKey.match(/year(\d+)/);
  if (m) return Number(m[1]) >= 7 ? "secondary" : "primary";
  return "primary"; // early years + default
};

// Map a class label to its schoolSubjects key ("Year 11"/"year11" → "year11").
// Early years keep this page's long-standing behaviour of sharing the nursery
// list, including pre-nursery.
const subjectClassKey = (label) => {
  const key = String(label || "").toLowerCase().replace(/\s+/g, "");
  if (key.includes("creche")) return "creche";
  if (key.includes("nursery")) return "nursery";
  const m = key.match(/year(\d+)/);
  return m ? `year${Number(m[1])}` : key;
};

// Resolve the subject list for a class label (used to measure result completeness)
const getSubjectListForClass = (className) => {
  const key = (className || "").toLowerCase().replace(/\s+/g, "");
  if (key.includes("creche")) return schoolSubjects.creche || [];
  if (key.includes("prenursery") || key.includes("pre-nursery") || key.includes("nursery")) {
    return schoolSubjects.nursery || [];
  }
  const m = key.match(/year(\d+)/);
  if (m) return schoolSubjects[`year${m[1]}`] || [];
  return [];
};

// A stored subject entry counts as "filled" when the teacher actually recorded a
// value for it, including a legitimate 0. Untouched cells are saved as "" (see
// handleClassChange's initializer and the ?? fallback in uploadResults), so we
// treat an empty / null / non-numeric field as "not recorded" and any numeric
// string (including "0") as "recorded". That is what makes a first-entered 0
// count as 1 subject done, and an exam that has been taken (even at 0 marks)
// register on the completeness bar instead of silently disappearing.
const resultEntryHasScore = (entry, isMidterm) => {
  if (!entry) return false;
  const filled = (v) => {
    if (v === null || v === undefined) return false;
    const s = String(v).trim();
    if (s === "") return false;
    return Number.isFinite(parseFloat(s));
  };
  if (isMidterm) return filled(entry.midtermScore ?? entry.test);
  return filled(entry.examination) || filled(entry.test) || filled(entry.project);
};

// The school's marking scheme is a hard ceiling on every result cell: Test 30,
// Project 10, Examination 60, mid-term score 30. A typed number used to be stored
// exactly as entered, which is how one subject could end up holding more marks
// than the column can take.
const SCORE_MAX = { test: 30, project: 10, examination: 60, midtermScore: 30 };

const clampScore = (key, value) => {
  const max = SCORE_MAX[key];
  if (max === undefined) return { value, clamped: false };
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return { value, clamped: false };   // empty / partial input
  if (num < 0) return { value: "0", clamped: true };
  if (num > max) return { value: String(max), clamped: true };
  return { value, clamped: false };
};

// Whole-school picker list (legacy no-space spellings). The page renders only
// the teacher's assigned classes out of it — see scopedClassOptions below.
const ALL_CLASS_OPTIONS = [
  ...Array.from({ length: 1 }, (_, i) => `Creche`),
  ...Array.from({ length: 2 }, (_, i) => `PreNursery${i + 1}`),
  ...Array.from({ length: 2 }, (_, i) => `Nursery${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `Year${i + 1}`)
];

// Map an assignment label ("Year 5", "Nursery 1"…) to its spelling used by the
// result/student tables ("Year5", "Nursery1"), or null when the teacher is
// assigned a class the legacy list does not carry.
const legacyClassOption = (label) => {
  const n = normCls(label);
  return ALL_CLASS_OPTIONS.find((x) => normCls(x) === n) || null;
};

// Main component: Handles student result entry, grading, and dynamic subject selection
export default function Result() {
  const [user, setUser] = useState();
  const [userAuth, setUserAuth] = useState([]);
  const [teacherAuth, setTeacherAuth] = useState([]);

  const [studentClassFilter, setStudentClassFilter] = useState("");
  const [termFilter, setTermFilter] = useState(""); // State to manage the selected term
  const [subjects, setSubjects] = useState([]);
  const [studentsOptions, setStudentsOptions] = useState([]);
  const [studentIdMap, setStudentIdMap] = useState({});
  const [clampedCells, setClampedCells] = useState({}); // cells capped by SCORE_MAX
  const [scores, setScores] = useState({
    debitAmount: { value: "" },
    // Initialize all psychomotor and affective domain fields
    handWriting: { value: "" },
    verbalFrequency: { value: "" },
    games: { value: "" },
    handlingTools: { value: "" },
    drawingPainting: { value: "" },
    musicalSkills: { value: "" },
    daysPresent: { value: "" },
    daysAbsent: { value: "" },
    punctuality: { value: "" },
    neatness: { value: "" },
    honesty: { value: "" },
    coOperation: { value: "" },
    leadership: { value: "" },
    helpingOthers: { value: "" },
    emotionalStability: { value: "" },
    health: { value: "" },
    attentiveness: { value: "" },
    attitudeToSchoolWork: { value: "" }
  });
  const [selectedStudent, setSelectedStudent] = useState("");
  const [fetchedResultId, setFetchedResultId] = useState(null);
  const [termSubjects, setTermSubjects] = useState({
    term1Subjects: [],
    term2Subjects: [],
    term3Subjects: [],
    overall1st: {},
    overall2nd: {},
    overall3rd: {},
  });
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [classStats, setClassStats] = useState([]);
  const [showRecordedChart, setShowRecordedChart] = useState(false); // Toggle the "Recorded vs Not Recorded" chart panel (hidden by default)
  const [showCompleteness, setShowCompleteness] = useState(false); // Toggle the "Result Completeness" panel (hidden by default)
  const [statsClass, setStatsClass] = useState(""); // Class selected in the completion panel
  const [isUploading, setIsUploading] = useState(false); // State to track upload process
  const [purpose, setPurpose] = useState('fullterm'); // State to manage result purpose (fullterm/midterm)

  // Export State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportTerm, setExportTerm] = useState('1st Term');
  const [exportType, setExportType] = useState('general');
  const [exportScope, setExportScope] = useState('all');
  const [exportStudentName, setExportStudentName] = useState('');
  const [devAuth, setDevAuth] = useState([]);

  // ---- assignment scope (see src/utils/scope.js) --------------------------
  // A form (class) teacher owns every subject of a class; a subject teacher owns
  // only the subjects the admin assigned them for that specific class. Results
  // follow that split: the editable grid is filtered to their subjects, the
  // whole-class fields (totals, remarks, traits, attendance) stay with the form
  // teacher, and the save merges into the stored row so the other teachers'
  // subjects are carried over untouched instead of being overwritten.
  const scope = useStaff();
  const isFormTeacherIn = (cls) =>
    !!scope?.classTeacherClasses?.some((c) => normCls(c) === normCls(cls));
  // null = every subject, [] = nothing assigned for that class
  const ownedSubjectsIn = (cls) => {
    if (!scope || scope.isGeneral || isFormTeacherIn(cls)) return null;
    return (scope.subjectPairs || [])
      .filter((p) => normCls(p.class) === normCls(cls))
      .map((p) => p.subject);
  };
  const ownsSubjectIn = (cls, subject) => {
    const owned = ownedSubjectsIn(cls);
    return owned === null || owned.some((o) => normSub(o) === normSub(subject));
  };
  const ownsSubject = (subject) => ownsSubjectIn(studentClassFilter, subject);
  // Assigned subjects that the class's predefined list does not carry (legacy
  // or extra labels the admin ticked). A subject teacher must still get a row
  // for them, otherwise their only editable subject can disappear.
  const extraOwnedSubjects = (cls, list) => {
    const owned = ownedSubjectsIn(cls);
    if (owned === null) return [];
    return owned.filter((o) => o && !list.some((s) => normSub(s) === normSub(o)));
  };
  // true only when the signed-in teacher is a SUBJECT teacher for the class
  // currently selected — form teachers edit the whole class as before
  const subjectScoped =
    !!scope && !scope.isGeneral && !isFormTeacherIn(studentClassFilter);

  // A teacher is responsible for a class when they are in general/admin scope,
  // the form (class) teacher of it, or a subject teacher assigned any subject
  // in it. Used to keep the Result Progress panels scoped to their own classes
  // instead of the whole school.
  const isAssignedClass = (cls) =>
    !scope ||
    scope.isGeneral ||
    isFormTeacherIn(cls) ||
    (scope.subjectPairs || []).some((p) => normCls(p.class) === normCls(cls));

  // const router = useRouter(); // Unused

  useEffect(() => {
    const getUserData = async () => {
      await supabase.auth.getUser().then((value) => {
        if (value.data?.user) {
          setUser(value.data.user);
        }
      });
    };
    // check if it is working
    const fetchUserAuth = async () => {
      try {
        const { data, error } = await supabase
          .from('bluebell_userauth')
          .select('email');
        if (error) throw error;
        setUserAuth(data);
      } catch (error) {
        // Handle error if needed
      }
    };
    
    const fetchTeacherAuth = async () => {
      try {
        const { data, error } = await supabase
          .from('bluebell_teacherauth')
          .select('email');
        if (error) throw error;
        setTeacherAuth(data);
      } catch (error) {
        // Handle error if needed
      }
    };

    const fetchDevAuth = async () => {
      try {
        const { data, error } = await supabase
          .from('devauth')
          .select('email');
        if (error) throw error;
        setDevAuth(data);
      } catch (error) {
        // Handle error if needed
      }
    };
    
    getUserData();
    fetchUserAuth();
    fetchTeacherAuth();
    fetchDevAuth();
  }, []);

  // Check if the current user is a teacher
  const isTeacher = user && teacherAuth && teacherAuth.some && teacherAuth.some(auth => auth.email === user?.user_metadata?.email);
  const isDev = user && devAuth && devAuth.some && devAuth.some(auth => auth.email === user?.user_metadata?.email);

  // Whether the signed-in user may run the class result actions (Preview, Result
  // Progress, Export). In the staff portal any scoped teacher qualifies; the
  // admin role-table checks are kept so the block also behaves correctly if this
  // component is ever rendered for an admin/dev account.
  const canManageResultActions =
    !!scope ||
    isTeacher ||
    isDev ||
    (userAuth && userAuth.some && userAuth.some((auth) => auth.email === user?.user_metadata?.email));

  // Resolve the acting staff member for the audit trail / notification. Staff
  // accounts carry no email in user_metadata, so reading it alone resolved to
  // 'Unknown User' and dropped the audit row — use the staff scope (name +
  // email) as the authoritative source, with the auth session as fallback.
  const getCurrentUserEmail = () =>
    String(scope?.staff?.email || user?.email || user?.user_metadata?.email || '').trim();
  const getCurrentUserName = () =>
    String(scope?.staff?.name || user?.user_metadata?.full_name || '').trim();

  // Resolve the acting user's role for audit logging
  const getAuditRole = () => {
    const em = getCurrentUserEmail();
    if ((devAuth || []).some((a) => a.email === em)) return "developer";
    if ((userAuth || []).some((a) => a.email === em)) return "admin";
    if ((teacherAuth || []).some((a) => a.email === em)) return "teacher";
    return "";
  };

  const handleExport = async () => {
    toast.info("Exporting data...");
    try {
      let query = supabase.from('bluebell_result').select('*');
      
      if (exportScope === 'individual') {
        if (!exportStudentName) {
          toast.error("Please enter student name");
          return;
        }
        query = query.ilike('studentName', `%${exportStudentName}%`);
        // Names can repeat across classes — pin the row to the class picked in
        // the modal so only that pupil's record is exported.
        if (exportClass) query = whereClassIn(query, 'studentClass', [exportClass]);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Defensive: never export rows for classes outside this teacher's
      // assignment ("all" scope included) — keeps the file form-scope honest.
      let rows = data || [];
      if (scope && !scope.isGeneral) {
        rows = rows.filter((r) => isAssignedClass(r.studentClass));
      }

      if (rows.length === 0) {
        toast.info("No data found to export");
        return;
      }

      const processedData = rows.map(record => {
         let termKey = 'term1Subjects';
         let overall = record.overall1st || {};

         if (exportTerm === '2nd Term') {
           termKey = 'term2Subjects';
           overall = Array.isArray(record.overall2nd) ? (record.overall2nd[0] || {}) : (record.overall2nd || {});
         } else if (exportTerm === '3rd Term') {
           termKey = 'term3Subjects';
           overall = Array.isArray(record.overall3rd) ? (record.overall3rd[0] || {}) : (record.overall3rd || {});
         }

         const subjects = record[termKey] || [];
         const subjectData = {};

         subjects.forEach(sub => {
           if (exportType === 'midterm') {
              subjectData[`${sub.subjectName} (Midterm)`] = sub.test || sub.ca1 || '-';
           } else {
              subjectData[`${sub.subjectName} (Test)`] = sub.test || '-';
              subjectData[`${sub.subjectName} (Project)`] = sub.project || '-';
              subjectData[`${sub.subjectName} (Exam)`] = sub.examination || sub.exam || '-';
              subjectData[`${sub.subjectName} (Total)`] = sub.total || '-';
              subjectData[`${sub.subjectName} (Grade)`] = sub.grade || '-';
           }
         });

         return {
           'Student Name': record.studentName,
           'Class': record.studentClass,
           'Term': exportTerm,
           'Type': exportType,
           ...subjectData,
           'Total Score': overall.overallTotal || '-',
           'Average/Grade': overall.overallGrade || '-',
           'Teacher Remark': overall.overallRemark || '-',
           'Principal Remark': overall.overallPrincipalRemark || '-'
         };
      });

      const ws = XLSX.utils.json_to_sheet(processedData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Results");
      XLSX.writeFile(wb, `Results_${exportTerm}_${exportType}.xlsx`);
      
      toast.success("Export successful!");
      setShowExportModal(false);
    } catch (error) {
      console.error(error);
      toast.error("Export failed: " + error.message);
    }
  };

  // Button activity state for 'Upload Results'
  const isUploadButtonDisabled = !selectedStudent || !studentClassFilter || !termFilter;

  // Class picker: only the classes this teacher is assigned to (form-teacher
  // classes + classes where they teach a subject), in the legacy spelling the
  // data tables use. General staff never reach the page (ScopeGate), so
  // allClasses is always populated here.
  const scopedClassOptions = React.useMemo(() => {
    if (!scope) return [];
    return ALL_CLASS_OPTIONS.filter((x) =>
      (scope.allClasses || []).some((c) => normCls(c) === normCls(x))
    );
  }, [scope]);

  // Prune a stale selection if the teacher's assignment changed mid-session
  // (assignment edited while logged in) so the picker can't keep an
  // out-of-scope class loaded.
  useEffect(() => {
    if (!scope || !studentClassFilter) return;
    if (!scopedClassOptions.some((x) => normCls(x) === normCls(studentClassFilter))) {
      setStudentClassFilter("");
      setSubjects([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedClassOptions]);

  // The datalist is driven by the SELECTED class, not the whole school: a
  // teacher may only pick pupils from one of their classes. No class chosen →
  // empty list (the placeholder tells them to pick a class first).
  const pickerStudents = React.useMemo(() => {
    if (!studentClassFilter) return [];
    return Object.keys(studentIdMap).filter(
      (name) => normCls(studentIdMap[name]?.class || "") === normCls(studentClassFilter)
    );
  }, [studentIdMap, studentClassFilter]);

  // Export modal: the class an individual export is limited to. Defaults to the
  // class picked on the toolbar; the datalist below only ever offers pupils of
  // this class and handleExport filters the query by it.
  const [exportClass, setExportClass] = useState("");
  const [exportClassTouched, setExportClassTouched] = useState(false);
  const seedRef = useRef(false); // ?class= / ?subject= deep link applied only once
  // One-shot row highlight for the subject carried by the deep link.
  const [focusSubject, setFocusSubject] = useState("");
  useEffect(() => {
    // Follow the toolbar selection unless the teacher picked a different class
    // inside the modal (and fall back to their first assigned class).
    if (exportClassTouched) return;
    const next =
      studentClassFilter && scopedClassOptions.some((x) => normCls(x) === normCls(studentClassFilter))
        ? studentClassFilter
        : scopedClassOptions[0] || "";
    if (next) setExportClass(next);
  }, [studentClassFilter, scopedClassOptions, exportClassTouched]);
  // Built from the whole (already scoped) student map rather than
  // pickerStudents, so the list stays correct when the modal class differs
  // from the toolbar selection.
  const exportClassStudents = React.useMemo(() => {
    if (!exportClass) return [];
    return Object.keys(studentIdMap).filter(
      (name) => normCls(studentIdMap[name]?.class || "") === normCls(exportClass)
    );
  }, [studentIdMap, exportClass]);

  // Fetch user data and student names along with IDs
  // (re-runs when the teacher's assigned classes change — keyed on the labels,
  // not the scope object, which the shell recreates on every render)
  const scopeClassKey = (scope?.allClasses || []).join("|");
  useEffect(() => {
    const fetchStudents = async () => {
      try {
        // Scoped: only students in the teacher's assigned classes (fetched
        // across label spellings). Before scope resolves there is nothing to
        // fetch — the effect re-runs once `scope` lands.
        if (!scope) return;
        if (!(scope.allClasses || []).length) return;
        // Narrowed to this teacher's classes across the label spellings; a
        // general-scope account (never reachable through ScopeGate) keeps the
        // whole-school list.
        const { data, error } = await (scope.isGeneral
          ? supabase.from("bluebell_student").select("id, name, class")
          : whereClassIn(supabase.from("bluebell_student").select("id, name, class"), "class", scope.allClasses));
        if (error) throw error;

        const sortedStudents = data.map((student) => student.name).sort();
        // Create a mapping that includes both student ID and class
        const studentIdMapping = data.reduce((acc, student) => {
          acc[student.name] = {
            id: student.id,
            class: student.class
          };
          return acc;
        }, {});

        setStudentsOptions(sortedStudents);
        setStudentIdMap(studentIdMapping);
      } catch (error) {
        toast.error("Error fetching students: " + error.message);
      }
    };

    fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeClassKey]);

  useEffect(() => {
    console.log("Student ID Map updated:", studentIdMap);
    // Log the keys to see what students are available
    console.log("Available students:", Object.keys(studentIdMap));
  }, [studentIdMap]);

  useEffect(() => {
    console.log("Scores updated:", scores);
  }, [scores]);

  useEffect(() => {
    console.log("Subjects updated:", subjects);
  }, [subjects]);

  useEffect(() => {
    console.log("Selected student changed:", selectedStudent);
  }, [selectedStudent]);


  useEffect(() => {
    console.log("Term filter changed:", termFilter);
  }, [termFilter]);

  // Default the term picker to the session's current term. bluebell_settings.term
  // is stored as "1st Term"/"2nd Term"/"3rd Term"; this picker uses lowercase.
  useEffect(() => {
    if (termFilter) return;
    supabase
      .from("bluebell_settings")
      .select("term")
      .limit(1)
      .then(({ data }) => {
        const t = String(data?.[0]?.term || "").toLowerCase().trim();
        if (["1st term", "2nd term", "3rd term"].includes(t)) setTermFilter(t);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    console.log("Term subjects updated:", termSubjects);
  }, [termSubjects]);

  // Attendance history for the selected student (current term, from bluebell_attendance)
  const [studentAttendance, setStudentAttendance] = useState([]);

  useEffect(() => {
    const fetchAttendance = async () => {
      setStudentAttendance([]);
      if (!selectedStudent || !studentClassFilter || !termFilter) return;
      try {
        const { data: settingsData } = await supabase
          .from("bluebell_settings")
          .select("session, term, schoolOpened")
          .limit(1);
        const s = (settingsData && settingsData[0]) || {};
        // attendance is only tracked for the term currently set in settings
        if (!s.term || s.term.toLowerCase().trim() !== termFilter.toLowerCase().trim()) return;

        const { data } = await supabase
          .from("bluebell_attendance")
          .select("*")
          .eq("student_name", selectedStudent)
          .eq("term", s.term)
          .order("date", { ascending: true });
        const norm = (v) => (v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const rows = (data || []).filter((r) => norm(r.class) === norm(studentClassFilter));
        setStudentAttendance(rows);

        // Prefill daysPresent/daysAbsent from check-ins (manual override still possible)
        if (rows.length > 0) {
          const present = rows.length;
          const opened = parseInt(s.schoolOpened, 10);
          setScores((prev) => ({
            ...prev,
            daysPresent: prev?.daysPresent?.value ? prev.daysPresent : { value: String(present) },
            daysAbsent:
              prev?.daysAbsent?.value
                ? prev.daysAbsent
                : { value: Number.isFinite(opened) ? String(Math.max(opened - present, 0)) : "" },
          }));
        }
      } catch (e) {
        console.warn("Attendance fetch failed:", e);
      }
    };
    fetchAttendance();
  }, [selectedStudent, studentClassFilter, termFilter]);

  const getStudentInfo = (name) => {
    if (!name || !studentIdMap) return null;
    const direct = studentIdMap[name];
    if (direct) return direct;
    const trimmed = name.trim().toLowerCase();
    const matchedKey = Object.keys(studentIdMap).find(
      (key) => key.trim().toLowerCase() === trimmed
    );
    return matchedKey ? studentIdMap[matchedKey] : null;
  };

  const classOptions = scopedClassOptions;

  
  useEffect(() => {
    console.log("Student class filter changed:", studentClassFilter);
    // Log all available class options
    console.log("Available class options:", classOptions);
  }, [studentClassFilter, classOptions]);
  
  useEffect(() => {
    const fetchClassStats = async () => {
      try {
        // Scoped: only this teacher's classes enter the stats/roster query —
        // the isAssignedClass filter below only trims result rows, so the
        // student list itself must be narrowed server-side too.
        let studentQuery = supabase
          .from("bluebell_student")
          .select("name, class");
        if (scope && !scope.isGeneral) {
          if (!(scope.allClasses || []).length) { setClassStats([]); return; }
          studentQuery = whereClassIn(studentQuery, "class", scope.allClasses);
        }
        const { data: studentsData, error: studentsError } = await studentQuery;

        const { data: resultsData, error: resultsError } = await supabase
          .from("bluebell_result")
          .select("studentName, studentClass, term1Subjects, term2Subjects, term3Subjects");

        if (studentsError || resultsError) {
          throw new Error(studentsError?.message || resultsError?.message);
        }

        const termKey =
          termFilter === "1st term"
            ? "term1Subjects"
            : termFilter === "2nd term"
              ? "term2Subjects"
              : "term3Subjects";
        const isMidterm = purpose === "midterm";
        const normName = (v) => (v || "").trim().toLowerCase();

        const resultsByStudent = {};
        (resultsData || []).forEach((r) => {
          if (r?.studentName) resultsByStudent[normName(r.studentName)] = r;
        });

        // Build per-class stats including per-student completeness for the chart panel
        const byClass = {};
        (studentsData || []).forEach((student) => {
          if (!student?.class) return;
          if (!byClass[student.class]) {
            byClass[student.class] = { totalPupils: 0, resultsUploaded: 0, students: [] };
          }
          const group = byClass[student.class];
          group.totalPupils += 1;

          const row = resultsByStudent[normName(student.name)];
          const allEntries = (row && row[termKey]) || [];
          // Completeness is measured against the subjects this teacher owns in
          // that class (null = the whole subject list for a form teacher), so a
          // Mathematics teacher is not shown as 1/21 done.
          const ownedForClass = ownedSubjectsIn(student.class);
          // [] means the teacher owns nothing in that class (it is not part of
          // their assignment at all) — keep the full class view rather than
          // showing a misleading 0/1.
          const scoped = ownedForClass && ownedForClass.length ? ownedForClass : null;
          const entries = scoped
            ? allEntries.filter((e) => ownsSubjectIn(student.class, e.subjectName))
            : allEntries;
          const subjectCount = Math.max(
            (scoped || getSubjectListForClass(student.class)).length,
            entries.length,
            1
          );
          const scoredCount = entries.filter((e) => resultEntryHasScore(e, isMidterm)).length;
          const recorded = entries.length > 0;
          if (recorded) group.resultsUploaded += 1;

          group.students.push({
            name: student.name,
            recorded,
            scoredCount,
            subjectCount,
            percent: Math.min(100, Math.round((scoredCount / subjectCount) * 100)),
          });
        });

        const stats = Object.keys(byClass)
          // Scope the progress panels to the classes this teacher is responsible
          // for, so the chart and the completeness selector only surface their
          // own classes rather than every class in the school.
          .filter((className) => isAssignedClass(className))
          .map((className) => ({
          className,
          ...byClass[className],
          students: byClass[className].students.sort((a, b) =>
            (a.name || "").localeCompare(b.name || "")
          ),
        }));
        stats.sort((a, b) => a.className.localeCompare(b.className));

        setClassStats(stats);
      } catch (error) {
        toast.error("Error fetching class stats: " + error.message);
      }
    };

    if (termFilter) {
      fetchClassStats();
    }
  }, [termFilter, purpose, scope]); // Refetch stats when the term/result type changes or once the teacher's assignment scope resolves

  // Derived data for the completion panel (bar chart + per-student progress bars)
  const activeStatsClass =
    statsClass || studentClassFilter || (classStats[0] && classStats[0].className) || "";
  const statsStudents =
    (classStats.find((c) => c.className === activeStatsClass) || { students: [] }).students;

  const isDarkChart =
    typeof document !== "undefined" &&
    document.documentElement?.getAttribute("data-theme") === "dark";
  const chartTextColor = isDarkChart ? "#cbd5e1" : "#334155";

  const completionChart = {
    labels: classStats.map((s) => s.className),
    datasets: [
      {
        label: "Results recorded",
        data: classStats.map((s) => s.resultsUploaded),
        backgroundColor: "#022aa1",
        borderRadius: 6,
        barPercentage: 0.68,
      },
      {
        label: "Not recorded",
        data: classStats.map((s) => Math.max(s.totalPupils - s.resultsUploaded, 0)),
        backgroundColor: isDarkChart ? "rgba(217, 83, 79, 0.45)" : "rgba(217, 83, 79, 0.55)",
        borderRadius: 6,
        barPercentage: 0.68,
      },
    ],
  };

  const completionChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top", labels: { color: chartTextColor, usePointStyle: true, boxHeight: 8 } },
      tooltip: { callbacks: {
        afterBody: (items) => {
          const stat = classStats[items[0].dataIndex];
          return stat ? `${stat.resultsUploaded} of ${stat.totalPupils} pupils recorded` : "";
        },
      } },
    },
    scales: {
      x: { stacked: true, ticks: { color: chartTextColor }, grid: { display: false } },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { color: chartTextColor, precision: 0 },
        grid: { color: isDarkChart ? "rgba(148,163,184,0.15)" : "rgba(107,114,128,0.12)" },
      },
    },
  };

  useEffect(() => {
    const fetchExistingResult = async () => {
      // Add checks to ensure all required values are present
      if (!selectedStudent || !studentClassFilter || !termFilter) {
        return;
      }
      
      // Check if studentIdMap is populated
      if (!studentIdMap || Object.keys(studentIdMap).length === 0) {
        return;
      }
      
      if (selectedStudent && studentClassFilter && termFilter) {
        const studentInfo = getStudentInfo(selectedStudent);
        if (!studentInfo) {
          return;
        }

        const studentId = studentInfo.id;
        const studentClassFromDb = studentInfo.class;

        const normalizeClassLabel = (value) =>
          (value || "").toLowerCase().replace(/[^a-z0-9]/g, '');

        const selectedClassNormalized = normalizeClassLabel(studentClassFilter);
        const dbClassNormalized = normalizeClassLabel(studentClassFromDb);

        if (studentClassFilter && selectedClassNormalized && dbClassNormalized && selectedClassNormalized !== dbClassNormalized) {
          toast.warn("Selected class does not match the student's class. Please choose the correct class.");
          setFetchedResultId(null);
          handleClassChange("");
          return;
        }

        const studentClass = studentClassFromDb || studentClassFilter;

        // Normalize class name for subject lookup
        const classKey = subjectClassKey(studentClass);
        const defaultSubjects = schoolSubjects[classKey] || [];

        try {
          // Match the existing live row by studentId alone: it is the stable FK
          // to bluebell_student.id and there is one live result row per student (all
          // three terms are JSONB columns on it). Filtering by studentClass too
          // made this lookup miss rows whose stored class label had drifted, one
          // way a duplicate got inserted. Order newest-first so the authoritative
          // row wins if legacy duplicates already exist.
          const { data: existingResult, error } = await supabase
            .from("bluebell_result")
            .select("*")
            .eq("studentId", studentId)
            .order("id", { ascending: false });

          if (error) {
            throw error;
          }

          // Show ONLY the current session's live result. A student with no live
          // bluebell_result row starts a fresh entry rather than surfacing a
          // previous-session archived result from bluebell_result_history.
          const effectiveResult = existingResult;

          // Check if we have exactly one result
          if (effectiveResult && effectiveResult.length === 1) {
            const result = effectiveResult[0];
            setFetchedResultId(result.id);

            const isFirstTerm = termFilter === "1st term";
            const isSecondTerm = termFilter === "2nd term";
            const termKey = isFirstTerm
              ? "term1Subjects"
              : isSecondTerm
                ? "term2Subjects"
                : "term3Subjects";

            let rawTermSubjects = result[termKey] || [];
            
            // Normalize and deduplicate subjects
            const normalizedSubjectsMap = new Map();
            
            rawTermSubjects.forEach(subject => {
              const normalizedName = normalizeSubjectName(subject.subjectName);
              const existing = normalizedSubjectsMap.get(normalizedName);
              
              const hasScore = (s) => (
                (s.test && s.test !== "") || 
                (s.project && s.project !== "") || 
                (s.examination && s.examination !== "") ||
                (s.midtermScore && s.midtermScore !== "")
              );
              
              if (!existing) {
                normalizedSubjectsMap.set(normalizedName, { ...subject, subjectName: normalizedName });
              } else {
                // If current has score and existing doesn't, overwrite
                if (hasScore(subject) && !hasScore(existing)) {
                   normalizedSubjectsMap.set(normalizedName, { ...subject, subjectName: normalizedName });
                }
              }
            });
            
            const termSpecificSubjects = Array.from(normalizedSubjectsMap.values());

            // Merge default subjects with result subjects (ensuring no duplicates)
            // We want default subjects first, then any extra subjects from the result
            const resultSubjectNames = termSpecificSubjects.map((sub) => sub.subjectName);
            const mergedSubjects = [...new Set([...defaultSubjects, ...resultSubjectNames])];
            
            // Form teachers keep every subject; subject teachers only their own
            // (plus any of their assigned subjects the list above lacks)
            const scopedSubjects = subjectScoped
              ? [...mergedSubjects.filter(ownsSubject), ...extraOwnedSubjects(studentClassFilter, mergedSubjects)]
              : mergedSubjects;

            setSubjects(scopedSubjects);

            const newScores = scopedSubjects.reduce((acc, subjectName) => {
              const subject = termSpecificSubjects.find(s => s.subjectName === subjectName);

              if (subject) {
                // Determine if the remark is custom or auto by checking against predefined remarks
                const totalScore = parseFloat(subject.test || 0) + 
                  parseFloat(subject.project || 0) + 
                  parseFloat(subject.examination || 0);
                
                const grade = determineGrade(
                  totalScore,
                  getClassLevelGroup(studentClassFilter.toLowerCase())
                );
                
                // Get the predefined remarks for this grade
                const autoRemark = grade && gradeRemarks[grade] ? gradeRemarks[grade] : "";
                
                // Check if the stored remark matches any of the predefined remarks
                const isCustomRemark = subject.remark && subject.remark !== autoRemark;
                
                acc[subjectName] = {
                  test: subject.test || "",
                  project: subject.project || "",
                  examination: subject.examination || "",
                  midtermScore: subject.midtermScore || subject.test || "",
                  remark: subject.remark || "",
                  useCustomRemark: isCustomRemark,
                  customRemark: isCustomRemark ? subject.remark : "",
                };
              } else {
                 // Default empty scores for new/missing subjects
                 acc[subjectName] = { 
                    test: "", 
                    project: "", 
                    examination: "", 
                    midtermScore: "",
                    remark: "", 
                    useCustomRemark: false, 
                    customRemark: "" 
                 };
              }
              return acc;
            }, {});

            const overallKey =
              termFilter === "1st term"
                ? "overall1st"
                : termFilter === "2nd term"
                  ? "overall2nd"
                  : "overall3rd";

            const overallResult = result[overallKey];

            if (overallResult) {
              ["daysPresent", "daysAbsent", "punctuality", "neatness", "honesty", "coOperation",
                "leadership", "helpingOthers", "emotionalStability", "health", "attentiveness",
                "attitudeToSchoolWork", "handWriting", "verbalFrequency", "games",
                "handlingTools", "drawingPainting", "musicalSkills"].forEach((key) => {
                  newScores[key] = { value: overallResult[key] || "" };
              });

              newScores.overallTotalFromDb = overallResult.overallTotal;
              newScores.overallGradeFromDb = overallResult.overallGrade;
              newScores.overallRemarkFromDb = overallResult.overallRemark;
              newScores.overallPrincipalRemarkFromDb = overallResult.overallPrincipalRemark;
              
              const currentSubjects = termSpecificSubjects.map((sub) => sub.subjectName);
              const overallGrade = determineGrade(
                currentSubjects.reduce((sum, subjectName) => {
                  const subject = termSpecificSubjects.find(s => s.subjectName === subjectName);
                  if (subject) {
                    return sum + parseFloat(subject.test || 0) + 
                      parseFloat(subject.project || 0) + 
                      parseFloat(subject.examination || 0);
                  }
                  return sum;
                }, 0) / currentSubjects.length,
                getClassLevelGroup(studentClassFilter.toLowerCase())
              );
              
              const predefinedOverallRemark = overallGrade && gradeRemarks[overallGrade] ? gradeRemarks[overallGrade] : "";
              
              const isCustomOverallRemark = overallResult.overallRemark && overallResult.overallRemark !== predefinedOverallRemark;
              
              newScores.useCustomOverallRemark = isCustomOverallRemark;
              newScores.customOverallRemark = isCustomOverallRemark ? overallResult.overallRemark : "";
            }

            setScores(newScores);
            setTermSubjects({
              term1Subjects: result.term1Subjects || [],
              term2Subjects: result.term2Subjects || [],
              term3Subjects: result.term3Subjects || [],
              overall1st: result.overall1st || {},
              overall2nd: result.overall2nd || {},
              overall3rd: result.overall3rd || {},
            });
          } else if (existingResult && existingResult.length > 1) {
            // Handle multiple results case
            toast.warn("Multiple results found. Using the first result.");
            const result = existingResult[0];
            setFetchedResultId(result.id);

            const isFirstTerm = termFilter === "1st term";
            const isSecondTerm = termFilter === "2nd term";
            const termKey = isFirstTerm
              ? "term1Subjects"
              : isSecondTerm
                ? "term2Subjects"
                : "term3Subjects";

            let rawTermSubjects = result[termKey] || [];
            
            // Normalize and deduplicate subjects
            const normalizedSubjectsMap = new Map();
            
            rawTermSubjects.forEach(subject => {
              const normalizedName = normalizeSubjectName(subject.subjectName);
              const existing = normalizedSubjectsMap.get(normalizedName);
              
              const hasScore = (s) => (
                (s.test && s.test !== "") || 
                (s.project && s.project !== "") || 
                (s.examination && s.examination !== "") ||
                (s.midtermScore && s.midtermScore !== "")
              );
              
              if (!existing) {
                normalizedSubjectsMap.set(normalizedName, { ...subject, subjectName: normalizedName });
              } else {
                // If current has score and existing doesn't, overwrite
                if (hasScore(subject) && !hasScore(existing)) {
                   normalizedSubjectsMap.set(normalizedName, { ...subject, subjectName: normalizedName });
                }
              }
            });
            
            const termSpecificSubjects = Array.from(normalizedSubjectsMap.values());

            // Merge default subjects with result subjects (ensuring no duplicates)
            // We want default subjects first, then any extra subjects from the result
            const resultSubjectNames = termSpecificSubjects.map((sub) => sub.subjectName);
            const mergedSubjects = [...new Set([...defaultSubjects, ...resultSubjectNames])];
            
            // Form teachers keep every subject; subject teachers only their own
            // (plus any of their assigned subjects the list above lacks)
            const scopedSubjects = subjectScoped
              ? [...mergedSubjects.filter(ownsSubject), ...extraOwnedSubjects(studentClassFilter, mergedSubjects)]
              : mergedSubjects;

            setSubjects(scopedSubjects);

            const newScores = scopedSubjects.reduce((acc, subjectName) => {
              const subject = termSpecificSubjects.find(s => s.subjectName === subjectName);

              if (subject) {
                // Determine if the remark is custom or auto by checking against predefined remarks
                const totalScore = parseFloat(subject.test || 0) + 
                  parseFloat(subject.project || 0) + 
                  parseFloat(subject.examination || 0);
                
                const grade = determineGrade(
                  totalScore,
                  getClassLevelGroup(studentClassFilter.toLowerCase())
                );
                
                // Get the predefined remarks for this grade
                const autoRemark = grade && gradeRemarks[grade] ? gradeRemarks[grade] : "";
                
                // Check if the stored remark matches any of the predefined remarks
                const isCustomRemark = subject.remark && subject.remark !== autoRemark;
                
                acc[subjectName] = {
                  test: subject.test || "",
                  project: subject.project || "",
                  examination: subject.examination || "",
                  remark: subject.remark || "",
                  useCustomRemark: isCustomRemark,
                  customRemark: isCustomRemark ? subject.remark : "",
                  midtermScore: subject.midtermScore || "",
                  midtermGrade: subject.midtermGrade || "",
                };
              } else {
                 // Default empty scores for new/missing subjects
                 acc[subjectName] = { 
                    test: "", 
                    project: "", 
                    examination: "", 
                    remark: "", 
                    useCustomRemark: false, 
                    customRemark: "",
                    midtermScore: "",
                    midtermGrade: ""
                 };
              }
              return acc;
            }, {});

            const overallKey =
              termFilter === "1st term"
                ? "overall1st"
                : termFilter === "2nd term"
                  ? "overall2nd"
                  : "overall3rd";

            const overallResult = result[overallKey];

            if (overallResult) {
              ["daysPresent", "daysAbsent", "punctuality", "neatness", "honesty", "coOperation",
                "leadership", "helpingOthers", "emotionalStability", "health", "attentiveness",
                "attitudeToSchoolWork", "handWriting", "verbalFrequency", "games",
                "handlingTools", "drawingPainting", "musicalSkills"].forEach((key) => {
                  newScores[key] = { value: overallResult[key] || "" };
              });

              newScores.overallTotalFromDb = overallResult.overallTotal;
              newScores.overallGradeFromDb = overallResult.overallGrade;
              newScores.overallRemarkFromDb = overallResult.overallRemark;
              newScores.overallPrincipalRemarkFromDb = overallResult.overallPrincipalRemark;
              
              const currentSubjects = termSpecificSubjects.map((sub) => sub.subjectName);
              const overallGrade = determineGrade(
                currentSubjects.reduce((sum, subjectName) => {
                  const subject = termSpecificSubjects.find(s => s.subjectName === subjectName);
                  if (subject) {
                    return sum + parseFloat(subject.test || 0) + 
                      parseFloat(subject.project || 0) + 
                      parseFloat(subject.examination || 0);
                  }
                  return sum;
                }, 0) / currentSubjects.length,
                getClassLevelGroup(studentClassFilter.toLowerCase())
              );
              
              const predefinedOverallRemark = overallGrade && gradeRemarks[overallGrade] ? gradeRemarks[overallGrade] : "";
              
              const isCustomOverallRemark = overallResult.overallRemark && overallResult.overallRemark !== predefinedOverallRemark;
              
              newScores.useCustomOverallRemark = isCustomOverallRemark;
              newScores.customOverallRemark = isCustomOverallRemark ? overallResult.overallRemark : "";
            }

            setScores(newScores);
            setTermSubjects({
              term1Subjects: result.term1Subjects || [],
              term2Subjects: result.term2Subjects || [],
              term3Subjects: result.term3Subjects || [],
              overall1st: result.overall1st || {},
              overall2nd: result.overall2nd || {},
              overall3rd: result.overall3rd || {},
            });
          } else {
            setFetchedResultId(null);
            // Clear the other-term cache so a later save (after the id is adopted
            // on first insert) can't spread a previously-viewed student's term
            // arrays into this row.
            setTermSubjects({
              term1Subjects: [],
              term2Subjects: [],
              term3Subjects: [],
              overall1st: {},
              overall2nd: {},
              overall3rd: {},
            });
            handleClassChange(studentClassFilter); // Reset the subjects and scores
          }
        } catch (error) {
          toast.error("Error in Response, Reload application! Or Make sure you have selected the correct student, class and term.");
        }
      }
    };

    fetchExistingResult();
  }, [selectedStudent, studentClassFilter, termFilter, studentIdMap]);

  const termOptions = ["1st term", "2nd term", "3rd term"];

  // Update subjects and initialize score structure when student class is selected
  const handleClassChange = (newClass) => {
    setStudentClassFilter(newClass);
    const classKey = subjectClassKey(newClass);

    const allSubjects = schoolSubjects[classKey] || [];
    // A subject teacher only edits the subjects assigned to them FOR THIS
    // class. Computed from newClass (not the stale subjectScoped value, which
    // still reflects the previously selected class).
    const ownedFor = scope && !scope.isGeneral && !isFormTeacherIn(newClass)
      ? ownedSubjectsIn(newClass)
      : null;
    const newSubjects =
      ownedFor === null
        ? allSubjects
        : [
            ...allSubjects.filter((s) => ownedFor.some((o) => normSub(o) === normSub(s))),
            // their assignment may name a subject this class does not list
            ...extraOwnedSubjects(newClass, allSubjects),
          ];
    setSubjects(newSubjects);

    const classLevelGroup = getClassLevelGroup(classKey);
    
    const newScores = newSubjects.reduce((acc, subject) => {
      // Use same structure for all class levels
      acc[subject] = { test: "", project: "", examination: "", remark: "", useCustomRemark: false, customRemark: "", midtermScore: "", midtermGrade: "" };
      return acc;
    }, {});
    
    // Add overall evaluation fields
    newScores.useCustomOverallRemark = false;
    newScores.customOverallRemark = "";
    
    setScores(newScores);
  }

  // Deep-link seeding from My Classes (/results?class=Year%205&subject=Maths):
  // map the assignment-style label to the picker's legacy spelling via normCls
  // and preselect it, once, when scope resolves. Params outside the teacher's
  // assignment are ignored (picker falls back to its defaults).
  // useSearchParams needs the Suspense boundary added in app/(staff)/results.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!scope || seedRef.current) return;
    seedRef.current = true;
    const clsParam = (searchParams.get("class") || "").trim();
    if (!clsParam) return;
    const match = (scope.allClasses || [])
      .map((c) => legacyClassOption(c))
      .find((x) => x && normCls(x) === normCls(clsParam));
    if (match && match !== studentClassFilter) handleClassChange(match);
    // ?subject= has no dedicated state on this page (the grid lists every
    // subject of the class, already trimmed to what the teacher owns), so it
    // is used as a one-shot highlight: resolve the param to the grid's own
    // spelling and pulse that row once the table has rendered.
    const subParam = (searchParams.get("subject") || "").trim();
    if (match && subParam && ownsSubjectIn(match, subParam)) {
      const list = getSubjectListForClass(match) || [];
      setFocusSubject(list.find((s) => normSub(s) === normSub(subParam)) || subParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, searchParams]);

  // Deep-linked subject highlight: scroll the row into view, then clear.
  useEffect(() => {
    if (!focusSubject) return;
    if (subjects.length) {
      const cell = [...document.querySelectorAll(".res-subject-cell")].find(
        (td) => normSub(td.textContent || "") === normSub(focusSubject)
      );
      cell?.closest("tr")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const t = setTimeout(() => setFocusSubject(""), 3200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSubject, subjects]);


  const handleInputChange = (field, key, value) => {
    // Cap the score fields at the marks they can hold, and remember which cell was
    // capped so the teacher can see why the number changed under the cursor
    const capped = clampScore(key, value);
    setClampedCells((prev) => {
      const cellKey = `${field}::${key}`;
      if (!capped.clamped) {
        if (!prev[cellKey]) return prev;
        const cleared = { ...prev };
        delete cleared[cellKey];
        return cleared;
      }
      return { ...prev, [cellKey]: SCORE_MAX[key] };
    });

    setScores((prevScores) => {
      let newScores;
      
      // If key is empty string, treat as a simple value assignment
      if (key === "") {
        newScores = {
          ...prevScores,
          [field]: value,
        };
      } else {
        // Otherwise, treat as a nested object property
        newScores = {
          ...prevScores,
          [field]: {
            ...prevScores[field],
            [key]: capped.value,
          }
        };
      }
      
      console.log("Updated scores:", newScores);
      return newScores;
    });
  }

  // Props for a score cell: the allowed maximum plus the warning styling that
  // stays on the input until the teacher edits it again
  const scoreCellProps = (subject, key) => {
    const max = SCORE_MAX[key];
    const cappedAt = clampedCells[`${subject}::${key}`];
    return {
      max: max !== undefined ? max : undefined,
      min: max !== undefined ? 0 : undefined,
      style: cappedAt
        ? { borderColor: "#dc3545", boxShadow: "0 0 0 2px rgba(220, 53, 69, 0.2)" }
        : undefined,
      title: cappedAt
        ? `Capped at ${max} marks — a ${key} entry cannot hold more`
        : max !== undefined
          ? `Maximum ${max} marks`
          : undefined,
    };
  };
  const calculateTotal = (subjectScores, classLevelGroup) => {
    // For all classes including early years: Test + Project + Examination = Total
    const test = parseFloat(subjectScores.test || 0);
    const project = parseFloat(subjectScores.project || 0);
    const examination = parseFloat(subjectScores.examination || 0);
    return test + project + examination;
  }
  const determineGrade = (total, classLevelGroup) => {
    // Use primary/secondary grading system for all levels
    if (total >= 96) return "A+";
    if (total >= 86) return "A";
    if (total >= 80) return "B+";
    if (total >= 70) return "B";
    if (total >= 66) return "C+";
    if (total >= 56) return "C";
    if (total >= 46) return "D";
    return "E";
  }

  const calculateMidtermGrade = (score) => {
    score = parseFloat(score || 0);
    if (score >= 29) return "A+";
    if (score >= 26) return "A";
    if (score >= 24) return "B+";
    if (score >= 21) return "B";
    if (score >= 20) return "C+";
    if (score >= 17) return "C";
    if (score >= 14) return "D";
    return "E";
  };

  const calculateOverallTotal = (studentClass) => {
    // Use the correct class name for determining the level group
    const classLevelGroup = getClassLevelGroup(studentClass.toLowerCase());
    return subjects.reduce((sum, subject) => {
      return sum + calculateTotal(scores[subject], classLevelGroup);
    }, 0);
  }
  const calculateOverallGrade = (studentClass) => {
    // Use the correct class name for determining the level group
    const classLevelGroup = getClassLevelGroup(studentClass.toLowerCase());
    const overallTotal = calculateOverallTotal(studentClass);
    const average = subjects.length > 0 ? overallTotal / subjects.length : 0;
    
    if (purpose === 'midterm') {
      return calculateMidtermGrade(Math.round(average));
    }

    return determineGrade(average, classLevelGroup);
  }
  const overallRemark = (studentClass) => {
    const grade = calculateOverallGrade(studentClass);
    // Check if grade exists in gradeRemarks before accessing
    if (grade && gradeRemarks[grade]) {
      return gradeRemarks[grade];
    }
    return "";
  }
  
  const overallPrincipalRemark = (studentClass) => {
    const grade = calculateOverallGrade(studentClass);
    // Check if grade exists in gradeRemarks before accessing
    if (grade && gradeRemarks[grade]) {
      return gradeRemarks[grade];
    }
    return "";
  }

  const gradeRemarks = {
    "A+": "Excellent",
    "A": "Very Good",
    "B+": "Good",
    "B": "Satisfactory",
    "C+": "Fair",
    "C": "Average",
    "D": "Below Average",
    "E": "Poor"
  }

  const fetchStudentToken = async (studentName, studentClass) => {
    console.log(`Fetching token for student: ${studentName}, class: ${studentClass}`);
    // Don't add spaces to class names - they should match the database format
    try {
      // First try with the class from studentIdMap if available
      const studentInfo = getStudentInfo(studentName);
      if (studentInfo && studentInfo.class) {
        const { data: data1, error: error1 } = await supabase
          .from("bluebell_student")
          .select("token")
          .eq("name", studentName)
          .eq("class", studentInfo.class);
        
        if (data1 && data1.length > 0 && !error1) {
          const token = data1[0]?.token || null;
          
          if (!token) {
            toast.warn("Student found but no token assigned. Please contact administrator.");
            return null;
          }
          return token;
        }
      }

      // If that didn't work, try exact match with provided class
      let { data, error } = await supabase
        .from("bluebell_student")
        .select("token")
        .eq("name", studentName)
        .eq("class", studentClass);

      // If still no results found, try case-insensitive match for the class
      if ((!data || data.length === 0) && !error) {
        const { data: caseInsensitiveData, error: caseInsensitiveError } = await supabase
          .from("bluebell_student")
          .select("token")
          .eq("name", studentName)
          .ilike("class", studentClass); // ilike for case-insensitive match
        
        if (!caseInsensitiveError) {
          data = caseInsensitiveData;
          error = caseInsensitiveError;
        }
      }

      if (error) {
        throw error;
      }

      // Check if we have exactly one result
      if (data && data.length === 1) {
        const token = data[0]?.token || null;
        
        if (!token) {
          toast.warn("Student found but no token assigned. Please contact administrator.");
          return null;
        }
        return token;
      } else if (data && data.length > 1) {
        // Handle multiple results case
        toast.warn("Multiple students found with the same name and class. Using the first result.");
        const token = data[0]?.token || null;
        if (!token) {
          toast.warn("Student found but no token assigned. Please contact administrator.");
          return null;
        }
        return token;
      } else {
        // No results found
        toast.warn("No student found with the given name and class.");
        return null;
      }
    } catch (error) {
      toast.error("Error fetching student token: " + error.message);
      return null;
    }
  }

  const uploadResults = async () => {
    if (!selectedStudent || !studentClassFilter || !termFilter) {
      toast.warn("Please fill in all fields before uploading results.");
      return;
    }

    const studentInfo = getStudentInfo(selectedStudent);
    if (!studentInfo) {
      toast.error("Please select a valid student.");
      return;
    }

    // Set loading state
    setIsUploading(true);

    const studentId = studentInfo.id;
    // Use the class from studentIdMap for consistency with database
    const studentClass = studentInfo.class || studentClassFilter;

    // Fetch the token for the selected student and class
    const token = await fetchStudentToken(selectedStudent, studentClass);
    if (!token) {
      // The specific error message is now handled in fetchStudentToken
      setIsUploading(false);
      return;
    }

    const termKey =
      termFilter === "1st term"
        ? "term1Subjects"
        : termFilter === "2nd term"
          ? "term2Subjects"
          : "term3Subjects";

    const termSubjectsToUpload = subjects.map((subject) => {
      const subjectScores = scores[subject] || {};
      // Use the correct class name for determining the level group
      const classLevelGroup = getClassLevelGroup(studentClass.toLowerCase());
      
      // Determine which remark to save based on user selection
      let remarkToSave = "";
      if (subjectScores.useCustomRemark) {
        remarkToSave = subjectScores.customRemark ?? "";
      } else {
        const autoGrade = purpose === "midterm"
          ? calculateMidtermGrade(subjectScores.midtermScore)
          : determineGrade(calculateTotal(subjectScores, classLevelGroup), classLevelGroup);
        remarkToSave = gradeRemarks[autoGrade] ?? "";
      }

      if (purpose === "midterm") {
          const midtermScore = subjectScores.midtermScore ?? "";
          const midtermGrade = calculateMidtermGrade(midtermScore);
          return {
            subjectName: subject,
            test: midtermScore, // Map midterm score to test field for compatibility
            project: "0",
            examination: "0",
            total: midtermScore, // Total is just the score for now
            grade: midtermGrade,
            remark: remarkToSave,
            midtermScore: midtermScore,
            midtermGrade: midtermGrade
          };
      } else {
          // For all classes, we save test, project, examination with calculated total and grade
          const total = calculateTotal(subjectScores, classLevelGroup);
          
          return {
            subjectName: subject,
            test: subjectScores.test ?? "0",
            project: subjectScores.project ?? "0",
            examination: subjectScores.examination ?? "0",
            total: total,
            grade: determineGrade(total, classLevelGroup),
            remark: remarkToSave,
            midtermScore: subjectScores.midtermScore ?? "", // Keep existing if needed
            midtermGrade: calculateMidtermGrade(subjectScores.midtermScore) // Keep existing if needed
          };
      }
    });
    
    // ---- scope enforcement --------------------------------------------------
    // `termSubjectsToUpload` only ever holds the subjects this teacher owns (the
    // editable grid was filtered above), so this is a pre-flight check that
    // nothing outside the assignment is being written.
    const guard = resultSubjectGuard(scope, studentClass, termSubjectsToUpload.map((s) => s.subjectName));
    if (!guard.ok) {
      toast.error(guard.reason);
      setIsUploading(false);
      return;
    }
    
    // Merge into the stored term array so the other teachers' subject rows
    // survive: rebuild each owned entry in place, then append owned subjects
    // that were not stored yet.
    const storedTermSubjects = (termSubjects && termSubjects[termKey]) || [];
    const mergedTermSubjects = storedTermSubjects.map((entry) => {
      if (!ownsSubjectIn(studentClass, entry.subjectName)) return entry;
      const rebuilt = termSubjectsToUpload.find(
        (s) => normSub(s.subjectName) === normSub(entry.subjectName)
      );
      return rebuilt || entry;
    });
    const notStoredYet = termSubjectsToUpload.filter(
      (s) => !storedTermSubjects.some((e) => normSub(e.subjectName) === normSub(s.subjectName))
    );
    const termSubjectsWritten = [...mergedTermSubjects, ...notStoredYet];
    
    const overallKey =
      termFilter === "1st term"
        ? "overall1st"
        : termFilter === "2nd term"
          ? "overall2nd"
          : "overall3rd";

    // Determine which overall remark to save based on user selection
    let overallRemarkToSave = "";
    if (scores.useCustomOverallRemark) {
      overallRemarkToSave = scores.customOverallRemark || "";
    } else {
      overallRemarkToSave = overallRemark(studentClass);
    }
    
    // Determine which principal remark to save based on user selection
    let overallPrincipalRemarkToSave = "";
    if (scores.useCustomPrincipalRemark) {
      overallPrincipalRemarkToSave = scores.customPrincipalRemark || "";
    } else {
      overallPrincipalRemarkToSave = overallPrincipalRemark(studentClass);
    }
    
    const termOverallToUpload = {
      overallTotal: calculateOverallTotal(studentClass),
      overallGrade: calculateOverallGrade(studentClass),
      overallRemark: overallRemarkToSave,
      overallPrincipalRemark: overallPrincipalRemarkToSave,
      daysPresent: scores["daysPresent"]?.value || "0",
      daysAbsent: scores["daysAbsent"]?.value || "0",
      punctuality: scores["punctuality"]?.value || "",
      neatness: scores["neatness"]?.value || "",
      honesty: scores["honesty"]?.value || "",
      coOperation: scores["coOperation"]?.value || "",
      leadership: scores["leadership"]?.value || "",
      helpingOthers: scores["helpingOthers"]?.value || "",
      emotionalStability: scores["emotionalStability"]?.value || "",
      health: scores["health"]?.value || "",
      attentiveness: scores["attentiveness"]?.value || "",
      attitudeToSchoolWork: scores["attitudeToSchoolWork"]?.value || "",
      handWriting: scores["handWriting"]?.value || "",
      verbalFrequency: scores["verbalFrequency"]?.value || "",
      games: scores["games"]?.value || "",
      handlingTools: scores["handlingTools"]?.value || "",
      drawingPainting: scores["drawingPainting"]?.value || "",
      musicalSkills: scores["musicalSkills"]?.value || "",
      debitAmount: scores["debitAmount"]?.value || "",
    }

    const updatedResultData = {
      studentId,
      studentName: selectedStudent,
      studentClass: studentClass, // Use the correct class name from studentIdMap
      // Preserve data for other terms when updating
      ...(fetchedResultId && {
        term1Subjects: (termFilter === "1st term") ? termSubjectsWritten : (termSubjects.term1Subjects || []),
        term2Subjects: (termFilter === "2nd term") ? termSubjectsWritten : (termSubjects.term2Subjects || []),
        term3Subjects: (termFilter === "3rd term") ? termSubjectsWritten : (termSubjects.term3Subjects || []),
        // Class-wide aggregates stay with the form teacher: a subject teacher's
        // save must preserve them, never recompute them from a few subjects.
        overall1st: (termFilter === "1st term")
          ? (subjectScoped ? (termSubjects.overall1st || {}) : termOverallToUpload)
          : (termSubjects.overall1st || {}),
        overall2nd: (termFilter === "2nd term")
          ? (subjectScoped ? (termSubjects.overall2nd || {}) : termOverallToUpload)
          : (termSubjects.overall2nd || {}),
        overall3rd: (termFilter === "3rd term")
          ? (subjectScoped ? (termSubjects.overall3rd || {}) : termOverallToUpload)
          : (termSubjects.overall3rd || {}),
      }),
      // If creating new record, only set data for current term
      ...(!fetchedResultId && {
        [termKey]: termSubjectsWritten,
        [overallKey]: subjectScoped ? (termSubjects[overallKey] || {}) : termOverallToUpload,
      }),
      token
    }

    try {
      if (fetchedResultId) {
        // Update record
        const { error } = await supabase
          .from("bluebell_result")
          .update(updatedResultData)
          .eq("id", fetchedResultId);

        if (error) {
          toast.error("Error in Response, Reload application! ");
          setIsUploading(false);
          return;
        }
        
        // Send email notification for updated results
        const emailSubject = 'Student Result Updated';
        const currentUserEmail = getCurrentUserEmail();
        
        const detailedScores = termSubjectsToUpload.map(s => {
          if (purpose === "midterm") {
             return `${s.subjectName}: Midterm=${s.midtermScore || '-'}`;
          } else {
             return `${s.subjectName}: Test=${s.test||'-'}, Proj=${s.project||'-'}, Exam=${s.examination||'-'}, Total=${s.total}, Grade=${s.grade}`;
          }
        }).join('\n');

        const emailMessage = `Student result has been updated by ${getCurrentUserName() || currentUserEmail || 'a staff member'}:

Student Name: ${selectedStudent}
Class: ${studentClass}
Term: ${termFilter}
Number of Subjects: ${termSubjectsToUpload.length} of ${termSubjectsWritten.length} in the record

Updated Scores:
${detailedScores}`;

            // Delivered to the addresses this school configures — see src/utils/resultRecipients.js
    const recipients = await resolveResultRecipients(supabase);
        await sendEmailNotification(supabase, emailSubject, emailMessage, recipients);
        
        toast.success("Results updated successfully!");

        // Audit: result updated
        logAction(supabase, {
          email: getCurrentUserEmail(),
          name: getCurrentUserName(),
          role: "staff",
          action: "result_update",
          targetTable: "bluebell_result",
          recordId: fetchedResultId,
          details: { studentName: selectedStudent, class: studentClass, term: termFilter, editedSubjects: termSubjectsToUpload.length, totalSubjects: termSubjectsWritten.length },
        });
      } else {
        // Create new record
        const { data: created, error } = await supabase
          .from("bluebell_result")
          .insert([updatedResultData])
          .select("id");

        if (error) {
          toast.error("Error in Response, Reload application! ");
          setIsUploading(false);
          return;
        }

        // Adopt the new row's id so a subsequent Save on the same form updates
        // this record instead of inserting another duplicate.
        if (created && created[0] && created[0].id != null) {
          setFetchedResultId(created[0].id);
        }
        
        // Send email notification for new results
        const emailSubject = 'New Student Result Uploaded';
        const currentUserEmail = getCurrentUserEmail();
        
        const detailedScores = termSubjectsToUpload.map(s => {
          if (purpose === "midterm") {
             return `${s.subjectName}: Midterm=${s.midtermScore || '-'}`;
          } else {
             return `${s.subjectName}: Test=${s.test||'-'}, Proj=${s.project||'-'}, Exam=${s.examination||'-'}, Total=${s.total}, Grade=${s.grade}`;
          }
        }).join('\n');

        const emailMessage = `New student result has been uploaded by ${getCurrentUserName() || currentUserEmail || 'a staff member'}:

Student Name: ${selectedStudent}
Class: ${studentClass}
Term: ${termFilter}
Number of Subjects: ${termSubjectsToUpload.length} of ${termSubjectsWritten.length} in the record

Scores:
${detailedScores}`;

            // Delivered to the addresses this school configures — see src/utils/resultRecipients.js
    const recipients = await resolveResultRecipients(supabase);
        await sendEmailNotification(supabase, emailSubject, emailMessage, recipients);
        
        toast.success("Results uploaded successfully!");

        // Audit: result uploaded
        logAction(supabase, {
          email: getCurrentUserEmail(),
          name: getCurrentUserName(),
          role: "staff",
          action: "result_upload",
          targetTable: "bluebell_result",
          details: { studentName: selectedStudent, class: studentClass, term: termFilter, editedSubjects: termSubjectsToUpload.length, totalSubjects: termSubjectsWritten.length },
        });
      }
    } catch (err) {
      toast.error("Error in Response, Reload application! ");
      setIsUploading(false);
      return;
    } finally {
      // Reset loading state
      setIsUploading(false);
    }
  }

  // Function to update the `uploadResult` field in Supabase
  const finalizeAndPublishResult = async () => {
    if (!fetchedResultId) {
      toast.warn("No result has been uploaded yet to finalize.");
      return;
    }

    try {
      // First, get the result details for the email notification
      const { data: resultData, error: fetchError } = await supabase
        .from("bluebell_result")
        .select("studentName, studentClass, term1Subjects, term2Subjects, term3Subjects")
        .eq("id", fetchedResultId)
        .single();

      if (fetchError) throw fetchError;

      const { /* data, */ error } = await supabase
        .from("bluebell_result")
        .update({ uploadResult: true })
        .eq("id", fetchedResultId);

      if (error) throw error;
      
      // Determine which term has data
      let termInfo = "Unknown Term";
      let termSubjects = [];
      if (resultData.term1Subjects && resultData.term1Subjects.length > 0) {
        termInfo = "1st term";
        termSubjects = resultData.term1Subjects;
      } else if (resultData.term2Subjects && resultData.term2Subjects.length > 0) {
        termInfo = "2nd term";
        termSubjects = resultData.term2Subjects;
      } else if (resultData.term3Subjects && resultData.term3Subjects.length > 0) {
        termInfo = "3rd term";
        termSubjects = resultData.term3Subjects;
      }
      
      // Send email notification for published results
      const emailSubject = 'Student Result Published';
      const currentUserEmail = getCurrentUserEmail();
      const emailMessage = `Student result has been published by ${getCurrentUserName() || currentUserEmail || 'a staff member'}:

Student Name: ${resultData.studentName}
Class: ${resultData.studentClass}
Term: ${termInfo}
Number of Subjects: ${termSubjects.length}`;
      await sendEmailNotification(supabase, emailSubject, emailMessage);
      
      toast.success("Result finalized and Uploaded");
    } catch (error) {
      toast.error("Error finalizing result: " + error.message);
    }
  }

  const handleClosePreviewModal = () => setShowPreviewModal(false);

  return (
    <div>
      {/* <NavbarComponent /> */}
      <ToastContainer />
      <div className="res-page">
        {/* Page header */}
        <div className="res-head">
          <div>
            <h1 className="res-title">
              <span className="res-title-ic"><RiUploadCloud2Line /></span> Upload Results Session
            </h1>
            <p className="res-sub">Record, review and publish student results for each term.</p>
          </div>
          <div className="res-pills">
            {studentClassFilter && (
              <span className="res-pill"><RiGraduationCapLine /> {studentClassFilter}</span>
            )}
            {termFilter && (
              <span className="res-pill"><RiTimeLine /> {termFilter}</span>
            )}
            <span className="res-pill alt">
              {purpose === "midterm" ? "Midterm Result" : "Full Term Result"}
            </span>
          </div>
        </div>

        {/* Session toolbar — student, class, term and result type */}
        <div className="res-session">
          <div className="res-field">
            <label htmlFor="studentsAutocomplete" className="res-label">
              <RiUserLine /> Student Name
            </label>
            <select
              id="studentsAutocomplete"
              className="res-input"
              value={selectedStudent}
              onChange={(e) => setSelectedStudent(e.target.value)}
              disabled={!studentClassFilter}
            >
              <option value="">{studentClassFilter ? "Select student name" : "Select a class first"}</option>
              {pickerStudents.map((studentName, index) => (
                <option key={index} value={studentName}>
                  {studentName}
                </option>
              ))}
              {selectedStudent && !pickerStudents.includes(selectedStudent) && (
                <option value={selectedStudent}>{selectedStudent}</option>
              )}
            </select>
          </div>

          <div className="res-field">
            <label htmlFor="classAutocomplete" className="res-label">
              <RiGraduationCapLine /> Class
            </label>
            <select
              id="classAutocomplete"
              className="res-input"
              value={studentClassFilter}
              onChange={(e) => handleClassChange(e.target.value)}
            >
              <option value="">Select Student Class</option>
              {classOptions.map((classOption, index) => (
                <option key={index} value={classOption}>
                  {classOption}
                </option>
              ))}
            </select>
          </div>

          <div className="res-field">
            <label htmlFor="termAutocomplete" className="res-label">
              <RiTimeLine /> Term
            </label>
            <select
              id="termAutocomplete"
              className="res-input"
              value={termFilter}
              onChange={(e) => setTermFilter(e.target.value)}
            >
              <option value="">Select Term</option>
              {termOptions.map((term, index) => (
                <option key={index} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </div>

          <div className="res-field">
            <span className="res-label"><RiStarLine /> Result Type</span>
            <div className="res-seg" role="group" aria-label="Result type">
              <button
                type="button"
                className={`res-seg-btn${purpose === "fullterm" ? " active" : ""}`}
                onClick={() => setPurpose("fullterm")}
              >
                Full Term
              </button>
              <button
                type="button"
                className={`res-seg-btn${purpose === "midterm" ? " active" : ""}`}
                onClick={() => setPurpose("midterm")}
              >
                Midterm
              </button>
            </div>
          </div>
        </div>

        {/* Role-aware action bar */}
        <div className="res-actions">
          {(userAuth && userAuth.some && userAuth.some(auth => auth.email === user?.user_metadata?.email)) && (
            <button className="res-btn green" onClick={finalizeAndPublishResult}>
              <RiCheckLine /> Finish & Publish Result
            </button>
          )}
          <button
            className="res-btn primary"
            onClick={uploadResults}
            disabled={isUploadButtonDisabled || isUploading}
          >
            {isUploading ? (
              <>
                <Spinner animation="border" size="sm" /> Uploading...
              </>
            ) : (
              <>
                <RiUploadCloud2Line /> Upload Results
              </>
            )}
          </button>
          {canManageResultActions && (
            <>
              <button
                className="res-btn amber"
                onClick={() => setShowPreviewModal(true)} // Open the preview modal
                disabled={!selectedStudent || !studentClassFilter || !termFilter}
              >
                <RiEyeLine /> Preview Result
              </button>
              <button
                className={`res-btn soft${showRecordedChart ? " on" : ""}`}
                onClick={() => setShowRecordedChart(!showRecordedChart)} // Toggle the chart panel
              >
                <RiBarChart2Line /> {showRecordedChart ? "Hide Recorded vs Not Recorded" : "Recorded vs Not Recorded"}
              </button>
              <button
                className={`res-btn soft${showCompleteness ? " on" : ""}`}
                onClick={() => setShowCompleteness(!showCompleteness)} // Toggle the completeness panel
              >
                <RiGroupLine /> {showCompleteness ? "Hide Result Completeness" : "Result Completeness"}
              </button>
              <button
                className="res-btn blue"
                onClick={() => setShowExportModal(true)}
              >
                <FaFileExcel /> Export Results
              </button>
            </>
          )}
        </div>
        
        {(showRecordedChart || showCompleteness) && (
          <div className="res-progress">
            <div className="res-progress-grid">
              {showRecordedChart && (
              <div className="res-card">
                <div className="res-card-head">
                  <RiBarChart2Line /> Recorded vs Not Recorded
                  <span className="res-card-sub">
                    {termFilter ? `${termFilter} • ${purpose === "midterm" ? "Midterm" : "Full Term"}` : "Select a term"}
                  </span>
                </div>
                {classStats.length === 0 ? (
                  <div className="res-empty">
                    {termFilter
                      ? "No classes with enrolled students yet."
                      : "Select a term above to load class statistics."}
                  </div>
                ) : (
                  <div className="res-chartbox">
                    <Bar data={completionChart} options={completionChartOptions} />
                  </div>
                )}
              </div>
              )}
              {showCompleteness && (
              <div className="res-card">
                <div className="res-card-head">
                  <RiGroupLine /> Result Completeness
                  <select
                    className="res-mini-select"
                    value={activeStatsClass}
                    onChange={(e) => setStatsClass(e.target.value)}
                  >
                    {classStats.map((s) => (
                      <option key={s.className} value={s.className}>
                        {s.className} ({s.resultsUploaded}/{s.totalPupils} recorded)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="res-stulist">
                  {statsStudents.length === 0 && (
                    <div className="res-empty">No students found for this class yet.</div>
                  )}
                  {statsStudents.map((st) => (
                    <div key={st.name} className="res-stu">
                      <div className="res-stu-top">
                        <span className="res-stu-name">{st.name}</span>
                        {st.recorded && st.percent >= 100 ? (
                          <span className="res-badge ok"><RiCheckLine /> Complete</span>
                        ) : st.recorded && st.percent > 0 ? (
                          <span className="res-badge part"><RiInformationLine /> {st.scoredCount}/{st.subjectCount} subjects</span>
                        ) : (
                          <span className="res-badge none"><RiCloseLine /> Not recorded</span>
                        )}
                      </div>
                      <div className="res-bar">
                        <div
                          className={`res-bar-fill${st.recorded && st.percent >= 100 ? " ok" : ""}`}
                          style={{ width: `${Math.max(st.percent, 2)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </div>
          </div>
        )}

        
        <Modal show={showExportModal} onHide={() => setShowExportModal(false)} centered contentClassName="res-modal-content">
          <div className="res-modal-head">
            <div className="t"><FaFileExcel /> Export Results to Excel</div>
            <div className="s">Download recorded results as a spreadsheet.</div>
          </div>
          <Modal.Body className="res-modal-body">
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Select Term</Form.Label>
                  <Form.Select value={exportTerm} onChange={(e) => setExportTerm(e.target.value)}>
                    <option value="1st Term">1st Term</option>
                    <option value="2nd Term">2nd Term</option>
                    <option value="3rd Term">3rd Term</option>
                  </Form.Select>
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>Result Type</Form.Label>
                  <Form.Select value={exportType} onChange={(e) => setExportType(e.target.value)}>
                    <option value="midterm">Midterm</option>
                    <option value="general">General Exam</option>
                  </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Scope</Form.Label>
                  <Form.Select value={exportScope} onChange={(e) => setExportScope(e.target.value)}>
                    <option value="all">All Students</option>
                    <option value="individual">Individual Student</option>
                  </Form.Select>
                </Form.Group>

                {exportScope === 'individual' && (
                  <>
                  <Form.Group className="mb-3">
                    <Form.Label>Class</Form.Label>
                    <Form.Select
                      value={exportClass}
                      onChange={(e) => { setExportClass(e.target.value); setExportClassTouched(true); setExportStudentName(""); }}
                    >
                      {scopedClassOptions.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Student Name</Form.Label>
                    <Form.Select
                      value={exportStudentName}
                      onChange={(e) => setExportStudentName(e.target.value)}
                      disabled={!exportClass}
                    >
                      <option value="">{exportClass ? "Select student name" : "Select a class first"}</option>
                      {exportClassStudents.map((studentName, index) => (
                        <option key={index} value={studentName}>{studentName}</option>
                      ))}
                      {exportStudentName && !exportClassStudents.includes(exportStudentName) && (
                        <option value={exportStudentName}>{exportStudentName}</option>
                      )}
                    </Form.Select>
                  </Form.Group>
                  </>
                )}
              </Form>
          </Modal.Body>
          <div className="res-modal-foot">
            <button className="res-cancel" onClick={() => setShowExportModal(false)}>
              Cancel
            </button>
            <button className="res-btn primary" onClick={handleExport}>
              <RiDownloadLine /> Export
            </button>
          </div>
        </Modal>

        <div className="res-card res-tablecard">
          <div className="res-card-head">
            <RiClipboardLine /> {purpose === "midterm" ? "Midterm Scores" : "Subject Scores"}
            <span className="res-card-sub">{selectedStudent ? selectedStudent : "Select a student to enter scores"}</span>
          </div>
          <div className="res-tablewrap">
        <table className="table res-table">
          <thead>
            <tr>
              <th>Subject</th>
              {purpose === "midterm" ? (
                <>
                  <th>Midterm Score (30)</th>
                  <th>Grade</th>
                  <th>Teacher&apos;s Remark</th>
                </>
              ) : (
                <>
                  <th>Test</th>
                  <th>Project</th>
                  <th>Examination</th>
                  <th>Total (100)</th>
                  <th>Grade</th>
                  <th>Teacher&apos;s Remark</th>
                </>
              )}
            </tr>
          </thead><tbody>
            {subjects.map((subject) => (
              <tr
                key={subject}
                className={focusSubject && normSub(subject) === normSub(focusSubject) ? "res-row-focus" : ""}
              >
                <td className="res-subject-cell">{subject}</td>
                {purpose === "midterm" ? (
                  <>
                    <td>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="Score (30)"
                        {...scoreCellProps(subject, "midtermScore")}
                        value={scores[subject]?.midtermScore ?? ""}
                        onChange={(e) =>
                          handleInputChange(subject, "midtermScore", e.target.value)
                        }
                      />
                    </td>
                    <td><span className="res-grade-chip">{calculateMidtermGrade(scores[subject]?.midtermScore)}</span></td>
                    <td>
                      <div className="d-flex flex-column gap-2">
                        <div className="d-flex gap-3">
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="radio"
                              name={`remarkType-${subject}`}
                              id={`autoRemark-${subject}`}
                              checked={!scores[subject]?.useCustomRemark}
                              onChange={() => handleInputChange(subject, "useCustomRemark", false)}
                            />
                            <label className="form-check-label" htmlFor={`autoRemark-${subject}`}>
                              Auto
                            </label>
                          </div>
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="radio"
                              name={`remarkType-${subject}`}
                              id={`customRemark-${subject}`}
                              checked={scores[subject]?.useCustomRemark}
                              onChange={() => handleInputChange(subject, "useCustomRemark", true)}
                            />
                            <label className="form-check-label" htmlFor={`customRemark-${subject}`}>
                              Custom
                            </label>
                          </div>
                        </div>
                        
                        {!scores[subject]?.useCustomRemark && (
                          <p className="res-auto-remark" style={{ margin: 0 }}>
                            {gradeRemarks[calculateMidtermGrade(scores[subject]?.midtermScore)] || "\u2014"}
                          </p>
                        )}
                        
                        {scores[subject]?.useCustomRemark && (
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Enter custom remark"
                            value={scores[subject]?.customRemark || ""}
                            onChange={(e) =>
                              handleInputChange(subject, "customRemark", e.target.value)
                            }
                          />
                        )}
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="Test (30)"
                        {...scoreCellProps(subject, "test")}
                        value={scores[subject]?.test ?? ""}
                        onChange={(e) =>
                          handleInputChange(subject, "test", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="Project (10)"
                        {...scoreCellProps(subject, "project")}
                        value={scores[subject]?.project ?? ""}
                        onChange={(e) =>
                          handleInputChange(subject, "project", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="Examination (60)"
                        {...scoreCellProps(subject, "examination")}
                        value={scores[subject]?.examination ?? ""}
                        onChange={(e) =>
                          handleInputChange(subject, "examination", e.target.value)
                        }
                      />
                    </td>
                    
                      <td className="fw-bold">{calculateTotal(scores[subject], getClassLevelGroup(studentClassFilter.toLowerCase()))}</td>
                    <td><span className="res-grade-chip">{determineGrade(calculateTotal(scores[subject], getClassLevelGroup(studentClassFilter.toLowerCase())), getClassLevelGroup(studentClassFilter.toLowerCase()))}</span></td>
                    <td>
                      <div className="d-flex flex-column gap-2">
                        {/* Radio buttons to choose between auto-generated and custom remark */}
                        <div className="d-flex gap-3">
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="radio"
                              name={`remarkType-${subject}`}
                              id={`autoRemark-${subject}`}
                              checked={!scores[subject]?.useCustomRemark}
                              onChange={() => handleInputChange(subject, "useCustomRemark", false)}
                            />
                            <label className="form-check-label" htmlFor={`autoRemark-${subject}`}>
                              Auto
                            </label>
                          </div>
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="radio"
                              name={`remarkType-${subject}`}
                              id={`customRemark-${subject}`}
                              checked={scores[subject]?.useCustomRemark}
                              onChange={() => handleInputChange(subject, "useCustomRemark", true)}
                            />
                            <label className="form-check-label" htmlFor={`customRemark-${subject}`}>
                              Custom
                            </label>
                          </div>
                        </div>
                        
                        {/* Show auto-generated remarks dropdown when auto is selected */}
                        {!scores[subject]?.useCustomRemark && (
                          <p className="res-auto-remark" style={{ margin: 0 }}>
                            {gradeRemarks[determineGrade(calculateTotal(scores[subject], getClassLevelGroup(studentClassFilter.toLowerCase())), getClassLevelGroup(studentClassFilter.toLowerCase()))] || "\u2014"}
                          </p>
                        )}
                        
                        {/* Show custom remark input when custom is selected */}
                        {scores[subject]?.useCustomRemark && (
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Enter custom remark"
                            value={scores[subject]?.customRemark || ""}
                            onChange={(e) =>
                              handleInputChange(subject, "customRemark", e.target.value)
                            }
                          />
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
          </div>
          {subjects.length === 0 && (
            <div className="res-empty">
              {subjectScoped
                ? `You have no subject assigned for ${studentClassFilter || "this class"} — ask the administrator to assign you one under Staff Assignments.`
                : "Select a class to load its subjects."}
            </div>
          )}
        </div>
        {/* Whole-class fields: totals, remarks, traits and attendance belong to
            the form teacher, so a subject teacher never sees these inputs. */}
        {!subjectScoped && (
        <div className="res-card res-overall mt-4">
          <div className="res-card-head"><RiAwardLine /> Overall Summary</div>
          <div className="res-overall-tops">
            <div className="res-statbox"><span className="k">Overall Total</span><span className="v">{scores?.overallTotalFromDb || calculateOverallTotal(studentClassFilter)}</span></div>
            <div className="res-statbox"><span className="k">Overall Grade</span><span className="v">{scores?.overallGradeFromDb || calculateOverallGrade(studentClassFilter)}</span></div>
          </div>
          <div className="res-remark">
            <h5>Teacher&apos;s Remark</h5>
    {/* Radio buttons to choose between auto-generated and custom overall remark */}
    <div className="d-flex gap-3">
      <div className="form-check">
        <input
          className="form-check-input"
          type="radio"
          name="overallRemarkType"
          id="autoOverallRemark"
          checked={!scores?.useCustomOverallRemark || scores?.useCustomOverallRemark === undefined ? true : !scores.useCustomOverallRemark}
          onChange={() => handleInputChange("useCustomOverallRemark", "", false)}
        />
        <label className="form-check-label" htmlFor="autoOverallRemark">
          Auto
        </label>
      </div>
      <div className="form-check">
        <input
          className="form-check-input"
          type="radio"
          name="overallRemarkType"
          id="customOverallRemark"
          checked={scores?.useCustomOverallRemark || false}
          onChange={() => handleInputChange("useCustomOverallRemark", "", true)}
        />
        <label className="form-check-label" htmlFor="customOverallRemark">
          Custom
        </label>
      </div>
    </div>
    
    {/* Show auto-generated overall remark when auto is selected */}
    {!scores?.useCustomOverallRemark && (
      <p className="res-auto-remark">Auto Teacher&apos;s Remark: {scores?.overallRemarkFromDb || overallRemark(studentClassFilter)}</p>
    )}
    
    {/* Show custom overall remark input when custom is selected */}
    {scores?.useCustomOverallRemark && (
      <input
        type="text"
        className="form-control"
        placeholder="Enter custom teacher remark"
        value={scores?.customOverallRemark || ""}
        onChange={(e) =>
          handleInputChange("customOverallRemark", "", e.target.value)
        }
      />
    )}
  </div>
  
  {/* Principal's Remark Section */}
  <div className="res-remark">
    <h5>Principal&apos;s Remark</h5>
    {/* Radio buttons to choose between auto-generated and custom principal remark */}
    <div className="d-flex gap-3">
      <div className="form-check">
        <input
          className="form-check-input"
          type="radio"
          name="principalRemarkType"
          id="autoPrincipalRemark"
          checked={!scores?.useCustomPrincipalRemark || scores?.useCustomPrincipalRemark === undefined ? true : !scores.useCustomPrincipalRemark}
          onChange={() => handleInputChange("useCustomPrincipalRemark", "", false)}
        />
        <label className="form-check-label" htmlFor="autoPrincipalRemark">
          Auto
        </label>
      </div>
      <div className="form-check">
        <input
          className="form-check-input"
          type="radio"
          name="principalRemarkType"
          id="customPrincipalRemark"
          checked={scores?.useCustomPrincipalRemark || false}
          onChange={() => handleInputChange("useCustomPrincipalRemark", "", true)}
        />
        <label className="form-check-label" htmlFor="customPrincipalRemark">
          Custom
        </label>
      </div>
    </div>
    
    {/* Show auto-generated principal remark when auto is selected */}
    {!scores?.useCustomPrincipalRemark && (
      <p className="res-auto-remark">Auto Principal&apos;s Remark: {scores?.overallPrincipalRemarkFromDb || overallPrincipalRemark(studentClassFilter)}</p>
    )}
    
    {/* Show custom principal remark input when custom is selected */}
    {scores?.useCustomPrincipalRemark && (
      <input
        type="text"
        className="form-control"
        placeholder="Enter custom principal remark"
        value={scores?.customPrincipalRemark || ""}
        onChange={(e) =>
          handleInputChange("customPrincipalRemark", "", e.target.value)
        }
      />
    )}
  </div>
  {/* Enhanced Additional Evaluation Section */}
  <div className="res-additional">
    <div className="res-card-head">
      <RiStarLine /> Additional Evaluation
      <span className="res-hint-inline">Instruction: Rate each trait from 1 to 5</span>
    </div>

    {/* Attendance Section */}
    <div className="res-eval">
      <h5><span className="ic"><RiTimeLine /></span> Attendance</h5>
      <p className="res-hint">
        Auto-filled from the student&apos;s check-in records when the selected term matches the active term in Settings — you can still update it manually if needed.
      </p>
      {studentAttendance.length > 0 && (
        <div className="res-attnd-box">
          <div className="fw-bold">
            Check-in history: {studentAttendance.length} day{studentAttendance.length > 1 ? "s" : ""} recorded this term
          </div>
          <div className="res-attnd-list">
            {studentAttendance.map((a) => (
              <div key={a.id} className="d-flex">
                <span>{a.date}</span>
                <span className="text-muted">{a.check_in_time ? new Date(a.check_in_time).toLocaleTimeString() : ""} ({a.method || "manual"})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="res-grid2">
        <div className="res-field">
          <label htmlFor="daysPresent" className="res-label">Days Present</label>
          <input
            id="daysPresent"
            type="number"
            className="res-input"
            value={scores?.daysPresent?.value ?? ""}
            placeholder="Enter number of days present"
            onChange={(e) => handleInputChange("daysPresent", "value", e.target.value)}
          />
        </div>
        <div className="res-field">
          <label htmlFor="daysAbsent" className="res-label">Days Absent</label>
          <input
            id="daysAbsent"
            type="number"
            className="res-input"
            value={scores?.daysAbsent?.value ?? ""}
            placeholder="Enter number of days absent"
            onChange={(e) => handleInputChange("daysAbsent", "value", e.target.value)}
          />
        </div>
      </div>
    </div>

    {/* Affective Domain Section */}
    <div className="res-eval">
      <h5><span className="ic green"><RiEmotionHappyLine /></span> Affective Domain</h5>
      <div className="res-rate-grid">
      {[
        "punctuality",
        "neatness",
        "honesty",
        "coOperation",
        "leadership",
        "helpingOthers",
        "emotionalStability",
        "health",
        "attentiveness",
        "attitudeToSchoolWork",
      ].map((option) => (
        <div className="res-field" key={option}>
          <label htmlFor={option} className="res-label">
            {option.replace(/_/g, " ")}
          </label>
          <input
            id={option}
            type="number"
            className="res-input"
            value={scores?.[option]?.value ?? ""}
            placeholder={`Rate from 1 to 5`}
            onChange={(e) => handleInputChange(option, "value", e.target.value)}
          />
        </div>
      ))}
      </div>
    </div>

    {/* Psychomotor Domain Section */}
    <div className="res-eval">
      <h5><span className="ic amber"><RiRunLine /></span> Psychomotor Domain</h5>
      <div className="res-rate-grid">
      {[
        "handWriting",
        "verbalFrequency",
        "games",
        "handlingTools",
        "drawingPainting",
        "musicalSkills",
      ].map((option) => (
        <div className="res-field" key={option}>
          <label htmlFor={option} className="res-label">
            {option.replace(/_/g, " ")}
          </label>
          <input
            id={option}
            type="number"
            className="res-input"
            value={scores?.[option]?.value ?? ""}
            placeholder={`Rate from 1 to 5`}
            onChange={(e) => handleInputChange(option, "value", e.target.value)}
          />
        </div>
      ))}
      </div>
    </div>
    
    {/* Debit Amount Section - Only visible to bluebell_userauth users */}
    {(userAuth && userAuth.some && userAuth.some(auth => auth.email === user?.user_metadata?.email)) && (
      <div className="res-eval">
        <h5><span className="ic red"><RiBankLine /></span> Debit Amount</h5>
        <div className="res-grid2">
          <div className="res-field">
            <label htmlFor="debitAmount" className="res-label">
              Amount
            </label>
            <input
              id="debitAmount"
              type="number"
              className="res-input"
              value={scores?.debitAmount?.value ?? ""}
              placeholder="Enter debit amount"
              onChange={(e) => handleInputChange("debitAmount", "value", e.target.value)}
            />
          </div>
        </div>
      </div>
    )}
  </div>
</div>
        )}
        <Modal show={showPreviewModal} onHide={handleClosePreviewModal} size="xl" centered contentClassName="res-modal-content">
          <div className="res-modal-head">
            <div className="t"><RiEyeLine /> Result Preview</div>
            <div className="s">
              {selectedStudent || "Student"}
              {studentClassFilter ? ` • ${studentClassFilter}` : ""}
              {termFilter ? ` • ${termFilter}` : ""}
              {purpose === "midterm" ? " • Midterm" : ""}
            </div>
          </div>
          <Modal.Body className="res-modal-body">
            <PreviewResultComponent
              studentName={selectedStudent}
              studentClass={studentClassFilter}
              term={termFilter}
              subjects={subjects}
              scores={scores}
              overallPrincipalRemark={overallPrincipalRemark}
              useCustomPrincipalRemark={scores?.useCustomPrincipalRemark}
              customPrincipalRemark={scores?.customPrincipalRemark}
              purpose={purpose}
            />
          </Modal.Body>
          <div className="res-modal-foot">
            <button className="res-cancel" onClick={handleClosePreviewModal}>
              Close
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}

const PreviewResultComponent = ({ studentName, studentClass, term, subjects, scores, overallPrincipalRemark, useCustomPrincipalRemark, customPrincipalRemark, purpose }) => {
  // grading scale comes from the shared getClassLevelGroup (numeric year check)
  const classLevelGroup = getClassLevelGroup(studentClass.toLowerCase());

  const calculateTotal = (subjectScores, classLevelGroup) => {
    // For all classes: Test + Project + Examination = Total
    const test = parseFloat(subjectScores.test || 0);
    const project = parseFloat(subjectScores.project || 0);
    const examination = parseFloat(subjectScores.examination || 0);
    return test + project + examination;
  };
  const determineGrade = (total, classLevelGroup) => {
    // Use primary/secondary grading system for all levels
    if (total >= 96) return "A+";
    if (total >= 86) return "A";
    if (total >= 80) return "B+";
    if (total >= 70) return "B";
    if (total >= 66) return "C+";
    if (total >= 56) return "C";
    if (total >= 46) return "D";
    return "E";
  };

  const calculateMidtermGrade = (score) => {
    score = parseFloat(score || 0);
    if (score >= 29) return "A+";
    if (score >= 26) return "A";
    if (score >= 24) return "B+";
    if (score >= 21) return "B";
    if (score >= 20) return "C+";
    if (score >= 17) return "C";
    if (score >= 14) return "D";
    return "E";
  };

  // Filter subjects that have valid scores
  const validSubjects = subjects.filter((subject) => {
    const subjectScores = scores[subject] || {};
    if (purpose === "midterm") {
      return subjectScores.midtermScore !== undefined && subjectScores.midtermScore !== "";
    }
    return (
      subjectScores.test !== undefined &&
      subjectScores.project !== undefined &&
      subjectScores.examination !== undefined
    );
  });

  const calculateOverallTotal = () => {
    return validSubjects.reduce((sum, subject) => {
      return sum + calculateTotal(scores[subject], classLevelGroup);
    }, 0);
  };
  const calculateOverallGrade = () => {
    const overallTotal = calculateOverallTotal();
    const average = validSubjects.length > 0 ? overallTotal / validSubjects.length : 0;
    return determineGrade(average, classLevelGroup);
  };
  return (
    <div className="res-pv">
      <h2>
        {purpose === "midterm" ? "Midterm Result Preview" : "Result Preview"}
      </h2>
      <div className="res-pv-meta">
        <span><strong>Student Name:</strong> {studentName}</span>
        <span><strong>Class:</strong> {studentClass}</span>
        <span><strong>Term:</strong> {term}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            {purpose === "midterm" ? (
              <>
                <th>Midterm Score (30)</th>
                <th>Grade</th>
                <th>Remark</th>
              </>
            ) : (
              <>
                <th>Test</th>
                <th>Project</th>
                <th>Examination</th>
                <th>Total (100)</th>
                <th>Grade</th>
                <th>Teacher&apos;s Remark</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {subjects.map((subject) => {
            const subjScore = scores[subject] || {};
            const total = calculateTotal(subjScore, classLevelGroup);
            const grade = determineGrade(total, classLevelGroup);
            return (
              <tr key={subject}>
                <td>{subject}</td>
                {purpose === "midterm" ? (
                  <>
                    <td>{subjScore.midtermScore || "0"}</td>
                    <td>{calculateMidtermGrade(subjScore.midtermScore)}</td>
                    <td>{subjScore.remark || ""}</td>
                  </>
                ) : (
                  <>
                    <td>{subjScore.test || "0"}</td>
                    <td>{subjScore.project || "0"}</td>
                    <td>{subjScore.examination || "0"}</td>
                    <td><strong>{total}</strong></td>
                    <td>{grade}</td>
                    <td>{subjScore.remark || ""}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {purpose !== "midterm" && (
        <div className="res-pv-foot">
          <p className="line">Overall Total: {calculateOverallTotal()}</p>
          <p className="line">Overall Grade: {validSubjects.length > 0 ? calculateOverallGrade() : "N/A"}</p>
          <p className="line" style={{ marginTop: "12px" }}>
            Principal&apos;s Comment: {useCustomPrincipalRemark ? (customPrincipalRemark || "N/A") : (overallPrincipalRemark ? overallPrincipalRemark(studentClass) : "N/A")}
          </p>
        </div>
      )}
    </div>
  );
};

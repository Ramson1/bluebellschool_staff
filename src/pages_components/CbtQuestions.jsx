import React, { useState, useEffect, useContext } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../supabaseClient';
import { StaffContext } from '../components/StaffShell.jsx';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import { sendEmailNotification } from '../api/emailNotificationService';
import { logAction } from '../api/auditLog';
import { schoolSubjects } from '../utils/subjectUtils';
import { normCls, normSub } from '../utils/scope.js';
import { ownedByMe, assertOwnership, withAuthor } from '../utils/ownership.js';
import {
  RiAddLine,
  RiDownloadLine,
  RiEditLine,
  RiDeleteBin6Line,
  RiSearchLine,
  RiRefreshLine,
  RiArchive2Line,
  RiTimeLine,
  RiStackLine,
  RiBookOpenLine,
  RiQuestionAnswerLine,
  RiFileEditLine,
  RiFileTextLine,
  RiUploadCloud2Line,
  RiCloseLine,
  RiErrorWarningLine,
  RiInboxLine,
  RiFileListLine,
  RiGraduationCapLine,
} from 'react-icons/ri';
import '../styles/CbtQuestions.css';
// import * as mammoth from 'mammoth';
// Mammoth removed for browser compatibility
// Reference to the template file in the public directory
const cbtTemplate = '/CBT_Question.docx';
// import emailjs from '@emailjs/browser'; // Unused
// import { sendEmailNotification as sendEmailNotificationClient, getAdminEmail } from '../api/emailClient';
// EMAIL FUNCTIONALITY COMMENTED OUT FOR VERCEL DEPLOYMENT

const allSubjects = Array.from(new Set(
  Object.values(schoolSubjects).flat()
)).sort();

// A question set is "archived" once it hasn't been updated for 2 months
const isArchivedSet = (q) => {
  const updatedDate = new Date(q.updated_at || q.created_at);
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  return updatedDate < twoMonthsAgo;
};

// Presentation metadata per session type (icons verified in react-icons/ri)
const SESSION_TYPES = {
  objective: { label: 'Objective', icon: RiQuestionAnswerLine },
  completion: { label: 'Completion', icon: RiFileEditLine },
  essay: { label: 'Essay', icon: RiFileTextLine },
};

// The three session types live in three separate tables; ownership is keyed by
// table so a set is always matched against the row it came from.
const tableForSession = (t) =>
  t === 'completion' ? 'jmis_cbt_completion' : t === 'essay' ? 'jmis_cbt_essay' : 'jmis_cbtQuestions';

// testing

const CbtQuestions = () => {
  // Staff-portal authorization source of truth: a validated scope (populated
  // from jmis_staff + jmis_staff_assignments and enforced by the ScopeGate
  // wrapper). The copied admin role tables are NOT the staff access list.
  const scope = useContext(StaffContext);
  const [user, setUser] = useState();
  const [teacherAuth, setTeacherAuth] = useState([]);
  const [userAuth, setUserAuth] = useState([]);
  const [devAuth, setDevAuth] = useState([]);
  const [cbtQuestions, setCbtQuestions] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentQuestionId, setCurrentQuestionId] = useState(null);
  const [questionsData, setQuestionsData] = useState([]);
  const [newSubject, setNewSubject] = useState('');
  const [newClass, setNewClass] = useState(''); // New state for class
  const [newDuration, setNewDuration] = useState('');
  const [newPurpose, setNewPurpose] = useState('practice'); // New purpose field
  const [newImage, setNewImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imageFileName, setImageFileName] = useState(null);
  const [buttonText, setButtonText] = useState('Save Changes');
  const [showCustomAlert, setShowCustomAlert] = useState(false); // State for custom alert modal
  const [loading, setLoading] = useState(true); // Add loading state
  const [templateFormat, setTemplateFormat] = useState('docx'); // State for template format selection
  const [purposeFilter, setPurposeFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [termFilter, setTermFilter] = useState('');
  const [newTerm, setNewTerm] = useState(''); // New state for term
  const [sessionType, setSessionType] = useState('objective'); // Session type: objective, completion, essay
  const [sessionTypeFilter, setSessionTypeFilter] = useState(''); // Filter by session type
  const [showArchived, setShowArchived] = useState(false); // Toggle archived items
  // const [adminEmail, setAdminEmail] = useState(''); // State for admin email - Unused

  // Get current user's email for audit trail
  const getCurrentUserEmail = () => {
    return user?.user_metadata?.email || 'Unknown User';
  };

  // Email used to sign records: the staff row is authoritative, the auth
  // session is the fallback.
  const getMyEmail = () => String(scope?.staff?.email || user?.email || user?.user_metadata?.email || '').trim();

  // The teacher's own classes, numeric-aware sorted. Both the filter toolbar
  // and the create form render this list so neither can offer a class the
  // teacher is not assigned to.
  const myClassOptions = (scope?.allClasses || [])
    .slice()
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));

  // Subjects offered for the class picked in the create form: a form (class)
  // teacher may quiz on any subject, a subject teacher only the subjects the
  // admin assigned them in THAT class. guardWrite's mayPair stays the save-time
  // backstop, this just stops the picker from offering impossible values.
  const subjectChoicesFor = (cls) => {
    if (!scope || scope.isGeneral || !cls) return allSubjects;
    if (scope.classTeacherClasses.some((x) => normCls(x) === normCls(cls))) return allSubjects;
    return scope.subjectPairs
      .filter((p) => normCls(p.class) === normCls(cls))
      .map((p) => p.subject);
  };

  // Class + subject pair check for the list (mirrors guardWrite's mayPair).
  const maySeePair = (cls, subject) => {
    if (!scope) return false;
    const c = normCls(cls);
    if (!scope.allClasses.some((x) => normCls(x) === c)) return false;
    if (scope.classTeacherClasses.some((x) => normCls(x) === c)) return true;
    return scope.subjectPairs.some(
      (p) => normCls(p.class) === c && normSub(p.subject) === normSub(subject)
    );
  };

  // Resolve the acting user's role for audit logging
  const getAuditRole = () => {
    const em = getCurrentUserEmail();
    if ((devAuth || []).some((a) => a.email === em)) return "developer";
    if ((userAuth || []).some((a) => a.email === em)) return "admin";
    if ((teacherAuth || []).some((a) => a.email === em)) return "teacher";
    return "";
  };

  // Safely initialize router
  let router;
  let isRouterAvailable = false;
  
  try {
    router = useRouter();
    isRouterAvailable = router && router.push;
  } catch (error) {
    console.warn('NextRouter not available in this context');
  }

  const fetchCbtQuestions = async () => {
    try {
      // Fetch from all three session type tables
      const [objectiveData, completionData, essayData] = await Promise.all([
        supabase.from('jmis_cbtQuestions').select('*').order('created_at', { ascending: false }),
        supabase.from('jmis_cbt_completion').select('*').order('created_at', { ascending: false }),
        supabase.from('jmis_cbt_essay').select('*').order('created_at', { ascending: false })
      ]);

      if (objectiveData.error) throw objectiveData.error;
      if (completionData.error) throw completionData.error;
      if (essayData.error) throw essayData.error;

      // Add sessionType field to each record
      const objectiveWithSession = (objectiveData.data || []).map(q => ({ ...q, sessionType: 'objective' }));
      const completionWithSession = (completionData.data || []).map(q => ({ ...q, sessionType: 'completion' }));
      const essayWithSession = (essayData.data || []).map(q => ({ ...q, sessionType: 'essay' }));

      // Combine all questions
      const allQuestions = [
        ...objectiveWithSession,
        ...completionWithSession,
        ...essayWithSession
      ];

      // Only my class/subject pairs AND only the sets I authored. Another
      // teacher's (or the admin's) set for the same pair never reaches this
      // list, so it cannot be opened, edited or deleted from here. created_by
      // is absent until the optional CBT SQL is applied, in which case the
      // pair check above still keeps the page usable.
      const mine = allQuestions.filter(
        (q) => maySeePair(q.class, q.subject) && ownedByMe(scope, tableForSession(q.sessionType), q)
      );

      setCbtQuestions(mine);
    } catch (error) {
      console.error('Error fetching CBT questions:', error);
      toast.error("Failed to fetch CBT questions. Please try again.");
    }
  };

  useEffect(() => {
    const initializeData = async () => {
      try {
        // Get current user
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        
        if (!currentUser) {
          setLoading(false);
          return;
        }
        
        setUser(currentUser);
        
        // Fetch all required data in parallel
        const [teacherData, userData, devData] = await Promise.all([
          supabase.from('jmis_teacherauth').select('email'),
          supabase.from('jmis_userauth').select('email'),
          supabase.from('devauth').select('email')
        ]);
        
        // Role tables only drive the developer-only controls. In the staff
        // portal a staff token may be RLS-denied on these reads, so treat them
        // as fail-soft (never abort init) and rely on scope for authorization.
        setTeacherAuth(teacherData.data || []);
        setUserAuth(userData.data || []);
        setDevAuth(devData.data || []);

        // If user is authorized (teacher, admin, dev OR a valid staff scope),
        // fetch CBT questions.
        const isTeacher = teacherData.data && teacherData.data.some(auth => auth.email === currentUser?.user_metadata?.email);
        const isAdmin = userData.data && userData.data.some(auth => auth.email === currentUser?.user_metadata?.email);
        const isDev = devData.data && devData.data.some(auth => auth.email === currentUser?.user_metadata?.email);

        if (isTeacher || isAdmin || isDev || scope) {
          await fetchCbtQuestions();
        }
      } catch (error) {
        console.error('Error initializing data:', error);
        toast.error("Failed to fetch data. Please check your internet connection.");
      } finally {
        // Only set loading to false after all verification is complete
        setLoading(false);
      }
    };
    
    initializeData();
  }, []);

  // The list is scope-driven, so refresh it whenever the assignment scope
  // resolves or changes (sign-in as another teacher, admin edits assignments).
  useEffect(() => {
    if (scope) fetchCbtQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Scroll to top when cbtQuestions changes
  useEffect(() => {
    if (cbtQuestions.length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [cbtQuestions]);

  // Check if the current user is a teacher
  // const isTeacher = user && teacherAuth && teacherAuth.some && teacherAuth.some(auth => auth.email === user?.user_metadata?.email); // Unused

  const uploadImage = async (file) => {
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const { error } = await supabase.storage
        .from("cbt")
        .upload(fileName, file);

      if (error) {
        throw error;
      } else {
        setImageFileName(fileName);
        return fileName;
      }
    } catch (error) {
      console.error(error);
      toast.error("Error uploading image: " + error.message);
    }
  };

  const handleExportDoc = (questionSet) => {
    try {
      const lines = [];
      questionSet.questions.forEach((q, index) => {
        lines.push(`${index + 1}. ${q.questionText}`);
        const options = q.answerOptions || [];
        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
        let correctLetter = null;
        options.forEach((opt, optIndex) => {
          const letter = letters[optIndex] || String.fromCharCode(65 + optIndex);
          lines.push(`${letter}. ${opt.answerText}`);
          if (opt.isCorrect && !correctLetter) {
            correctLetter = letter.toLowerCase();
          }
        });
        if (correctLetter) {
          lines.push(`Answer: ${correctLetter}`);
        }
        lines.push('');
      });
      const content = lines.join('\n');
      const blob = new Blob([content], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeSubject = questionSet.subject || 'CBT_Questions';
      const safeClass = questionSet.class || 'All';
      link.href = url;
      link.download = `${safeSubject}_${safeClass}.doc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('CBT questions exported as MS Word document');
    } catch (error) {
      toast.error('Failed to export questions as MS Word document');
    }
  };

  // const parseWordDocument = (content) => {
  //   const lines = content.split("\n").filter((line) => line.trim() !== ""); // Split content into lines and remove empty lines
  //   const questions = [];
  //   let currentQuestion = null;
  //
  //   lines.forEach((line) => {
  //     if (line.startsWith("Q:")) {
  //       // Start of a new question
  //       if (currentQuestion) {
  //         questions.push(currentQuestion);
  //       }
  //       currentQuestion = {
  //         questionText: line.replace("Q:", "").trim(),
  //         answerOptions: [],
  //       };
  //     } else if (/^[A-D]\./.test(line)) {
  //       // Option (e.g., "A. Option text")
  //       if (currentQuestion) {
  //         currentQuestion.answerOptions.push({
  //           answerText: line.substring(2).trim(), // Extract text after "A.", "B.", etc.
  //           isCorrect: false,
  //         });
  //       }
  //     } else if (line.startsWith("Correct Answer:")) {
  //       // Correct answer (e.g., "Correct Answer: A")
  //       if (currentQuestion) {
  //         const correctOption = line.replace("Correct Answer:", "").trim();
  //         currentQuestion.answerOptions.forEach((option, index) => {
  //           const optionLetter = String.fromCharCode(65 + index); // Convert index to letter (A, B, C, D)
  //           option.isCorrect = optionLetter === correctOption;
  //         });
  //       }
  //     }
  //   });
  //
  //   // Add the last question
  //   if (currentQuestion) {
  //     questions.push(currentQuestion);
  //   }
  //
  //   return questions;
  // }; // Unused

  const handleAddQuestion = () => {
    setShowCustomAlert(true); // Show the custom alert modal
  };

  const handleManualEntry = () => {
    setShowCustomAlert(false); // Close the custom alert modal
    setIsEditing(false);
    setCurrentQuestionId(null);
    setQuestionsData([{ questionText: '', answerOptions: [{ answerText: '', isCorrect: false }] }]);
    setNewSubject('');
    setNewClass('');
    setNewTerm(''); // Reset term state
    setNewDuration('');
    setNewPurpose('practice'); // Reset purpose state
    setNewImage(null);
    setImageFile(null);
    setShowModal(true); // Open the main modal for manual entry
  };
  
  const handleDocumentUpload = () => {
    setShowCustomAlert(false); // Close the custom alert modal
    
    // Only run in browser environment
    if (typeof window === 'undefined') {
      return;
    }
    
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json, .docx"; // Accept JSON and DOCX files
    fileInput.onchange = async (event) => {
      const file = event.target.files[0];
      if (file) {
        try {
          if (file.type === "application/json") {
            // Handle JSON file
            const fileContent = await file.text();
            const parsedData = JSON.parse(fileContent);

            // Validate the structure of the uploaded file
            if (!Array.isArray(parsedData)) {
              throw new Error("Invalid file format. The file should contain an array of questions.");
            }

            // Format questions based on session type
            let formattedQuestions;
            
            if (sessionType === 'objective') {
              // Objective: Multiple choice format
              formattedQuestions = parsedData.map((item) => ({
                questionText: item.question,
                answerOptions: (item.options || []).map((option) => ({
                  answerText: option,
                  isCorrect: option === item.correctAnswer,
                })),
              }));
            } else if (sessionType === 'completion') {
              // Completion: Fill-in-the-blank format
              formattedQuestions = parsedData.map((item) => ({
                questionText: item.questionText || item.question,
                expectedAnswers: item.expectedAnswers || [],
                acceptableSynonyms: item.acceptableSynonyms || [],
                requiredKeywords: item.requiredKeywords || [],
                points: item.points || 1,
              }));
            } else if (sessionType === 'essay') {
              // Essay: Free text format
              formattedQuestions = parsedData.map((item) => ({
                questionText: item.questionText || item.question,
                expectedAnswer: item.expectedAnswer || '',
                requiredKeywords: item.requiredKeywords || [],
                acceptableSynonyms: item.acceptableSynonyms || [],
                minWords: item.minWords || 50,
                points: item.points || 10,
              }));
            }

            setQuestionsData(formattedQuestions);
          } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            // Handle DOCX file - simple text extraction
            toast.info("Processing DOCX file...");
            const arrayBuffer = await file.arrayBuffer();
            // Load mammoth's browser build lazily, only when a DOCX is actually
            // uploaded. This keeps the (Node-oriented) main entry out of the
            // initial bundle and replaces the previous `window.mammoth` global,
            // which was never defined and threw on every .docx upload.
            const mammothModule = await import("mammoth/mammoth.browser");
            const mammoth = mammothModule.default || mammothModule;
            if (!mammoth || typeof mammoth.extractRawText !== "function") {
              throw new Error("DOCX reader could not be loaded in the browser.");
            }
            const result = await mammoth.extractRawText({ arrayBuffer });
            const text = result.value;
            
            // Parse the text content - Updated to handle flexible formats
            const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '');
            const questions = [];
            let currentQuestion = null;
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              
              // Check for question (starts with number followed by period or dot)
              if (/^\d+\./.test(line)) {
                // Save previous question if exists
                if (currentQuestion && currentQuestion.answerOptions.length > 0) {
                  questions.push(currentQuestion);
                }
                
                // Start new question
                currentQuestion = {
                  questionText: line.replace(/^\d+\.\s*/, '').trim(),
                  answerOptions: [],
                  correctAnswer: null
                };
              }
              // Check for answer option (A., B., C., D. or A), B), C), D) or (A) (B) (C) (D))
              else if (/^[A-D][.)\.]\s|\([A-D]\)\s/i.test(line) && currentQuestion) {
                // Extract option letter and text
                let optionLetter = '';
                let optionText = '';
                
                if (/^[A-D][.)\.]\s/i.test(line)) {
                  optionLetter = line.charAt(0).toLowerCase();
                  optionText = line.replace(/^[A-D][.)\.]\s*/i, '').trim();
                } else if (/\([A-D]\)\s/i.test(line)) {
                  optionLetter = line.charAt(1).toLowerCase();
                  optionText = line.replace(/\([A-D]\)\s*/i, '').trim();
                }
                
                if (optionText) {
                  currentQuestion.answerOptions.push({
                    answerText: optionText,
                    isCorrect: false,
                    optionLetter: optionLetter
                  });
                }
              }
              // Check for correct answer - Answer: a or Answer a (with/without colon)
              else if (/^answer:?\s*[a-d]/i.test(line) && currentQuestion) {
                const match = line.match(/^answer:?\s*([a-d])/i);
                if (match) {
                  const correctLetter = match[1].toLowerCase();
                  
                  // Mark the correct answer
                  currentQuestion.answerOptions.forEach((opt) => {
                    opt.isCorrect = opt.optionLetter === correctLetter;
                  });
                }
              }
            }
            
            // Add the last question
            if (currentQuestion && currentQuestion.answerOptions.length > 0) {
              questions.push(currentQuestion);
            }
            
            // Process questions - remove temporary optionLetter property and handle missing answers
            const processedQuestions = questions.map(question => {
              // Remove temporary optionLetter property
              question.answerOptions.forEach((opt) => {
                delete opt.optionLetter;
              });
              
              // If no correct answer is marked, leave all as false (to be filled later)
              const hasCorrectAnswer = question.answerOptions.some(opt => opt.isCorrect);
              
              return question;
            });
            
            // Validate questions - at least need a question and options
            const validQuestions = processedQuestions.filter(q => {
              const hasQuestion = q.questionText && q.questionText.length > 0;
              const hasOptions = q.answerOptions && q.answerOptions.length >= 2;
              return hasQuestion && hasOptions;
            });
            
            if (validQuestions.length === 0) {
              throw new Error("No valid questions found in the document. Please check the format.");
            }
            
            setQuestionsData(validQuestions);
            toast.success(`Loaded ${validQuestions.length} questions from DOCX`);
            
            // Show warning if some questions have unmarked answers
            const questionsWithoutAnswers = validQuestions.filter(q => !q.answerOptions.some(opt => opt.isCorrect));
            if (questionsWithoutAnswers.length > 0) {
              toast.warn(`${questionsWithoutAnswers.length} question(s) have unmarked answers. You can edit them to set the correct answer.`);
            }
          } else {
            throw new Error("Unsupported file type. Please upload a .json or .docx file.");
          }

          setIsEditing(false);
          setCurrentQuestionId(null);
          setNewSubject('');
          setNewClass('');
          setNewDuration('');
          setNewImage(null);
          setImageFile(null);
          setShowModal(true); // Open the main modal with parsed questions
        } catch (error) {
          toast.error("Error processing the uploaded file: " + error.message);
        }
      }
    };
    fileInput.click();
  };

  const handleEditQuestion = (question) => {
    // Only the teacher who created a set may open it for editing.
    const own = assertOwnership(scope, tableForSession(question.sessionType), question);
    if (!own.ok) { toast.warn(own.reason); return; }
    setIsEditing(true);
    setCurrentQuestionId(question.id);
    setQuestionsData(question.questions);
    setNewSubject(question.subject);
    setNewClass(question.class);
    setNewTerm(question.term || '');
    setNewDuration(question.duration);
    setNewPurpose(question.purpose || 'practice');
    setNewImage(question.image);
    setSessionType(question.sessionType || 'objective'); // Set session type
    setShowModal(true);
  };

  const handleDeleteQuestion = async (questionId) => {
  try {
    // Find the question in state to get its session type
    const questionToDelete = cbtQuestions.find(q => q.id === questionId);
    if (!questionToDelete) {
      toast.error("Question not found.");
      return;
    }

    // Determine table based on session type
    const targetTable = questionToDelete.sessionType === 'objective' 
      ? 'jmis_cbtQuestions' 
      : questionToDelete.sessionType === 'completion' 
        ? 'jmis_cbt_completion' 
        : 'jmis_cbt_essay';

    // Ownership check before the delete: a colleague's set is untouchable here.
    const own = assertOwnership(scope, targetTable, questionToDelete);
    if (!own.ok) { toast.warn(own.reason); return; }
    
    // First, get the question details before deleting
    const { data: questionData, error: fetchError } = await supabase
      .from(targetTable)
      .select('subject, class')
      .eq('id', questionId)
      .single();

    if (fetchError) {
      console.error('Error fetching question data:', fetchError);
      toast.error("Failed to fetch question details.");
      return;
    }

    const { error } = await supabase
      .from(targetTable)
      .delete()
      .eq('id', questionId);

    if (error) {
      throw error;
    }

    // Update the state to remove the deleted question
    setCbtQuestions(cbtQuestions.filter((question) => question.id !== questionId));
    toast.success("Question deleted successfully!");

    // Audit: question deleted
    logAction(supabase, {
      email: getCurrentUserEmail(),
      role: getAuditRole(),
      action: "cbt_question_delete",
      targetTable: targetTable,
      recordId: questionId,
    });
    
    // Send email notification with subject and class instead of ID
    try {
      const emailSubject = 'CBT Question Deleted';
      const currentUserEmail = getCurrentUserEmail();
      const emailMessage = `A CBT question has been deleted by ${currentUserEmail}:

Subject: ${questionData.subject}
Class: ${questionData.class}`;
      
      console.log('📧 [CBT Delete] Sending email notification...');
      const emailResult = await sendEmailNotification(supabase, emailSubject, emailMessage);
      
      if (emailResult.success) {
        console.log('✅ [CBT Delete] Email sent successfully');
      } else {
        console.error('❌ [CBT Delete] Email failed:', emailResult.error);
        toast.warn('Question deleted but email notification failed: ' + emailResult.error);
      }
    } catch (emailError) {
      console.error('❌ [CBT Delete] Email error:', emailError);
      toast.warn('Question deleted but email notification failed');
    }
    
    // Refresh the list of questions
    await fetchCbtQuestions();
  } catch (error) {
    console.error('Error deleting question:', error);
    toast.error("Failed to delete question. Please try again.");
  }
};

  const handleSaveEditQuestion = async () => {
    try {
      setButtonText('Loading...');
      let imageUrl = newImage;
      if (imageFile) {
        imageUrl = await uploadImage(imageFile);
      }

      const updateData = {
        questions: questionsData,
        subject: newSubject,
        class: newClass, // Include class in update data
        term: newTerm, // Include term in update data
        duration: newDuration,
        purpose: newPurpose, // Include purpose in update data
        image: imageUrl,
      };

      // Write back to the table the set actually came from, and only if I own
      // it. (This path used to always target the objective table, which could
      // touch a same-id row in another table.)
      const rowToEdit = (cbtQuestions || []).find((q) => q.id === currentQuestionId);
      if (!rowToEdit) {
        toast.error("Question set not found — refresh the list and try again.");
        return;
      }
      const editTable = tableForSession(rowToEdit.sessionType);
      const own = assertOwnership(scope, editTable, rowToEdit);
      if (!own.ok) { toast.warn(own.reason); return; }

      const { data, error } = await supabase
        .from(editTable)
        .update(updateData)
        .eq('id', currentQuestionId);
      if (error) throw error;
      
      // Check if data exists and has at least one element before accessing data[0]
      if (data && data.length > 0) {
        setCbtQuestions(cbtQuestions.map(q => (q.id === currentQuestionId ? data[0] : q)));
      } else {
        // If no data returned, refresh the questions list
        await fetchCbtQuestions();
      }
      setShowModal(false);
      setIsEditing(false);
      setCurrentQuestionId(null);
      setQuestionsData([]);
      setNewSubject('');
      setNewClass(''); // Reset class state
      setNewDuration('');
      setNewImage(null);
      setImageFile(null);
      toast.success("Question updated successfully!");

      // Audit: question updated
      logAction(supabase, {
        email: getCurrentUserEmail(),
        role: getAuditRole(),
        action: "cbt_question_update",
        targetTable: 'jmis_cbtQuestions',
        recordId: currentQuestionId,
        details: { questionText: updateData?.questionText },
      });
      
      // Send email notification
      try {
        const emailSubject = 'CBT Question Updated';
        const currentUserEmail = getCurrentUserEmail();
        
        // Build detailed questions list
        const questionsList = questionsData.map((q, index) => {
          let questionDetail = `\nQuestion ${index + 1}: ${q.questionText || q.question || 'No question text'}\n`;
          
          // Handle both formats: answerOptions array OR individual option fields
          if (q.answerOptions && Array.isArray(q.answerOptions)) {
            // New format: answerOptions array
            const labels = ['A', 'B', 'C', 'D'];
            q.answerOptions.forEach((opt, optIndex) => {
              const label = labels[optIndex] || String.fromCharCode(65 + optIndex);
              questionDetail += `  ${label}) ${opt.answerText || 'N/A'}${opt.isCorrect ? ' ✓' : ''}\n`;
            });
            // Find correct answer
            const correctOpt = q.answerOptions.find(opt => opt.isCorrect);
            const correctIndex = q.answerOptions.indexOf(correctOpt);
            const correctLabel = correctIndex >= 0 ? String.fromCharCode(65 + correctIndex) : 'Not specified';
            questionDetail += `  ✓ Correct Answer: ${correctLabel}\n`;
          } else {
            // Old format: individual option fields
            questionDetail += `  A) ${q.optionA || q.a || 'N/A'}\n`;
            questionDetail += `  B) ${q.optionB || q.b || 'N/A'}\n`;
            questionDetail += `  C) ${q.optionC || q.c || 'N/A'}\n`;
            questionDetail += `  D) ${q.optionD || q.d || 'N/A'}\n`;
            questionDetail += `  ✓ Correct Answer: ${q.correctAnswer || q.answer || 'Not specified'}\n`;
          }
          
          return questionDetail;
        }).join('\n');
        
        const emailMessage = `A CBT question has been updated by ${currentUserEmail}:

Subject: ${newSubject}
Class: ${newClass}
Term: ${newTerm || 'Not specified'}
Duration: ${newDuration} minutes
Purpose: ${newPurpose || 'Practice'}
Number of Questions: ${questionsData.length}

--- QUESTIONS DETAILS ---
${questionsList}`;
        
        console.log('📧 [CBT Update] Sending email notification...');
        const emailResult = await sendEmailNotification(supabase, emailSubject, emailMessage);
        
        if (emailResult.success) {
          console.log('✅ [CBT Update] Email sent successfully');
        } else {
          console.error('❌ [CBT Update] Email failed:', emailResult.error);
          toast.warn('Question updated but email notification failed: ' + emailResult.error);
        }
      } catch (emailError) {
        console.error('❌ [CBT Update] Email error:', emailError);
        toast.warn('Question updated but email notification failed');
      }
      
      // Refresh the list of questions
      await fetchCbtQuestions();
    } catch (error) {
      console.error("Error updating question:", error);
      toast.error("Failed to update question: " + (error.message || "Unknown error"));
    } finally {
      setButtonText('Save Changes');
    }
  };

  const handleSaveQuestion = async () => {
    try {
      setButtonText('Saving...');
      
      // Determine target table based on session type
      const targetTable = sessionType === 'objective' 
        ? 'jmis_cbtQuestions' 
        : sessionType === 'completion' 
          ? 'jmis_cbt_completion' 
          : 'jmis_cbt_essay';
      
      const newQuestionData = {
        subject: newSubject,
        class: newClass,
        term: newTerm,
        duration: newDuration,
        purpose: newPurpose,
        image: newImage ? await uploadImage(imageFile) : null,
        questions: questionsData,
      };

      // Sign the set with the creating teacher (created_by) so that only this
      // teacher sees and manages it afterwards. Skipped automatically on a
      // table where the column has not been added yet.
      const tagged = await withAuthor(targetTable, newQuestionData, getMyEmail());

      const { data, error } = await supabase
        .from(targetTable)
        .insert([tagged]);

      if (error) {
        throw error;
      }

      // Check if data exists and is an array before spreading
      if (data && Array.isArray(data)) {
        setCbtQuestions([...cbtQuestions, ...data]); // Add the new question to the state
      } else if (data && data[0]) {
        // If data is not an array but has a first element, treat it as a single record
        setCbtQuestions([...cbtQuestions, data[0]]);
      } else {
        // If no data returned, refresh the questions list
        await fetchCbtQuestions();
      }
      toast.success("Question added successfully!");

      // Audit: question added
      logAction(supabase, {
        email: getCurrentUserEmail(),
        role: getAuditRole(),
        action: "cbt_question_add",
        targetTable: targetTable,
        details: { questionText: newQuestionData?.questionText, sessionType },
      });
      
      // Send email notification
      try {
        const emailSubject = `New CBT ${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} Question Added`;
        const currentUserEmail = getCurrentUserEmail();
        
        // Build detailed questions list based on session type
        let questionsList = '';
        
        if (sessionType === 'objective') {
          questionsList = questionsData.map((q, index) => {
            let questionDetail = `\nQuestion ${index + 1}: ${q.questionText || q.question || 'No question text'}\n`;
            
            if (q.answerOptions && Array.isArray(q.answerOptions)) {
              const labels = ['A', 'B', 'C', 'D'];
              q.answerOptions.forEach((opt, optIndex) => {
                const label = labels[optIndex] || String.fromCharCode(65 + optIndex);
                questionDetail += `  ${label}) ${opt.answerText || 'N/A'}${opt.isCorrect ? ' ✓' : ''}\n`;
              });
              const correctOpt = q.answerOptions.find(opt => opt.isCorrect);
              const correctIndex = q.answerOptions.indexOf(correctOpt);
              const correctLabel = correctIndex >= 0 ? String.fromCharCode(65 + correctIndex) : 'Not specified';
              questionDetail += `  ✓ Correct Answer: ${correctLabel}\n`;
            }
            
            return questionDetail;
          }).join('\n');
        } else if (sessionType === 'completion') {
          questionsList = questionsData.map((q, index) => {
            let questionDetail = `\nQuestion ${index + 1}: ${q.questionText || 'No question text'}\n`;
            questionDetail += `  Expected Answers: ${(q.expectedAnswers || []).join(', ')}\n`;
            questionDetail += `  Synonyms: ${(q.acceptableSynonyms || []).join(', ')}\n`;
            questionDetail += `  Points: ${q.points || 1}\n`;
            return questionDetail;
          }).join('\n');
        } else {
          // Essay
          questionsList = questionsData.map((q, index) => {
            let questionDetail = `\nQuestion ${index + 1}: ${q.questionText || 'No question text'}\n`;
            questionDetail += `  Expected Answer: ${q.expectedAnswer || 'Not specified'}\n`;
            questionDetail += `  Keywords: ${(q.requiredKeywords || []).join(', ')}\n`;
            questionDetail += `  Min Words: ${q.minWords || 0}\n`;
            questionDetail += `  Points: ${q.points || 10}\n`;
            return questionDetail;
          }).join('\n');
        }
        
        const emailMessage = `A new CBT ${sessionType} question has been added by ${currentUserEmail}:

Session Type: ${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)}
Subject: ${newSubject}
Class: ${newClass}
Term: ${newTerm || 'Not specified'}
Duration: ${newDuration} minutes
Purpose: ${newPurpose || 'Practice'}
Number of Questions: ${questionsData.length}

--- QUESTIONS DETAILS ---
${questionsList}`;
        
        console.log('📧 [CBT Create] Sending email notification...');
        const emailResult = await sendEmailNotification(supabase, emailSubject, emailMessage);
        
        if (emailResult.success) {
          console.log('✅ [CBT Create] Email sent successfully');
        } else {
          console.error('❌ [CBT Create] Email failed:', emailResult.error);
          toast.warn('Question added but email notification failed: ' + emailResult.error);
        }
      } catch (emailError) {
        console.error('❌ [CBT Create] Email error:', emailError);
        toast.warn('Question added but email notification failed');
      }
      
      setShowModal(false); // Close the modal
      // Refresh the list of questions
      await fetchCbtQuestions();
    } catch (error) {
      console.error("Error saving question:", error);
      toast.error("Failed to add question: " + (error.message || "Unknown error"));
    } finally {
      setButtonText('Save Changes');
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleQuestionChange = (index, field, value) => {
    const updatedQuestions = [...questionsData];
    updatedQuestions[index][field] = value;
    setQuestionsData(updatedQuestions);
  };

  const handleOptionChange = (questionIndex, optionIndex, field, value) => {
    const updatedQuestions = [...questionsData];
    if (field === 'isCorrect' && value === true) {
      updatedQuestions[questionIndex].answerOptions.forEach((option, index) => {
        option.isCorrect = index === optionIndex;
      });
    } else {
      updatedQuestions[questionIndex].answerOptions[optionIndex][field] = value;
    }
    setQuestionsData(updatedQuestions);
  };

  const addNewQuestion = () => {
    let newQuestion;
    
    if (sessionType === 'objective') {
      // Objective: Multiple choice
      newQuestion = {
        questionText: '',
        answerOptions: [{ answerText: '', isCorrect: false }]
      };
    } else if (sessionType === 'completion') {
      // Completion: Fill-in-the-blank
      newQuestion = {
        questionText: '',
        expectedAnswers: [],
        acceptableSynonyms: [],
        requiredKeywords: [],
        points: 1
      };
    } else if (sessionType === 'essay') {
      // Essay: Free text
      newQuestion = {
        questionText: '',
        expectedAnswer: '',
        requiredKeywords: [],
        acceptableSynonyms: [],
        minWords: 50,
        points: 10
      };
    }
    
    setQuestionsData([...questionsData, newQuestion]);
  };

  const addNewOption = (questionIndex) => {
    const updatedQuestions = [...questionsData];
    updatedQuestions[questionIndex].answerOptions.push({ answerText: '', isCorrect: false });
    setQuestionsData(updatedQuestions);
  };

  const deleteQuestion = (questionIndex) => {
    const updatedQuestions = [...questionsData];
    updatedQuestions.splice(questionIndex, 1);
    setQuestionsData(updatedQuestions);
  };

  const deleteOption = (questionIndex, optionIndex) => {
    const updatedQuestions = [...questionsData];
    updatedQuestions[questionIndex].answerOptions.splice(optionIndex, 1);
    setQuestionsData(updatedQuestions);
  };

  const subjectImage = 'https://BLUEBELL_SUPABASE_REF_PLACEHOLDER.supabase.co/storage/v1/object/public/cbt//';

  const formatDuration = (duration) => {
    if (duration < 60) {
      return `${duration} minutes`;
    } else {
      const hours = Math.floor(duration / 60);
      const minutes = duration % 60;
      return `${hours} hour${hours > 1 ? 's' : ''} ${minutes > 0 ? `${minutes} minutes` : ''}`;
    }
  };

  // const handleShowModal = () => {
  //   setIsEditing(false);
  //   setCurrentQuestionId(null);
  //   setQuestionsData([{ questionText: '', answerOptions: [{ answerText: '', isCorrect: false }] }]);
  //   setNewSubject('');
  //   setNewClass(''); // Reset class state
  //   setNewDuration('');
  //   setNewImage(null);
  //   setImageFile(null);
  //   setShowModal(true);
  // }; // Unused

  // ---- derived access + visible list (computed once for the whole render) ----
  const userEmail = user?.user_metadata?.email;
  const isAuthed = !!scope || [teacherAuth, userAuth, devAuth].some(
    (list) => list && list.some && list.some((auth) => auth.email === userEmail)
  );
  const isDevUser = !!(devAuth && devAuth.some && devAuth.some((auth) => auth.email === userEmail));

  const visibleQuestions = (cbtQuestions || []).filter((q) => {
    if (purposeFilter && q.purpose !== purposeFilter) return false;
    if (classFilter && normCls(q.class) !== normCls(classFilter)) return false;
    if (subjectFilter && !q.subject?.toLowerCase().includes(subjectFilter.toLowerCase())) return false;
    if (termFilter && q.term !== termFilter) return false;
    if (sessionTypeFilter && q.sessionType !== sessionTypeFilter) return false;
    return showArchived ? isArchivedSet(q) : !isArchivedSet(q);
  });
  const archivedCount = (cbtQuestions || []).filter(isArchivedSet).length;



  return (
    <div>
      <ToastContainer />
      {loading ? (
        <div className="cbtq-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
          <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem', marginBottom: '1rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <div style={{ color: 'var(--text-secondary, #888)' }}>Verifying credentials…</div>
        </div>
      ) : isAuthed ? (
        <div className="cbtq-page">
          {/* Page header */}
          <div className="cbtq-head">
            <div>
              <h1 className="cbtq-title">
                <span className="cbtq-title-ic"><RiBookOpenLine /></span>
                CBT Question Bank
              </h1>
              <p className="cbtq-sub">Upload, manage and export objective, completion and essay question sets.</p>
            </div>
            <div className="cbtq-pills">
              <span className="cbtq-pill"><RiStackLine />&nbsp;Total:&nbsp;<strong>{(cbtQuestions || []).length}</strong>&nbsp;sets</span>
              <span className="cbtq-pill"><RiInboxLine />&nbsp;Showing:&nbsp;<strong>{visibleQuestions.length}</strong>&nbsp;{showArchived ? 'archived' : 'current'}</span>
            </div>
          </div>

          {/* Session type + template downloads */}
          <div className="cbtq-tpl">
            <p className="cbtq-tpl-label"><RiFileTextLine /> Session Type &amp; Templates</p>
            <Form.Select
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value)}
              aria-label="Session type"
            >
              <option value="objective">Objective (Multiple Choice)</option>
              <option value="completion">Completion (Fill-in-Blank)</option>
              <option value="essay">Essay (Free Text)</option>
            </Form.Select>
            {sessionType === 'objective' && (
              <Button
                className="cbtq-btn green"
                href="/CBT_Question.docx"
                download="CBT_Question_Template.docx"
              >
                <RiFileTextLine /> Download DOCX Template
              </Button>
            )}
            <Button
              className={sessionType === 'objective' ? 'cbtq-btn soft' : 'cbtq-btn blue'}
              href={sessionType === 'objective' ? '/cbtTemplate.json' : sessionType === 'completion' ? '/completionTemplate.json' : '/essayTemplate.json'}
              download={sessionType === 'objective' ? 'cbtTemplate.json' : sessionType === 'completion' ? 'completionTemplate.json' : 'essayTemplate.json'}
            >
              <RiDownloadLine /> Download {sessionType === 'objective' ? 'Objective JSON' : sessionType === 'completion' ? 'Completion' : 'Essay'} Template
            </Button>
          </div>

          {/* Add new dropzone */}
          <div className="cbtq-addnew" onClick={handleAddQuestion} role="button">
            <span className="plus"><RiAddLine /></span>
            Add New Question Set
          </div>

          {/* Filters toolbar */}
          <div className="cbtq-filters">
            <Form.Select
              value={purposeFilter}
              onChange={(e) => setPurposeFilter(e.target.value)}
              aria-label="Purpose filter"
            >
              <option value="">All Purposes</option>
              <option value="midterm">Midterm</option>
              <option value="exam">Exam</option>
              <option value="practice">Practice</option>
            </Form.Select>
            <Form.Select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Class filter"
            >
              <option value="">All Classes</option>
              {myClassOptions.map((cls) => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </Form.Select>
            <Form.Select
              value={termFilter}
              onChange={(e) => setTermFilter(e.target.value)}
              aria-label="Term filter"
            >
              <option value="">All Terms</option>
              <option value="First Term">First Term</option>
              <option value="Second Term">Second Term</option>
              <option value="Third Term">Third Term</option>
            </Form.Select>
            <Form.Select
              value={sessionTypeFilter}
              onChange={(e) => setSessionTypeFilter(e.target.value)}
              aria-label="Session type filter"
            >
              <option value="">All Session Types</option>
              <option value="objective">Objective</option>
              <option value="completion">Completion</option>
              <option value="essay">Essay</option>
            </Form.Select>
            <div className="cbtq-search">
              <RiSearchLine />
              <Form.Control
                type="text"
                placeholder="Filter by subject"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="cbtq-btn soft"
              onClick={() => {
                setPurposeFilter('');
                setClassFilter('');
                setSubjectFilter('');
                setTermFilter('');
                setSessionTypeFilter('');
              }}
            >
              <RiRefreshLine /> Clear Filters
            </button>
          </div>

          <p className="cbtq-owned">
            Only the question sets you uploaded for your assigned classes and subjects are listed here.
          </p>
                
          {/* Archive toggle and count — developer only */}
          {isDevUser && (
            <div className="cbtq-arcrow">
              <div className="cbtq-arctext">
                Total: <strong>{(cbtQuestions || []).length}</strong> question sets&nbsp;|&nbsp;
                Showing: <strong>{visibleQuestions.length}</strong> {showArchived ? '(Archived)' : '(Current)'}&nbsp;|&nbsp;
                Archived: <strong>{archivedCount}</strong>
              </div>
              <button
                type="button"
                className={`cbtq-btn ${showArchived ? 'green' : 'soft'}`}
                onClick={() => setShowArchived(!showArchived)}
              >
                {showArchived ? (<><RiTimeLine /> Show Current</>) : (<><RiArchive2Line /> Show Archive ({archivedCount})</>)}
              </button>
            </div>
          )}

          {/* Delete all — developer only */}
          {isDevUser && (
            <div style={{ marginBottom: '14px' }}>
              <Button
                className="cbtq-btn red"
                onClick={async () => {
                  const confirmed = window.confirm('This will delete all CBT questions in the system. Continue?');
                  if (!confirmed) {
                    return;
                  }
                  try {
                    const { error } = await supabase
                      .from('jmis_cbtQuestions')
                      .delete()
                      .not('id', 'is', null);
                    if (error) {
                      throw error;
                    }
                    setCbtQuestions([]);
                    const emailSubject = 'All CBT Questions Deleted';
                    const currentUserEmail = getCurrentUserEmail();
                    const emailMessage = `All CBT questions have been deleted by ${currentUserEmail}.`;
                    await sendEmailNotification(supabase, emailSubject, emailMessage);
                    toast.success('All CBT questions deleted successfully');

                    // Audit: all questions deleted
                    logAction(supabase, {
                      email: currentUserEmail,
                      role: getAuditRole(),
                      action: "cbt_questions_delete_all",
                      targetTable: 'jmis_cbtQuestions',
                    });
                  } catch (error) {
                    toast.error('Failed to delete all CBT questions');
                  }
                }}
              >
                <RiDeleteBin6Line /> Delete All CBT Questions
              </Button>
            </div>
          )}
          {visibleQuestions.length === 0 ? (
            <div className="cbtq-empty">
              <RiInboxLine />
              {showArchived
                ? 'No archived question sets match the current filters.'
                : 'You have not uploaded a question set for your classes yet. Click "Add New Question Set" to create one — only you can see and manage it.'}
            </div>
          ) : (
            <div className="cbtq-grid">
              {visibleQuestions.map((question, index) => {
                const typeMeta = SESSION_TYPES[question.sessionType] || SESSION_TYPES.objective;
                const TypeIcon = typeMeta.icon;
                return (
                  <div className="cbtq-card" key={index}>
                    <span className={`cbtq-type ${question.sessionType || 'objective'}`}>
                      <TypeIcon /> {typeMeta.label}
                    </span>
                    {isArchivedSet(question) && (
                      <span className="cbtq-archive"><RiArchive2Line /> Archived</span>
                    )}
                    {question.image ? (
                      <img
                        src={`${subjectImage}${question.image}`}
                        className="cbtq-cover"
                        alt={question.subject || 'CBT question set'}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="cbtq-cover-fallback">{(question.subject || 'CBT').slice(0, 18)}</div>
                    )}
                    <div className="cbtq-cardbody">
                      <h5 className="cbtq-cardtitle">{question.subject || 'Untitled'}</h5>
                      <div className="cbtq-metas">
                        <span className="cbtq-meta"><RiGraduationCapLine /> {question.class || '—'}</span>
                        <span className="cbtq-meta cbtq-purpose"><RiBookOpenLine /> {question.purpose || 'practice'}</span>
                        <span className="cbtq-meta"><RiTimeLine /> {formatDuration(question.duration)}</span>
                        <span className="cbtq-meta"><RiFileListLine /> {question.questions?.length || 0} question(s)</span>
                      </div>
                    </div>
                    <div className="cbtq-cardfoot">
                      <Button className="cbtq-btn green cbtq-act" onClick={() => handleEditQuestion(question)}>
                        <RiEditLine /> Edit
                      </Button>
                      <Button className="cbtq-btn blue cbtq-act" onClick={() => handleExportDoc(question)}>
                        <RiDownloadLine /> Export DOC
                      </Button>
                      <Button
                        className="cbtq-btn red"
                        style={{ flex: '0 0 auto', padding: '8px 12px' }}
                        title="Delete question set"
                        onClick={() => handleDeleteQuestion(question.id)}
                      >
                        <RiDeleteBin6Line />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh', padding: '20px' }}>
          <div
            style={{
              width: 'min(480px, 92%)',
              padding: '36px 30px',
              backgroundColor: 'var(--card-bg, #fff)',
              border: '1px solid var(--card-border, #f0f2f5)',
              borderRadius: '16px',
              boxShadow: '0 10px 30px var(--shadow-color, rgba(0, 0, 0, 0.12))',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '40px', color: '#d64c5b', marginBottom: '10px' }}><RiErrorWarningLine /></div>
            <h2 style={{ marginBottom: '12px', color: 'var(--text-primary, #222)', fontWeight: 800 }}>
              User not authorised
            </h2>
            <p style={{ marginBottom: '28px', color: 'var(--text-secondary, #888)' }}>
              Please login with proper credentials or check your internet connection.
            </p>
            <button
              onClick={() => {
                if (isRouterAvailable) {
                  router.push('/login');
                } else {
                  // Fallback to window.location for cases where router is not available
                  window.location.href = '/login';
                }
              }}
              className="cbtq-btn green"
              style={{ margin: '0 auto' }}
            >
              Go to Login
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Question Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg" centered contentClassName="cbtq-modal-content">
        <Modal.Header className="cbtq-modal-head" closeButton closeVariant="white">
          <Modal.Title>
            <div className="t">{isEditing ? 'Edit Question Set' : 'Add New Question Set'}</div>
            <div className="s">{(SESSION_TYPES[sessionType] || SESSION_TYPES.objective).label} session · set the details, then build the questions</div>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="cbtq-modal-body">
          <Form>
            <div>
            <Form.Group controlId="formSessionType">
              <Form.Label className="form-label">Session Type:</Form.Label>
              <Form.Select
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value)}
                className="form-control"
                
              >
                <option value="objective">Objective (Multiple Choice)</option>
                <option value="completion">Completion (Fill-in-the-Blank)</option>
                <option value="essay">Essay (Free Text)</option>
              </Form.Select>
              {sessionType === 'completion' && (
                <small className="text-muted" style={{display: 'block', marginTop: '8px'}}>
                  💡 Completion questions use fill-in-the-blank format. Upload a JSON file with expected answers and synonyms.
                </small>
              )}
              {sessionType === 'essay' && (
                <small className="text-muted" style={{display: 'block', marginTop: '8px'}}>
                  💡 Essay questions use free-text format. Upload a JSON file with keywords and scoring criteria.
                </small>
              )}
            </Form.Group>
            <Form.Group controlId="formSubject">
              <Form.Label className="form-label">Subject:</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter subject"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                className="form-control"
                
                list="subjectOptions"
              />
              <datalist id="subjectOptions">
                {subjectChoicesFor(newClass).map((subject, index) => (
                  <option key={index} value={subject} />
                ))}
              </datalist>
            </Form.Group>
            <Form.Group controlId="formClass">
              <Form.Label  className="form-label">Class:</Form.Label>
              <Form.Select
                value={newClass}
                    onChange={(e) => setNewClass(e.target.value)}
                    className="form-control"
                
              >
                <option value="">Select class</option>
                {myClassOptions.map((cls) => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="formTerm">
              <Form.Label  className="form-label">Term:</Form.Label>
              <Form.Select
                value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    className="form-control"
                
              >
                <option value="">Select term</option>
                <option value="First Term">First Term</option>
                <option value="Second Term">Second Term</option>
                <option value="Third Term">Third Term</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="formDuration">
              <Form.Label  className="form-label">Duration (in minutes):</Form.Label>
              <Form.Control
                type="number"
                placeholder="Enter duration"
                value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    className="form-control"
                
              />
            </Form.Group>
            <Form.Group controlId="formPurpose">
              <Form.Label  className="form-label">Purpose:</Form.Label>
              <Form.Select
                value={newPurpose}
                onChange={(e) => setNewPurpose(e.target.value)}
                className="form-control"
                
              >
                <option value="practice">Practice</option>
                <option value="midterm">Midterm</option>
                <option value="exam">Exam</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="formImage">
              <Form.Label  className="form-label">Image:</Form.Label>
              <Form.Control
                type="file"
                    onChange={handleImageChange}
                    className="form-control"
                
              />
              {newImage && <img src={newImage} alt="" style={{ marginTop: '10px', maxHeight: '200px' }} />}
            </Form.Group>
            </div>
                <div className="cbtq-qbox">
                  <p className="cbtq-qbox-head"><RiFileListLine /> Questions Session</p>
            {questionsData.map((question, questionIndex) => (
              <div key={questionIndex} className="cbtq-qitem">
                <Form.Group controlId={`formQuestion${questionIndex}`}>
                  <Form.Label>Question {questionIndex + 1}</Form.Label>
                  <div className="cbtq-qitem-row">
                  <Form.Control
                    type="text"
                    placeholder="Enter question"
                    value={question.questionText}
                    onChange={(e) => handleQuestionChange(questionIndex, 'questionText', e.target.value)}
                    className="form-control"
                
                  />
                  <Button className="cbtq-btn red cbtq-delq" onClick={() => deleteQuestion(questionIndex)}>
                    <RiDeleteBin6Line /> Remove
                    </Button>
                    </div>
                </Form.Group>
                
                {/* Render different fields based on session type */}
                {sessionType === 'objective' && question.answerOptions && (
                  <>
                    {question.answerOptions.map((option, optionIndex) => (
                      <Form.Group controlId={`formOption${questionIndex}-${optionIndex}`} key={optionIndex}>
                        <Form.Label className="cbtq-optlabel">Option {optionIndex + 1}:</Form.Label>
                        <div style={{justifyContent: 'center', alignItems: 'center', display: 'flex', flexDirection: 'column', gap: '10px'}}>
                        <div className="cbtq-optrow">
                        <Form.Control
                          type="text"
                          placeholder={`Enter option ${optionIndex + 1}`}
                          value={option.answerText}
                          onChange={(e) => handleOptionChange(questionIndex, optionIndex, 'answerText', e.target.value)}
                          className='form-control'
                        />
                        <Button className="cbtq-btn soft" style={{ color: '#d64c5b', flex: '0 0 auto' }} onClick={() => deleteOption(questionIndex, optionIndex)}>
                          <RiCloseLine /> Remove
                        </Button>
                        </div>
                        <Form.Check
                          type="radio"
                          label="  Correct Answer"
                          name={`correctAnswer${questionIndex}`}
                          checked={option.isCorrect}
                          onChange={() => handleOptionChange(questionIndex, optionIndex, 'isCorrect', true)}
                        />
                        </div>
                      </Form.Group>
                    ))}
                    <Button className="cbtq-btn blue" style={{marginBottom: '20px'}} onClick={() => addNewOption(questionIndex)}>
                      <RiAddLine /> Add Option
                    </Button>
                  </>
                )}
                
                {sessionType === 'completion' && (
                  <>
                    <Form.Group controlId={`formExpectedAnswers${questionIndex}`}>
                      <Form.Label className="cbtq-optlabel">Expected Answers (comma-separated):</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="e.g., Paris, paris, PARIS"
                        value={(question.expectedAnswers || []).join(', ')}
                        onChange={(e) => handleQuestionChange(questionIndex, 'expectedAnswers', e.target.value.split(',').map(s => s.trim()))}
                        className='form-control'
                      />
                      <small className="text-muted">All acceptable exact answers</small>
                    </Form.Group>
                    
                    <Form.Group controlId={`formSynonyms${questionIndex}`} style={{marginTop: '15px'}}>
                      <Form.Label className="cbtq-optlabel">Acceptable Synonyms (comma-separated):</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="e.g., city, capital, place"
                        value={(question.acceptableSynonyms || []).join(', ')}
                        onChange={(e) => handleQuestionChange(questionIndex, 'acceptableSynonyms', e.target.value.split(',').map(s => s.trim()))}
                        className='form-control'
                      />
                      <small className="text-muted">Related words that should be accepted</small>
                    </Form.Group>
                    
                    <Form.Group controlId={`formKeywords${questionIndex}`} style={{marginTop: '15px'}}>
                      <Form.Label className="cbtq-optlabel">Required Keywords (comma-separated):</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="e.g., france, europe, eiffel"
                        value={(question.requiredKeywords || []).join(', ')}
                        onChange={(e) => handleQuestionChange(questionIndex, 'requiredKeywords', e.target.value.split(',').map(s => s.trim()))}
                        className='form-control'
                      />
                      <small className="text-muted">Keywords that must appear in the answer</small>
                    </Form.Group>
                    
                    <Form.Group controlId={`formPoints${questionIndex}`} style={{marginTop: '15px'}}>
                      <Form.Label className="cbtq-optlabel">Points:</Form.Label>
                      <Form.Control
                        type="number"
                        placeholder="1"
                        value={question.points || 1}
                        onChange={(e) => handleQuestionChange(questionIndex, 'points', parseInt(e.target.value))}
                        className='form-control'
                      />
                    </Form.Group>
                  </>
                )}
                
                {sessionType === 'essay' && (
                  <>
                    <Form.Group controlId={`formExpectedAnswer${questionIndex}`}>
                      <Form.Label className="cbtq-optlabel">Expected Answer (model answer):</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        placeholder="Enter the ideal/model answer..."
                        value={question.expectedAnswer || ''}
                        onChange={(e) => handleQuestionChange(questionIndex, 'expectedAnswer', e.target.value)}
                        className='form-control'
                      />
                      <small className="text-muted">The ideal answer for comparison</small>
                    </Form.Group>
                    
                    <Form.Group controlId={`formKeywords${questionIndex}`} style={{marginTop: '15px'}}>
                      <Form.Label className="cbtq-optlabel">Required Keywords (comma-separated):</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="e.g., photosynthesis, chlorophyll, sunlight, glucose"
                        value={(question.requiredKeywords || []).join(', ')}
                        onChange={(e) => handleQuestionChange(questionIndex, 'requiredKeywords', e.target.value.split(',').map(s => s.trim()))}
                        className='form-control'
                      />
                      <small className="text-muted">Important concepts that should be mentioned</small>
                    </Form.Group>
                    
                    <Form.Group controlId={`formSynonyms${questionIndex}`} style={{marginTop: '15px'}}>
                      <Form.Label className="cbtq-optlabel">Acceptable Synonyms (comma-separated):</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="e.g., energy, power, fuel"
                        value={(question.acceptableSynonyms || []).join(', ')}
                        onChange={(e) => handleQuestionChange(questionIndex, 'acceptableSynonyms', e.target.value.split(',').map(s => s.trim()))}
                        className='form-control'
                      />
                      <small className="text-muted">Alternative terms that are acceptable</small>
                    </Form.Group>
                    
                    <Form.Group controlId={`formMinWords${questionIndex}`} style={{marginTop: '15px'}}>
                      <Form.Label className="cbtq-optlabel">Minimum Word Count:</Form.Label>
                      <Form.Control
                        type="number"
                        placeholder="50"
                        value={question.minWords || 50}
                        onChange={(e) => handleQuestionChange(questionIndex, 'minWords', parseInt(e.target.value))}
                        className='form-control'
                      />
                      <small className="text-muted">Minimum words required in the student&apos;s answer</small>
                    </Form.Group>
                    
                    <Form.Group controlId={`formPoints${questionIndex}`} style={{marginTop: '15px'}}>
                      <Form.Label className="cbtq-optlabel">Points:</Form.Label>
                      <Form.Control
                        type="number"
                        placeholder="10"
                        value={question.points || 10}
                        onChange={(e) => handleQuestionChange(questionIndex, 'points', parseInt(e.target.value))}
                        className='form-control'
                      />
                    </Form.Group>
                  </>
                )}
              </div>
            ))}
              <Button className="cbtq-btn green" style={{ marginTop: '16px' }} onClick={addNewQuestion}>
                  <RiAddLine /> Add Question
                </Button>
                </div>
            </Form>
          </Modal.Body>
          <Modal.Footer className="cbtq-modal-foot">
            <button type="button" className="cbtq-cancel" onClick={() => setShowModal(false)}>
              <RiCloseLine /> Close
            </button>
            <Button className="cbtq-btn green" onClick={isEditing ? handleSaveEditQuestion : handleSaveQuestion}>
              {isEditing ? <RiEditLine /> : <RiAddLine />} {buttonText}
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Custom Alert Modal — entry method chooser */}
        <Modal show={showCustomAlert} onHide={() => setShowCustomAlert(false)} centered contentClassName="cbtq-modal-content">
          <Modal.Header className="cbtq-modal-head" closeButton closeVariant="white">
            <Modal.Title>
              <div className="t">Select Question Entry Method</div>
              <div className="s">
                {(SESSION_TYPES[sessionType] || SESSION_TYPES.objective).label} session — how would you like to add questions?
              </div>
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="cbtq-modal-body" style={{ paddingBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              <button type="button" className="cbtq-choice manual" onClick={handleManualEntry}>
                <span className="ic"><RiFileEditLine /></span>
                {sessionType === 'objective' ? 'Insert Questions Manually' : 'Add Manually'}
                <span className="hint">
                  {sessionType === 'objective'
                    ? 'Type the question and its answer options inline'
                    : sessionType === 'completion'
                      ? 'Enter question, expected answers, synonyms and keywords'
                      : 'Enter question, expected answer, keywords and minimum words'}
                </span>
              </button>
              <button type="button" className="cbtq-choice upload" onClick={handleDocumentUpload}>
                <span className="ic"><RiUploadCloud2Line /></span>
                {sessionType === 'objective' ? 'Upload from File' : 'Upload JSON File'}
                <span className="hint">Use the downloaded template as a guide</span>
              </button>
            </div>
          </Modal.Body>
        </Modal>
    </div>
  );
};

export default CbtQuestions;

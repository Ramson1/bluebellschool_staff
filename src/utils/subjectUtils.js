// Utility functions for subject abbreviations and standardized remarks

// Subject abbreviation mapping
const SUBJECT_ABBREVIATIONS = {
  'Physical and Health Education': 'P H E',
  'Information & Communication Technology': 'ICT', 
  'Cultural and creative arts': 'C C A',
  'Christian Religious Knowledge': 'C R S',
  'Basic Science': 'Basic Science',
  'English Studies': 'English Studies',
  'Mathematics': 'Mathematics',
  'Social Studies': 'Social Studies',
  'Fine Art': 'Fine Art',
  'French': 'French',
  'Business Studies': 'Business Studies',
  'Home Economics': 'Home Economics',
  'Agricultural Science': 'Agric Science',
  'Literature': 'Literature',
  'Government': 'Government',
  'Commerce': 'Commerce',
  'Economics': 'Economics',
  'Geography': 'Geography',
  'History': 'H I S',
  'Accounting': 'Accounting',
  'Further Mathematics': 'Further Math',
  'Chemistry': 'Chemistry',
  'Physics': 'Physics',
  'Biology': 'Biology'
};

// Reverse mapping for expanding abbreviations back to full names
const ABBREVIATION_TO_FULL = Object.fromEntries(
  Object.entries(SUBJECT_ABBREVIATIONS).map(([full, abbr]) => [abbr, full])
);

// Function to abbreviate subject names
export function abbreviateSubject(subjectName) {
  // First check if it's already an abbreviation
  if (ABBREVIATION_TO_FULL[subjectName]) {
    return subjectName; // Already abbreviated
  }
  
  // Check if we have a direct mapping
  if (SUBJECT_ABBREVIATIONS[subjectName]) {
    return SUBJECT_ABBREVIATIONS[subjectName];
  }
  
  // For compound subjects like "English Language & Literature"
  // Try to find partial matches
  for (const [full, abbr] of Object.entries(SUBJECT_ABBREVIATIONS)) {
    if (subjectName.includes(full)) {
      return abbr;
    }
  }
  
  // If no mapping found, return original name
  return subjectName;
}

// Function to expand abbreviated subject names
export function expandSubjectAbbreviation(abbr) {
  return ABBREVIATION_TO_FULL[abbr] || abbr;
}

// Standardized remarks for student performance
export const STANDARD_REMARKS = [
  'Excellent',
  'Very good', 
  'Good',
  'Fair',
  'Poor',
  'Outstanding',
  'Satisfactory',
  'More effort',
  'Great effort',
  'Needs improvement',
  'Satisfactory progress',
  'Outstanding performance'
];

// Grade-based remarks mapping
export const GRADE_REMARKS = {
  'A+': ['Excellent', 'Outstanding', 'Exceptional'],
  'A': ['Very good', 'Outstanding', 'Superior'],
  'B+': ['Good', 'Satisfactory', 'Above average'],
  'B': ['Good', 'Satisfactory', 'Competent'],
  'C+': ['Fair', 'Average', 'Acceptable'],
  'C': ['Fair', 'Average', 'Basic'],
  'D': ['Poor', 'Below average', 'Needs improvement'],
  'E': ['Poor', 'Unsatisfactory', 'Requires more effort']
};

// Function to get standard remarks for a grade
export function getStandardRemarks(grade) {
  return GRADE_REMARKS[grade] || ['Needs improvement'];
}

// Function to check if a remark is standard
export function isStandardRemark(remark) {
  return STANDARD_REMARKS.includes(remark);
}

// Subject normalization mapping (handles common variations and abbreviations)
const SUBJECT_NORMALIZATION_MAP = {
  // Cultural and Creative Arts
  'c c a': 'Cultural and creative arts',
  'cca': 'Cultural and creative arts',
  'cultural & creative arts': 'Cultural and creative arts',
  'cultural and creative art': 'Cultural and creative arts',
  
  // Christian Religious Knowledge
  'c r k': 'Christian Religious Knowledge',
  'crk': 'Christian Religious Knowledge',
  'c r s': 'Christian Religious Knowledge',
  'crs': 'Christian Religious Knowledge',
  'christian religious studies': 'Christian Religious Knowledge',
  'christain religious studies': 'Christian Religious Knowledge',
  
  // Physical and Health Education
  'p h e': 'Physical and Health Education',
  'phe': 'Physical and Health Education',
  'physical & health education': 'Physical and Health Education',
  
  // Information & Communication Technology
  'i c t': 'Information & Communication Technology',
  'ict': 'Information & Communication Technology',
  'information and computer technology': 'Information & Communication Technology',
  'information & computer technology': 'Information & Communication Technology',
  'information and communication technology': 'Information & Communication Technology',
  'information & communication technology': 'Information & Communication Technology',
  'unformation & computer technology': 'Information & Communication Technology',
  'unformation and computer technology': 'Information & Communication Technology',
  
  // English / English Language variations
  'englishlanguage': 'English',
  'english language': 'English',
  'englishstudies': 'English Studies',
  'english studies': 'English Studies',
  
  // Pre-Vocational Studies
  'p v s': 'Pre-Vocational',
  'pvs': 'Pre-Vocational',
  'pre vocational': 'Pre-Vocational',
  
  // P. S. H. E variations
  'p. s. h. e': 'P. S. H. E',
  'p s h e': 'P. S. H. E',
  'pshe': 'P. S. H. E',
  'p.s.h.e': 'P. S. H. E',
  
  // History variations
  'h i s': 'History',
  'his': 'History',
  'h.i.s': 'History',
  
  // Others
  'maths': 'Numeracy', // Assuming for lower classes or verify? Wait, year 7+ uses Mathematics. Lower uses Numeracy.
  // Actually, let's stick to the specific ones mentioned and obvious abbreviations.
  // 'maths' -> 'Mathematics' is safer for upper classes, but lower uses Numeracy.
  // I'll leave 'maths' out for now unless I see it.
};

// Function to normalize subject names to canonical form
export function normalizeSubjectName(subjectName) {
  if (!subjectName) return subjectName;
  
  const normalized = subjectName.toLowerCase().trim().replace(/\s+/g, ' ');
  
  // Direct check in normalization map
  if (SUBJECT_NORMALIZATION_MAP[normalized]) {
    return SUBJECT_NORMALIZATION_MAP[normalized];
  }
  
  // Check against abbreviations (reverse mapping)
  // We need to handle case insensitivity for ABBREVIATION_TO_FULL keys too
  const abbrEntry = Object.entries(ABBREVIATION_TO_FULL).find(([abbr]) => 
    abbr.toLowerCase().replace(/\s+/g, '') === normalized.replace(/\s+/g, '')
  );
  
  if (abbrEntry) {
    return abbrEntry[1];
  }

  return subjectName;
}

// Export the mappings for direct access
export { SUBJECT_ABBREVIATIONS, ABBREVIATION_TO_FULL };

export const schoolSubjects = {
  creche: [
    "Literacy",
    "Numeracy",
    "General Subjects",
    "Pre-writing",
    "Christian Religious Knowledge",
    "Diction"
  ],
  "pre-nursery1": [
    "Literacy",
    "Numeracy",
    "General Subjects",
    "Pre-writing",
    "Christian Religious Knowledge",
    "Arts and Craft",
    "Diction",
  ],
  "pre-nursery2": [
    "Literacy",
    "Numeracy",
    "General Subjects",
    "Pre-writing",
    "Christian Religious Knowledge",
    "Arts and Craft",
    "Diction"
  ],
  nursery: [
    "Literacy",
    "Numeracy",
    "General Subjects",
    "Pre-writing",
    "Christian Religious Knowledge",
    "Arts and Craft",
    "Diction"
  ],
  year1: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Pre-Vocational",
    "Numeracy",
    "P. S. H. E",
    "Critical Thinking",
    "Literacy",
    "Diction",
    "Cultural and creative arts",
    "Geography",
    "Christian Religious Knowledge",
    "Music",
    "Handwriting"
  ],
  year2: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Pre-Vocational",
    "Numeracy",
    "P. S. H. E",
    "Critical Thinking",
    "Literacy",
    "Diction",
    "Cultural and creative arts",
    "Geography",
    "Christian Religious Knowledge",
    "Music",
    "Handwriting"
  ],
  year3: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Pre-Vocational",
    "Numeracy",
    "P. S. H. E",
    "Critical Thinking",
    "Literacy",
    "Diction",
    "Cultural and creative arts",
    "Geography",
    "Christian Religious Knowledge",
    "Music",
    "Handwriting"
  ],
  year4: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Pre-Vocational",
    "Numeracy",
    "P. S. H. E",
    "Critical Thinking",
    "Literacy",
    "Diction",
    "Cultural and creative arts",
    "Geography",
    "Christian Religious Knowledge",
    "Music",
    "Handwriting"
  ],
  year5: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Pre-Vocational",
    "Numeracy",
    "P. S. H. E",
    "Critical Thinking",
    "Literacy",
    "Diction",
    "Cultural and creative arts",
    "Geography",
    "Christian Religious Knowledge",
    "Music",
    "Handwriting"
  ],
  year6: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Pre-Vocational",
    "Numeracy",
    "P. S. H. E",
    "Critical Thinking",
    "Literacy",
    "Diction",
    "Cultural and creative arts",
    "Geography",
    "Christian Religious Knowledge",
    "Music",
    "Handwriting"
  ],
  year7: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Home Economics",
    "Basic Technology",
    "History",
    "Literature",
    "Diction",
    "Cultural and creative arts",
    "Biology",
    "Business Studies",
    "Christian Religious Knowledge",
    "Music",
    "Civic Education",
    "Social Studies",
    "Agriculture Studies",
    "Physics",
    "Chemistry",
    "Handwriting",
    "Mathematics",
    "English"
  ],
  year8: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Home Economics",
    "Basic Technology",
    "History",
    "Literature",
    "Diction",
    "Cultural and creative arts",
    "Biology",
    "Business Studies",
    "Christian Religious Knowledge",
    "Music",
    "Civic Education",
    "Social Studies",
    "Agriculture Studies",
    "Physics",
    "Chemistry",
    "Handwriting",
    "Mathematics",
    "English"
  ],
  year9: [
    "Basic Science",
    "Physical and Health Education",
    "Information & Communication Technology",
    "Home Economics",
    "Basic Technology",
    "History",
    "Literature",
    "Diction",
    "Cultural and creative arts",
    "Biology",
    "Business Studies",
    "Christian Religious Knowledge",
    "Music",
    "Civic Education",
    "Social Studies",
    "Agriculture Studies",
    "Physics",
    "Chemistry",
    "Handwriting",
    "Mathematics",
    "English"
  ]
};

// Senior secondary classes share the Year 9 subject set; kept as explicit keys
// so /year(\d+)/ lookups resolve for every class the portal can pick (Year 1-12).
schoolSubjects.year10 = schoolSubjects.year9;
schoolSubjects.year11 = schoolSubjects.year9;
schoolSubjects.year12 = schoolSubjects.year9;

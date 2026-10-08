// Shared role helpers for new feature pages.
// Existing pages keep their inline checks; new pages should use these.
// Tables: bluebell_userauth (admin), bluebell_teacherauth (teacher), devauth (developer),
// bluebell_secretaryauth (secretary — read-only dashboard access).

// Built-in developer accounts — always treated as developer even if the
// devauth table is missing or does not contain them yet.
export const DEV_EMAILS = [
  'blackboxinfo01@gmail.com',
  'rhemaexpertsolutions@gmail.com',
];

const norm = (e) => (e || '').toLowerCase();

export async function fetchAuthRoles(supabase) {
  const [adminRes, teacherRes, devRes, secretaryRes] = await Promise.allSettled([
    supabase.from('bluebell_userauth').select('email'),
    supabase.from('bluebell_teacherauth').select('email'),
    supabase.from('devauth').select('email'),
    // table may not exist until platform_staff_management_setup.sql runs —
    // allSettled keeps a failure here harmless (resolves to [])
    supabase.from('bluebell_secretaryauth').select('email'),
  ]);

  const unwrap = (res) =>
    res.status === 'fulfilled' && !res.value.error ? (res.value.data || []) : [];

  const devEmails = unwrap(devRes).map((r) => r.email);
  return {
    adminEmails: unwrap(adminRes).map((r) => r.email),
    teacherEmails: unwrap(teacherRes).map((r) => r.email),
    secretaryEmails: unwrap(secretaryRes).map((r) => r.email),
    // merge fallback developer emails (deduped, case-insensitive)
    devEmails: [...new Set([...devEmails, ...DEV_EMAILS].map(norm))],
  };
}

export const isAdmin = (email, adminEmails = []) =>
  !!email && adminEmails.includes(email);

export const isTeacher = (email, teacherEmails = []) =>
  !!email && teacherEmails.includes(email);

export const isSecretary = (email, secretaryEmails = []) =>
  !!email && secretaryEmails.map(norm).includes(norm(email));

export const isDev = (email, devEmails = []) =>
  !!email && (DEV_EMAILS.map(norm).includes(norm(email)) || devEmails.map(norm).includes(norm(email)));

// Any staff member allowed into the attendance taker
export const canTakeAttendance = (email, { adminEmails = [], teacherEmails = [], devEmails = [] } = {}) =>
  isAdmin(email, adminEmails) || isTeacher(email, teacherEmails) || isDev(email, devEmails);

// Staff attendance management: admin + dev only (teachers must NOT see it)
export const canManageStaffAttendance = (email, { adminEmails = [], devEmails = [] } = {}) =>
  isAdmin(email, adminEmails) || isDev(email, devEmails);

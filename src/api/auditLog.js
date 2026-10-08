// Audit trail helper — fire-and-forget inserts into bluebell_auditlogs.
// NEVER throws into user flows: audit failures must not break the app.
// Developer accounts are intentionally NOT tracked.

export const DEV_EMAILS_EXCLUDED = [
  'blackboxinfo01@gmail.com',
  'rhemaexpertsolutions@gmail.com',
];

/**
 * Log an admin/teacher action.
 * @param {object} supabase - supabase client
 * @param {object} entry
 * @param {string} entry.email    - actor email
 * @param {string} [entry.role]   - 'admin' | 'teacher' | 'staff'
 * @param {string} entry.action   - e.g. 'student_add', 'result_update'
 * @param {string} [entry.targetTable]
 * @param {string|number} [entry.recordId]
 * @param {object} [entry.details] - before/after snapshot (JSONB)
 */
export function logAction(supabase, { email, role, action, targetTable, recordId, details }) {
  try {
    if (!email || DEV_EMAILS_EXCLUDED.includes(email.toLowerCase()) || email === 'Unknown User') return;
    // Fire-and-forget — do not await in UI paths
    supabase
      .from('bluebell_auditlogs')
      .insert([{
        email,
        role: role || '',
        action,
        target_table: targetTable || '',
        record_id: recordId != null ? String(recordId) : '',
        details: details || {},
      }])
      .then(({ error }) => {
        if (error) console.warn('[audit] failed to log:', error.message);
      })
      .catch((e) => console.warn('[audit] unexpected error:', e));
  } catch (e) {
    console.warn('[audit] logAction error:', e);
  }
}

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
 * @param {string} [entry.name]   - actor display name (staff name); persisted as actor_name
 * @param {string} [entry.role]   - 'admin' | 'teacher' | 'staff'
 * @param {string} entry.action   - e.g. 'student_add', 'result_update'
 * @param {string} [entry.targetTable]
 * @param {string|number} [entry.recordId]
 * @param {object} [entry.details] - before/after snapshot (JSONB)
 */
export function logAction(supabase, { email, name, role, action, targetTable, recordId, details }) {
  try {
    const em = String(email || '').trim();
    const nm = String(name || '').trim();
    // Truly anonymous (no email AND no name) -> nothing to attribute, skip.
    if (!em && !nm) return;
    // Developers stay intentionally untracked whenever an email identifies them.
    if (em && DEV_EMAILS_EXCLUDED.includes(em.toLowerCase())) return;
    // Fire-and-forget — do not await in UI paths
    supabase
      .from('bluebell_auditlogs')
      .insert([{
        email: em || nm,          // email TEXT NOT NULL — fall back to the name
        actor_name: nm || null,   // human-readable snapshot of the actor
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

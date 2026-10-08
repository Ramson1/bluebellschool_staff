import { NextResponse } from 'next/server';
import { requireStaffCaller, serviceClient } from '@/src/utils/serverAuth.js';

// Columns a staff member may change on their own profile — everything else on
// jmis_staff is dropped before the write, so this endpoint cannot be used to
// alter a login email, a class/subject assignment, an account status, a staff
// number or the auth linkage, whatever the request body claims to contain.
const SELF_EDITABLE = ['name', 'sex', 'address', 'phone', 'designation', 'department', 'profile_pic', 'date_of_appointment'];
const SEXES = ['', 'Male', 'Female'];
const DEPARTMENTS = ['Academic', 'Non-Academic'];
// Columns that are dates rather than free text on jmis_staff. They come back
// from an <input type="date"> as 'YYYY-MM-DD' (or '' when cleared) and are
// stored in a DATE column, so they skip the text rule below and are cleared
// to null instead of being written as an empty string, which Postgres rejects.
const DATE_FIELDS = ['date_of_appointment'];

// PATCH /api/staff-self — self-service changes to the signed-in staff member's
// own account. Three actions, distinguished by the body:
//  { newEmail }                       → replace the provisional LOGIN email.
//    Staff start on an admin-created email and swap in their personal one from
//    the Profile page. Runs on the service-role key server-side; the caller must
//    be an active staff profile linked to their auth user, and only their own
//    account is ever touched. Signing in with the full name keeps working
//    regardless (resolved via jmis_staff), so a mistyped email is never a
//    lock-out.
//  { action: 'update_profile', profile } → edit their own details, limited to
//    SELF_EDITABLE. Class/subject assignment and email stay the admin's job.
//  { action: 'clear_password' }       → forget the password the admin issued.
//    Called right after the staff member sets their own password, so the admin's
//    developer-only column can never show a credential that no longer works.
//    Their new password stays unknown to us — Supabase keeps only its hash.
export async function PATCH(request) {
  try {
    const caller = await requireStaffCaller(request);
    if (!caller) {
      return NextResponse.json({ error: 'Sign-in required' }, { status: 401 });
    }

    const admin = serviceClient();

    // The caller's own staff profile (linked by auth user id, or the legacy
    // email match for records created outside this flow). Carries every
    // self-editable column so the update branch can diff against what is stored.
    const findOwn = async () => admin
      .from('jmis_staff')
      .select(`id, email, status, ${SELF_EDITABLE.join(', ')}`)
      .or(`auth_user_id.eq.${caller.id},email.eq.${caller.email}`)
      .limit(1)
      .maybeSingle();

    const body = await request.json().catch(() => ({}));

    if (body?.action === 'clear_password') {
      const { data: own, error: findErr } = await findOwn();
      if (findErr || !own) {
        return NextResponse.json({ error: 'No staff record is linked to this login' }, { status: 403 });
      }
      // Best effort: the staff member's own password change has already
      // succeeded, so a missing/hedged credential store must not show as a
      // failure on their Profile page.
      let cleared = false;
      try {
        const { error } = await admin.from('jmis_staff_credentials').delete().eq('staff_id', own.id);
        cleared = !error;
      } catch { /* store not created yet — nothing to clear */ }
      return NextResponse.json({ ok: true, cleared });
    }

    if (body?.action === 'update_profile') {
      const { data: own, error: findErr } = await findOwn();
      if (findErr || !own) {
        return NextResponse.json({ error: 'No staff record is linked to this login' }, { status: 403 });
      }
      if (own.status && own.status !== 'active') {
        return NextResponse.json({ error: 'Your account is not active — contact the administrator' }, { status: 403 });
      }

      // Keep only the permitted columns, and only text values (every editable
      // column on jmis_staff is text apart from the DATE_FIELDS below). Unknown
      // keys are silently dropped.
      const src = body.profile || {};
      const patch = {};
      for (const key of SELF_EDITABLE) {
        if (!(key in src)) continue;
        if (DATE_FIELDS.includes(key)) continue; // validated as a date further down
        if (src[key] !== null && typeof src[key] !== 'string') {
          return NextResponse.json({ error: `"${key}" must be text` }, { status: 400 });
        }
        patch[key] = String(src[key] ?? '').trim();
      }
      for (const key of DATE_FIELDS) {
        if (!(key in src)) continue;
        patch[key] = String(src[key] ?? '').trim() || null;
      }
      // Only write what actually changed. Beyond a smaller UPDATE, this is what
      // keeps a strange legacy value from blocking the rest of the form: the
      // page posts the whole record, so a phone stored as "(0801) 234-5678" or
      // an old free-text photo comes back untouched, and untouched fields are
      // not re-validated.
      for (const key of Object.keys(patch)) {
        if (patch[key] === String(own[key] ?? '').trim()) delete patch[key];
      }
      if (!Object.keys(patch).length) {
        return NextResponse.json({ ok: true, unchanged: true, staff: own });
      }

      if ('name' in patch) {
        patch.name = patch.name.replace(/\s+/g, ' ');
        if (patch.name.length < 3) {
          return NextResponse.json({ error: 'Full name is required (at least 3 characters)' }, { status: 400 });
        }
        if (patch.name.length > 80) {
          return NextResponse.json({ error: 'Full name is too long (max 80 characters)' }, { status: 400 });
        }
        // A name is a sign-in handle: StaffLogin resolves name → email before
        // signing in, so two staff sharing one name breaks login for both.
        // Same reasoning as the email clash check below.
        const { data: nameClash } = await admin
          .from('jmis_staff')
          .select('id')
          .ilike('name', patch.name)
          .neq('id', own.id)
          .maybeSingle();
        if (nameClash) {
          return NextResponse.json({ error: 'That name is already used by another staff member — sign-in resolves names, so they must stay unique' }, { status: 409 });
        }
      }
      if ('sex' in patch && !SEXES.includes(patch.sex)) {
        return NextResponse.json({ error: 'Sex must be Male or Female' }, { status: 400 });
      }
      if ('department' in patch && !DEPARTMENTS.includes(patch.department)) {
        return NextResponse.json({ error: 'Department must be Academic or Non-Academic' }, { status: 400 });
      }
      if (patch.phone && !/^\+?[\d\s-]{7,20}$/.test(patch.phone)) {
        return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 });
      }
      if (patch.address && patch.address.length > 300) {
        return NextResponse.json({ error: 'Address is too long (max 300 characters)' }, { status: 400 });
      }
      // Date of appointment: the calendar input sends YYYY-MM-DD, and a real
      // calendar date must exist (2026-02-30 is refused, not just badly formed).
      if ('date_of_appointment' in patch && patch.date_of_appointment) {
        const d = patch.date_of_appointment;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)) || d.slice(0, 10) !== d) {
          return NextResponse.json({ error: 'Date of appointment must be a valid date (YYYY-MM-DD)' }, { status: 400 });
        }
      }
      // A new photo must be a public URL (what the upload returns) or a plain
      // storage path — never markup, since this renders inside <img src>.
      if ('profile_pic' in patch && patch.profile_pic) {
        const okShape = /^(https?:\/\/\S+|[\w./-]+)$/i.test(patch.profile_pic) && patch.profile_pic.length <= 400;
        if (!okShape) {
          return NextResponse.json({ error: 'Unrecognised photo reference' }, { status: 400 });
        }
      }

      const { data: updated, error } = await admin
        .from('jmis_staff')
        .update(patch)
        .eq('id', own.id)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: `Could not save your details: ${error.message}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, staff: updated });
    }

    const { newEmail } = body || {};
    const email = String(newEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    const { data: staff, error: fetchErr } = await findOwn();
    if (fetchErr || !staff) {
      return NextResponse.json({ error: 'No staff record is linked to this login' }, { status: 403 });
    }
    if (staff.status && staff.status !== 'active') {
      return NextResponse.json({ error: 'Your account is not active — contact the administrator' }, { status: 403 });
    }
    if ((staff.email || '').toLowerCase() === email) {
      return NextResponse.json({ ok: true, email, unchanged: true });
    }

    // Reject emails already used by another staff profile
    const { data: clash } = await admin
      .from('jmis_staff')
      .select('id')
      .ilike('email', email)
      .neq('id', staff.id)
      .maybeSingle();
    if (clash) {
      return NextResponse.json({ error: 'That email is already used by another staff account' }, { status: 409 });
    }

    const { error: authErr } = await admin.auth.admin.updateUserById(caller.id, { email });
    if (authErr) {
      const taken = /already/i.test(authErr.message || '');
      return NextResponse.json(
        { error: taken ? 'That email is already registered — use a different one' : `Could not update email: ${authErr.message}` },
        { status: taken ? 409 : 500 }
      );
    }

    // Keep the profile + teacher-access list in sync with the new login email
    await admin.from('jmis_staff').update({ email }).eq('id', staff.id);
    try {
      await admin.from('jmis_teacherauth').update({ email }).eq('email', (staff.email || '').toLowerCase());
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, email });
  } catch (error) {
    console.error('staff-self PATCH error:', error);
    const msg = String(error?.message || '').includes('SERVICE_ROLE')
      ? 'Server is missing SUPABASE_SERVICE_ROLE_KEY'
      : error.message || 'Request failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

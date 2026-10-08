// Server-only helpers for the staff portal's own API routes.
// Mirrors bluebellschool/src/utils/serverAdminAuth.ts but for STAFF callers:
// resolves the bearer token of the signed-in staff member and exposes a
// service-role client for safe self-service changes (login email).
// The service-role key lives only in server env (SUPABASE_SERVICE_ROLE_KEY)
// and must never be exposed to the browser.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server');
  }
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Resolve the signed-in staff caller from the Authorization bearer token the
// browser app sends. Returns the Supabase user (id + email) or null.
export async function requireStaffCaller(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await anonClient().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

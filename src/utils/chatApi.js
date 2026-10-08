// ---------------------------------------------------------------------------
// Shared chat data layer (parent <-> school). Used by the Student portal, the
// Staff portal and the Admin dashboard against the SAME Supabase project.
// Tables + columns are defined in bluebellschool/src/api/jmis_chat_setup.sql.
//
// A conversation is a 2-party thread between one student/parent and one
// "school side" participant (a class teacher, or the general Admin/Office).
// Identity is carried per call because parents have no auth account.
// ---------------------------------------------------------------------------

import { supabase } from "../supabaseClient.js";

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MB per file
const BUCKET = "passport"; // existing public bucket; chat files live under chat/
const PREFIX = "chat";

export const fmtSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const pairKey = (studentId, schoolType, teacherStaffId) =>
  `${studentId}:${schoolType}:${teacherStaffId || ""}`;

// ---- conversations ---------------------------------------------------------

export async function openConversation(c) {
  const pk = pairKey(String(c.studentId), c.schoolType, c.teacherStaffId ? String(c.teacherStaffId) : "");
  const { data: existing } = await supabase
    .from("jmis_chat_conversations").select("*").eq("pair_key", pk).maybeSingle();
  if (existing) return existing;
  const { data: inserted, error } = await supabase
    .from("jmis_chat_conversations")
    .insert({
      pair_key: pk,
      student_id: String(c.studentId),
      student_name: c.studentName || "",
      student_class: c.studentClass || "",
      school_type: c.schoolType,
      teacher_staff_id: c.teacherStaffId ? String(c.teacherStaffId) : null,
      school_label: c.schoolLabel || "School Admin/Office",
    })
    .select().single();
  if (error) {
    // Another tab may have created it concurrently — refetch before failing.
    const { data: again } = await supabase
      .from("jmis_chat_conversations").select("*").eq("pair_key", pk).maybeSingle();
    if (again) return again;
    throw error;
  }
  return inserted;
}

export async function listConversations(filter) {
  let q = supabase.from("jmis_chat_conversations").select("*");
  if (filter?.studentId) q = q.eq("student_id", String(filter.studentId));
  // A staff member sees every thread addressed to them: parent<->teacher
  // (school_type 'teacher') AND office<->staff from the admin dashboard
  // (school_type 'admin'). Both carry teacher_staff_id = this staff id; general
  // parent<->office threads have a NULL teacher_staff_id and stay hidden.
  if (filter?.teacherStaffId) q = q.eq("teacher_staff_id", String(filter.teacherStaffId));
  if (filter?.adminAll) q = q; // admin sees every thread
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
  if (error) throw error;
  return data || [];
}

// ---- messages --------------------------------------------------------------

export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from("jmis_chat_messages").select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

export async function sendMessage({ conversationId, me, body, attachment, replyToId }) {
  const { data, error } = await supabase
    .from("jmis_chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_side: me.side,
      sender_key: me.key || "",
      sender_name: me.name || "",
      body: (body || "").trim(),
      reply_to_id: replyToId || null,
      attachment_url: attachment?.url || null,
      attachment_name: attachment?.name || null,
      attachment_mime: attachment?.mime || null,
      attachment_size: attachment?.size || null,
    })
    .select().single();
  if (error) throw error;
  await supabase.from("jmis_chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  return data;
}

export async function editMessage(id, body) {
  const { data, error } = await supabase
    .from("jmis_chat_messages")
    .update({ body: (body || "").trim(), edited_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMessage(id) {
  const { error } = await supabase
    .from("jmis_chat_messages")
    .update({ deleted: true, body: "", attachment_url: null, attachment_name: null, attachment_mime: null, attachment_size: null })
    .eq("id", id);
  if (error) throw error;
}

export async function uploadAttachment(conversationId, file) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 2 MB.`);
  }
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${PREFIX}/${conversationId}/${Date.now()}_${rand}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, name: file.name, mime: file.type, size: file.size };
}

// ---- scoped contact discovery ---------------------------------------------

// Teachers responsible for a class (class_teacher assignments, then the
// class_assigned column as a fallback). Returns [{ staffId, name }].
export async function findClassTeachers(className) {
  const out = [];
  try {
    const { data: asg } = await supabase
      .from("jmis_staff_assignments").select("staff_id")
      .eq("assignment_type", "class_teacher").eq("class", className).limit(20);
    const ids = [...new Set((asg || []).map((a) => a.staff_id).filter(Boolean))].map(String);
    if (ids.length) {
      const { data: staff } = await supabase.from("jmis_staff").select("id, name").in("id", ids);
      (staff || []).forEach((s) => out.push({ staffId: String(s.id), name: s.name || "Class Teacher" }));
    }
  } catch (_) {/* ignore */}
  if (!out.length) {
    try {
      const { data: staff } = await supabase.from("jmis_staff").select("id, name").eq("class_assigned", className).limit(10);
      (staff || []).forEach((s) => out.push({ staffId: String(s.id), name: s.name || "Class Teacher" }));
    } catch (_) {/* ignore */}
  }
  return out;
}

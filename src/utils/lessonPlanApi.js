// Shared data layer for the Lesson Plan builder.
// Used by the staff portal (teachers author) and the admin dashboard (review).
// It talks to the existing jmis_lesson_plans table, which the migration
// jmis_lesson_plan_builder_setup.sql widened with the paper-template fields.

import { supabase } from "../supabaseClient.js";

export const TABLE = "jmis_lesson_plans";
export const REVIEW_STATUSES = ["pending", "reviewed", "approved", "revision"];

// A blank plan with the paper template's default Lesson-Structure rows.
export function emptyPlan() {
  return {
    class: "",
    subject: "",
    academic_session: "",
    term: "",
    week: "",
    topic: "",
    sub_topic: "",
    lesson_no: "",
    duration: "",
    age: "",
    lesson_date: "",
    objectives: "",
    prior_knowledge: "",
    resources: "",
    possible_problems: "",
    steps: defaultSteps(),
    evaluation: "",
    homework: "",
    teacher_name: "",
    head_teacher: "",
    review_status: "pending",
  };
}

// Sensible starting scaffold that mirrors the school's form (Lead-in + steps).
export function defaultSteps() {
  return [
    { step: "Lead in / Motivation", time: "", teacher: "", student: "" },
    { step: "Step / Activity 1", time: "", teacher: "", student: "" },
    { step: "Step / Activity 2", time: "", teacher: "", student: "" },
    { step: "Step / Activity 3", time: "", teacher: "", student: "" },
  ];
}

// Normalise a raw DB row into the shape the form + document expect.
export function normalize(row) {
  let steps = row.steps;
  if (typeof steps === "string") {
    try { steps = JSON.parse(steps); } catch (_) { steps = []; }
  }
  if (!Array.isArray(steps)) steps = [];
  return { ...row, steps: steps.map((s) => ({ step: s.step || "", time: s.time || "", teacher: s.teacher || "", student: s.student || "" })) };
}

export async function listPlans() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map(normalize);
}

export async function getPlan(id) {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? normalize(data) : null;
}

// Insert or update. `editing` is the prior row (or null for a new plan).
// The staff write-guard validates class/subject scope before the request fires.
export async function savePlan(form, { editing, authorEmail } = {}) {
  const payload = {
    class: form.class,
    subject: form.subject,
    academic_session: form.academic_session || null,
    term: form.term || null,
    week: form.week === "" ? null : Number(form.week),
    topic: form.topic || null,
    sub_topic: form.sub_topic || null,
    lesson_no: form.lesson_no || null,
    duration: form.duration || null,
    age: form.age || null,
    lesson_date: form.lesson_date || null,
    objectives: form.objectives || null,
    prior_knowledge: form.prior_knowledge || null,
    resources: form.resources || null,
    possible_problems: form.possible_problems || null,
    steps: (form.steps || []).filter((s) => s && (s.step || s.teacher || s.student)),
    evaluation: form.evaluation || null,
    homework: form.homework || null,
    teacher_name: form.teacher_name || null,
    head_teacher: form.head_teacher || null,
  };

  let res;
  if (editing && editing.id != null) {
    res = await supabase.from(TABLE).update(payload).eq("id", editing.id).select();
  } else {
    payload.submitted_by = authorEmail || null;
    payload.review_status = "pending";
    res = await supabase.from(TABLE).insert([payload]).select();
  }
  if (res.error) throw res.error;
  return res.data && res.data[0] ? normalize(res.data[0]) : null;
}

export async function deletePlan(id) {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

// Admin-only: change the review status of a submitted plan.
export async function setReview(id, status, reviewer) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ review_status: status, reviewed_by: reviewer || null })
    .eq("id", id)
    .select();
  if (error) throw error;
  return data && data[0] ? normalize(data[0]) : null;
}

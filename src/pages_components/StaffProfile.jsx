"use client";

import React, { useContext, useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { StaffContext } from "../components/StaffShell.jsx";
import { logAction } from "../api/auditLog.js";
import { toast } from "react-toastify";
import { RiUserLine, RiLockLine, RiTimeLine, RiSaveLine, RiMailLine, RiCameraLine, RiUploadLine, RiArrowGoBackLine, RiLoader4Line } from "react-icons/ri";
import "../styles/AdminPages.css";

// Self-service profile. A staff member edits their own details here — name, sex,
// address, phone, designation, department, date of appointment and passport
// photo — while the login email (its own card below), the class/subject
// assignment, staff number and status stay the administrator's, enforced
// server-side by the allowlist in app/api/staff-self/route.js rather than by
// hiding fields in this page.
// Password change uses auth.updateUser (anon key, signed-in user only); the
// email change and profile write go through /api/staff-self, which runs on the
// service-role key and touches only the caller's own row.

// Fields this page lets the staff member change, mirroring SELF_EDITABLE on the
// server. Kept as a list so the dirty check and the audit trail stay honest.
const EDITABLE = ["name", "sex", "address", "phone", "designation", "department", "profile_pic", "date_of_appointment"];
const blankForm = () => ({ name: "", sex: "", address: "", phone: "", designation: "", department: "Academic", profile_pic: "", date_of_appointment: "" });
const formOf = (s) => {
  const f = blankForm();
  EDITABLE.forEach((k) => { if (s?.[k] != null) f[k] = String(s[k]); });
  return f;
};

// profile_pic may hold a full URL (what uploads return) or a bare object path
// from older records. Both resolve against the 'passport' bucket: the dedicated
// 'staff_passport' bucket does not exist in this project (a live probe returns
// NoSuchBucket), so pointing at it would render every relative value as a dead
// image URL.
const PIC_BUCKET = "passport";
function picSrc(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return supabase.storage.from(PIC_BUCKET).getPublicUrl(v).data.publicUrl;
}

export default function StaffProfile() {
  const scope = useContext(StaffContext);
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [emailForm, setEmailForm] = useState({ next: "", confirm: "" });
  const [emailBusy, setEmailBusy] = useState(false);

  const [form, setForm] = useState(blankForm());
  const [baseline, setBaseline] = useState(blankForm());
  const [picFile, setPicFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  const staff = scope?.staff;

  useEffect(() => {
    if (!staff?.id) return;
    supabase
      .from("bluebell_staff_attendance")
      .select("date, check_in_time, check_out_time, method")
      .eq("staff_id", staff.id)
      .order("date", { ascending: false })
      .limit(30)
      .then(({ data }) => setHistory(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id]);

  // Load the stored record into the form once per staff row (and after an admin
  // edits it under us, which changes scope.staff). Saving sets both states from
  // the server's response, so this never clobbers in-progress typing.
  useEffect(() => {
    if (!staff?.id) return;
    const loaded = formOf(staff);
    setForm(loaded);
    setBaseline(loaded);
    setPicFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id]);

  // Stage a chosen/dropped image; the upload itself happens on Save so a
  // cancelled edit never leaves an orphan file in storage.
  const applyPicFile = (file) => {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) { toast.error("Please choose an image file (JPG, PNG, etc.)"); return; }
    setPicFile(file);
  };

  // Upload into the shared 'passport' bucket, which exists and already accepts
  // authenticated writes (verified live). The staff-prefixed name keeps these
  // objects apart from learner passports in the same bucket.
  const uploadPic = async (file) => {
    const ext = file.name.split(".").pop();
    const fileName = `staff-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(PIC_BUCKET).upload(fileName, file, { upsert: false });
    if (error) throw new Error(`Could not upload your photo: ${error.message}`);
    return supabase.storage.from(PIC_BUCKET).getPublicUrl(fileName).data.publicUrl;
  };

  const dirty = !!picFile || EDITABLE.some((k) => (form[k] || "") !== (baseline[k] || ""));

  const discardChanges = () => { setForm(baseline); setPicFile(null); };

  const saveProfile = async () => {
    if (!form.name.trim()) { toast.warn("Full name is required."); return; }
    const prev = baseline;
    setSaving(true);
    try {
      const profile = { ...form };
      if (picFile) profile.profile_pic = await uploadPic(picFile);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/staff-self", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ action: "update_profile", profile }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || "Could not save your details");
      // Trust the server's copy back into the form (it trims, and normalises
      // empty strings) so the dirty state clears correctly.
      const saved = formOf(out.staff || { ...prev, ...profile });
      setForm(saved);
      setBaseline(saved);
      setPicFile(null);
      logAction(supabase, {
        email: staff?.email, role: "staff", action: "staff_profile_self_update", targetTable: "bluebell_staff",
        recordId: staff?.id, details: { changed: EDITABLE.filter((k) => saved[k] !== (prev[k] || "")) },
      });
      toast.success("Your details are updated.");
      scope.reload?.();
    } catch (err) {
      toast.error(err.message || "Could not save your details");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pw.next.length < 6) { toast.warn("Password must be at least 6 characters."); return; }
    if (pw.next !== pw.confirm) { toast.error("Passwords do not match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    // The password the admin issued is now dead, so ask the server to forget it
    // (it keeps a copy for developers). Their new password is never sent here —
    // Supabase stores only its hash, and that stays the case. Non-fatal: this
    // call only affects what the admin dashboard can still see.
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch("/api/staff-self", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ action: "clear_password" }),
      }).catch(() => {});
    });
    logAction(supabase, { email: staff?.email, role: "staff", action: "staff_password_change", targetTable: "auth", details: {} });
    setPw({ next: "", confirm: "" });
    toast.success("Password updated. Use it the next time you sign in.");
  };

  const changeEmail = async () => {
    const next = emailForm.next.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(next)) { toast.warn("Enter a valid email address."); return; }
    if (next !== emailForm.confirm.trim().toLowerCase()) { toast.error("The two emails do not match."); return; }
    setEmailBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/staff-self", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ newEmail: next }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || "Could not update email");
      logAction(supabase, { email: next, role: "staff", action: "staff_email_change", targetTable: "bluebell_staff", details: { previous: staff.email } });
      setEmailForm({ next: "", confirm: "" });
      toast.success(out.unchanged ? "That is already your email." : `Login email updated to ${next}. You can still sign in with your full name too.`);
      scope.reload?.();
    } catch (err) {
      toast.error(err.message || "Could not update email");
    } finally {
      setEmailBusy(false);
    }
  };

  if (!scope || !staff) return null;

  // Deliberately not editable on this page. The email has its own self-service
  // card (below right); the rest belongs to the administrator.
  const lockedRows = [
    ["Staff No", staff.staff_no || "—"],
    ["Class", staff.class_assigned || "—"],
    ["Subjects", Array.isArray(staff.subjects) ? (staff.subjects.join(", ") || "—") : (staff.subjects || "—")],
    ["Status", <span key="st" className={"ap-badge " + (staff.status === "active" ? "ok" : staff.status === "suspended" ? "warn" : "danger")}>{staff.status || "active"}</span>],
  ];
  const preview = picFile ? URL.createObjectURL(picFile) : picSrc(form.profile_pic);

  return (
    <div>
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiUserLine /></span>My Profile</h1>
          <p className="ap-sub">Keep your own details up to date — your class, subjects and staff number are set by the administrator.</p>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="ap-card">
            <div className="ap-card-head"><span className="ic"><RiUserLine /></span> My details</div>
            <div className="pad">
              <div className="d-flex align-items-center gap-3 mb-3">
                {preview ? (
                  <img src={preview} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#e9ecef", display: "flex", alignItems: "center", justifyContent: "center" }}><RiUserLine size={26} color="#8a93a2" /></div>
                )}
                <div>
                  <b style={{ fontSize: "1.05rem" }}>{form.name || staff.name}</b>
                  <div className="ap-muted" style={{ fontSize: "0.85rem" }}>{form.designation || "Staff"}{form.department ? ` · ${form.department}` : ""}</div>
                </div>
              </div>

              <div className="ap-form-grid">
                <div className="ap-field">
                  <label className="ap-label">Full Name *</label>
                  <input className="ap-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mrs. Jane Doe" />
                  <span className="ap-hint">You can sign in with this name, so it must stay unique in the school.</span>
                </div>
                <div className="ap-field">
                  <label className="ap-label">Sex</label>
                  <select className="ap-input" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div className="ap-field">
                  <label className="ap-label">Designation</label>
                  <input className="ap-input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Class Teacher, Bursar" />
                </div>
                <div className="ap-field">
                  <label className="ap-label">Department</label>
                  <select className="ap-input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                    <option value="Academic">Academic</option>
                    <option value="Non-Academic">Non-Academic</option>
                  </select>
                </div>
                <div className="ap-field">
                  <label className="ap-label">Date of Appointment</label>
                  <input className="ap-input" type="date" value={form.date_of_appointment} onChange={(e) => setForm({ ...form, date_of_appointment: e.target.value })} />
                  <span className="ap-hint">The day you began service at the school. Leave it blank if you don't know it and ask the administrator.</span>
                </div>
                <div className="ap-field">
                  <label className="ap-label">Phone Number</label>
                  <input className="ap-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 08012345678" />
                </div>
                <div className="ap-field">
                  <label className="ap-label">Login Email</label>
                  <input className="ap-input" value={staff.email || ""} readOnly disabled />
                  <span className="ap-hint">Changed on the “Change sign-in email” card.</span>
                </div>
                <div className="ap-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="ap-label">Address</label>
                  <input className="ap-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, city, state" />
                </div>
                <div className="ap-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="ap-label">Passport Photo</label>
                  <div
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!dragOver) setDragOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); applyPicFile(e.dataTransfer?.files?.[0]); }}
                    style={{ display: "flex", alignItems: "center", gap: 14, padding: 12, borderRadius: 10, border: `1.5px dashed ${dragOver ? "#011b97" : "#cbd5e1"}`, background: dragOver ? "rgba(1, 27, 151,.06)" : "transparent", transition: "border-color .15s ease, background .15s ease" }}
                  >
                    <span style={{ position: "relative", width: 56, height: 56, borderRadius: "50%", overflow: "hidden", background: "var(--container-bg, #f1f5f9)", display: "inline-flex", flex: "0 0 auto" }}>
                      {preview ? (
                        <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}><RiUserLine size={22} color="#8a93a2" /></span>
                      )}
                      <RiCameraLine style={{ position: "absolute", right: 4, bottom: 4, background: "rgba(1, 27, 151,.85)", color: "#fff", borderRadius: "50%", padding: 3, width: 18, height: 18 }} />
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input type="file" accept="image/*" onChange={(e) => applyPicFile(e.target.files?.[0] || null)} style={{ fontSize: "0.85rem" }} />
                      <span className="ap-hint" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <RiUploadLine /> or drag &amp; drop an image here
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="d-flex align-items-center gap-2" style={{ marginTop: 14 }}>
                <button className="ap-btn primary" onClick={saveProfile} disabled={saving || !dirty}>
                  {saving ? <><RiLoader4Line className="spin" /> Saving…</> : <><RiSaveLine /> Save changes</>}
                </button>
                {dirty && !saving && (
                  <button className="ap-btn ghost" onClick={discardChanges}><RiArrowGoBackLine /> Discard</button>
                )}
              </div>

              <table className="ap-table" style={{ marginTop: 14 }}>
                <tbody>
                  {lockedRows.map(([label, value]) => (
                    <tr key={label}><td className="ap-muted" style={{ width: 140 }}>{label}</td><td>{value}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="ap-muted" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
                Something wrong with your staff number, class or subjects? Ask the school administrator — those are edited in the Admin Dashboard.
              </p>
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="ap-card mb-3">
            <div className="ap-card-head"><span className="ic"><RiMailLine /></span> Change sign-in email</div>
            <div className="pad">
              <p className="ap-muted" style={{ fontSize: "0.82rem" }}>
                The admin created a provisional email for your first login. Replace it with your
                personal email — from then on sign in with that email (or simply your full name).
              </p>
              <div className="mb-3">
                <label className="ap-label">New email</label>
                <input className="ap-input" type="email" autoComplete="email" placeholder="you@gmail.com" value={emailForm.next} onChange={(e) => setEmailForm((p) => ({ ...p, next: e.target.value }))} />
              </div>
              <div className="mb-3">
                <label className="ap-label">Confirm new email</label>
                <input className="ap-input" type="email" autoComplete="email" value={emailForm.confirm} onChange={(e) => setEmailForm((p) => ({ ...p, confirm: e.target.value }))} />
              </div>
              <button className="ap-btn blue" disabled={emailBusy || !emailForm.next || !emailForm.confirm} onClick={changeEmail}>
                <RiSaveLine /> {emailBusy ? "Updating…" : "Update login email"}
              </button>
            </div>
          </div>

          <div className="ap-card mb-3">
            <div className="ap-card-head"><span className="ic"><RiLockLine /></span> Change password</div>
            <div className="pad">
              <div className="mb-3">
                <label className="ap-label">New password</label>
                <input className="ap-input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
              </div>
              <div className="mb-3">
                <label className="ap-label">Confirm new password</label>
                <input className="ap-input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
              </div>
              <button className="ap-btn primary" disabled={busy || !pw.next} onClick={changePassword}>
                <RiSaveLine /> {busy ? "Updating…" : "Update password"}
              </button>
            </div>
          </div>

          <div className="ap-card">
            <div className="ap-card-head"><span className="ic"><RiTimeLine /></span> Gate sign-in history</div>
            {history.length === 0 ? (
              <div className="ap-empty">No sign-in records yet — your arrivals are captured by the front-desk QR scanner.</div>
            ) : (
              <div className="ap-tablewrap">
                <table className="ap-table">
                  <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Method</th></tr></thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={h.date ?? i}>
                        <td>{h.date}</td>
                        <td>{h.check_in_time ? new Date(h.check_in_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td>
                          {h.check_out_time
                            ? new Date(h.check_out_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : <span className="ap-badge ok">Still in</span>}
                        </td>
                        <td><span className="ap-badge neutral">{h.method || "qr"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

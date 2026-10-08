"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { RiLockPasswordLine, RiMailLine, RiTeamLine, RiEyeLine, RiEyeOffLine } from "react-icons/ri";
import "../styles/AdminPages.css";
import "../styles/StaffShell.css";

// Staff portal sign-in — email OR full name + password (accounts are provisioned
// by the admin on the Staff Accounts page; no Google sign-in here). A name login
// is resolved to the account's email via jmis_staff before signing in, so staff
// can later replace their provisional email on the Profile page without losing
// their familiar name login.
export default function StaffLogin() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);

  // "Ms. Nakie Doris" / "ms nakie doris" / "NAKIE DORIS" all match the stored
  // name "Nakie Doris" (names are saved without titles).
  const normalizeName = (v) =>
    v.trim().replace(/^\s*(mrs?|ms|mr|miss|madam?|dr|prof)\.?\s+/i, "").replace(/\s+/g, " ").trim();

  const resolveNameToEmail = async (name) => {
    const target = normalizeName(name);
    if (!target) throw new Error("Enter your full name or email");
    const { data, error } = await supabase
      .from("jmis_staff")
      .select("name, email")
      .ilike("name", target);
    if (error) throw new Error("Could not look up your name — use your email instead");
    const emails = [...new Set((data || []).map((r) => r.email).filter(Boolean))];
    if (emails.length === 0) throw new Error("No staff account found for that name — check the spelling or sign in with your email");
    if (emails.length > 1) throw new Error("Several staff share that name — please sign in with your email instead");
    return emails[0];
  };

  const signIn = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let email = identifier.trim();
      if (!email.includes("@")) email = await resolveNameToEmail(email);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // The /login route is NOT inside the StaffShell layout, so nothing else
      // redirects after auth — navigate explicitly to the dashboard here.
      toast.success("Signed in");
      router.replace("/home");
    } catch (err) {
      toast.error(err.message || "Invalid email or password");
    } finally {
      setBusy(false);
    }
  };

  const sendRecovery = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail, {
        redirectTo: typeof window !== "undefined" ? `${window.location.origin}/profile` : undefined,
      });
      if (error) throw error;
      toast.success("Password reset link sent — check your inbox, then open this portal and set a new password on your Profile page.");
      setShowRecovery(false);
    } catch (err) {
      toast.error(err.message || "Could not send reset link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="staff-login-wrap">
      <ToastContainer position="top-center" />
      <div className="staff-login-card">
        <div className="staff-login-brand">
          <img src="/logo.jpg" alt="Bluebell logo" />
          <div>
            <h1>Staff Portal</h1>
            <p>Bluebell International School</p>
          </div>
        </div>

        {!showRecovery ? (
          <form onSubmit={signIn} className="staff-login-form">
            <label className="ap-label"><RiMailLine /> Email or Full Name</label>
            <input
              type="text"
              className="ap-input mb-3"
              placeholder="you@bluebellschool.com  ·  or your full name"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
            />
            <label className="ap-label"><RiLockPasswordLine /> Password</label>
            <div className="position-relative mb-2">
              <input
                type={showPassword ? "text" : "password"}
                className="ap-input"
                style={{ paddingRight: 40 }}
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="staff-pw-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <RiEyeOffLine /> : <RiEyeLine />}
              </button>
            </div>
            <button type="button" className="staff-link-btn mb-3" onClick={() => setShowRecovery(true)}>
              Forgot password?
            </button>
            <button type="submit" className="staff-login-submit" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <p className="staff-login-hint">
              <RiTeamLine /> Accounts are created by the school administrator. Sign in with your email
              or your full name — on first login, change your password and enter your personal email on your Profile page.
            </p>
          </form>
        ) : (
          <form onSubmit={sendRecovery} className="staff-login-form">
            <label className="ap-label"><RiMailLine /> Your registered email</label>
            <input
              type="email"
              className="ap-input mb-3"
              placeholder="you@jemischool.com"
              value={recoveryEmail}
              onChange={(e) => setRecoveryEmail(e.target.value)}
              required
            />
            <button type="submit" className="staff-login-submit" disabled={busy}>
              {busy ? "Sending..." : "Send reset link"}
            </button>
            <button type="button" className="staff-link-btn mt-2" onClick={() => setShowRecovery(false)}>
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

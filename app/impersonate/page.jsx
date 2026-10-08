"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../src/supabaseClient.js";
import "../../src/styles/AdminPages.css";
import "../../src/styles/StaffShell.css";

// Impersonation landing — opened in a NEW TAB by the admin "Sign in as Staff"
// button. The admin server minted a single-use Supabase magiclink and put the
// token in this URL's hash fragment (#t=...), which never reaches a server, the
// referrer, or history. Here we exchange that token for a real session and hand
// off to the normal portal. This lives OUTSIDE the (staff) route group (like
// /login), so it is not wrapped by StaffShell; after establishing the session we
// navigate to /home, where StaffShell picks the session up via getSession + its
// onAuthStateChange(SIGNED_IN) listener.
//
// Primary exchange uses supabase.auth.verifyOtp (v2.89 supports token_hash). If
// that ever rejects as an unknown param we fall back to the documented REST
// endpoint (/auth/v1/verify → setSession), which needs no email delivery.
export default function ImpersonatePage() {
  const router = useRouter();
  const [status, setStatus] = useState("working"); // working | failed
  const [message, setMessage] = useState("Opening the staff portal…");
  const ranOnce = useRef(false);

  useEffect(() => {
    if (ranOnce.current) return; // guard StrictMode double-invoke (token is single-use)
    ranOnce.current = true;

    const finish = async () => {
      // Scrub the one-time token from the address bar before navigating.
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        /* ignore */
      }
      sessionStorage.setItem("jmis_impersonating", "1");
      router.replace("/home");
    };

    const fail = (msg) => {
      setMessage(msg || "Could not open this staff session.");
      setStatus("failed");
    };

    const run = async () => {
      const hash = window.location.hash || "";
      const m = hash.match(/[#&]t=([^&]+)/);
      const tokenHash = m ? decodeURIComponent(m[1]) : "";
      if (!tokenHash) {
        fail("No sign-in token was provided. Please use the button in the admin dashboard.");
        return;
      }

      // 1) Preferred: supabase-js verifyOtp with the magiclink token_hash.
      const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
      if (!error) {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          await finish();
          return;
        }
      }

      // 2) Fallback: REST /auth/v1/verify → setSession (no email delivery).
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const res = await fetch(`${url}/auth/v1/verify`, {
          method: "POST",
          headers: { apikey: anon, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.access_token) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: json.access_token,
            refresh_token: json.refresh_token,
          });
          if (!setErr) {
            await finish();
            return;
          }
        }
        fail(json?.error_description || json?.msg || "This sign-in link is invalid or has already been used.");
      } catch (e) {
        fail(e?.message || "Could not complete the sign-in.");
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="staff-login-wrap">
      <div className="staff-login-card">
        <div className="staff-login-brand">
          <img src="/logo.jpg" alt="Bluebell logo" />
          <div>
            <h1>Staff Portal</h1>
            <p>Administrator preview</p>
          </div>
        </div>

        {status === "working" ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div className="ap-spinner" style={{ margin: "0 auto 12px" }} />
            <p style={{ margin: 0 }}>{message}</p>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <p style={{ color: "#a13834", fontWeight: 700, marginBottom: 16 }}>{message}</p>
            <button className="staff-login-submit" style={{ maxWidth: 240, margin: "0 auto" }} onClick={() => router.replace("/login")}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

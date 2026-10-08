"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../src/supabaseClient.js";

// Root: send signed-in staff to the dashboard, everyone else to /login.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      router.replace(session ? "/home" : "/login");
    });
  }, [router]);

  return (
    <div className="staff-boot">
      <div className="ap-spinner" />
      <p>Loading portal…</p>
    </div>
  );
}

"use client";

import { Suspense } from "react";
import Result from "../../../src/pages_components/Result.jsx";
import ScopeGate from "../../../src/components/ScopeGate.jsx";

// Verbatim copy of the admin results page — the class picker, the student
// fetches and the export are limited to the teacher's assigned classes (see
// Result.jsx), ScopeGate still prunes any picker it can identify, and the
// supabase write guard (src/utils/writeGuard.js) rejects out-of-scope uploads.
// Result reads ?class= deep links via useSearchParams, which must sit inside a
// Suspense boundary under the app router.
export default function Route() {
  return (
    <ScopeGate>
      <Suspense fallback={<div className="ap-loading"><div className="ap-spinner" /> Loading results…</div>}>
        <Result />
      </Suspense>
    </ScopeGate>
  );
}
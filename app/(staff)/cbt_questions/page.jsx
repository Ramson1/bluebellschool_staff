"use client";

import CbtQuestions from "../../../src/pages_components/CbtQuestions.jsx";
import ScopeGate from "../../../src/components/ScopeGate.jsx";

// Verbatim copy of the admin CBT question manager — ScopeGate limits the
// class/subject selectors to the teacher's assignment; the write guard
// blocks saves outside their scope. Question engine logic is untouched.
export default function Route() {
  return (
    <ScopeGate>
      <CbtQuestions />
    </ScopeGate>
  );
}
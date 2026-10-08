"use client";

import React, { useContext, useEffect, useRef } from "react";
import { StaffContext } from "../components/StaffShell.jsx";
import { normCls, normSub } from "../utils/scope.js";
import { RiForbidLine } from "react-icons/ri";

// Wrapper around the verbatim-copied admin pages (Result, CbtQuestions).
// It does NOT alter their logic — it only hides <option>s (and datalist
// entries) whose class/subject fall outside the signed-in staff member's
// assignment, so the selectors physically cannot offer an out-of-scope
// value. The network-level writeGuard in src/utils/writeGuard.js is the
// defensive second layer that catches anything else.
export default function ScopeGate({ children }) {
  const scope = useContext(StaffContext);
  const ref = useRef(null);
  const academic = scope?.isAcademic !== false;

  useEffect(() => {
    if (!scope || scope.isGeneral || !academic || !ref.current) return;

    const allowedClasses = new Set(scope.allClasses.map(normCls));
    const pairKeys = new Set(
      scope.subjectPairs.map((p) => `${normCls(p.class)}|${normSub(p.subject)}`)
    );
    const classTeacherSet = new Set(scope.classTeacherClasses.map(normCls));

    const classifySelect = (el) => {
      const hay = `${el.id || ""} ${el.className || ""} ${el.getAttribute("aria-label") || ""}`;
      const label = (el.labels && el.labels[0] ? el.labels[0].textContent : "").toLowerCase();
      const blob = `${hay} ${label}`.toLowerCase();
      if (/class/.test(blob)) return "class";
      if (/subject/.test(blob)) return "subject";
      return null;
    };

    const prune = () => {
      if (!ref.current) return;
      ref.current.querySelectorAll("select, datalist").forEach((el) => {
        const kind = classifySelect(el);
        if (!kind) return;
        const currentCls = normCls(
          (ref.current.querySelector('select[id*="class" i], select[class*="class" i]') || {}).value || ""
        );
        Array.from(el.options || []).forEach((opt) => {
          const v = opt.value;
          if (!v) return; // keep placeholder
          let show = true;
          if (kind === "class") show = allowedClasses.has(normCls(v));
          else if (kind === "subject") {
            show =
              classTeacherSet.has(currentCls) ||
              scope.subjectPairs.some((p) => normSub(p.subject) === normSub(v)) ||
              pairKeys.has(`${currentCls || "*"}|${normSub(v)}`) ||
              [...pairKeys].some((k) => k.endsWith(`|${normSub(v)}`));
          }
          opt.hidden = !show;
          opt.disabled = !show;
          if (!show && opt.selected) opt.selected = false;
        });
      });
    };

    prune();
    const observer = new MutationObserver(prune);
    observer.observe(ref.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["value"] });
    return () => observer.disconnect();
  }, [scope, academic]);

  if (!scope) return null;

  if (!academic) {
    return (
      <div className="ap-card">
        <div className="ap-card-head"><RiForbidLine /> Restricted</div>
        <div className="ap-empty pad">
          Your account is Non-Academic, so results and CBT tools are not available.
          If that is a mistake, ask the school administrator to move you to the Academic department.
        </div>
      </div>
    );
  }

  if (scope.isGeneral) {
    return (
      <div className="ap-card">
        <div className="ap-card-head"><RiForbidLine /> Restricted</div>
        <div className="ap-empty pad">
          Your account has no class or subject assignment yet, so results and CBT tools are
          unavailable. Please ask the school administrator to assign you a class.
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <div className="scope-note ap-muted" style={{ marginBottom: 10 }}>
        Scoped access — you can only view/select: <b>{scope.allClasses.join(", ")}</b>
        {scope.subjectPairs.length > 0 && !scope.classTeacherClasses.length
          ? ` · subjects: ${scope.subjectPairs.map((p) => `${p.subject} (${p.class})`).join(", ")}`
          : ""}
        .
      </div>
      {children}
    </div>
  );
}

// Installs a defensive, client-side guard in front of the shared Supabase
// client: every insert/update/upsert payload is checked against the signed-in
// staff member's assignment scope BEFORE the request leaves the browser.
// This protects the verbatim-copied pages (Result.jsx, CbtQuestions.jsx) —
// their upload logic stays byte-for-byte identical, out-of-scope writes are
// simply rejected here and surfaced as a toast.

import { supabase } from "../supabaseClient.js";
import { guardWrite } from "./scope.js";
import { toast } from "react-toastify";

let activeScope = null;
let installed = false;

export function setActiveScope(scope) {
  activeScope = scope || null;
}

export function installWriteGuard() {
  if (installed) return;
  installed = true;

  const proto = Object.getPrototypeOf(supabase.from("bluebell_settings"));
  if (!proto) return;

  for (const method of ["insert", "update", "upsert"]) {
    const original = proto[method];
    if (typeof original !== "function") continue;
    proto[method] = function patched(rows, options) {
      // No scope resolved yet (login page etc.) → don't block silently; the
      // shell only renders guarded pages once scope exists.
      const builder = original.call(this, rows, options);
      if (activeScope && builder) {
        const check = guardWrite(activeScope, this?.url, rows, method);
        if (!check.ok) {
          toast.error(check.reason || "This action is outside your class/subject assignment.");
          // Keep the builder chainable (.eq/.then still work) but resolve it
          // with a PostgREST-shaped error instead of sending the request, so
          // existing `const { error } = await ...` flows handle it gracefully.
          builder.then = function (onFulfilled, onRejected) {
            const result = { data: null, error: { message: check.reason || "Blocked by staff scope guard", code: "42501", __scopeBlocked: true } };
            return Promise.resolve(result).then(onFulfilled, onRejected);
          };
        }
      }
      return builder;
    };
  }
}

import StaffShell from "../../src/components/StaffShell";

// All authenticated portal routes render inside the staff shell
// (sidebar + scope guard + StaffContext).
export default function StaffGroupLayout({ children }) {
  return <StaffShell>{children}</StaffShell>;
}

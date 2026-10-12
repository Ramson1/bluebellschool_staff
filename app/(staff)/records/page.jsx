"use client";

import Page from "../../../src/pages_components/StaffRecords";

// Bare /records falls back to the first dataset (Staff Records). The sidebar
// links each dataset explicitly via /records/<dataset>.
export default function Route() {
  return <Page dataset="staff" />;
}

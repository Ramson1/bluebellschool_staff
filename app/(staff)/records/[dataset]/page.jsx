"use client";

import { useParams } from "next/navigation";
import Page from "../../../../src/pages_components/StaffRecords";

// One read-only Records dataset per sidebar button (/records/<dataset>).
// StaffRecords validates the id against its dataset list and gates on
// scope.recordsAccess, so an unknown segment simply falls back to the first.
export default function Route() {
  const params = useParams();
  return <Page dataset={String(params?.dataset || "")} />;
}

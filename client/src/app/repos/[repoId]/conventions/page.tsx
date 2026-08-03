import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions — house-rules extracted from the clone.
   Thin route entry; the view, its card, scan report, styles and helpers are
   colocated under _components/. */
export default function ConventionsPage() {
  return <ConventionsView />;
}

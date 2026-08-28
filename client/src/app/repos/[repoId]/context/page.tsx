import { Suspense } from "react";
import { ContextView } from "./_components/ContextView";

/* Route: /repos/:repoId/context — the repository's own markdown documents.
   Thin route entry; the view, its styles and helpers are colocated under
   _components/. The Suspense boundary is required because the view reads
   `useSearchParams` (the selected document lives in the URL). */
export default function ProjectContextPage() {
  return (
    <Suspense fallback={null}>
      <ContextView />
    </Suspense>
  );
}

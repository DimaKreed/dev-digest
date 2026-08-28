import { OnboardingView } from "./_components/OnboardingView";

/* Route: /repos/:repoId/onboarding — the generated onboarding tour.
   Thin route entry; the view, its section card, table of contents, code block,
   styles and helpers are colocated under _components/.

   Note the collision this route lives with: the bare /onboarding route is the
   ADD-REPOSITORY screen, not this. Only the repo-scoped path is the tour. */
export default function OnboardingPage() {
  return <OnboardingView />;
}

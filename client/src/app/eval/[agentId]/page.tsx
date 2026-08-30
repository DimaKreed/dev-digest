/* /eval/:agentId — one agent's eval history and run comparison. Thin route
   page; the screen is `_components/EvalAgentView`. */
"use client";

import { useParams } from "next/navigation";
import { EvalAgentView } from "./_components/EvalAgentView";

export default function EvalAgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  return <EvalAgentView agentId={agentId} />;
}

import { ApiError } from "@/lib/api";

/**
 * The extractor answers 409 `repo_not_indexed` when the clone has never been
 * indexed. That is a next-step, not a failure, so the page words it differently.
 */
export function isRepoNotIndexed(e: unknown): boolean {
  return e instanceof ApiError && e.code === "repo_not_indexed";
}

/** Absolute local timestamp, falling back to the raw string if unparseable. */
export function scanTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Save a JSON payload to disk as `filename` (no server round-trip). */
export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

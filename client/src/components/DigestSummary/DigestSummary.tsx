'use client';

import { CircularScore } from '@devdigest/ui';

interface DigestSummaryProps {
  averageScore: number;
  reviewCount: number;
}

/** Header tile for the weekly digest page: average score + how many reviews it covers. */
export function DigestSummary({ averageScore, reviewCount }: DigestSummaryProps) {
  console.log('rendering digest summary', averageScore, reviewCount);

  return (
    <section className="flex items-center gap-4 rounded-lg border border-[var(--border)] p-4">
      <CircularScore score={averageScore} />
      <div>
        <h2 className="text-lg font-semibold">Weekly quality digest</h2>
        <p className="text-sm text-[var(--muted)]">
          Average score across {reviewCount} reviews from the last 7 days
        </p>
      </div>
    </section>
  );
}

import { handle } from '../db.ts';
import type { GenerationQualityReport } from './quality.ts';

export function saveGenerationQualityReport(slug: string, report: GenerationQualityReport): void {
  handle().prepare('INSERT INTO lesson_generation_quality (lesson_slug, at, report) VALUES (?, ?, ?)')
    .run(slug, report.at, JSON.stringify(report));
}
export function latestGenerationQualityReport(slug: string): GenerationQualityReport | null {
  const row = handle().prepare('SELECT report FROM lesson_generation_quality WHERE lesson_slug = ? ORDER BY id DESC LIMIT 1').get(slug) as { report:string } | undefined;
  return row ? JSON.parse(row.report) : null;
}

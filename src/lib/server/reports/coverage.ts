import type { NativeReportSource } from './native-source.ts';

export type TopicCoverage = { objectiveId?: string; title: string; covered: boolean; comment: string | null };

export type TeachingCoverage =
  | { source: 'manual'; topics: TopicCoverage[] }
  | { source: 'native'; topics: TopicCoverage[]; bundle: NativeReportSource };

export class ReportConflict extends Error {
  override name = 'ReportConflict';
}

export function coverageInput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid coverage');
  return raw as Record<string, unknown>;
}

export function validateCoverage(raw: unknown, bundle?: NativeReportSource): TeachingCoverage {
  const { source, topics } = coverageInput(raw);
  if ((source !== 'manual' && source !== 'native') || !Array.isArray(topics) || topics.length > 40) {
    throw new Error('invalid coverage');
  }
  const remaining = new Map(bundle?.objectives.map(objective => [objective.id, objective]));
  const checked = topics.map((topic): TopicCoverage => {
    if (!topic || typeof topic !== 'object' || Array.isArray(topic)) throw new Error('invalid topic');
    const { title, covered, comment, objectiveId } = topic;
    if (typeof covered !== 'boolean' || (comment !== null && (typeof comment !== 'string' || comment.length > 2000))) {
      throw new Error('invalid topic');
    }
    const privateComment = comment?.trim() || null;
    if (objectiveId !== undefined) {
      const objective = remaining.get(objectiveId);
      if (!objective) throw new Error('invalid objective');
      remaining.delete(objectiveId);
      return { objectiveId: objective.id, title: objective.title, covered, comment: privateComment };
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('invalid topic');
    return { title: title.trim(), covered, comment: privateComment };
  });
  if (remaining.size) throw new Error('missing objective coverage');
  if (source === 'manual') return { source, topics: checked };
  if (!bundle) throw new ReportConflict();
  return { source, topics: checked, bundle };
}

export function decodeCoverage(raw: unknown): TeachingCoverage | null {
  if (typeof raw !== 'string') return null;
  try {
    const saved = JSON.parse(raw);
    // Earlier releases used this column for legacy objective IDs.
    return saved?.schema === 'drive-report-v1' ? saved.coverage : null;
  } catch {
    return null;
  }
}

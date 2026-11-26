export type TopicCoverage = { title: string; covered: boolean; comment: string | null };

export type TeachingCoverage = { source: 'manual'; topics: TopicCoverage[] };

export class ReportConflict extends Error {
  override name = 'ReportConflict';
}

export function manualCoverage(raw: unknown): TeachingCoverage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid coverage');
  const { source, topics } = raw as Record<string, unknown>;
  if (source !== 'manual' || !Array.isArray(topics) || topics.length > 40) {
    throw new Error('invalid coverage');
  }

  return { source, topics: topics.map(topic => {
    if (!topic || typeof topic !== 'object' || Array.isArray(topic)) throw new Error('invalid topic');
    const { title, covered, comment } = topic;
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof covered !== 'boolean' ||
        (comment !== null && (typeof comment !== 'string' || comment.length > 2000))) {
      throw new Error('invalid topic');
    }
    return { title: title.trim(), covered, comment: comment?.trim() || null };
  }) };
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

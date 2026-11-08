/** Serializable coverage state shared by the report form and its focused checks. */
export interface ReportTopic { id: string; title: string; sceneIds: string[]; skillKeys: string[] }
export interface ReportMaterial {
  slug: string; materialId: number; version: number; hash: string;
  title: string; sceneIds: string[]; topics: ReportTopic[];
}
export type TopicChoice = ReportTopic & { covered: boolean; comment: string | null };
export interface TopicReportRevision {
  revision: number; source: 'manual' | 'material'; snapshot: ReportMaterial | null; topics: TopicChoice[];
}
export function initialCoverage(materials: ReportMaterial[], latest: TopicReportRevision | null): { selection: string; material: ReportMaterial | null; topics: TopicChoice[] } {
  if (latest) return {
    selection: latest.source === 'material' ? 'filed' : 'manual',
    material: latest.snapshot,
    topics: latest.topics.map(topic => ({ ...topic, sceneIds: [...topic.sceneIds], skillKeys: [...topic.skillKeys] })),
  };
  const material = materials.length === 1 ? materials[0] : null;
  return { selection: material ? `material:${material.slug}` : materials.length ? '' : 'manual', material, topics: material?.topics.map(topic => ({ ...topic, covered: false, comment: null })) ?? [] };
}

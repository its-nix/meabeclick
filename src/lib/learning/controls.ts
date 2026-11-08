import type { LearningScene, VisualKind } from './model.ts';

type ControlDefinition = {
  index: number; name: string; label: string;
  min: number | 'xDomain[0]'; max: number | 'xDomain[1]'; step: number;
};
export type LearningControl = Omit<ControlDefinition, 'min' | 'max'> & { min: number; max: number };
const parameter = (index: number, name: string, label: string): ControlDefinition => ({ index, name, label, min: -5, max: 5, step: 1 });
const h = parameter(1, 'h', 'ימינה ושמאלה'), k = parameter(2, 'k', 'למעלה ולמטה');
const a = parameter(0, 'a', 'פתיחה וכיוון');
const linear = [parameter(0, 'm', 'שיפוע'), parameter(1, 'b', 'חיתוך עם הציר')];

/** Only these combinations expose sliders; formula parameters are not automatically controls. */
export const LEARNING_CONTROL_CAPABILITIES: ReadonlyArray<{
  visual: VisualKind; context: 'explore' | 'graph-target'; parameters: ReadonlyArray<ControlDefinition>;
}> = [
  { visual: 'quadratic', context: 'explore', parameters: [h, k] },
  { visual: 'quadratic', context: 'graph-target', parameters: [h, k, a] },
  { visual: 'linear', context: 'explore', parameters: linear },
  { visual: 'linear', context: 'graph-target', parameters: linear },
  { visual: 'number-line', context: 'explore', parameters: [{ index: 0, name: 'x', label: 'מיקום על הציר', min: 'xDomain[0]', max: 'xDomain[1]', step: .25 }] },
];

export function learningControls(scene: Pick<LearningScene, 'visual' | 'phase' | 'check' | 'frames' | 'xDomain'>): LearningControl[] {
  if (scene.phase === 'explore' && scene.frames.length > 1) return [];
  const context = scene.check?.kind === 'graph-target' ? 'graph-target' : scene.phase === 'explore' ? 'explore' : null;
  const parameters = LEARNING_CONTROL_CAPABILITIES.find(c => c.visual === scene.visual && c.context === context)?.parameters ?? [];
  return parameters.map(p => ({ ...p, min: typeof p.min === 'number' ? p.min : scene.xDomain[0], max: typeof p.max === 'number' ? p.max : scene.xDomain[1] }));
}

/** Structured prompt evidence comes from the same parameter definitions as the rendered inputs. */
export function learningControlGuidance(): string {
  return JSON.stringify({
    sceneControlRules: { explore: { phase: 'explore', frames: 1 }, 'graph-target': { checkKind: 'graph-target', frames: 1 }, multiFrameExplore: 'no-controls', otherScenes: 'no-controls', unlistedParameters: 'cannot-be-changed' },
    sceneControls: LEARNING_CONTROL_CAPABILITIES,
  });
}

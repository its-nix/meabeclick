import { PARABOLAS } from '$lib/learning/parabolas.ts';
import { renderLearningDocument } from '$server/learning-render.ts';
import { documentHeaders } from '$server/document-policy.ts';

export const GET = () => new Response(renderLearningDocument(PARABOLAS, {
  demo: true, film: '/learning-media/parabola-shift.mp4',
}), { headers: documentHeaders() });

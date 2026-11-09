/** Generate an editable HyperFrames composition from the same scene used in the lesson.
 * npm run learning:video -- [--input lesson.json] [--scene notice] [--prepare-only]
 */
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PARABOLAS } from '../src/lib/learning/parabolas.ts';
import { drawLearningVisual, learningFrameAt, formulaForVisual } from '../src/lib/learning/visual.ts';
import { experienceProblems } from '../src/lib/server/learning-render.ts';
import { learningStyles } from '../src/lib/learning/styles.ts';
import { writeLearningText } from '../src/lib/learning/runtime.ts';
import { publicExperience } from '../src/lib/learning/model.ts';
import { escapeHtml } from '../src/lib/learning/math.ts';
import { BRAND_LOGO_SRC, deckRootCss } from '../src/lib/brand.ts';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i+1]; };
const input = option('--input');
const raw = input ? JSON.parse(await readFile(resolve(input), 'utf8')) : PARABOLAS;
const experience = raw.learning ?? raw;
const problems = experienceProblems(experience);
if (problems.length) throw new Error(problems.join('; '));
const sourceScene = publicExperience(experience).scenes.find(s => s.id === (option('--scene') ?? experience.scenes[0].id));
if (!sourceScene) throw new Error('Unknown scene');
const scene=sourceScene;
const independent=scene.phase==='challenge'||raw.teaching?.practice?.some(p=>p.asset==='scene'&&p.ref===scene.id&&p.support==='independent');
const questionVisual=['fraction','geometry','data-bars','normal','normal-school'].includes(scene.visual);
const name = input ? `lesson-${createHash('sha256').update(JSON.stringify(publicExperience(experience))).digest('hex').slice(0,12)}-${scene.id}` : 'parabola-shift';
const dir = resolve('learning-video', name);
const assets = resolve(dir, 'assets');
await mkdir(assets, { recursive: true });
await cp('static/learning-assets', resolve(assets, 'math'), { recursive: true });
await cp('node_modules/gsap/dist/gsap.min.js', resolve(assets, 'gsap.min.js'));
await cp(resolve('static', BRAND_LOGO_SRC.split('?')[0].slice(1)), resolve(assets, 'logo.svg'));
const duration = Math.max(1, scene.frames.length-1)*4+2;
const css = (deckRootCss() + learningStyles.slice(0,learningStyles.indexOf('*{box-sizing'))
  + learningStyles.match(/:root\{[^}]*\}/)[0]
  + learningStyles.slice(learningStyles.indexOf('.plot{'),learningStyles.indexOf('.scene-caption{')))
  .replaceAll('/learning-assets/', 'assets/math/');
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="assets/math/katex.min.css"><style>
${css}
html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:var(--bg);color:var(--text)}
#root{position:absolute;inset:0;padding:48px 64px;font-family:Heebo,Arial,sans-serif}
.film-brand{display:flex;align-items:center;gap:12px}.film-brand img{display:block;width:auto}.film-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.film-header span{font-size:18px;color:var(--muted-strong)}.film-header h1{font-size:34px;margin:0;color:var(--text)}.film-canvas{display:grid;grid-template-columns:310px 1fr;gap:35px;align-items:center;direction:rtl}.film-copy{font-size:24px;line-height:1.8}.film-copy small{display:block;font-size:16px;color:var(--muted-strong);margin-bottom:18px}.film-visual{background:#fff;border:1px solid var(--border);border-radius:18px;padding:18px 12px}.film-visual .plot{width:100%;height:410px;max-height:none}.film-equation{text-align:center;direction:ltr;font-size:30px;height:62px}.film-footer{font-size:16px;color:var(--muted-strong);margin-top:18px}.film-stage{color:var(--cta-strong);font-size:16px}
</style><script src="assets/math/katex.min.js"></script><script src="assets/gsap.min.js"></script></head><body>
<div id="root" data-composition-id="${name}" data-start="0" data-duration="${duration}" data-width="1280" data-height="720" data-fps="30">
<div id="lesson-scene" class="clip" data-start="0" data-duration="${duration}" data-track-index="1">
<header class="film-header"><h1>${escapeHtml(experience.title)}</h1><div class="film-brand"><img src="assets/logo.svg" alt="" height="36"><span>מאה בקליק</span></div></header>
<div class="film-canvas"><div class="film-copy"><small id="stage" dir="ltr">01 / ${scene.frames.length}</small><div id="caption"></div></div><div class="film-visual"><div id="equation" class="film-equation"></div><svg id="film-plot" class="plot" role="img" aria-label="${escapeHtml(scene.title)}"></svg></div></div>
<footer class="film-footer">${escapeHtml(experience.objective)}</footer></div></div>
<script>
const scene=${JSON.stringify(scene).replaceAll('<', '\\u003c')};const independent=${!!independent},questionVisual=${questionVisual};
const draw=${drawLearningVisual.toString()};const frameAt=${learningFrameAt.toString()};const formula=${formulaForVisual.toString()};const rich=${writeLearningText.toString()};
function renderAt(t){const state=frameAt(scene,t);draw(document.getElementById('film-plot'),scene.visual,state.values,scene.xDomain,scene.yDomain,{reference:scene.visual==='quadratic'&&!independent?[1,0,0]:undefined,target:scene.check?.target,hide:independent&&!questionVisual,questionOnly:independent&&questionVisual});document.getElementById('equation').innerHTML=katex.renderToString(independent&&scene.check?.kind==='graph-target'?(scene.visual==='quadratic'?'y=a(x-h)^2+k':'y=mx+b'):scene.visual==='steps'||independent&&questionVisual?scene.frames[state.frame].tex:formula(scene.visual,state.values),{throwOnError:true,trust:false});rich(document.getElementById('caption'),scene.frames[state.frame].caption);document.getElementById('stage').textContent=String(state.frame+1).padStart(2,'0')+' / '+scene.frames.length;}
window.addEventListener('hf-seek',e=>renderAt(e.detail.time));
const clock={t:0};const tl=gsap.timeline({paused:true});tl.fromTo(clock,{t:0},{t:${duration},duration:${duration},ease:'none',onUpdate:()=>renderAt(clock.t)},0);window.__timelines=window.__timelines||{};window.__timelines['${name}']=tl;renderAt(0);
</script></body></html>`;
await writeFile(resolve(dir, 'index.html'), html);
await writeFile(resolve(dir, 'hyperframes.json'), JSON.stringify({ name, width:1280, height:720, fps:30 }, null, 2));
console.log(`Composition: ${dir}`);
const renderDirectory=input?resolve(dir,'render'):resolve('static/learning-media');
const output=resolve(renderDirectory,`${name}.mp4`);
console.log(`Render target: ${output}`);
if (!args.includes('--prepare-only')) {
  await mkdir(renderDirectory, { recursive: true });
  const result = spawnSync(resolve('node_modules/.bin/hyperframes'), ['render', dir, '--quality', 'delivery', '--workers', '1', '-o', output], {
    stdio: 'inherit', env: { ...process.env, DO_NOT_TRACK:'1', HYPERFRAMES_NO_TELEMETRY:'1' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const poster = spawnSync('ffmpeg', ['-y','-ss',String(Math.max(0,duration-1)),'-i',output,'-frames:v','1',output.replace(/\.mp4$/,'-poster.png')], {stdio:'ignore'});
  if (poster.status !== 0) throw new Error('Could not render the video poster');
  console.log(`Video: ${output}`);
}

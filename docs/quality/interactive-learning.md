# Interactive learning, version 1

The primary generated material is a Hebrew, phone-first learning experience:
discover → explore → practise → independent challenge → reflect. A shared
mathematical scene drives the live diagram, animation, controls and video
export. Short prompts and contextual feedback replace bullet-only teaching.

## Entry points

- `/learn/parabolas`: public reference lesson with device-local demonstration
  progress and an embedded, locally rendered HyperFrames clip.
- `/app/learn/<slug>`: published, assigned lesson with family-scoped access,
  server grading and progress saved across devices.
- `/lessons/<slug>`: existing presentation links render the new experience
  when the published plan has `learning`. Earlier material remains readable.
- `/app/lessons/<slug>/experience`: tutor editing, unsaved preview, draft
  saving and explicit publication. The existing lesson editor links here.
- The student's homework area lists their generated learning experiences.
  Interactive practice completion is separate from submission/grading of
  written homework and from assessed skill mastery.
- Booking-time material appears on the student's home as preparation. It
  becomes homework after the lesson report, or at the same 24-hour fallback
  deadline as written homework. Cancelled bookings do not release practice.
- The tutor editor shows per-question attempts, hints and successful checks
  from the published student experience, to guide the next conversation.

## Generation contract

### Brand, student wording and presenter notes

The renderer owns the visual identity. The site, lesson HTML, printed worksheet,
teacher guide and video exporter use the original logo URL and palette from
`src/lib/brand.ts`, with Heebo. Generated content cannot choose another logo,
colour palette or typography. The video composition copies the original SVG
artwork; it never redraws the mark. The public reference video is regenerated
when its presentation changes.

Multi-frame demonstrations retain their authored parameter values. Free
exploration uses one frame and updates captions from the actual chosen values,
so moving a slider cannot leave an explanation referring to an earlier graph.

Student copy uses warm, direct Hebrew in the plural: a concrete example first,
one visible change at a time, then the mathematical name or general rule.
Define unfamiliar terms before using them. Prefer “מציבים x=2 ומקבלים אפס
בסוגריים” to unexplained wording such as “הביטוי מתאפס”. Titles name the topic;
instructions say what to do; captions explain what changed and why. No invented
slogans, vague metaphors, or claims that a problem is easy. Graph-construction
instructions describe the whole curve being graded, including shape; they must
not promise a marked target point that the renderer does not draw.

Every newly generated scene requires `presenterNotes` with four nonempty fields:
`explanation` (what to say), `ask` (one question to pause for), `expectedAnswer`
(what understanding to listen for), and `ifStuck` (a concrete next step).
They refer to that scene's actual example and numbers. The generator's strict
schema and validation require them, including for opening and reflection scenes.
Earlier stored lessons remain valid without notes; the interface identifies
missing notes instead of inventing teaching guidance.

The tutor opens `/app/lessons/<slug>/presenter` from the lesson or experience
editor. This private guide follows the published practice material, including
report-driven replacements. Each scene opens in one reusable presentation
window using `#scene=<id>`, keeping the guide separate from the shared screen.
The experience editor can edit notes with the rest of the draft. Only publication
changes the guide used with the published presentation. Private notes can also
be printed from the guide.

Notes are removed from student, demonstration and projector payloads, worksheets
and exported video compositions. Their route requires tutor authentication and
uses `private, no-store`. Editing only notes does not change the student content
fingerprint or erase attempts, queued work or completion. This is structural
validation and access control; mathematical correctness and whether a student
understands the explanation still require reading the generated lesson.

`src/lib/learning/model.ts` and `schema.ts` define `LearningExperience` v1.
New generation must return `learning`; a missing experience is retried as
bad output. Existing stored plans need no migration of their content.

Codex receives an enforced `--output-schema`, not only a schema in its
prompt. The strict wire schema requires every key and represents optional
fields and unused game types as nullable. The app removes only originally
optional nulls before using the plan, preserving required `check: null`.
Library generation failures retain bounded diagnostic details in server
logs; those details are never returned in the library response.

Supported mathematical representations:

| Visual | Parameters | Meaning |
| --- | --- | --- |
| quadratic | a, h, k | y = a(x-h)²+k |
| linear | m, b | y = mx+b |
| number-line | value | A point on the configured number line |
| balance | coefficient, constant, total | coefficient·x+constant=total |
| steps | none | A sequence of typeset worked steps for other topics |

Choice, numeric and graph-construction questions have progressive hints,
specific feedback and explicit checking rules. Numeric checking accepts
decimal notation and equivalent fractions; free-form algebraic expressions
are intentionally outside this version's checker. Unsupported topics use
typeset steps, not an invented graph. Mathematical prose uses `\(...\)`;
frame formulas use TeX without delimiters. KaTeX is self-hosted, including
fonts, and does not trust input HTML.

Structural and TeX validation run before publication. They do not certify
arbitrary mathematical reasoning: examples, misconceptions and level fit
still need review against the teaching rubric. The reference lesson is an
acceptance example, not a claim that all generated lessons have its quality.

## Persistence and publication

Migration 035 explicitly relates lesson slugs to student IDs. Access does
not infer identity from names or matching calendar times. Progress is
scoped to student, lesson, content fingerprint and scene. New content keeps
old progress intact under its earlier fingerprint. Request IDs make offline
retries idempotent. Failed answer submissions stay on the device until the
server can check them; they are never presented as successful checks.
The browser restores its outbox before writing state and copies submitted
values, so later slider movement cannot alter an earlier answer. Browser
storage includes the lesson slug: separate bookings of the same library
material never share completion or pending answers. Cosmetic title/metadata
changes preserve the content fingerprint.

Migration 036 attaches preparation to its explicit booking, planned skill
and release deadline. A report releases the planned experience if that skill
was covered (or if it is a note-only report, matching written homework policy).
When a different skill was taught, one ready interactive library experience
for a covered skill becomes the focused practice. If none exists, the
unrelated preparation is withheld from homework; written taught homework
still follows its existing generation/fallback policy. This version does
not generate a replacement interactive course during report filing.

Replacement practice gets a separate append-only plan/slides history under
an internal material slug. Student rendering, tutor preview, solutions and
editing all resolve the same target. The original preparation is preserved.
Release runs once while held; late/repeated reports do not retract work
already assigned. An optimistic target/version lock rejects an editor left
open across replacement or another tutor edit.

Tutor previews do not file results in student records. Drafts do not replace
published material. Publication re-renders the presentation and uses the
existing append-only material store. The printable student worksheet excludes
answer keys; the tutor can open `?solutions=1` for the answer sheet.
Both the editor seed and its save use the existing protected `editBase`:
an unaccepted generated revision cannot become the rest of a learning-only
edit. Live formulas, editor previews and printed formulas all derive from
the same engine values. The existing dashboard presentation URL opens a
locally graded teaching preview for the tutor.

## Animation and video

`learningFrameAt` is a seekable clock. `drawLearningVisual` preserves SVG
element identity while updating the diagram. The browser supplies pause,
scrub, step and speed controls, with step-based behavior for reduced motion.
No animation starts automatically. Sound is not required to use a lesson.
An independent graph-construction question keeps its target curve visible as
the question stimulus; the candidate curve, its projected vertex and comparison
curve stay hidden until the student succeeds. Other independent questions keep
their supporting graph hidden.

```sh
npm run learning:video -- --prepare-only
npx hyperframes preview learning-video/parabola-shift --background
npx hyperframes check learning-video/parabola-shift --json
npm run learning:video
```

To export a generated lesson, pass `--input /path/to/lesson.json --scene ID`.
The editable composition is generated under ignored `learning-video/`;
the MP4 and poster are written under `static/learning-media/`. Local video
export requires FFmpeg. Lessons animate directly in the browser, so a video
render never delays a booking. Per-lesson MP4 rendering is an explicit
authoring/export step, not a production job queue.
Generated export names include a content hash, so identical scene IDs in
different lessons cannot overwrite each other's videos.

The print stylesheet creates paper exercises and static diagrams. Interactive
behavior does not survive PDF export. Use the browser print dialog's PDF
destination; tutor solutions are a separate authorized output.

## Verification

```sh
npm run build
npm run check:ci
npm run test:learning
npm run test:learning:browser
npm test
```

The browser smoke uses synthetic data and checks actual animation state,
wrong/correct feedback, hints, graph construction, local reload, assigned
progress reload, offline retry across reload, immutable queued graph answers,
cross-booking isolation, tutor teaching mode, independent-challenge masking, PDF export
and widths 320/390/768/1440. On Linux, install Chromium with
`npx --no-install playwright-core install --with-deps chromium`; CI runs this
and the browser smoke before publishing an image. On macOS the smoke uses
Google Chrome. Set `CHROME_BIN` to use another browser executable. It writes evidence to a temporary directory or
`EVIDENCE_DIR`. It is not a substitute for student observation, assistive
technology testing or a physical-device check.

The Docker context includes `scripts/vendor-learning.mjs` for `prebuild`.
Generated local build/video directories and vendored assets are excluded;
the image builds its own math assets from the lockfile. Migrations 035–036
are additive; the upgrade tests start at both schema 034 and 035, preserve
existing student/material/progress rows, and check repeated application.

Existing library plans without `learning` retain their legacy renderer until
explicitly upgraded and reviewed. New generation requires an experience;
reusing a ready older master does not silently run an engine or replace the
tutor's approved content. Broad topic-level mathematical quality and actual
student usability still need a representative evaluation before promotion.

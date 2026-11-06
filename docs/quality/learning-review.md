# Feedback and release workflow for learning generation

Use ordinary conversation for requests. The installed skill is `$meabeclick-learning-iteration`; its [canonical source](../../skills/meabeclick-learning-iteration/SKILL.md) lives in this repository. The [feedback history](learning-feedback.md) records sanitized problems and evidence. No issue form or new customer workflow is required.

The teacher-only review index is `/app/learning-review`. It exposes synthetic presentations, private notes, homework and preview games, with local-only practice state and no score reporting. It does not create library masters, customer lessons or assignments.

## Run a representative batch

From the repository root, with a Codex account that can use the selected model:

```sh
CODEX_BIN=/path/to/verified/codex node scripts/generate-learning-review.mjs \
  --model <available-model> --out /path/to/new-review-directory
```

The ten briefs live in `scripts/learning-review-cases.mjs`. The runner uses the actual `generateLesson` path and an isolated temporary database. It records inputs, model, effort, CLI, timeout, source files/fingerprint, timestamps and output hashes. New batches default to high effort and concurrency two. A first case checks the configuration before scheduling the rest. Shared auth/quota/model failures stop new work; malformed output has the generator's existing single retry.

Resume with the same arguments. Ready artifacts are checksum-checked and validated before they are skipped. Failed cases require an explicit `--retry-failed`; do this only after diagnosing the failure. One invocation owns a batch through `.generation-lock`. After a crash, verify the recorded PID has ended before removing a stale lock. An interrupted `generating` case will be rerun on resume. Never remove a live process's lock.

A clean completion persists a source-verification seal. Assembly refuses an unverified or drift-failed batch; a failed seal cannot be reset by resume. Historical pre-seal runs can be audited explicitly with `scripts/verify-learning-review.mjs --from <directory> [--source-ref <commit>]`, which reconstructs the exact recorded source hash and checks artifact hashes. This audit cannot override recorded drift or establish teaching approval.

Source/model changes require a new directory. For a focused iteration:

```sh
node scripts/generate-learning-review.mjs --model <available-model> \
  --out /path/to/new-candidate --case 04-percentages
```

`--case` also accepts comma-separated IDs. Local `.diagnostic.log` and `.rejected.json` files can contain echoed inputs; they are not packaged. Keep generation directories outside the repository. This pilot used the locally available `gpt-5.6-sol`, high effort and CLI 0.149.0; that does not establish availability or the billing tier of a different production account.

## Assemble and review

```sh
node scripts/package-learning-review.mjs --from /path/to/baseline \
  --replace /path/to/new-candidate
```

Exactly one baseline is required. Optional explicit replacements take priority only for their ready cases, in the order supplied. All ten selected artifacts must pass hashes, lesson/TeX/private-notes validation, rendering and game contracts before the corpus changes. Each case retains its own generation configuration; assembly records the current validation fingerprint separately. The bundled source is `src/lib/server/learning-review-corpus.json`, containing only synthetic material. Prior released corpora remain recoverable through Git history; retain local baselines too when comparing new candidates.

Run the affected regression tests, build/typecheck, and the browser checks:

```sh
npm run build
npm run check:ci
node --test tests/unit/learning-review-batch.test.mjs tests/characterization/learning-review.test.mjs
npm run test:learning:browser
npm run test:review:browser
```

The review browser check visits every stage at desktop/mobile sizes, checks math and overflow, opens projection separately from notes, visits all games, completes supported choice games and verifies no customer score/progress writes. CI runs this alongside the full suite and image build. Screenshots are included in the synthetic workspace artifact.

Record a concrete teaching comment, fix its reusable layer, regenerate affected cases in a new candidate and compare. Keep a rollback commit when releasing through the normal PR/deploy pipeline. Existing customer publications, tutor edits, links and progress are not replaced by corpus assembly or generation changes. Retirement of old reusable library masters is a separate operation after teaching review and the real production reliability gate in `PRODUCT.md`; ten synthetic examples alone do not meet that gate.

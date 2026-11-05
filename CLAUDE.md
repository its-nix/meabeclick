# mea-beclick

mea-beclick is the site and booking flow for the מאה בקליק private tutoring service.

## Knowledgebase

Product requirements, the vision, and binding decisions live in one file:
`PRODUCT.md` at the repo root. It overrides any other document that
disagrees; git is the history.

- `mea-beclick-kb/students/`, `mea-beclick-kb/pricing/` — real student and
  payment records (PII — see below). **Not in this repo.** They are
  untracked, `.gitignore`d, and purged from git history; they exist only on
  the tutor's own disk. Do not read them, do not commit them, and do not
  re-add either path to version control. If you need a fact about a student,
  the database has it (`students_v2`, `accounts`, `enrollments`,
  `payments`) — see
  `docs/superpowers/specs/2026-09-18-student-records-out-of-the-repo-design.md`.

## Company context and asset boundary

The verified company-wide knowledgebase is [its-nix/knowledgebase](https://github.com/its-nix/knowledgebase/blob/main/START-HERE.md), not a presumed local `~/Projects/nix` path. Start from its [project ownership boundaries](https://github.com/its-nix/knowledgebase/blob/main/_meta/project-kb-boundary.md) and [GitHub/Drive directory](https://github.com/its-nix/knowledgebase/blob/main/company/github-drive-directory.md). These are private organization resources, so a public reader may not have access.

MeaBeclick and the older Tutoring Drive materials are one business. [The sanitized asset map](mea-beclick-kb/drive-assets.md) points only to the access-controlled Drive **parent**, not private student or payment records. This repo is public: never write child-folder links, customer identifiers, payments, credentials or private attachments to GitHub or to the all-org company KB.

Product requirements and binding decisions remain in `PRODUCT.md`; company knowledge stays in the verified company KB, and project research/technical truth stays in this repository. The `mea-beclick-kb/students/` and `mea-beclick-kb/pricing/` local paths remain untracked and prohibited from Git. Do not infer a successful sync, permission change, or approval from a link.

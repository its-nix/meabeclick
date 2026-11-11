# Personal Google learning workspace

## Intent

Use Lior's personal Google Drive as the authoritative home for new learning artifacts and a visible Google Sheets register for teaching records. Google Docs supplies readable student profiles. The website continues to supply student access, interactive activities, bookings and payments. Reuse the existing MeaBeclick project folder and leave its Marketing and Skills areas intact. The older student folder is stale and is explicitly excluded.

The owner approved the direction, personal ownership and a clean system inside the project folder. Routine folder names and the initial schema below are implementation choices. This delivery is the concrete workspace skeleton and a tested programmatic foundation, not a silent migration of existing customer records.

## Deliverables

- One staff-only Learning area with Templates, Library, Students and Review folders, owned by the connected personal account and inheriting only the existing staff access.
- One native Google Sheets learning register. Five linked record tabs are Students, Materials, Lessons, Assignments and Progress. A Config tab documents schema version and verified folder/template IDs. Stable IDs link records; names and row positions are not keys.
- Native Google Docs for a student profile template, a lesson brief template and a short workspace guide. One clearly labelled synthetic student illustrates their relationship to the register. No real student imports, contacts, invitations or score writes.
- A versioned schema shared by the workbook builder and the code. Validate required fields, duplicate IDs, reference integrity, allowed statuses, Google file URLs and evidence semantics. A generated presentation or a viewed file does not establish mastery.
- A small read-only Google API adapter and CLI that verify the dedicated personal-account connection, inspect the register and assemble learning context by student ID. Explicitly reject incomplete or conflicting records. Do not fall back to the older business-account token.

## Records

Students owns the structured learner identity and educational context, profile document and folder links. The profile document owns free-form tutor narrative; structured progress remains in the register. Materials identifies a particular artifact/release and its provider, audience, subject, topic and approval state. Lessons records the intended and taught lesson context. Assignments binds a particular material version to a student and lesson. Progress records a skill observation and its evidence, distinguishing support from independently demonstrated performance.

Headers are bilingual and retain a stable machine key. Tabs and schema keys are versioned. Duplicate or renamed keys fail clearly rather than being interpreted by position. Dates use ISO forms at the API boundary. Machine identifiers, formulas, headers and configuration receive appropriate protection or warnings; tutor input stays editable. Seed records are explicitly marked demo and never counted as customer activity.

## Automation and code boundary

The present connection in this chat is the personal account; the website's existing OAuth implementation is a separate connection used by the older business workflow. New workspace credentials use a dedicated namespace. An explicit owner check and folder ownership checks prevent a business-token fallback. Store no tokens or customer records in Git or the register.

The first adapter is intentionally read-only. Production automated writes require one dedicated personal-account authorization plus a serialized, idempotent publishing/event path. That boundary is explicit: this skeleton does not claim that the new workbook is already connected to booking-time generation. The bootstrap itself is created and read back through the connected Drive tools.

Google Slides is the intended default for future presentation artifacts. The existing reference decks are PPTX/PDF files and remain intact in Skills; native approved template conversion and the same-lesson comparison are a subsequent authoring gate. Do not label an empty deck or an imported reference as a finished customer lesson.

## Making the application leaner

Keep Google as the primary editing interface for new presentations and teaching records. The future worker creates native artifacts, records their stable links and exposes approved releases through the student portal. After parity and migration evidence, retire the custom presentation editor/teacher viewer and duplicate learning-library administration for the new path. Keep historical readers until existing assignments and links are verified. Reuse mathematical validation and interactive graph/game components where they add teaching value.

This delivery does not delete those readers, migrate customer data, switch generation defaults, remove authorization/booking/payment storage or introduce a second mutable copy of the educational register. It documents the replacement boundary before changing production behavior.

## Verification

Verify created folder/file identity, ownership, parent relationships, native MIME types and access. Inspect every populated register tab, dropdowns, references, demo exclusion and formulas. Read back all Google Docs, preserving native headings and RTL text. The programmatic reader must handle reordered columns, unknown schema versions, duplicate/missing IDs, broken links, invalid evidence and authentication errors without leaking secrets or creating writes. Run affected tests, build and type check. Use an independent bounded review of the contract and actual bootstrap before delivery.

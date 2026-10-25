/** Server-backed, lesson-scoped game assignments. */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handle, inTransaction } from './db.ts';
import { readGameFiller } from './game-filler.ts';
import { getRegistry } from './lesson/registry.ts';
import { linkGameToSkill } from './lesson/targeting.ts';

export type LessonGameStatus = 'draft' | 'published' | 'archived';

type AssignmentRow = {
  id: string; lesson_id: number; student_id: number; template: string;
  title: string; position: number; status: LessonGameStatus; draft_body: string;
  draft_revision: number; published_data_id: string | null; node_id: number | null;
  created_at: string; updated_at: string; published_at: string | null;
};

type LessonContextRow = {
  id: number; slug: string; title: string | null; topic: string | null;
  lesson_at: string | null;
};

export type LessonGameAssignment = {
  id: string; lessonId: number; lessonSlug: string; studentId: number;
  template: string; title: string; position: number; status: LessonGameStatus;
  body: Record<string, unknown>; revision: number; publishedDataId: string | null;
  nodeId: number | null; createdAt: string; updatedAt: string; publishedAt: string | null;
};

export type StudentLessonGame = {
  assignmentId: string; lessonSlug: string; lessonTitle: string; lessonAt: string | null;
  template: string; title: string; position: number; dataId: string;
  nodeId: number | null; skill: string | null; plays: number; bestScore: number | null;
  total: number | null; lastPlayedAt: string | null;
};

export type StudentPlanSkill = { id: number; title: string };

const id = (prefix: string): string => `${prefix}-${randomBytes(12).toString('hex')}`;

export function lessonForStudent(lessonSlug: string, studentId: number): LessonContextRow | null {
  return (handle().prepare(`
    SELECT l.id, l.slug, l.title, l.topic, l.lesson_at
    FROM lessons l
    WHERE l.slug = ?
      AND EXISTS (
        SELECT 1 FROM bookings_v2 b
        WHERE b.start = l.lesson_at AND b.student_id = ? AND b.status != 'cancelled'
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings_v2 b
        WHERE b.start = l.lesson_at AND b.student_id != ? AND b.status != 'cancelled'
      )
  `).get(lessonSlug, studentId, studentId) as LessonContextRow | undefined) ?? null;
}

export function studentForLesson(lessonSlug: string): { id: number; code: string; name: string } | null {
  const rows = handle().prepare(`
    SELECT DISTINCT s.id, s.code, s.name
    FROM lessons l
    JOIN bookings_v2 b ON b.start = l.lesson_at AND b.status != 'cancelled'
    JOIN students_v2 s ON s.id = b.student_id
    WHERE l.slug = ?
  `).all(lessonSlug) as { id: number; code: string; name: string }[];
  return rows.length === 1 ? rows[0] : null;
}

function exampleBody(template: string): Record<string, unknown> {
  const definition = getRegistry().templates[template];
  if (!definition || definition.status !== 'ready' || !definition.example) {
    throw new Error('unknown or unavailable game template');
  }
  const stored = readGameFiller(definition.example);
  const body = stored ?? readFileSync(join(process.cwd(), 'seed', 'games-data', `${definition.example}.json`), 'utf8');
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid catalog example');
  return structuredClone(parsed as Record<string, unknown>);
}

function assertSkillForStudent(studentId: number, nodeId: number | null | undefined): void {
  if (nodeId == null) return;
  const row = handle().prepare(`
    SELECT pn.id
    FROM plan_nodes pn
    JOIN plans p ON p.id = pn.plan_id
    WHERE pn.id = ? AND p.student_id = ? AND pn.kind = 'skill' AND pn.visibility != 'hidden'
  `).get(nodeId, studentId);
  if (!row) throw new Error('skill is not available to this student');
}

export function lessonGameSkillsForStudent(studentId: number): StudentPlanSkill[] {
  return handle().prepare(`
    SELECT pn.id, pn.title
    FROM plan_nodes pn
    JOIN plans p ON p.id = pn.plan_id
    WHERE p.student_id = ? AND pn.kind = 'skill' AND pn.visibility != 'hidden'
    ORDER BY pn.position, pn.id
  `).all(studentId) as StudentPlanSkill[];
}

function validateShape(value: unknown, schema: unknown, path = 'game'): void {
  if (typeof schema === 'string') {
    const optional = schema.includes('optional');
    if (value == null && optional) return;
    const expected = schema.split(/[ ,—]/)[0];
    if (expected === 'string' && schema.includes('OR { answer') && value && typeof value === 'object') {
      const answer = (value as Record<string, unknown>).answer;
      if (typeof answer === 'string' && answer.trim()) return;
    }
    if (expected === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`${path} must be a number`);
    }
    if (expected === 'string' && (typeof value !== 'string' || (!optional && !value.trim()))) {
      throw new Error(`${path} must be a non-empty string`);
    }
    return;
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must contain items`);
    for (const [index, item] of value.entries()) validateShape(item, schema[0], `${path}.${index}`);
    return;
  }
  if (schema && typeof schema === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    for (const [key, childSchema] of Object.entries(schema as Record<string, unknown>)) {
      validateShape((value as Record<string, unknown>)[key], childSchema, `${path}.${key}`);
    }
  }
}

export function validateLessonGame(template: string, body: unknown): asserts body is Record<string, unknown> {
  const definition = getRegistry().templates[template];
  if (!definition || definition.status !== 'ready') throw new Error('unknown or unavailable game template');
  validateShape(body, definition.dataSchema);
}

function assignmentById(assignmentId: string): (AssignmentRow & { lesson_slug: string }) | null {
  return (handle().prepare(`
    SELECT a.*, l.slug AS lesson_slug
    FROM lesson_game_assignments a JOIN lessons l ON l.id = a.lesson_id
    WHERE a.id = ?
  `).get(assignmentId) as (AssignmentRow & { lesson_slug: string }) | undefined) ?? null;
}

function toAssignment(row: AssignmentRow & { lesson_slug: string }): LessonGameAssignment {
  return {
    id: row.id, lessonId: row.lesson_id, lessonSlug: row.lesson_slug,
    studentId: row.student_id, template: row.template, title: row.title,
    position: row.position, status: row.status,
    body: JSON.parse(row.draft_body) as Record<string, unknown>, revision: row.draft_revision,
    publishedDataId: row.published_data_id, nodeId: row.node_id,
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at,
  };
}

export function getLessonGame(assignmentId: string): LessonGameAssignment | null {
  const row = assignmentById(assignmentId);
  return row ? toAssignment(row) : null;
}

export function createLessonGame(input: {
  lessonSlug: string; studentId: number; template: string; nodeId?: number | null;
}): LessonGameAssignment {
  const lesson = lessonForStudent(input.lessonSlug, input.studentId);
  if (!lesson) throw new Error('lesson is not available to this student');
  assertSkillForStudent(input.studentId, input.nodeId);
  const body = exampleBody(input.template);
  validateLessonGame(input.template, body);
  const now = new Date().toISOString();
  const assignmentId = id('lga');
  const position = Number((handle().prepare(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lesson_game_assignments WHERE lesson_id = ?`
  ).get(lesson.id) as { next: number }).next);
  const title = String(body.title || getRegistry().templates[input.template].title);
  handle().prepare(`
    INSERT INTO lesson_game_assignments
      (id, lesson_id, student_id, template, title, position, status, draft_body,
       draft_revision, node_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?)
  `).run(assignmentId, lesson.id, input.studentId, input.template, title, position,
    JSON.stringify(body), input.nodeId ?? null, now, now);
  return toAssignment(assignmentById(assignmentId)!);
}

export function lessonGamesForLesson(lessonSlug: string): LessonGameAssignment[] {
  const rows = handle().prepare(`
    SELECT a.*, l.slug AS lesson_slug
    FROM lesson_game_assignments a JOIN lessons l ON l.id = a.lesson_id
    WHERE l.slug = ? ORDER BY a.position, a.created_at
  `).all(lessonSlug) as (AssignmentRow & { lesson_slug: string })[];
  return rows.map(toAssignment);
}

function assertRevision(row: AssignmentRow, expected: number): void {
  if (row.draft_revision !== expected) throw new Error('revision conflict');
  if (row.status === 'archived') throw new Error('assignment is archived');
}

export function saveLessonGameDraft(input: {
  assignmentId: string; expectedRevision: number; title: string; body: unknown;
  nodeId?: number | null;
}): LessonGameAssignment {
  const row = assignmentById(input.assignmentId);
  if (!row) throw new Error('assignment not found');
  assertRevision(row, input.expectedRevision);
  assertSkillForStudent(row.student_id, input.nodeId);
  validateLessonGame(row.template, input.body);
  const title = input.title.trim();
  if (!title) throw new Error('title is required');
  const nodeId = input.nodeId === undefined ? row.node_id : input.nodeId;
  const result = handle().prepare(`
    UPDATE lesson_game_assignments
    SET title = ?, draft_body = ?, draft_revision = draft_revision + 1,
        node_id = ?, updated_at = ?
    WHERE id = ? AND draft_revision = ? AND status != 'archived'
  `).run(title, JSON.stringify(input.body), nodeId, new Date().toISOString(),
    input.assignmentId, input.expectedRevision);
  if (Number(result.changes) !== 1) throw new Error('revision conflict');
  return toAssignment(assignmentById(input.assignmentId)!);
}

export function publishLessonGame(input: {
  assignmentId: string; expectedRevision: number;
}): LessonGameAssignment {
  return inTransaction(() => {
    const row = assignmentById(input.assignmentId);
    if (!row) throw new Error('assignment not found');
    assertRevision(row, input.expectedRevision);
    const body = JSON.parse(row.draft_body) as Record<string, unknown>;
    validateLessonGame(row.template, body);
    const dataId = id(`lesson-${row.lesson_id}-${row.template}`);
    const now = new Date().toISOString();
    handle().prepare(`
      INSERT INTO lesson_game_revisions (data_id, assignment_id, body, published_at)
      VALUES (?, ?, ?, ?)
    `).run(dataId, row.id, JSON.stringify(body), now);
    const result = handle().prepare(`
      UPDATE lesson_game_assignments
      SET status = 'published', published_data_id = ?, published_at = ?,
          updated_at = ?, draft_revision = draft_revision + 1
      WHERE id = ? AND draft_revision = ? AND status != 'archived'
    `).run(dataId, now, now, row.id, input.expectedRevision);
    if (Number(result.changes) !== 1) throw new Error('revision conflict');
    if (row.node_id != null) linkGameToSkill(row.student_id, dataId, row.node_id);
    return toAssignment(assignmentById(row.id)!);
  });
}

export function saveAndPublishLessonGame(input: {
  assignmentId: string; expectedRevision: number; title: string; body: unknown;
  nodeId?: number | null;
}): LessonGameAssignment {
  return inTransaction(() => {
    const draft = saveLessonGameDraft(input);
    return publishLessonGame({ assignmentId: input.assignmentId, expectedRevision: draft.revision });
  });
}

export function archiveLessonGame(assignmentId: string): void {
  handle().prepare(`UPDATE lesson_game_assignments SET status = 'archived', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), assignmentId);
}

export function readPublishedLessonGame(dataId: string): {
  dataId: string; assignmentId: string; studentId: number; template: string;
  title: string; body: Record<string, unknown>;
} | null {
  const row = handle().prepare(`
    SELECT r.data_id, r.assignment_id, r.body, a.student_id, a.template, a.title
    FROM lesson_game_revisions r JOIN lesson_game_assignments a ON a.id = r.assignment_id
    WHERE r.data_id = ?
  `).get(dataId) as {
    data_id: string; assignment_id: string; body: string; student_id: number;
    template: string; title: string;
  } | undefined;
  return row ? {
    dataId: row.data_id, assignmentId: row.assignment_id, studentId: row.student_id,
    template: row.template, title: row.title,
    body: JSON.parse(row.body) as Record<string, unknown>,
  } : null;
}

export function lessonGamesForStudent(studentId: number): StudentLessonGame[] {
  const rows = handle().prepare(`
    SELECT a.id AS assignment_id, l.slug AS lesson_slug,
           COALESCE(l.title, l.topic, l.slug) AS lesson_title, l.lesson_at,
           a.template, a.title, a.position, a.published_data_id AS data_id, a.node_id,
           pn.title AS skill,
           COUNT(r.id) AS plays, MAX(r.score) AS best_score, MAX(r.total) AS total,
           MAX(r.at) AS last_played_at
    FROM lesson_game_assignments a
    JOIN lessons l ON l.id = a.lesson_id
    JOIN bookings_v2 b ON b.start = l.lesson_at AND b.student_id = a.student_id AND b.status != 'cancelled'
    LEFT JOIN plan_nodes pn ON pn.id = a.node_id AND pn.visibility != 'hidden'
    LEFT JOIN results_v2 r ON r.student_id = a.student_id AND r.data_id = a.published_data_id
    WHERE a.student_id = ? AND a.status = 'published' AND a.published_data_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings_v2 other
        WHERE other.start = l.lesson_at AND other.student_id != a.student_id AND other.status != 'cancelled'
      )
    GROUP BY a.id
    ORDER BY COALESCE(l.lesson_at, l.at) DESC, a.position, a.created_at
  `).all(studentId) as Array<{
    assignment_id: string; lesson_slug: string; lesson_title: string; lesson_at: string | null;
    template: string; title: string; position: number; data_id: string; node_id: number | null;
    skill: string | null; plays: number; best_score: number | null; total: number | null;
    last_played_at: string | null;
  }>;
  return rows.map(row => ({
    assignmentId: row.assignment_id, lessonSlug: row.lesson_slug,
    lessonTitle: row.lesson_title, lessonAt: row.lesson_at, template: row.template,
    title: row.title, position: row.position, dataId: row.data_id, nodeId: row.node_id,
    skill: row.skill, plays: Number(row.plays), bestScore: row.best_score,
    total: row.total, lastPlayedAt: row.last_played_at,
  }));
}

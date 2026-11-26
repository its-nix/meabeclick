import { createHash } from 'node:crypto';
import { centralDriveApi, SLIDES } from '../central-drive/api.ts';
import { learningService } from '../learning-google.ts';
import { getNativeLessonJob } from '../native-learning/jobs.ts';
import { ReportConflict } from './coverage.ts';
import type { BookingRow } from './store.ts';

const fileId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{10,200}$/.test(value);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

type Objective = { id: string; title: string };
type Receipt = {
  version?: unknown; state?: unknown; sourceHash?: unknown; reviewFolderId?: unknown;
  slides?: { id?: unknown }; homework?: { id?: unknown }; tutorNotes?: { id?: unknown };
  notesLocation?: unknown; provenance?: { bundleVersion?: unknown };
};

export type NativeReportBundle = {
  binding: string; jobId: number; reviewFolderId: string; slidesId: string;
  sourceHash: string; authoredVersion: string; homeworkId: string; tutorNotesId: string | null;
  objectives: Objective[];
};

export type NativeReportSource = NativeReportBundle & {
  token: string;
  slides: { version: string; name: string; modifiedAt: string };
};

/** A completed receipt and its authored objectives must belong to this exact booking. */
export function nativeReportBundle(booking: BookingRow): NativeReportBundle | null {
  const job = getNativeLessonJob(booking.id);
  if (job?.state !== 'review' || job.studentId !== booking.student_id) return null;
  const snapshot = job.snapshot;
  if (snapshot.bookingId !== booking.id || snapshot.studentId !== booking.student_id ||
      snapshot.enrollmentId !== booking.enrollment_id || Date.parse(snapshot.start) !== Date.parse(booking.start)) return null;

  const receipt = job.bundle as Receipt | null;
  const authored = (snapshot as typeof snapshot & {
    authored?: { version: unknown; bundle?: { objectives?: Objective[] } };
  }).authored;
  if (receipt?.version !== 1 || receipt.state !== 'draft' || !isHash(receipt.sourceHash) ||
      !fileId(receipt.reviewFolderId) || !fileId(receipt.slides?.id) || !fileId(receipt.homework?.id) ||
      (receipt.tutorNotes ? !fileId(receipt.tutorNotes.id) : receipt.notesLocation !== 'slides') ||
      !isHash(authored?.version) || authored.version !== receipt.provenance?.bundleVersion ||
      !authored.bundle || hash(authored.bundle) !== authored.version) return null;

  const objectives = authored.bundle.objectives;
  if (!Array.isArray(objectives) || !objectives.length || objectives.length > 40 ||
      objectives.some(item => typeof item?.id !== 'string' || !item.id.trim() || item.id.length > 120 ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200) ||
      new Set(objectives.map(item => item.id)).size !== objectives.length) return null;

  return {
    binding: hash([job.id, booking.id, booking.student_id, booking.enrollment_id, booking.start, receipt]),
    jobId: job.id, reviewFolderId: receipt.reviewFolderId, slidesId: receipt.slides.id,
    sourceHash: receipt.sourceHash, authoredVersion: authored.version, homeworkId: receipt.homework.id,
    tutorNotesId: receipt.tutorNotes ? receipt.tutorNotes.id as string : null,
    objectives: objectives.map(({ id, title }) => ({ id, title })),
  };
}

type ReportDrive = Pick<ReturnType<typeof centralDriveApi>, 'json' | 'scope' | 'ownerEmail'>;

/** Drive's file version changes even for metadata updates, which conservatively invalidates an open form. */
export async function nativeReportSource(booking: BookingRow, drive?: ReportDrive): Promise<NativeReportSource> {
  const bundle = nativeReportBundle(booking);
  if (!bundle) throw new ReportConflict();

  try {
    const access = drive ? null : learningService().syncAccess();
    const api = drive ?? centralDriveApi({ access: access!, checkpoint: { read: () => null, write: () => {} } });
    const meta = await api.json(`https://www.googleapis.com/drive/v3/files/${bundle.slidesId}?fields=id,mimeType,parents,owners(emailAddress),permissions(type),trashed,appProperties,version,name,modifiedTime`);
    access?.assertCurrent();
    if (meta.id !== bundle.slidesId || meta.mimeType !== SLIDES || meta.trashed !== false ||
        meta.parents?.length !== 1 || meta.parents[0] !== bundle.reviewFolderId ||
        meta.appProperties?.meaCentralScope !== api.scope ||
        !meta.owners?.some((owner: { emailAddress?: string }) => owner.emailAddress?.toLowerCase() === api.ownerEmail.toLowerCase()) ||
        !Array.isArray(meta.permissions) || meta.permissions.some((permission: { type?: string }) => !['user', 'group'].includes(permission.type ?? '')) ||
        typeof meta.version !== 'string' || !/^[1-9]\d{0,18}$/.test(meta.version) ||
        typeof meta.name !== 'string' || !meta.name.trim() ||
        typeof meta.modifiedTime !== 'string' || !Number.isFinite(Date.parse(meta.modifiedTime))) {
      throw new ReportConflict();
    }
    return {
      ...bundle,
      token: hash([bundle.binding, meta.version]),
      slides: { version: meta.version, name: meta.name.slice(0, 250), modifiedAt: meta.modifiedTime },
    };
  } catch {
    throw new ReportConflict();
  }
}

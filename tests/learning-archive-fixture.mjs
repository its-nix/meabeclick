export const receipt={version:1,archiveId:'archive-first',fingerprint:'a'.repeat(64),archivedAt:'2026-11-14T12:00:00.000Z',artifactCount:3,lessonCount:1,
 workspaceId:'nativeworkspace123',libraryId:'nativelibrary123',presentationsId:'presentations123',homeworkId:'homeworkfolder123',gamesId:'gamesfolder123',notesId:'notesfolder123',templatesId:'templatesfolder123',reviewId:'reviewfolder123',archiveFolderId:'archivefolder123',archiveIndexId:'archiveindex123',studentsId:'studentsfolder123',indexId:'sourceindex123',guideId:'nativeguide123'};
export function seedRetired(db,slug='retired-lesson'){
 db.prepare("INSERT INTO lessons(slug,student,at,status,title,slides) VALUES(?, 'Synthetic learner', ?, 'ready','Archived synthetic lesson',?)").run(slug,new Date().toISOString(),`lessons/${slug}/slides.html`);
 db.prepare('INSERT INTO learning_archive(id,archive_id,fingerprint,slugs,receipt) VALUES(1,?,?,?,?)').run(receipt.archiveId,receipt.fingerprint,JSON.stringify([slug]),JSON.stringify(receipt));
 db.prepare('INSERT INTO learning_retired_lessons(slug,archive_id) VALUES(?,?)').run(slug,receipt.archiveId);
 return receipt;
}

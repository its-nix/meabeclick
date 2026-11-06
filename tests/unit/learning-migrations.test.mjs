import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MIGRATIONS} from '../../src/lib/server/migrations/list.ts';
import {migrate} from '../../src/lib/server/migrations/index.ts';

for(const from of [34,35]) test(`learning migration upgrades schema ${from} without altering existing material or student records`,()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    migrate(db,MIGRATIONS.filter(m=>m.version<=from));
    // Legacy lessons is initialized by db.ts after the versioned migrations.
    db.exec('CREATE TABLE lessons (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE)');
    const now='2026-11-04T00:00:00.000Z';
    db.prepare('INSERT INTO accounts (id,name,credential,created_at) VALUES (1,?,?,?)').run('משפחת בדיקה','synthetic',now);
    db.prepare('INSERT INTO students_v2 (id,code,name,account_id,credential,created_at) VALUES (1,?,?,1,?,?)').run('migration-test','תלמיד בדיקה','synthetic',now);
    db.prepare('INSERT INTO lessons (slug) VALUES (?)').run('migration-test');
    db.prepare(`INSERT INTO lesson_materials (lesson_slug,kind,version,content,origin,published_at,created_at)
      VALUES (?,'plan',1,?,'edited',?,?)`).run('migration-test','{"title":"חומר שפורסם קודם"}',now,now);
    if(from===35) {
      db.prepare('INSERT INTO learning_assignments (lesson_slug,student_id) VALUES (?,1)').run('migration-test');
      db.prepare(`INSERT INTO learning_progress (student_id,lesson_slug,fingerprint,scene_id,attempts,solved,visited,updated_at)
        VALUES (1,?,'old-version','challenge',2,1,1,?)`).run('migration-test',now);
    }
    const material=db.prepare('SELECT * FROM lesson_materials').all();
    const student=db.prepare('SELECT * FROM students_v2').all();
    migrate(db);
    migrate(db); // A restart must not reapply either migration.
    assert.equal(db.prepare('SELECT max(version) AS version FROM schema_version').get().version,Math.max(...MIGRATIONS.map(m=>m.version)));
    assert.deepEqual(db.prepare('SELECT * FROM lesson_materials').all(),material);
    assert.deepEqual(db.prepare('SELECT * FROM students_v2').all(),student);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    if(from===35) {
      assert.equal(db.prepare('SELECT solved FROM learning_progress').get().solved,1);
      assert.equal(db.prepare('SELECT practice_state FROM learning_assignments').get().practice_state,'assigned');
    }
  }finally{db.close();}
});

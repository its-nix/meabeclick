// Import before prep.ts: its engine-health dependency opens SQLite.
// Parallel unit files must never race migrations against the default data DB.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'lesson-unit-'));
process.env.DB_PATH=join(process.env.DATA_DIR,'results.db');

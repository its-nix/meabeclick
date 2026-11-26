"""Durable local ledger for autonomous content creation and review capacity."""
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sqlite3


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Timestamp must be an ISO-8601 string')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Invalid ISO-8601 timestamp') from exc
    if parsed.tzinfo is None:
        raise ValueError('Timestamp must include a timezone')
    return parsed.isoformat()


class Store:
    """SQLite store with idempotent stage claims and append-only event history."""

    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS stage_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stage TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('claimed','completed','held','failed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          result_json TEXT,
          UNIQUE(stage, fingerprint)
        );
        CREATE TABLE IF NOT EXISTS concepts (
          id TEXT PRIMARY KEY,
          run_id INTEGER NOT NULL REFERENCES stage_runs(id),
          fingerprint TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('candidate','production_ready','selected','producing','produced','rejected','held')),
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS content_items (
          id TEXT PRIMARY KEY,
          concept_id TEXT NOT NULL REFERENCES concepts(id),
          artifact_id TEXT UNIQUE,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS review_batches (
          batch_id TEXT PRIMARY KEY,
          planned_count INTEGER NOT NULL CHECK(planned_count BETWEEN 0 AND 20),
          review_minutes INTEGER,
          completed INTEGER NOT NULL CHECK(completed IN (0,1)),
          backlog INTEGER NOT NULL DEFAULT 0 CHECK(backlog >= 0),
          observed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS calendar_slots (
          scheduled_at TEXT PRIMARY KEY,
          concept_id TEXT NOT NULL UNIQUE REFERENCES concepts(id)
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          detail TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        ''')
        self.db.execute('PRAGMA user_version=1')

    def close(self):
        if getattr(self, 'db', None) is not None:
            self.db.close()
            self.db = None

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def _event(self, kind, entity_id, detail, at):
        self.db.execute('INSERT INTO events(event_type,entity_id,detail,created_at) VALUES(?,?,?,?)',
                        (kind, str(entity_id), _canonical(detail), at))

    def claim_stage(self, stage, fingerprint, now):
        if not isinstance(stage, str) or not stage.strip():
            raise ValueError('Stage name required')
        if not isinstance(fingerprint, str) or not fingerprint.strip():
            raise ValueError('Stage fingerprint required')
        at = _timestamp(now)
        with self.transaction():
            row = self.db.execute('SELECT id FROM stage_runs WHERE stage=? AND fingerprint=?',
                                  (stage, fingerprint)).fetchone()
            if row:
                state = self.db.execute('SELECT status FROM stage_runs WHERE id=?', (row['id'],)).fetchone()['status']
                if state in ('held', 'failed'):
                    self.db.execute("UPDATE stage_runs SET status='claimed',updated_at=?,result_json=NULL WHERE id=?", (at, row['id']))
                    self._event('stage_reclaimed', row['id'], {'stage': stage, 'fingerprint': fingerprint}, at)
                    return row['id'], True
                return row['id'], False
            cursor = self.db.execute('INSERT INTO stage_runs(stage,fingerprint,status,created_at,updated_at) VALUES(?,?,?,?,?)',
                                     (stage, fingerprint, 'claimed', at, at))
            run_id = cursor.lastrowid
            self._event('stage_claimed', run_id, {'stage': stage, 'fingerprint': fingerprint}, at)
        return run_id, True

    def finish_stage(self, run_id, status, result, now):
        if status not in ('completed', 'held', 'failed'):
            raise ValueError('Invalid stage result status')
        at = _timestamp(now)
        value = _canonical(result)
        with self.transaction():
            row = self.db.execute('SELECT status FROM stage_runs WHERE id=?', (run_id,)).fetchone()
            if not row or row['status'] != 'claimed':
                raise ValueError('Stage run is not claimed')
            self.db.execute('UPDATE stage_runs SET status=?,result_json=?,updated_at=? WHERE id=?',
                            (status, value, at, run_id))
            self._event('stage_'+status, run_id, result, at)

    def save_concepts(self, run_id, concepts):
        if not isinstance(concepts, list):
            raise ValueError('Concepts must be a list')
        at = datetime.now().astimezone().isoformat()
        ids = []
        with self.transaction():
            run = self.db.execute('SELECT id FROM stage_runs WHERE id=?', (run_id,)).fetchone()
            if not run:
                raise ValueError('Unknown stage run')
            for payload in concepts:
                if not isinstance(payload, dict):
                    raise ValueError('Concept must be a JSON object')
                canonical = _canonical(payload)
                fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
                concept_id = 'C' + fingerprint[:20]
                self.db.execute("INSERT OR IGNORE INTO concepts(id,run_id,fingerprint,status,payload_json,created_at,updated_at) VALUES(?,?,?,'candidate',?,?,?)",
                                (concept_id, run_id, fingerprint, canonical, at, at))
                ids.append(concept_id)
                self._event('concept_saved', concept_id, {'run_id': run_id, 'fingerprint': fingerprint}, at)
        return ids

    def transition_concept(self, concept_id, expected, target, detail):
        allowed = {'candidate': {'production_ready', 'rejected', 'held'},
                   'production_ready': {'selected', 'rejected', 'held'},
                   'selected': {'producing', 'held'}, 'producing': {'produced', 'held'},
                   'held': {'candidate', 'production_ready', 'rejected'},
                   'produced': set(), 'rejected': set()}
        if target not in allowed.get(expected, set()):
            raise ValueError('Invalid concept transition')
        at = datetime.now().astimezone().isoformat()
        with self.transaction():
            row = self.db.execute('SELECT status FROM concepts WHERE id=?', (concept_id,)).fetchone()
            if not row or row['status'] != expected:
                raise ValueError('Concept transition source status changed')
            self.db.execute('UPDATE concepts SET status=?,updated_at=? WHERE id=?', (target, at, concept_id))
            self._event('concept_'+target, concept_id, {'from': expected, 'detail': detail}, at)

    def save_content_item(self, item_id, concept_id, artifact_id, status, payload):
        """Idempotently bind one concept to its immutable artifact and review state."""
        if not isinstance(item_id, str) or not item_id or not isinstance(concept_id, str) or not concept_id:
            raise ValueError('Content item and concept IDs are required')
        if status not in ('produced', 'verified', 'review', 'held') or not isinstance(payload, dict):
            raise ValueError('Invalid content item state')
        at = datetime.now().astimezone().isoformat()
        encoded = _canonical(payload)
        with self.transaction():
            old = self.db.execute('SELECT concept_id,artifact_id,status,payload_json FROM content_items WHERE id=?', (item_id,)).fetchone()
            if old:
                if (old['concept_id'], old['artifact_id']) != (concept_id, artifact_id):
                    raise ValueError('Content item identity already binds a different artifact')
                if old['status'] != status or old['payload_json'] != encoded:
                    self.db.execute('UPDATE content_items SET status=?,payload_json=?,updated_at=? WHERE id=?',
                                    (status, encoded, at, item_id))
                return item_id
            self.db.execute('INSERT INTO content_items(id,concept_id,artifact_id,status,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                            (item_id, concept_id, artifact_id, status, encoded, at, at))
            self._event('content_item_saved', item_id, {'concept_id': concept_id, 'artifact_id': artifact_id, 'status': status}, at)
        return item_id

    def ready_concepts(self, limit):
        if type(limit) is not int or limit < 0:
            raise ValueError('Limit must be a nonnegative integer')
        rows = self.db.execute("SELECT id,run_id,status,payload_json,created_at FROM concepts WHERE status='production_ready' ORDER BY created_at,id LIMIT ?", (limit,)).fetchall()
        return [{'id': r['id'], 'run_id': r['run_id'], 'status': r['status'],
                 'payload': json.loads(r['payload_json']), 'created_at': r['created_at']} for r in rows]

    def record_review(self, batch_id, minutes, completed, observed_at, planned_count=2, backlog=0):
        if not isinstance(batch_id, str) or not batch_id.strip():
            raise ValueError('Review batch ID required')
        if minutes is not None and (type(minutes) is not int or minutes < 0):
            raise ValueError('Review minutes must be a nonnegative integer or null')
        if type(completed) is not bool:
            raise ValueError('Review completion must be boolean')
        if type(planned_count) is not int or not 0 <= planned_count <= 20:
            raise ValueError('Planned count must be between 0 and 20')
        if type(backlog) is not int or backlog < 0:
            raise ValueError('Backlog must be a nonnegative integer')
        at = _timestamp(observed_at)
        with self.transaction():
            old = self.db.execute('SELECT * FROM review_batches WHERE batch_id=?', (batch_id,)).fetchone()
            record = (planned_count, minutes, int(completed), backlog, at)
            if old:
                if old['planned_count'] != planned_count:
                    raise ValueError('Review batch planned count is immutable')
                if old['review_minutes'] is not None and minutes != old['review_minutes']:
                    raise ValueError('Owner review minutes are immutable once recorded')
                minutes = old['review_minutes'] if minutes is None else minutes
                completed = bool(old['completed'] or completed)
                self.db.execute('UPDATE review_batches SET review_minutes=?,completed=?,backlog=?,observed_at=? WHERE batch_id=?',
                                (minutes, int(completed), backlog, at, batch_id))
                self._event('review_updated', batch_id, {'planned_count': planned_count, 'minutes': minutes,
                                                        'completed': completed, 'backlog': backlog}, at)
                return
            self.db.execute('INSERT INTO review_batches(batch_id,planned_count,review_minutes,completed,backlog,observed_at) VALUES(?,?,?,?,?,?)',
                            (batch_id, *record))
            self._event('review_recorded', batch_id, {'planned_count': planned_count, 'minutes': minutes,
                                                      'completed': completed, 'backlog': backlog}, at)

    def snapshot(self, now):
        at = _timestamp(now)
        counts = {name: self.db.execute(query).fetchone()[0] for name, query in {
            'stage_runs': 'SELECT count(*) FROM stage_runs',
            'concepts': 'SELECT count(*) FROM concepts',
            'review_batches': 'SELECT count(*) FROM review_batches'}.items()}
        concept_counts = {r['status']: r['n'] for r in self.db.execute('SELECT status,count(*) AS n FROM concepts GROUP BY status')}
        return {'as_of': at, 'counts': counts, 'concept_counts': concept_counts}


def review_target(store, default=2, budget_minutes=30, max_items=20, now=None, max_age_days=45):
    if type(default) is not int or not 1 <= default <= max_items <= 20:
        raise ValueError('Invalid review target bounds')
    if type(budget_minutes) is not int or budget_minutes < 1:
        raise ValueError('Invalid review budget')
    all_rows = store.db.execute('SELECT * FROM review_batches ORDER BY observed_at,batch_id').fetchall()
    if all_rows:
        latest_any=all_rows[-1]
        if not latest_any['completed'] or latest_any['review_minutes'] is None:
            return {'target': latest_any['planned_count'], 'reason': 'latest review batch is incomplete or has no recorded minutes'}
    rows = [row for row in all_rows if row['completed'] and row['review_minutes'] is not None]
    if not rows:
        return {'target': default, 'reason': 'no completed review with recorded minutes'}
    latest = rows[-1]
    current=datetime.fromisoformat(_timestamp(now)) if now is not None else datetime.now().astimezone()
    observed=datetime.fromisoformat(latest['observed_at'])
    if type(max_age_days) is not int or max_age_days<1:raise ValueError('Review data freshness must be a positive number of days')
    age=current-observed
    if age.total_seconds()<0 or age.total_seconds()>max_age_days*86400:
        return {'target':latest['planned_count'],'reason':'last completed review is stale; holding the demonstrated batch size'}
    if latest['backlog'] > 0:
        return {'target': latest['planned_count'], 'reason': 'review backlog remains'}
    if latest['review_minutes'] > budget_minutes:
        in_budget = [r['planned_count'] for r in rows[:-1] if r['review_minutes'] <= budget_minutes and r['backlog'] == 0]
        target = in_budget[-1] if in_budget else default
        return {'target': target, 'reason': 'last completed review exceeded the time budget'}
    return {'target': min(max_items, latest['planned_count'] + 1), 'reason': 'completed review fit within budget without backlog'}

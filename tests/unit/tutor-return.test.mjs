import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeTutorReturn } from '../../src/lib/tutor-return.ts';

const origin = 'https://tutor.example';
test('safe tutor returns preserve known page context without nested return chains', () => {
  assert.equal(safeTutorReturn('/app/library?topic=math&page=3#catalog', origin), '/app/library?topic=math&page=3');
  assert.equal(safeTutorReturn('/app/students/example?returnTo=https%3A%2F%2Fevil.example', origin), '/app/students/example');
  assert.equal(safeTutorReturn('/app/lessons/example/edit?game=4', origin), '/app/lessons/example/edit?game=4');
});
test('safe tutor returns reject external and action destinations', () => {
  for (const raw of [null, '', '//evil.example', '/\\evil.example', 'https://evil.example', '/api/students/a', '/logout', '/enter', '/app/play/test', '/app/students/a/delete', '/app/library/../login']) {
    assert.equal(safeTutorReturn(raw, origin, '/app/students/example'), '/app/students/example', String(raw));
  }
  assert.equal(safeTutorReturn(null, origin, '//evil.example'), '/app/dashboard');
});

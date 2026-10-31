import test from 'node:test';
import assert from 'node:assert/strict';
import { homeworkProblems } from '../../src/lib/homework-display.ts';

test('explicit context, mathematical data and instruction stay separate without splitting decimals or tuples', () => {
  assert.deepEqual(homeworkProblems('במשולש ABC. הנתונים: AB = 3.5, AC = 4; A(2, 3)\nהשאלה: חשבו את ההיקף.'), [{
    context: 'במשולש ABC.', data: ['AB = 3.5', 'AC = 4', 'A(2, 3)'], instruction: 'חשבו את ההיקף.',
  }]);
});

test('line-start numbered problems become distinct cards; decimals and inline enumeration are not guessed', () => {
  assert.deepEqual(homeworkProblems('1. פתרו x = 3.5\n2) חשבו 2 + 4'), [
    { context: '', data: [], instruction: 'פתרו x = 3.5' },
    { context: '', data: [], instruction: 'חשבו 2 + 4' },
  ]);
  for (const text of ['פתרו: 1. x = 2 2. y = 4', 'טקסט\n2. סעיף משני', 'נתונים: x = 2, y = 3', '<img src=x onerror=alert(1)>\nפתרו x = 2', '']) {
    assert.deepEqual(homeworkProblems(text), [{ context: '', data: [], instruction: text }]);
  }
});

test('display math delimiters do not turn mathematical commas into datum boundaries', () => {
  assert.deepEqual(homeworkProblems('נתונים: $$x = 1, y = 2$$; \\(a = 3, b = 4\\)\nשאלה: חשבו')[0].data,
    ['$$x = 1, y = 2$$', '\\(a = 3, b = 4\\)']);
});

test('data separator preserves decimal commas, nested tuples, inequalities, and delimited LaTeX', () => {
  assert.deepEqual(homeworkProblems('נתונים: x = 3,5; f(x, y) = (1, 2); $\\\\frac{1, 2}{3}$; x ≥ -2\nהוראה: מצאו את x')[0].data,
    ['x = 3,5', 'f(x, y) = (1, 2)', '$\\\\frac{1, 2}{3}$', 'x ≥ -2']);
});

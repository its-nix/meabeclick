import { visualDeckFixture } from './visual-deck-fixture.mjs';
export async function prepareReviewedNativeLesson() {
  return { version: 'fixture-v1', bundle: visualDeckFixture(), sources: [], model: 'fixture' };
}

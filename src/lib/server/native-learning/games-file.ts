import type { VisualLesson } from '../../learning/deck/model.ts';

export interface GamesFile {
  version: 1;
  lessonRef: string;
  objectives: { id: string; title: string }[];
  games: VisualLesson['games'];
}

/** The editable Drive source for one lesson. Answers stay private to staff. */
export function exportGamesFile(bundle: VisualLesson, lessonRef: string): GamesFile {
  return {
    version: 1,
    lessonRef,
    objectives: bundle.objectives.map(({ id, title }) => ({ id, title })),
    games: structuredClone(bundle.games),
  };
}

export function gamesFileText(file: GamesFile): string {
  return JSON.stringify(file, null, 1);
}

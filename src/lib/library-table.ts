export interface LibraryTableFilters {
  template: string;
  topic: string;
  status: string;
  search: string;
}

/** Pure view filtering; no filtering can change the identity used to prepare
 * or edit a master. An unprepared skill has its own explicit status. */
export function filterLibraryRows<T extends {
  templateId: string; topic: string; title: string; track: string; item: { status: string } | null;
}>(rows: T[], filters: LibraryTableFilters): T[] {
  const search = filters.search.trim().toLocaleLowerCase('he');
  return rows.filter(row =>
    (!filters.template || row.templateId === filters.template)
    && (!filters.topic || row.topic === filters.topic)
    && (!filters.status || (row.item?.status ?? 'none') === filters.status)
    && (!search || `${row.title} ${row.topic} ${row.track}`.toLocaleLowerCase('he').includes(search)),
  );
}
/** A filtered catalog stays bounded and never points at a now-empty page. */
export function libraryPage<T>(rows: T[], requested: number): { page: number; pages: number; rows: T[] } {
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  return { page, pages, rows: rows.slice((page - 1) * 25, page * 25) };
}


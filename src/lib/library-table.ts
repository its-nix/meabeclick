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

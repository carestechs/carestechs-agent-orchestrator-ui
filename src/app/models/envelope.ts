export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface EnvelopeMeta {
  alreadyReceived?: boolean;
}

export interface Envelope<T> {
  data: T;
  meta: EnvelopeMeta | null;
}

export interface PaginatedEnvelope<T> {
  data: T[];
  meta: Pagination;
}

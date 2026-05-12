export interface Pagination {
  page: number;
  pageSize: number;
  // Real orchestrator field is `totalCount`. Source: live capture of
  // `GET /api/v1/runs` meta block.
  totalCount: number;
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

/** Typed fetch helpers. Client speaks only the shared/api contracts. */

import type {
  AccuseRequest,
  AccuseResponse,
  ArchiveResponse,
  BoardResponse,
  CaseResponse,
  ErrorResponse,
  FileRequest,
  FileResponse,
  MyShardsResponse,
  VerdictResponse,
} from '../shared/api';

const isError = (v: unknown): v is ErrorResponse =>
  typeof v === 'object' && v !== null && (v as { status?: string }).status === 'error';

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  const body: unknown = await res.json();
  if (isError(body)) throw new Error(body.message);
  return body as T;
};

const postJson = async <T>(url: string, payload: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: unknown = await res.json();
  if (isError(body)) throw new Error(body.message);
  return body as T;
};

export const api = {
  case: () => getJson<CaseResponse>('/api/case'),
  myShards: () => getJson<MyShardsResponse>('/api/my-shards'),
  board: () => getJson<BoardResponse>('/api/board'),
  verdict: () => getJson<VerdictResponse>('/api/verdict'),
  archive: () => getJson<ArchiveResponse>('/api/archive'),
  file: (req: FileRequest) => postJson<FileResponse>('/api/file', req),
  accuse: (req: AccuseRequest) => postJson<AccuseResponse>('/api/accuse', req),
};

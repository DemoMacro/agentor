export function buildFileKey(fileId: string): string {
  return `file:${fileId}`;
}

export function buildFileMetaKey(fileId: string): string {
  return `file:${fileId}:meta`;
}

export function buildBatchKey(batchId: string): string {
  return `batch:${batchId}`;
}

export function buildBatchResultsKey(batchId: string): string {
  return `batch:${batchId}:results`;
}

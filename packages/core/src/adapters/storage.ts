export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, opts?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  cas<T>(key: string, expected: T | null, next: T): Promise<boolean>;
  stream?: (key: string, chunks: AsyncIterable<Buffer>) => Promise<string>;
}

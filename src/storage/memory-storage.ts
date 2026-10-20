import {
  createStorageRepository,
  type StoragePort,
  type StorageRepository,
} from './repository';

export interface MemoryStorageHarness {
  port: MemoryStoragePort;
  repository: StorageRepository;
}

export class MemoryStoragePort implements StoragePort {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Set<(changedKeys: string[]) => void>();
  private activeWrites = 0;

  readCalls = 0;
  setCalls = 0;
  removeCalls = 0;
  maxActiveWrites = 0;

  failRead: Error | null = null;
  failSet: Error | null = null;
  failRemove: Error | null = null;
  beforeSet: (() => Promise<void>) | null = null;

  constructor(initialData: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initialData)) {
      this.values.set(key, structuredClone(value));
    }
  }

  async readAll(): Promise<Record<string, unknown>> {
    this.readCalls += 1;
    if (this.failRead !== null) {
      throw this.failRead;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of this.values) {
      result[key] = structuredClone(value);
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.setCalls += 1;
    this.activeWrites += 1;
    this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);

    try {
      if (this.beforeSet !== null) {
        await this.beforeSet();
      }
      if (this.failSet !== null) {
        throw this.failSet;
      }
      for (const [key, value] of Object.entries(items)) {
        this.values.set(key, structuredClone(value));
      }
    } finally {
      this.activeWrites -= 1;
    }
  }

  async remove(keys: string[]): Promise<void> {
    this.removeCalls += 1;
    if (this.failRemove !== null) {
      throw this.failRemove;
    }
    for (const key of keys) {
      this.values.delete(key);
    }
  }

  subscribe(listener: (changedKeys: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitChange(changedKeys: string[]): void {
    for (const listener of [...this.listeners]) {
      listener([...changedKeys]);
    }
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, structuredClone(value));
  }

  get(key: string): unknown {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

export function createMemoryStorageHarness(
  initialData: Record<string, unknown> = {},
): MemoryStorageHarness {
  const port = new MemoryStoragePort(initialData);
  return { port, repository: createStorageRepository(port) };
}

export function createMemoryStorageRepository(
  initialData: Record<string, unknown> = {},
): StorageRepository {
  return createMemoryStorageHarness(initialData).repository;
}

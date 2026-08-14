/**
 * Database Layer — repository contracts.
 *
 * Frontend code never talks to a database. Services depend only on these
 * interfaces; the concrete adapter (in-memory today, Lovable Cloud/Postgres
 * later) is chosen in `src/backend/data/index.ts`.
 */

export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Repository<T extends Entity, TCreate = Omit<T, keyof Entity>> {
  findById(id: string): Promise<T | null>;
  list(query?: ListQuery): Promise<ListResult<T>>;
  create(data: TCreate): Promise<T>;
  update(id: string, data: Partial<TCreate>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

/** Reference adapter used until the Database Layer is provisioned. */
export class InMemoryRepository<T extends Entity, TCreate = Omit<T, keyof Entity>>
  implements Repository<T, TCreate>
{
  protected store = new Map<string, T>();

  async findById(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async list(query: ListQuery = {}): Promise<ListResult<T>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const all = [...this.store.values()];
    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
    };
  }

  async create(data: TCreate): Promise<T> {
    const now = new Date().toISOString();
    const entity = {
      ...(data as object),
      id: globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    } as T;
    this.store.set(entity.id, entity);
    return entity;
  }

  async update(id: string, data: Partial<TCreate>): Promise<T | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() } as T;
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}

import { describe, expect, it } from "vitest";

import { InMemoryRepository, type Entity } from "@/backend/data/repository";

interface Note extends Entity {
  title: string;
}

describe("InMemoryRepository", () => {
  it("supports the CRUD + pagination contract", async () => {
    const repo = new InMemoryRepository<Note, { title: string }>();

    const created = await repo.create({ title: "first" });
    expect(await repo.findById(created.id)).toMatchObject({ title: "first" });

    await repo.create({ title: "second" });
    const page = await repo.list({ page: 1, pageSize: 1 });
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);

    expect((await repo.update(created.id, { title: "renamed" }))?.title).toBe("renamed");
    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
  });
});

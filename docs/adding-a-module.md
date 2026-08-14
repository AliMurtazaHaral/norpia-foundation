# Adding a Backend Module

A module is a vertical feature slice. Example: `conversations`.

```text
src/backend/modules/conversations/
  conversations.schemas.ts     # zod schemas + inferred types (contract)
  conversations.repository.ts  # implements Repository<T> from src/backend/data/repository.ts
  conversations.service.ts     # business logic; depends on interfaces only
```

1. **Schemas** — define request/response shapes with zod. Types are inferred, never duplicated.
2. **Repository** — implement the `Repository` interface. Start from `InMemoryRepository` and swap
   the adapter when the Database Layer is provisioned; the service does not change.
3. **Service** — export a factory (`createXService(deps)`) plus a default singleton so tests can
   inject fakes. Publish domain events here, not in routes:

   ```ts
   await getEventBus().publish("conversation.created", { conversationId: entity.id });
   ```

4. **Route** — add `src/routes/api/v1/conversations.ts` using `apiRoute(...)`.
5. **OpenAPI** — document the new paths in `src/backend/api/openapi.ts`.
6. **Tests** — add a unit test under `tests/` for the service using a fake repository.

Do not import a module's repository from the frontend, and do not import backend modules from
components — the UI goes through `src/lib/api/client.ts`.

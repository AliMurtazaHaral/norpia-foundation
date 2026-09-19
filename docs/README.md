# NORPIA — Documentation

| Document | Purpose |
| --- | --- |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | System architecture: layers, communication, API/event/security strategy |
| [`api-guidelines.md`](./api-guidelines.md) | How to add an endpoint, envelope + error rules |
| [`adding-a-module.md`](./adding-a-module.md) | Step-by-step recipe for a new backend feature slice |
| [`../infrastructure/README.md`](../infrastructure/README.md) | Runtime, environments, configuration and secrets |
| [`AUTHENTICATION.md`](./AUTHENTICATION.md) | Supabase auth, sessions, roles, protected routes |
| [`SECURITY.md`](./SECURITY.md) | Trust boundaries, RLS policies, secret handling |
| [`AI_CHAT.md`](./AI_CHAT.md) | JARVIS chat: provider, streaming, persistence |
| [`CONTEXT_MANAGEMENT.md`](./CONTEXT_MANAGEMENT.md) | Month 2 W1: context retrieval, context builder, summarization, limits |
| [`LONG_TERM_MEMORY.md`](./LONG_TERM_MEMORY.md) | Month 2 W2: user memory model, categories, service, retrieval, RLS |


Live API reference: `/api/docs` (rendered from `/api/v1/openapi.json`).

## Local environment

See [development-environment.md](./development-environment.md) for Docker, env vars and startup commands.
- [AI provider abstraction](./AI_PROVIDERS.md) — provider-agnostic AI layer (Month 2 Week 3)

# NORPIA Foundation

My color scheme is given in the screenshot. Please stricly follow it. We are currently in WEEK 2 of the NORPIA/JARVIS MVP development.

IMPORTANT:

Do not build Week 3 authentication features or Week 4 advanced AI chat features yet.

This task is ONLY for the Week 2 System Architecture & Project Foundation.

The goal is to establish a clean, production-ready foundation that we can extend during the remaining 5 months.

PROJECT CONTEXT:

NORPIA/JARVIS is intended to become a long-term AI Operating System. The architecture must therefore be modular, API-first, scalable, secure, and ready for future AI orchestration, memory, RAG, MCP, workflow automation, n8n integration, and SaaS capabilities.

Implement the following:

1. HIGH-LEVEL APPLICATION ARCHITECTURE

Create a clean architecture with these logical layers:

- Frontend Layer

- Backend/API Layer

- AI Layer

- Authentication Layer

- Database Layer

- Storage Layer

- Integration Layer

Keep these layers properly separated.

The frontend must communicate with the backend through APIs.

The AI layer must not be tightly coupled to the UI.

External integrations must go through clearly defined interfaces.

Database access must remain isolated from frontend code.

2. PROJECT STRUCTURE

Organize the project into clear modules so future developers can easily understand and extend it.

Create a clean structure for:

- frontend

- backend

- shared configuration where necessary

- documentation

- infrastructure

- tests

Do not create unnecessary complexity or microservices at this stage.

Use a modular architecture that can later evolve into separate services if required.

3. API-FIRST FOUNDATION

Establish the API structure now.

Use versioned API routes such as:

/api/v1/

Create a consistent structure for:

- API responses

- errors

- validation

- authentication-ready middleware

- request/response schemas

- service layer

- repository/data-access layer

Make the API documentation automatically available.

4. FUTURE INTEGRATION READINESS

Design interfaces that will allow future integrations with:

- OpenAI

- Anthropic

- MCP

- n8n

- Gmail

- Google Calendar

- Microsoft services

- other external APIs

Do NOT implement all of these integrations now.

Only create the architectural interfaces/contracts required for future integration.

5. EVENT-DRIVEN READINESS

Create a basic internal event architecture.

The system should be able to publish and consume application events in the future.

Examples:

- conversation.created

- message.created

- document.uploaded

- workflow.started

- workflow.completed

- ai.task.created

Do not introduce a complicated distributed event infrastructure yet. Keep it simple and extensible.

6. DOCUMENTATION

Create/update an ARCHITECTURE.md document explaining:

- system components

- responsibilities of each component

- communication between components

- API strategy

- future integration strategy

- event-driven strategy

- security boundaries

- future scalability approach

7. DO NOT CHANGE

Do not implement:

- advanced authentication

- RBAC implementation

- password reset

- email verification

- full AI chat

- RAG

- vector search

- workflow automation

- CRM

- subscriptions

- payment systems

Those belong to later weeks/phases.

Before making changes, inspect the existing project and preserve anything already implemented correctly.

At the end, provide a concise summary of:

- files created

- files modified

- architecture implemented

- remaining Week 2 work

- any technical decisions that need my approval

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fad56b8b-79d2-4ae5-a378-129b4ffa0b90).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

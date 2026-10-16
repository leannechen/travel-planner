# Own the backend and data: Node.js API with PostgreSQL, deployed to fly.io

The core backend is a Node.js (TypeScript) API we write and run ourselves, backed by PostgreSQL and shipped as a Docker image to fly.io, instead of a hosted backend-as-a-service. The domain rules (Leg lifecycle, Todo deletion with an Event, last-write-wins collaboration) are backend logic that should live in our own code, and the data is naturally relational (Trip, Day, Event, Todo, Leg). Identity is the one deliberate exception (ADR 0006).

## Considered Options

- **Hosted backend (database, auth and realtime in one service)**: faster to start and realtime comes built in, but the rules would be split between our code and the service's configuration, and moving away later is costly.

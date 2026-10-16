# Express 5 API with Zod schemas shared between web and API

The API uses Express 5, the most widely used Node.js framework. Express does not infer types from routes, so request and response shapes are defined once as Zod schemas in a `shared` workspace package; the API validates input with them and the web app derives its types from them. We accepted writing the schemas by hand in exchange for a mainstream framework and a single, visible source of truth for the API contract.

## Considered Options

- **Hono with its typed RPC client**: shares types automatically but is a less common framework.
- **Fastify, NestJS**: both viable; Express was chosen for familiarity and the amount of existing documentation.

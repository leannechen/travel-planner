# Production image: the API, serving the built web app from the same origin (step 27, fly.io).
# Build: docker build --build-arg VITE_AUTH0_DOMAIN=... (see fly.toml [build.args] for the full list).

ARG NODE_VERSION=24.22.1

FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app

# Build the web app. Needs devDependencies (TypeScript, Vite), so NODE_ENV is not set here: npm would
# skip them and the build would fail.
FROM base AS web
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# The VITE_ values are built into the page and public (the browser sees them), so they are build
# arguments, not secrets. Without the Auth0 ones the page would stop at start (authConfig.ts), so the
# build stops instead. The Google ones are optional: without them the Map View shows a sample map.
ARG VITE_AUTH0_DOMAIN VITE_AUTH0_CLIENT_ID VITE_AUTH0_AUDIENCE VITE_GOOGLE_MAPS_API_KEY VITE_GOOGLE_MAP_ID
RUN test -n "$VITE_AUTH0_DOMAIN" && test -n "$VITE_AUTH0_CLIENT_ID" && test -n "$VITE_AUTH0_AUDIENCE" \
  || { echo "VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID and VITE_AUTH0_AUDIENCE are required build arguments" >&2; exit 1; }
RUN npm run build -w @travel-planner/web

# The running server: production dependencies of the API only. The API runs its TypeScript through tsx,
# as in development, so there is no compile step for it.
FROM base AS runtime
# Safe by default: auth.ts refuses the fake token verifier (AUTH_FAKE) when this is set, and invitation
# links stay out of the log. Set here, not in fly.toml or a secret, so every run of the image has it.
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev -w @travel-planner/api -w @travel-planner/shared --include-workspace-root=false \
  && npm cache clean --force
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
COPY --from=web /app/apps/web/dist apps/web/dist
# Event images go to this folder until object storage is set up (IMAGE_DIR, images.ts). It is inside
# the machine, so they are lost on every deploy.
RUN mkdir -p apps/api/uploads && chown node:node apps/api/uploads
ENV WEB_DIR=/app/apps/web/dist PORT=8080
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]

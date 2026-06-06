# Always-on host for the AI panel runner (Railway / Fly.io / Render worker).
# IMPORTANT: build from the panel/ ROOT so the generated bindings are in context:
#   docker build -f ai-runner/Dockerfile -t panel-ai .
#
# Deps are installed at /app so that both ai-runner/ and the bindings under
# client/src/module_bindings/ resolve 'spacetimedb' from /app/node_modules.
FROM node:22-slim
WORKDIR /app

COPY ai-runner/package.json ./package.json
RUN npm install

COPY ai-runner/ ./ai-runner/
COPY client/src/module_bindings/ ./client/src/module_bindings/

# Required env at runtime:
#   ANTHROPIC_API_KEY   (secret)
#   SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
#   MODULE_NAME=<your published module name, e.g. panel-quidwaiali>
# Optional: ANTHROPIC_MODEL, AI_NAME
# Persist the AI identity across restarts by mounting a volume at
#   /app/ai-runner/.ai_token  (otherwise the AI rejoins with a fresh identity).
CMD ["npx", "tsx", "ai-runner/ai-runner.ts"]

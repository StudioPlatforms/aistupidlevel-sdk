# The AI Stupid Level MCP server, built from source. Build from the repository root:
#   docker build -f packages/mcp/Dockerfile -t aistupidlevel-mcp .
#   docker run -i --rm -e ASL_DATA_KEY=asl_live_... aistupidlevel-mcp
# It speaks MCP over stdio. Both keys are optional: without them it starts and lists its tools,
# and each tool explains which key it needs.
FROM node:22-slim AS build
WORKDIR /app
COPY packages/mcp/package.json packages/mcp/package-lock.json ./
RUN npm ci --ignore-scripts
COPY packages/mcp/tsconfig.json ./
COPY packages/mcp/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/cli.js"]

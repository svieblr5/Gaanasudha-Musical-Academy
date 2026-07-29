# Container image for running the portal on a Synology NAS (or any Docker host).
FROM node:20-alpine

WORKDIR /app

# Install production dependencies (all deps here are pure-JS and run on Linux;
# node-windows is included but unused in the container).
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3080
EXPOSE 3080

# music/ and data/ are provided as mounted volumes (see docker-compose.yml).
CMD ["node", "server.js"]

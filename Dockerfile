FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "server.js"]

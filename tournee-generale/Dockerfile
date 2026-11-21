FROM node:22-alpine
WORKDIR /app
COPY package.json index.html manifest.webmanifest icon.svg ./
COPY src ./src
COPY server ./server
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/server.js"]

FROM node:22-alpine
WORKDIR /app
COPY index.html manifest.webmanifest sw.js icon.svg ./
COPY src ./src
COPY data ./data
COPY server ./server
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/relay.js"]

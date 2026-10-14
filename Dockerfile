# Lets container hosts run the shop. Mount permanent storage and set DATA_DIR to its folder (for example /data).
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/server.js"]

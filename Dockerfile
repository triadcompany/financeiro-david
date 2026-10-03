FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
COPY --chown=node:node dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run migrate && npm start"]

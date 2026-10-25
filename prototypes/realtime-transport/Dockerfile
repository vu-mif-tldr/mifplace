# One image for both roles: the prototype server and the load tool (see compose.yaml).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.web.json ./
COPY src ./src
RUN npm run build:web

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
COPY src ./src
EXPOSE 3100
ENTRYPOINT ["node"]
CMD ["src/server/main.ts", "--host", "0.0.0.0"]

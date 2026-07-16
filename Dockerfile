FROM node:20-alpine AS builder

WORKDIR /app
# pnpm-lock.yaml must be copied explicitly — the old `package*.json` glob never
# matched it, so --frozen-lockfile had no lockfile to work from.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm reads the packageManager field in package.json and self-switches to that
# exact version, so the globally installed one only needs to bootstrap.
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

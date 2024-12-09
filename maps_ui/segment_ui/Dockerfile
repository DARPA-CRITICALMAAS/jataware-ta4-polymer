FROM node:22.11.0-slim as build

RUN mkdir /app
WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]


RUN npm ci
COPY . .

RUN npm run build

FROM caddy

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /usr/share/caddy/
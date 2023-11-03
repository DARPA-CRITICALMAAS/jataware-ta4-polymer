FROM node:lts-slim as build

RUN mkdir /app
WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]


RUN npm install
COPY . .

RUN npm run build

FROM caddy

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /usr/share/caddy/


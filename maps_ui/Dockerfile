# Build the segment app
FROM node:lts-slim as segment
RUN mkdir /app1
WORKDIR /app1

COPY ./segment_ui /app1/

RUN npm install


RUN npm run build

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

COPY --from=segment /app1/dist /usr/share/caddy/segment

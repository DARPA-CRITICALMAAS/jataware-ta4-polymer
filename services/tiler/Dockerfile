FROM golang:1.21-bullseye AS build

WORKDIR /src
ARG TILER_VERSION
ARG TILER_BUILD

COPY ./tiler .
RUN GOOS=linux go build \
        -ldflags="-s -w" \
        -ldflags "-X main.Version=${TILER_VERSION} -X main.Build=${TILER_BUILD}" \
        -o /out/tiler main.go

FROM debian:bullseye-slim

RUN apt-get update && apt-get clean && apt-get install --no-install-recommends -y  \
    ca-certificates \
    curl \
    net-tools \
    libvips-tools \
    libvips \
    tini

RUN rm -rf /var/lib/apt/lists/*

COPY --from=build /out/tiler /usr/bin/tiler

WORKDIR /srv/tiler

ENTRYPOINT ["/usr/bin/tini", "--", "tiler", "serve"]

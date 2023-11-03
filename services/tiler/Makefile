VERSION := 0.0.1

DT  = $(shell date +"%Y%m%d")

DETECTED_OS := $(shell uname)

CMD_ARGUMENTS ?= $(cmd)

.DEFAULT_GOAL := help

check-%:
	@: $(if $(value $*),,$(error $* is undefined))

help:
	@echo ""
	@echo "By default make targets assume DEV to run production pass in prod=y as a command line argument"
	@echo ""
	@echo "Targets:"
	@echo ""
	@grep -E '^([a-zA-Z_-])+%*:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-40s\033[0m %s\n", $$1, $$2}'


.PHONY: print-version
print-version:
	@echo "Version: ${VERSION}"


.PHONY: gitlab-docker-login
gitlab-docker-login:| check-GITLAB_USER check-GITLAB_PASS
	@printf "${GITLAB_PASS}\n" | docker login registry.gitlab.com/jataware -u "${GITLAB_USER}" --password-stdin


.PHONY: docker_buildx
docker_buildx:| gitlab-docker-login
	docker buildx build \
		--platform linux/arm64,linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/tiler:${VERSION} \
		--build-arg TILER_VERSION="${VERSION}" \
		--build-arg TILER_BUILD_DATE="${DT}" \
		--output type=image,push=true \
		-f Dockerfile \
		.

.PHONY: docker_build
docker_build:
	docker build \
		--platform linux/amd64 \
		-t tiler:dev \
		--build-arg TILER_VERSION="${VERSION}" \
		--build-arg TILER_BUILD_DATE="${DT}" \
		-f Dockerfile \
		.


.PHONY: fmt
fmt:
	 (cd tiler && go fmt ./...)

.PHONY: compile
compile:
	 (cd tiler && go build \
					-ldflags="-s -w" \
					-ldflags="-X main.Version=${VERSION} -X main.BuildDate=${DT} -X main.ARCH=" \
-o /dev/null main.go)




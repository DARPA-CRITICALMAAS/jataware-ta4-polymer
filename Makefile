VERSION := 0.1.61

# make helpers
null  :=
space := $(null) #
comma := ,

DETECTED_OS := $(shell uname)

# (╯°□°）╯︵ ┻━┻
ifeq ($(DETECTED_OS),Darwin)
	SED=gsed
else
	SED=sed
endif
# ┬─┬ノ(ಠ_ಠノ)


.DEFAULT_GOAL := help

.PHONY: yN
yN:
	@echo "Are you sure? [y/N] " && read ans && [ $${ans:-N} = y ] || (echo "aborted."; exit 1;)

tool-exists-%:
		@which $* > /dev/null

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
print-version:  ## Print current version
	@printf "${VERSION}"


.PHONY: bump-version
bump-version:
	@echo "Current: ${VERSION}"
	@echo ${VERSION} | awk -F. -v OFS=. '{$$NF+=1; print}' | xargs -I%x $(SED) -i "0,/${VERSION}/s//%x/" Makefile
	@$(MAKE) -s print-version


.PHONY: format
format:   ## Run python format
	(cd services/auto-georef && poetry run format)

.PHONY: lint
lint:   ## Run python lint
	(cd services/auto-georef && poetry run lint)

.PHONY: docker-build-ui
docker-build-ui:
	(cd ui && docker build -t nylon_ui:dev .)

.PHONY: docker-build-georef
docker-build-georef:
	(cd services/auto-georef && docker build -t nylon_georef:dev .)

.PHONY: docker-build-silk
docker-build-silk:
	(cd services/silk && docker build -t nylon_silk:dev .)



.PHONY: gitlab-docker-login
gitlab-docker-login:| check-GITLAB_USER check-GITLAB_PASS
	@printf "${GITLAB_PASS}\n" | docker login registry.gitlab.com/jataware -u "${GITLAB_USER}" --password-stdin


.PHONY: docker-buildx-georef
docker_buildx-georef:| gitlab-docker-login  ## build and push georef image
	@echo "building georef"
	(cd services/auto-georef && \
		docker buildx build \
			--platform linux/amd64 \
			-t registry.gitlab.com/jataware/nylon/georef:${VERSION} \
			--output type=image,push=true \
			-f Dockerfile \
			.)

define ui_env_prod
VITE_TIFF_URL="https://s3.amazonaws.com/common.polymer.rocks"
VITE_MAPTILER_KEY="${MAPTILER_KEY}"
endef

ui/.env.production:| check-MAPTILER_KEY  ## writes ui/.env.production file
		$(file > ui/.env.production,$(ui_env_prod))

.PHONY: docker_buildx-ui
docker_buildx-ui:| gitlab-docker-login  ui/.env.production ## build and push ui
	@echo "building ui"
	(cd ui && \
		docker buildx build \
			--platform linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/ui:${VERSION} \
		--output type=image,push=true \
		-f Dockerfile \
		.)

.PHONY: docker_buildx-silk
docker_buildx-silk:| gitlab-docker-login  ## build and push silk
	@echo "building silk"
	(cd services/silk && \
		docker buildx build \
			--platform linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/silk:${VERSION} \
		--output type=image,push=true \
		-f Dockerfile \
		.)


.PHONY: docker_buildx-all
docker_buildx-all:| docker_buildx-ui docker_buildx-silk docker_buildx-georef

.PHONY:
ALL_DOCKER_COMPOSE_FILES:= $(wildcard docker-compose*.yaml)

ifneq ($(wildcard .docker-compose.locals),)
DOCKER_COMPOSE_LOCALS=$(shell cat .docker-compose.locals)
else
DOCKER_COMPOSE_LOCALS=
endif


DOCKER_COMPOSE_FILES:=docker-compose.network.yaml \
	docker-compose.minio.yaml \
	docker-compose.elastic.yaml \
	docker-compose.postgis.yaml \
	docker-compose.silk.yaml \
	docker-compose.autogeoref.yaml \
	$(DOCKER_COMPOSE_LOCALS) \
	docker-compose.dev.yaml

ALL_PROFILES=default minio elastic postgis silk georef

define all_profiles
$(subst $(space),$(comma),$(ALL_PROFILES))
endef

STORAGE_PROFILES=default minio elastic postgis

define storage_profiles
$(subst $(space),$(comma),$(STORAGE_PROFILES))
endef

.PHONY: up
up:
	docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.georef
up.georef:
	COMPOSE_PROFILES="georef" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.silk
up.silk:
	COMPOSE_PROFILES="silk" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.a
up.a:
	COMPOSE_PROFILES="$(all_profiles)" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.s  ## start storage containers only
up.s:
	COMPOSE_PROFILES="$(storage_profiles)" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d


.PHONY: down.a
down.a:
	COMPOSE_PROFILES="*" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) down


.PHONY: logs
logs:
	COMPOSE_PROFILES="$(all_profiles)" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) logs

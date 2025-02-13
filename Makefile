VERSION := 0.1.397

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

.PHONY: docker-build-maps-ui
docker-build-maps-ui:
	(cd maps_ui && docker build -t nylon_maps_ui:dev .)

.PHONY: docker-build-georef
docker-build-georef:
	(cd services/auto-georef && docker build -t nylon_georef:dev .)

.PHONY: docker-build-segment_api
docker-build-segment_api:
	(cd services/segment_api && docker build -t segment_api:dev .)

.PHONY: docker-build-jataware-auto-legend
docker-build-jataware-auto-legend:
	(cd services/jataware_auto_legend && docker build -t jataware_auto_legend:dev .)

.PHONY: docker-build-baseline-mpm
docker-build-baseline-mpm:
	(cd services/baseline_mpm && docker build -t baseline_mpm:dev .)


.PHONY: docker-build-jataware-georef
docker-build-jataware-georef:
	(cd services/jataware_georef && docker build -t jataware_georef:dev .)

.PHONY: docker-build-silk
docker-build-silk:
	(cd services/silk && docker build -t nylon_silk:dev .)


.PHONY: gitlab-docker-login
gitlab-docker-login:| check-GITLAB_USER check-GITLAB_PASS
	@printf "${GITLAB_PASS}\n" | docker login registry.gitlab.com/jataware -u "${GITLAB_USER}" --password-stdin


define georef_ui_env_prod
VITE_MAPTILER_KEY="${MAPTILER_KEY}"
endef

services/auto-georef/ui/.env.production:| check-MAPTILER_KEY  ## writes .env.production file
		$(file > services/auto-georef/ui/.env.production,$(georef_ui_env_prod))


.PHONY: docker-buildx-georef
docker_buildx-georef:| gitlab-docker-login services/auto-georef/ui/.env.production ## build and push georef image
	@echo "building georef"
	(cd services/auto-georef && \
		docker buildx build \
			--platform linux/amd64 \
			-t registry.gitlab.com/jataware/nylon/georef:${VERSION} \
			--output type=image,push=true \
			-f Dockerfile \
			.)

define maps_ui_env_prod
VITE_TIFF_URL="https://s3.amazonaws.com/common.polymer.rocks"
VITE_MAPTILER_KEY="${MAPTILER_KEY}"
VITE_POLYMER_COG_URL="https://s3.amazonaws.com"
VITE_POLYMER_PUBLIC_BUCKET="common.polymer.rocks"
VITE_POLYMER_S3_COG_PRO_PREFEX="cogs/projections"
VITE_CDR_COG_URL="https://s3.amazonaws.com"
VITE_CDR_PUBLIC_BUCKET="public.cdr.land"
VITE_CDR_S3_COG_PRO_PREFEX="test/cogs"
VITE_CDR_S3_COG_PREFEX="cogs"
VITE_POLYMER_SYSTEM="polymer"
VITE_POLYMER_SYSTEM_VERSION="0.0.1"
endef

maps_ui/.env.production:| check-MAPTILER_KEY  ## writes ui/.env.production file
		$(file > maps_ui/.env.production,$(maps_ui_env_prod))

.PHONY: docker_buildx-ui
docker_buildx-maps-ui:| gitlab-docker-login  maps_ui/.env.production ## build and push ui
	@echo "building maps_ui"
	(cd maps_ui && \
		docker buildx build \
			--platform linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/maps_ui:${VERSION} \
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

.PHONY: docker_buildx-jataware_georef
docker_buildx-jataware_georef:| gitlab-docker-login  ## build and push jataware-georef
	@echo "building jataware_georef"
	(cd services/jataware_georef && \
		docker buildx build \
			--platform linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/jataware_georef:${VERSION} \
		--output type=image,push=true \
		-f Dockerfile \
		.)

.PHONY: docker_buildx-segmentation_api
docker_buildx-segmentation_api:| gitlab-docker-login  ## build and push segmentation-georef
	@echo "building segmentation-api"
	(cd services/segment_api && \
		docker buildx build \
			--platform linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/segmentation-api:${VERSION} \
		--output type=image,push=true \
		-f Dockerfile \
		.)

.PHONY: docker_buildx-jataware-auto-legend
docker_buildx-jataware-auto-legend:| gitlab-docker-login  ## build and push segmentation-georef
	@echo "building jataware-auto-legend"
	(cd services/jataware_auto_legend && \
		docker buildx build \
			--platform linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/jataware-auto-legend:${VERSION} \
		--output type=image,push=true \
		-f Dockerfile \
		.)


.PHONY: docker_buildx-baseline_mpm
docker_buildx-baseline_mpm:| gitlab-docker-login  ## build and push segmentation-georef
	@echo "building baseline_mpm"
	(cd services/baseline_mpm && \
		docker buildx build \
			--platform linux/amd64 \
		-t registry.gitlab.com/jataware/nylon/baseline_mpm:${VERSION} \
		--output type=image,push=true \
		-f Dockerfile \
		.)

.PHONY: docker_buildx-all
docker_buildx-all:| docker_buildx-maps-ui docker_buildx-silk docker_buildx-georef docker_buildx-jataware_georef docker_buildx-segmentation_api docker_buildx-baseline_mpm docker_buildx-jataware-auto-legend

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
	docker-compose.segment_api.yaml \
	docker-compose.baseline_mpm.yaml \
	docker-compose.jataware_georef.yaml \
	docker-compose.jataware_auto_legend.yaml \
	docker-compose.redis.yaml \
	$(DOCKER_COMPOSE_LOCALS) \
	docker-compose.dev.yaml

ALL_PROFILES=default minio elastic postgis silk georef jataware_georef redis segment_api baseline_mpm jataware_auto_legend

define all_profiles
$(subst $(space),$(comma),$(ALL_PROFILES))
endef

STORAGE_PROFILES=default minio elastic postgis redis

define storage_profiles
$(subst $(space),$(comma),$(STORAGE_PROFILES))
endef

.PHONY: up
up:
	docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.georef
up.georef:
	COMPOSE_PROFILES="georef" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d


.PHONY: up.segment_api
up.segment_api:
	COMPOSE_PROFILES="segment_api" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.jataware_auto_legend
up.jataware_auto_legend:
	COMPOSE_PROFILES="jataware_auto_legend" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d
.PHONY: down.jataware_auto_legend
down.jataware_auto_legend:
	COMPOSE_PROFILES="jataware_auto_legend" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) down



.PHONY: up.baseline_mpm
up.baseline_mpm:
	COMPOSE_PROFILES="baseline_mpm" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.redis
up.redis:
	COMPOSE_PROFILES="redis" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: up.jataware_georef
up.jataware_georef:
	COMPOSE_PROFILES="jataware_georef" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) up -d

.PHONY: down.jataware_georef
down.jataware_georef:
	COMPOSE_PROFILES="jataware_georef" docker compose $(addprefix -f , $(DOCKER_COMPOSE_FILES)) down


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

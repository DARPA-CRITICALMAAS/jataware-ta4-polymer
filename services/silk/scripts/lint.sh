#!/usr/bin/env bash

set -ex

# mypy --show-error-codes ${PACKAGE}
ruff check ${PACKAGE}
ruff format ${PACKAGE} --check

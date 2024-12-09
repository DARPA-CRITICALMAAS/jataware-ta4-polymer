#!/bin/sh
set -ex

# Sort imports one per line, so autoflake can remove unused imports
isort --force-single-line-imports ${PACKAGE}

autoflake --remove-all-unused-imports --recursive --remove-unused-variables --in-place ${PACKAGE} --exclude=__init__.py
isort --line-length 119 ${PACKAGE}
black --line-length 119 ${PACKAGE}

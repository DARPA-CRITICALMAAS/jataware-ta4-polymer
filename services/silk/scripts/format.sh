#!/bin/sh
set -ex

ruff check ${PACKAGE} --fix
ruff format ${PACKAGE}

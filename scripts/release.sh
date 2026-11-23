#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
zip -q -X dist/webchat.zip _layouts/webchat.html webchat.md _webchat/README.md
cp _layouts/webchat.html dist/webchat.html
ls -l dist

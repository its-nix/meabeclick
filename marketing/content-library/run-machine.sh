#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 1 ]; then
  echo "Usage: run-machine.sh /absolute/path/to/config.json [tick options]" >&2
  exit 2
fi
CONFIG=$1
shift
exec "${CONTENT_MACHINE_PYTHON:-python3}" "$SCRIPT_DIR/machine.py" tick --config "$CONFIG" "$@"

#!/bin/bash
# QuotaBar moved to apps/quotabar. A QuotaBar built from here before the move updates itself by
# running this file and then taking build/QuotaBar.app from this folder: it is built there and
# copied here. The app it builds updates from apps/quotabar from then on.
set -euo pipefail
cd "$(dirname "$0")"
NEW=../../apps/quotabar
bash "$NEW/build.sh" "$@"
rm -rf build/QuotaBar.app
mkdir -p build
cp -R "$NEW/build/QuotaBar.app" build/
echo "QuotaBar is in apps/quotabar now: build there from now on."

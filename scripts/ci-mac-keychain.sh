#!/bin/bash
set -euo pipefail
# Only used in disposable GitHub runners. Never run on a contributor's Mac.
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_OS:-}" != "macOS" ]]; then
  echo 'This helper is restricted to macOS GitHub Actions runners' >&2
  exit 1
fi
keychain_password="$(uuidgen)"
echo "::add-mask::$keychain_password"
keychain_file="$RUNNER_TEMP/mythpen-credential-test.keychain-db"
security create-keychain -p "$keychain_password" "$keychain_file"
security set-keychain-settings -lut 21600 "$keychain_file"
security unlock-keychain -p "$keychain_password" "$keychain_file"
security default-keychain -s "$keychain_file"
security list-keychains -d user -s "$keychain_file"

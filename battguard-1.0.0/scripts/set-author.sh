#!/usr/bin/env bash
# Replace the YOUR_GITHUB_USERNAME placeholder everywhere and rename the applet
# directory, e.g.:  scripts/set-author.sh octocat
# SPDX-License-Identifier: MIT
set -euo pipefail

user="${1:-}"
[[ "$user" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$ ]] ||
    { echo "usage: $0 <github-username>" >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."
placeholder="YOUR_GITHUB_USERNAME"
old="battguard@$placeholder"

if [[ -d "$old" ]]; then
    mv "$old" "battguard@$user"
    mv "battguard@$user/files/$old" "battguard@$user/files/battguard@$user"
fi

grep -rlI --exclude-dir=.git --exclude-dir=node_modules --exclude='set-author.sh' -e "$placeholder" . |
    while IFS= read -r file; do
        sed -i "s/$placeholder/$user/g" "$file"
    done
echo "Done: applet UUID is now battguard@$user"

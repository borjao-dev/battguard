#!/usr/bin/env bash
# BattGuard uninstaller. SPDX-License-Identifier: MIT
#
#   ./uninstall.sh [--prefix DIR]
#
# Removes the helper, the polkit files and the applet of the current user.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-/usr/local}"
DESTDIR="${DESTDIR:-}"
POLKIT_ACTIONS_DIR="${POLKIT_ACTIONS_DIR:-/usr/share/polkit-1/actions}"
POLKIT_RULES_DIR="${POLKIT_RULES_DIR:-/etc/polkit-1/rules.d}"

die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

while (($#)); do
    case "$1" in
    --prefix)
        (($# >= 2)) || die "--prefix needs a directory"
        PREFIX="$2"
        shift
        ;;
    -h | --help)
        sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
    *) die "unknown argument: $1" ;;
    esac
    shift
done
[[ "$PREFIX" =~ ^/[A-Za-z0-9._/+-]*$ ]] || die "invalid --prefix: $PREFIX"

as_root() {
    if [[ -n "$DESTDIR" || $EUID -eq 0 ]]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        die "root privileges are required: run as root or install sudo"
    fi
}

info "Removing the helper and polkit files"
as_root rm -f "$DESTDIR$PREFIX/libexec/battguard/battguard-helper" \
    "$DESTDIR$POLKIT_ACTIONS_DIR/io.github.battguard.policy" \
    "$DESTDIR$POLKIT_RULES_DIR/50-battguard.rules"
as_root rmdir --ignore-fail-on-non-empty "$DESTDIR$PREFIX/libexec/battguard" 2>/dev/null || true

if ((EUID != 0)); then
    data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
    for dir in "$SRC"/battguard@*/; do
        [[ -d "$dir" ]] || continue
        uuid="$(basename "$dir")"
        info "Removing the applet and its translations ($uuid)"
        rm -rf "${data_home:?}/cinnamon/applets/$uuid"
        rm -f "$data_home"/locale/*/LC_MESSAGES/"$uuid".mo
    done
fi
info "Done."

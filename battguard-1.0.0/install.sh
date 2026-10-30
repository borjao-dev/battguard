#!/usr/bin/env bash
# BattGuard installer. SPDX-License-Identifier: MIT
#
#   ./install.sh [all|system|applet] [--prefix DIR] [--passwordless]
#
#   system   Install the root-owned helper and its polkit policy (needs root).
#   applet   Install the Cinnamon applet for the current user (never as root).
#   all      Both (default). Run it as your normal user; sudo is used when needed.
#
# Environment: DESTDIR (staging root for packagers), XDG_DATA_HOME.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-/usr/local}"
DESTDIR="${DESTDIR:-}"
POLKIT_ACTIONS_DIR="${POLKIT_ACTIONS_DIR:-/usr/share/polkit-1/actions}"
POLKIT_RULES_DIR="${POLKIT_RULES_DIR:-/etc/polkit-1/rules.d}"
LINUWU_URL="https://github.com/0x7375646F/Linuwu-Sense"

step=all
passwordless=0

die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }

usage() {
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while (($#)); do
    case "$1" in
    all | system | applet) step="$1" ;;
    --prefix)
        (($# >= 2)) || die "--prefix needs a directory"
        PREFIX="$2"
        shift
        ;;
    --passwordless) passwordless=1 ;;
    -h | --help)
        usage
        exit 0
        ;;
    *) die "unknown argument: $1 (see --help)" ;;
    esac
    shift
done

[[ "$PREFIX" =~ ^/[A-Za-z0-9._/+-]*$ ]] || die "invalid --prefix: $PREFIX"
HELPER_DIR="$PREFIX/libexec/battguard"

as_root() {
    if [[ -n "$DESTDIR" || $EUID -eq 0 ]]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        die "root privileges are required: run as root or install sudo"
    fi
}

check_tools() {
    local tool
    for tool in install sed mktemp realpath; do
        command -v "$tool" >/dev/null 2>&1 || die "required tool not found: $tool"
    done
}

install_system() {
    local owner=() tmp
    [[ -z "$DESTDIR" ]] && owner=(-o root -g root)
    command -v pkexec >/dev/null 2>&1 ||
        warn "pkexec (polkit) was not found; the applet cannot change the limit without it"

    info "Installing the helper to $DESTDIR$HELPER_DIR"
    as_root install -d -m 0755 ${owner[@]+"${owner[@]}"} "$DESTDIR$HELPER_DIR"
    as_root install -m 0755 ${owner[@]+"${owner[@]}"} "$SRC/system/battguard-helper" "$DESTDIR$HELPER_DIR/battguard-helper"

    info "Installing the polkit policy"
    tmp="$(mktemp)"
    sed "s|@HELPER_PATH@|$HELPER_DIR/battguard-helper|g" "$SRC/system/io.github.battguard.policy.in" >"$tmp"
    if command -v xmllint >/dev/null 2>&1; then
        xmllint --noout "$tmp" || die "generated polkit policy is not valid XML"
    fi
    as_root install -d -m 0755 ${owner[@]+"${owner[@]}"} "$DESTDIR$POLKIT_ACTIONS_DIR"
    as_root install -m 0644 ${owner[@]+"${owner[@]}"} "$tmp" "$DESTDIR$POLKIT_ACTIONS_DIR/io.github.battguard.policy"
    rm -f "$tmp"

    if ((passwordless)); then
        info "Installing the optional passwordless rule (wheel/sudo members on a local session)"
        as_root install -d -m 0755 ${owner[@]+"${owner[@]}"} "$DESTDIR$POLKIT_RULES_DIR"
        as_root install -m 0644 ${owner[@]+"${owner[@]}"} "$SRC/system/50-battguard-passwordless.rules" \
            "$DESTDIR$POLKIT_RULES_DIR/50-battguard.rules"
    fi
}

install_applet() {
    ((EUID != 0)) || die "run the applet step as your normal user, not as root"
    local dirs=("$SRC"/battguard@*/) uuid data_home dest po lang
    ((${#dirs[@]} == 1)) && [[ -d "${dirs[0]}" ]] || die "expected exactly one battguard@* directory in $SRC"
    uuid="$(basename "${dirs[0]}")"
    [[ "$uuid" == *YOUR_GITHUB_USERNAME* ]] &&
        warn "applet UUID still has the placeholder; run scripts/set-author.sh <github-user> before publishing"
    command -v cinnamon >/dev/null 2>&1 || warn "Cinnamon was not found on this system; the applet only runs on Cinnamon"

    data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
    dest="$data_home/cinnamon/applets/$uuid"
    info "Installing the applet to $dest"
    rm -rf "$dest"
    mkdir -p "$dest"
    cp -r "${dirs[0]}files/$uuid/." "$dest/"

    if command -v msgfmt >/dev/null 2>&1; then
        for po in "$dest"/po/*.po; do
            [[ -f "$po" ]] || continue
            lang="$(basename "$po" .po)"
            mkdir -p "$data_home/locale/$lang/LC_MESSAGES"
            msgfmt -o "$data_home/locale/$lang/LC_MESSAGES/$uuid.mo" "$po"
        done
    else
        warn "msgfmt (gettext) not found; the applet will be shown in English only"
    fi
}

report_compatibility() {
    local helper="$HELPER_DIR/battguard-helper" output
    [[ -z "$DESTDIR" && -x "$helper" ]] || return 0
    output="$("$helper" check 2>/dev/null || true)"
    case "$output" in
    *supported=yes*)
        info "This computer is supported ($(grep '^backend=' <<<"$output"))."
        ;;
    *reason=needs-driver*)
        warn "Acer laptop detected, but no charge-limit interface is available."
        warn "Install and load the Linuwu-Sense driver first: $LINUWU_URL"
        ;;
    *)
        warn "This computer has no supported charge-limit interface."
        warn "The applet will still install, but it will only show an explanatory message."
        ;;
    esac
}

check_tools
case "$step" in
system) install_system ;;
applet) install_applet ;;
all)
    install_system
    install_applet
    ;;
esac
[[ "$step" == applet ]] || report_compatibility
[[ "$step" == system ]] || info "Done. Right-click the panel > Applets, and add BattGuard."

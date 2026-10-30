#!/usr/bin/env bash
# Test-suite for system/battguard-helper, using a fake sysfs tree.
# Each test runs in its own subshell so that SYSFS_ROOT and the stubbed
# require_root never leak; shellcheck's subshell notes are therefore expected.
# shellcheck disable=SC2030,SC2031,SC2329
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$HERE/../system/battguard-helper"
pass=0
fail=0

expect() { # description, expected, actual
    if [[ "$2" == "$3" ]]; then
        pass=$((pass + 1))
        printf '  ok   %s\n' "$1"
    else
        fail=$((fail + 1))
        printf '  FAIL %s (expected %q, got %q)\n' "$1" "$2" "$3"
    fi
}

# Run a function inside a subshell that sourced the helper and owns a fresh
# fake sysfs. Usage: with_sysfs <setup-function> <test-function>
with_sysfs() {
    (
        # shellcheck source=/dev/null
        source "$HELPER"
        set +e
        SYSFS_ROOT="$(mktemp -d)"
        trap 'rm -rf "$SYSFS_ROOT" "${OUTSIDE:-}"' EXIT
        require_root() { :; }
        "$1"
        "$2"
    )
}

# --- fake hardware ---------------------------------------------------------
setup_other_vendor() { mkdir -p "$SYSFS_ROOT/class/dmi/id"; echo "Dell Inc." >"$SYSFS_ROOT/class/dmi/id/sys_vendor"; }
setup_acer_no_driver() { mkdir -p "$SYSFS_ROOT/class/dmi/id"; echo "Acer" >"$SYSFS_ROOT/class/dmi/id/sys_vendor"; }
setup_linuwu() {
    mkdir -p "$SYSFS_ROOT/devices/platform/acer-wmi/predator_sense"
    echo 0 >"$SYSFS_ROOT/devices/platform/acer-wmi/predator_sense/battery_limiter"
}
setup_linuwu_nitro_module_path() {
    local d="$SYSFS_ROOT/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/nitro_sense"
    mkdir -p "$d"
    echo 1 >"$d/battery_limiter"
}
setup_power_supply() {
    local b
    for b in BAT0 BAT1; do
        mkdir -p "$SYSFS_ROOT/class/power_supply/$b"
        echo 100 >"$SYSFS_ROOT/class/power_supply/$b/charge_control_end_threshold"
    done
}
setup_leading_zero() {
    mkdir -p "$SYSFS_ROOT/class/power_supply/BAT0"
    echo 080 >"$SYSFS_ROOT/class/power_supply/BAT0/charge_control_end_threshold"
}
setup_symlink_escape() {
    mkdir -p "$SYSFS_ROOT/class/power_supply/BAT0"
    OUTSIDE="$(mktemp)"
    echo 100 >"$OUTSIDE"
    ln -s "$OUTSIDE" "$SYSFS_ROOT/class/power_supply/BAT0/charge_control_end_threshold"
}

# --- test bodies (run inside the subshell) ----------------------------------
t_check() { cmd_check; }
t_linuwu_on_then_off() { cmd_set on >/dev/null; cmd_set off; }
t_linuwu_on() { cmd_set on; }
t_power_supply_on() {
    cmd_set on >/dev/null
    echo "$(<"$SYSFS_ROOT/class/power_supply/BAT0/charge_control_end_threshold") $(<"$SYSFS_ROOT/class/power_supply/BAT1/charge_control_end_threshold")"
}
t_set_exit_code() { (cmd_set on) >/dev/null 2>&1; echo $?; }
t_symlink_unchanged() { (cmd_set on) >/dev/null 2>&1; cat "$OUTSIDE"; }

echo "check"
expect "unsupported vendor" $'supported=no\nreason=unsupported\nvendor=Dell Inc.' "$(with_sysfs setup_other_vendor t_check)"
expect "acer without driver" $'supported=no\nreason=needs-driver\nvendor=Acer' "$(with_sysfs setup_acer_no_driver t_check)"
expect "linuwu, limit off" $'supported=yes\nbackend=linuwu\nstate=off' "$(with_sysfs setup_linuwu t_check)"
expect "linuwu nitro via module path, limit on" $'supported=yes\nbackend=linuwu\nstate=on' "$(with_sysfs setup_linuwu_nitro_module_path t_check)"
expect "power_supply, limit off" $'supported=yes\nbackend=power_supply\nstate=off' "$(with_sysfs setup_power_supply t_check)"
expect "leading zeros are read as decimal" $'supported=yes\nbackend=power_supply\nstate=on' "$(with_sysfs setup_leading_zero t_check)"

echo "set"
expect "linuwu: on" $'supported=yes\nbackend=linuwu\nstate=on' "$(with_sysfs setup_linuwu t_linuwu_on)"
expect "linuwu: on then off" $'supported=yes\nbackend=linuwu\nstate=off' "$(with_sysfs setup_linuwu t_linuwu_on_then_off)"
expect "power_supply: 80 written to every battery" "80 80" "$(with_sysfs setup_power_supply t_power_supply_on)"
expect "unsupported hardware: exit code 10" "10" "$(with_sysfs setup_other_vendor t_set_exit_code)"
expect "symlink escaping /sys is refused: exit code 12" "12" "$(with_sysfs setup_symlink_escape t_set_exit_code)"
expect "symlink target stays untouched" "100" "$(with_sysfs setup_symlink_escape t_symlink_unchanged)"

echo "usage and privileges"
"$HELPER" >/dev/null 2>&1; expect "no argument: exit 2" 2 $?
"$HELPER" bogus >/dev/null 2>&1; expect "unknown command: exit 2" 2 $?
"$HELPER" on off >/dev/null 2>&1; expect "extra argument: exit 2" 2 $?
if ((EUID != 0)); then
    "$HELPER" on >/dev/null 2>&1; expect "'on' without root: exit 13" 13 $?
fi
expect "version" "battguard-helper 1.0.0" "$("$HELPER" version)"

printf '\npassed: %d, failed: %d\n' "$pass" "$fail"
((fail == 0))

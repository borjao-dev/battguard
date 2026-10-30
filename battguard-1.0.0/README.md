# BattGuard

A Cinnamon panel applet with one switch: **limit the battery charge to 80 %** (or allow a full charge again).
Keeping a laptop that stays plugged in at 100 % wears the battery faster; a charge limit is the usual fix.

> **Heads-up: BattGuard only works on supported laptops.** On any other machine it does nothing and
> shows a message explaining why. See [Supported hardware](#supported-hardware).

## Supported hardware

| Backend | What your laptop needs | Typical models |
|---|---|---|
| **Linuwu-Sense** | The [Linuwu-Sense](https://github.com/0x7375646F/Linuwu-Sense) kernel module loaded, exposing `battery_limiter` | Acer Predator and Nitro laptops supported by that driver |
| **Kernel standard** | A `charge_control_end_threshold` file in `/sys/class/power_supply/BAT*/` | Laptops whose kernel driver implements it (for example many ThinkPad and ASUS models; depends on model and kernel version) |

* **Tested on real hardware:** Acer Predator Helios Neo 16 (PHN16-71), Linuwu-Sense, Fedora 44, Cinnamon.
* **Kernel-standard backend:** implemented according to the kernel's documented interface and covered by automated
  tests with a simulated `/sys`, but **not yet verified on real hardware**. Reports are welcome.
* Not supported: laptops with no software-controllable charge limit (several vendors only offer it in the BIOS).
* BattGuard only sets "on" (80 %) and "off" (100 %). It does not choose other values.

Run `battguard-helper check` at any time to see how your machine is classified.

*"Acer", "Predator" and "Nitro" are trademarks of their respective owners. This project is independent and is
not affiliated with or endorsed by them.*

## Requirements

* Cinnamon desktop (developed on the Cinnamon shipped with Fedora 44).
* `bash`, `coreutils` (`realpath`), and **polkit** (`pkexec`) with a running polkit agent (standard on Cinnamon).
* A supported laptop (above).

BattGuard is written for any Linux distribution (plain Bash, JavaScript and polkit), but has only been run on Fedora so far.

## Install

From the project directory, as your **normal user** (sudo is used only for the system part):

```bash
./install.sh
```

Then right-click the panel → *Applets* → add **BattGuard**.

Useful options:

* `./install.sh system` or `./install.sh applet` installs only one part. The applet part never runs as root.
* `--prefix /usr` changes where the helper goes (default `/usr/local`).
* `--passwordless` additionally installs a polkit rule so administrators (`wheel`/`sudo` groups) on a local,
  active session can flip the switch without typing a password. Without it you authenticate with polkit
  (the password is remembered for a few minutes).

The installer finishes by telling you whether your computer is supported.

Fedora users can also use the RPM draft in [`packaging/`](packaging/).

## Uninstall

```bash
./uninstall.sh
```

## How it works and security

* The applet never touches the hardware. It calls `battguard-helper check` (no privileges) to learn the state,
  and `pkexec battguard-helper on|off` to change it.
* The helper is root-owned, takes **one fixed argument** (`check`, `on` or `off`), writes only to an allow-list of
  sysfs attributes, refuses anything that resolves outside `/sys`, and reads each value back to confirm the change.
* The applet refuses to run a helper that is not a regular, root-owned file without group/other write permission.
* Authorization goes through a polkit action bound to the helper's path. **No sudoers rule and no stored passwords.**
* The optional `--passwordless` rule is the only thing that relaxes this, and only for local, active sessions of
  administrators.

## Troubleshooting

| Message | Cause and fix |
|---|---|
| *The BattGuard helper is not installed* | Run `./install.sh system`. |
| *…Acer laptop, but the Linuwu-Sense driver is not loaded* | Install and load Linuwu-Sense, then check `battguard-helper check`. |
| *No supported battery charge-limit interface* | Your laptop does not expose one; see [Supported hardware](#supported-hardware). |
| *Your login shell is not listed in /etc/shells* | `pkexec` refuses users whose login shell is missing from `/etc/shells`. Check `getent passwd "$USER"` against `cat /etc/shells`; for example `/usr/sbin/zsh` is not the same string as `/usr/bin/zsh`. Set your shell to a listed path with `chsh`. |
| Nothing happens after authenticating | Run `pkexec /usr/local/libexec/battguard/battguard-helper on` in a terminal and read the error. |

## Development

```bash
bash tests/test_helper.sh   # helper, against a fake /sys
node tests/test_applet.js   # applet logic, against stubs of Cinnamon's runtime
```

The tests do not require root or real hardware. (The "non-root" case of the helper suite is skipped when run as root.)

Before publishing your own copy run `scripts/set-author.sh <github-username>`; it renames the applet directory and
replaces the `YOUR_GITHUB_USERNAME` placeholder everywhere.

### Translations

Strings are in `battguard@*/files/battguard@*/po/`. Copy `battguard.pot` to `<lang>.po`, translate it and open a
pull request. `install.sh` compiles the translations when `msgfmt` (gettext) is available.

## License

MIT, see [LICENSE](LICENSE).

# BattGuard

A panel switch that limits your laptop battery charge to 80 %.

**Works only on supported laptops:**

* Acer Predator / Nitro laptops with the [Linuwu-Sense](https://github.com/0x7375646F/Linuwu-Sense) driver loaded.
* Laptops whose kernel exposes `/sys/class/power_supply/BAT*/charge_control_end_threshold`
  (depends on model and kernel version).

On any other machine the applet only shows a message explaining why it cannot work.

## Installation

Installing this applet from Cinnamon Settings is **not enough**: changing the charge limit needs a small
root-owned helper and a polkit policy that are installed system-wide. Get them from the project page:
https://github.com/YOUR_GITHUB_USERNAME/battguard (run `./install.sh system`).

Until the helper is installed, the applet shows "The BattGuard helper is not installed".

## Requirements

`bash`, `coreutils`, `polkit` (`pkexec`), and a supported laptop.

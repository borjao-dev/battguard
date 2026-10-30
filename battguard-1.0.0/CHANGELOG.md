# Changelog

## 1.0.0

- First public release.
- Switch in the Cinnamon panel to turn the battery charge limit (80%) on and off.
- Compatibility check at runtime: the applet explains why it cannot work instead of failing silently.
- Backends: Linuwu-Sense (Acer Predator/Nitro) and the standard kernel `charge_control_end_threshold`.
- Root-owned helper run through pkexec with a polkit policy (no sudoers rule, no passwords stored).
- English interface with Brazilian Portuguese translation.

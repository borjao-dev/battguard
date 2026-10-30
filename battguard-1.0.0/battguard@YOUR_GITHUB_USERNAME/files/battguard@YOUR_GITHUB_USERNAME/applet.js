/*
 * BattGuard - Cinnamon applet that toggles the laptop battery charge limit.
 * SPDX-License-Identifier: MIT
 *
 * The applet itself never touches the hardware. It asks the root-owned
 * "battguard-helper" program whether this computer is supported ("check", no
 * privileges) and, when the user flips the switch, runs the same helper through
 * pkexec ("on" / "off").
 */
const Applet = imports.ui.applet;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext;

const UUID = 'battguard@YOUR_GITHUB_USERNAME';
const HELPER_NAME = 'battguard-helper';
// Root-owned locations only, in order of preference.
const HELPER_DIRS = [
    '/usr/libexec/battguard',
    '/usr/lib/battguard',
    '/usr/local/libexec/battguard',
    '/usr/local/lib/battguard',
];
const REFRESH_INTERVAL_SECONDS = 60;
const PKEXEC_DISMISSED = 126; // The user closed the authentication dialog.
const MAX_ERROR_LENGTH = 200;

const ICONS = {
    on: 'battery-level-80-symbolic',
    off: 'battery-level-100-symbolic',
    warning: 'dialog-warning-symbolic',
};

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
    const translated = Gettext.dgettext(UUID, str);
    return translated !== str ? translated : Gettext.gettext(str);
}

/** Parse the helper's "key=value" lines into a plain object. */
function parseCheck(text) {
    const result = Object.create(null);
    for (const line of String(text).split('\n')) {
        const index = line.indexOf('=');
        if (index > 0)
            result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return result;
}

/** A helper is trusted only if it is a regular file owned by root and not writable by others. */
function isTrustedHelper(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info(
            'standard::type,unix::uid,unix::mode',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        const mode = info.get_attribute_uint32('unix::mode');
        return info.get_file_type() === Gio.FileType.REGULAR &&
            info.get_attribute_uint32('unix::uid') === 0 &&
            (mode & 0o022) === 0 &&
            (mode & 0o111) !== 0;
    } catch (e) {
        return false;
    }
}

function findHelper() {
    for (const dir of HELPER_DIRS) {
        const path = dir + '/' + HELPER_NAME;
        if (isTrustedHelper(path))
            return path;
    }
    return null;
}

/** Run a command asynchronously; callback(exitStatus, stdout, stderr). */
function runCommand(argv, callback) {
    try {
        const process = Gio.Subprocess.new(
            argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        process.communicate_utf8_async(null, null, (proc, result) => {
            try {
                const [, stdout, stderr] = proc.communicate_utf8_finish(result);
                callback(proc.get_exit_status(), stdout || '', stderr || '');
            } catch (e) {
                callback(-1, '', String(e));
            }
        });
    } catch (e) {
        callback(-1, '', String(e));
    }
}

function setVisible(item, visible) {
    (item.actor || item).visible = visible;
}

class BattGuardApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this._destroyed = false;
        this._busy = false;
        this._helper = null;

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this._switch = new PopupMenu.PopupSwitchMenuItem(_('Limit battery charge'));
        this._switch.connect('toggled', (item, state) => this._onToggled(state));
        this.menu.addMenuItem(this._switch);

        this._message = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._message);

        this._showMessage(ICONS.warning, _('Checking…'));
        this.refresh();
        this._timerId = Mainloop.timeout_add_seconds(REFRESH_INTERVAL_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /** Re-check compatibility and the current state of the limit. */
    refresh() {
        if (this._destroyed || this._busy)
            return;
        this._helper = findHelper();
        if (!this._helper) {
            this._showUnavailable('no-helper');
            return;
        }
        runCommand([this._helper, 'check'], (status, stdout) => {
            if (this._destroyed)
                return;
            if (status !== 0) {
                this._showUnavailable('error');
                return;
            }
            const info = parseCheck(stdout);
            if (info.supported !== 'yes')
                this._showUnavailable(info.reason || 'unsupported');
            else
                this._showState(info.state);
        });
    }

    _showState(state) {
        if (state !== 'on' && state !== 'off') {
            this._showUnavailable('unknown-state');
            return;
        }
        const on = state === 'on';
        this._switch.setSensitive(true);
        setVisible(this._switch, true);
        this._switch.setToggleState(on);
        setVisible(this._message, false);
        this.set_applet_icon_symbolic_name(on ? ICONS.on : ICONS.off);
        this.set_applet_tooltip(on ?
            _('Battery charge limit: on') :
            _('Battery charge limit: off (full charge allowed)'));
    }

    _showUnavailable(reason) {
        const messages = {
            'no-helper': _('The BattGuard helper is not installed. See the README for installation instructions.'),
            'needs-driver': _('This looks like an Acer laptop, but the Linuwu-Sense driver is not loaded.'),
            'unsupported': _('No supported battery charge-limit interface was found on this computer.'),
            'unknown-state': _('The current battery charge limit could not be read.'),
            'error': _('BattGuard is not available on this computer.'),
        };
        setVisible(this._switch, false);
        this._showMessage(ICONS.warning, messages[reason] || messages.error);
    }

    _showMessage(icon, text) {
        this._message.label.set_text(text);
        setVisible(this._message, true);
        this.set_applet_icon_symbolic_name(icon);
        this.set_applet_tooltip(text);
    }

    _onToggled(state) {
        if (this._busy || !this._helper)
            return;
        this._busy = true;
        this._switch.setSensitive(false);
        runCommand(['pkexec', this._helper, state ? 'on' : 'off'], (status, stdout, stderr) => {
            this._busy = false;
            if (this._destroyed)
                return;
            if (status !== 0 && status !== PKEXEC_DISMISSED)
                this._notifyFailure(stderr);
            this.refresh(); // Always show what the hardware really reports.
        });
    }

    _notifyFailure(stderr) {
        let details;
        if (/SHELL/.test(stderr)) {
            details = _('Your login shell is not listed in /etc/shells, so pkexec refused to run. See the README (Troubleshooting).');
        } else {
            details = _('Could not change the charge limit.');
            const firstLine = String(stderr).trim().split('\n')[0].slice(0, MAX_ERROR_LENGTH);
            if (firstLine)
                details += ' ' + firstLine;
        }
        Main.notifyError('BattGuard', details);
    }

    on_applet_clicked() {
        this.refresh();
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this._destroyed = true;
        if (this._timerId) {
            Mainloop.source_remove(this._timerId);
            this._timerId = 0;
        }
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new BattGuardApplet(metadata, orientation, panelHeight, instanceId);
}

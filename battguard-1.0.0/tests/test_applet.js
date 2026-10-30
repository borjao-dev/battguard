'use strict';
// Smoke tests for the applet logic. Cinnamon's JS runtime (GJS) is replaced by
// small stubs, so this checks BattGuard's own behaviour, not Cinnamon's.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const UUID_DIR = fs.readdirSync(path.join(__dirname, '..')).find(d => d.startsWith('battguard@'));
const SOURCE = path.join(__dirname, '..', UUID_DIR, 'files', UUID_DIR, 'applet.js');
const HELPER = '/usr/libexec/battguard/battguard-helper';

function makeEnvironment(scenario) {
    const log = { notifications: [], commands: [], icons: [], tooltips: [], removedTimers: [] };

    class IconApplet {
        constructor() {}
        set_applet_icon_symbolic_name(name) { log.icons.push(name); }
        set_applet_tooltip(text) { log.tooltips.push(text); }
    }
    class Item {
        constructor(text) { this.visible = true; this.sensitive = true; this.label = { text, set_text: t => { this.label.text = t; } }; this.handlers = {}; }
        connect(name, fn) { this.handlers[name] = fn; }
        setSensitive(v) { this.sensitive = v; }
        setToggleState(v) { this.state = v; }
    }
    const fileInfo = scenario.fileInfo || { type: 'REGULAR', uid: 0, mode: 0o755 };

    const imports = {
        ui: {
            applet: { IconApplet, AppletPopupMenu: class { addMenuItem() {} toggle() { log.toggled = true; } } },
            main: { notifyError: (title, body) => log.notifications.push([title, body]) },
            popupMenu: {
                PopupMenuManager: class { addMenu() {} },
                PopupSwitchMenuItem: Item,
                PopupMenuItem: Item,
            },
        },
        gi: {
            Gio: {
                File: { new_for_path: p => ({ query_info: () => {
                    if (!scenario.trustedPaths.includes(p)) throw new Error('not found');
                    return {
                        get_attribute_uint32: k => (k === 'unix::uid' ? fileInfo.uid : fileInfo.mode),
                        get_file_type: () => fileInfo.type,
                    };
                } }) },
                FileQueryInfoFlags: { NOFOLLOW_SYMLINKS: 1 },
                FileType: { REGULAR: 'REGULAR' },
                SubprocessFlags: { STDOUT_PIPE: 1, STDERR_PIPE: 2 },
                Subprocess: { new: argv => {
                    log.commands.push(argv);
                    const [status, out, err] = scenario.run(argv);
                    return {
                        communicate_utf8_async: (a, b, cb) => cb({ communicate_utf8_finish: () => [true, out, err], get_exit_status: () => status }, {}),
                    };
                } },
            },
            GLib: { get_home_dir: () => '/home/test', SOURCE_CONTINUE: true },
        },
        mainloop: { timeout_add_seconds: () => 42, source_remove: id => log.removedTimers.push(id) },
        gettext: { bindtextdomain() {}, dgettext: (d, s) => s, gettext: s => s },
    };
    const context = vm.createContext({ imports, String, Object, Error, console });
    vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), context, { filename: SOURCE });
    return { context, log };
}

const ok = { trustedPaths: [HELPER] };
let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const build = scenario => {
    const { context, log } = makeEnvironment(scenario);
    return { applet: vm.runInContext("main({}, 0, 30, 1)", context), log };
};

console.log('parseCheck');
test('parses key=value lines and ignores junk', () => {
    const { context } = makeEnvironment(ok);
    const r = vm.runInContext("parseCheck('supported=yes\\nnoise\\nstate=on\\n=bad\\nvendor=A=B')", context);
    assert.strictEqual(r.supported, 'yes'); assert.strictEqual(r.state, 'on'); assert.strictEqual(r.vendor, 'A=B');
    assert.strictEqual(Object.keys(r).length, 3);
});

console.log('helper trust');
for (const [name, info, expected] of [
    ['root-owned regular executable is trusted', { type: 'REGULAR', uid: 0, mode: 0o755 }, true],
    ['file owned by a normal user is rejected', { type: 'REGULAR', uid: 1000, mode: 0o755 }, false],
    ['group/other-writable file is rejected', { type: 'REGULAR', uid: 0, mode: 0o775 }, false],
    ['non-executable file is rejected', { type: 'REGULAR', uid: 0, mode: 0o644 }, false],
    ['symlink is rejected', { type: 'SYMBOLIC_LINK', uid: 0, mode: 0o755 }, false],
]) {
    test(name, () => {
        const { context } = makeEnvironment({ trustedPaths: [HELPER], fileInfo: info });
        assert.strictEqual(vm.runInContext('isTrustedHelper("' + HELPER + '")', context), expected);
    });
}
test('missing helper is not found', () => {
    const { context } = makeEnvironment({ trustedPaths: [] });
    assert.strictEqual(vm.runInContext('findHelper()', context), null);
});

console.log('compatibility states');
const checkOutput = text => argv => (argv[1] === 'check' ? [0, text, ''] : [0, '', '']);
test('no helper installed', () => {
    const { applet } = build({ trustedPaths: [], run: () => [0, '', ''] });
    assert.strictEqual(applet._switch.visible, false);
    assert.match(applet._message.label.text, /helper is not installed/);
});
test('unsupported laptop', () => {
    const { applet } = build({ ...ok, run: checkOutput('supported=no\nreason=unsupported\nvendor=Dell\n') });
    assert.strictEqual(applet._switch.visible, false);
    assert.match(applet._message.label.text, /No supported battery charge-limit interface/);
});
test('acer laptop missing the driver', () => {
    const { applet } = build({ ...ok, run: checkOutput('supported=no\nreason=needs-driver\nvendor=Acer\n') });
    assert.match(applet._message.label.text, /Linuwu-Sense driver is not loaded/);
});
test('helper failure is reported as unavailable', () => {
    const { applet } = build({ ...ok, run: () => [1, '', 'boom'] });
    assert.match(applet._message.label.text, /not available on this computer/);
});
test('unknown state is reported, never guessed', () => {
    const { applet } = build({ ...ok, run: checkOutput('supported=yes\nbackend=linuwu\nstate=unknown\n') });
    assert.match(applet._message.label.text, /could not be read/);
    assert.strictEqual(applet._switch.visible, false);
});
test('supported, limit off', () => {
    const { applet, log } = build({ ...ok, run: checkOutput('supported=yes\nbackend=linuwu\nstate=off\n') });
    assert.strictEqual(applet._switch.visible, true); assert.strictEqual(applet._switch.state, false);
    assert.strictEqual(log.icons.at(-1), 'battery-level-100-symbolic');
});
test('supported, limit on', () => {
    const { applet, log } = build({ ...ok, run: checkOutput('supported=yes\nbackend=power_supply\nstate=on\n') });
    assert.strictEqual(applet._switch.state, true); assert.strictEqual(log.icons.at(-1), 'battery-level-80-symbolic');
});

console.log('toggling');
const toggleScenario = (pkexecResult) => ({ ...ok, run: argv => (argv[0] === 'pkexec' ? pkexecResult : [0, 'supported=yes\nbackend=linuwu\nstate=on\n', '']) });
test('runs pkexec with the helper path and re-checks afterwards', () => {
    const { applet, log } = build(toggleScenario([0, '', '']));
    log.commands.length = 0;
    applet._switch.handlers.toggled(null, true);
    assert.strictEqual(JSON.stringify(log.commands[0]), JSON.stringify(['pkexec', HELPER, 'on']));
    assert.strictEqual(JSON.stringify(log.commands[1]), JSON.stringify([HELPER, 'check']));
    assert.strictEqual(log.notifications.length, 0);
});
test('dismissing the password dialog is silent', () => {
    const { applet, log } = build(toggleScenario([126, '', 'Error: dismissed']));
    applet._switch.handlers.toggled(null, true);
    assert.strictEqual(log.notifications.length, 0);
});
test('pkexec SHELL error gives an actionable message', () => {
    const { applet, log } = build(toggleScenario([127, '', 'The value for the SHELL variable was not found in the /etc/shells file']));
    applet._switch.handlers.toggled(null, true);
    assert.match(log.notifications[0][1], /\/etc\/shells/);
});
test('other failures show a truncated first line', () => {
    const { applet, log } = build(toggleScenario([12, '', 'x'.repeat(500) + '\nsecond line']));
    applet._switch.handlers.toggled(null, false);
    assert.ok(log.notifications[0][1].length < 260); assert.ok(!log.notifications[0][1].includes('second line'));
});
test('a second toggle while busy is ignored', () => {
    const { applet, log } = build(toggleScenario([0, '', '']));
    applet._busy = true; log.commands.length = 0;
    applet._switch.handlers.toggled(null, true);
    assert.strictEqual(log.commands.length, 0);
});

console.log('lifecycle');
test('removal stops the timer and silences late callbacks', () => {
    const { applet, log } = build({ ...ok, run: checkOutput('supported=yes\nbackend=linuwu\nstate=on\n') });
    applet.on_applet_removed_from_panel();
    assert.deepStrictEqual(log.removedTimers, [42]);
    log.commands.length = 0; applet.refresh();
    assert.strictEqual(log.commands.length, 0);
});

console.log('\npassed: ' + passed + (process.exitCode ? ' (with failures)' : ''));

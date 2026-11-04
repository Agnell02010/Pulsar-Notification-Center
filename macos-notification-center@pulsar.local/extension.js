/* macOS Notification Center - Pulsar OS
 *
 * Thin entry point. GNOME Shell caches this file, so a change here only takes
 * effect after a logout/login: all the real work therefore lives in `nc.js`,
 * which is imported below with a cache-busting query. A plain
 *
 *     gnome-extensions disable macos-notification-center@pulsar.local
 *     gnome-extensions enable  macos-notification-center@pulsar.local
 *
 * then reloads nc.js without touching the session.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEBUG_FLAG = '/tmp/pulsar-nc-debug';

function debugStartupStartedAt() {
    try {
        return GLib.file_test(DEBUG_FLAG, GLib.FileTest.EXISTS)
            ? GLib.get_monotonic_time()
            : 0;
    } catch (e) {
        return 0;
    }
}

function debugStartupTiming(label, startedAt) {
    if (!startedAt)
        return;
    try {
        if (GLib.file_test(DEBUG_FLAG, GLib.FileTest.EXISTS)) {
            const elapsed = (GLib.get_monotonic_time() - startedAt) / 1000;
            console.log(`pulsar-nc-dbg: startup ${label}: ${elapsed.toFixed(2)}ms`);
        }
    } catch (e) {
        // Diagnostics must not interfere with enabling the extension.
    }
}

export default class MacOSNotificationCenterExtension extends Extension {
    async enable() {
        let mod = null;
        let importStartedAt = 0;
        try {
            const uri = Gio.File.new_for_path(
                GLib.build_filenamev([this.path, 'nc.js'])).get_uri();
            importStartedAt = debugStartupStartedAt();
            mod = await import(`${uri}?v=${Date.now()}`);
        } catch (e) {
            debugStartupTiming('import nc.js failed', importStartedAt);
            console.error(`macos-nc: nc.js could not be loaded: ${e}`);
            return;
        }
        debugStartupTiming('import nc.js', importStartedAt);

        try {
            this._nc = mod.crea({path: this.path});
        } catch (e) {
            console.error(`macos-nc: crea() failed: ${e}`);
            this._nc = null;
            return;
        }

        try {
            this._nc.enable();
        } catch (e) {
            console.error(`macos-nc: enable() failed: ${e}`);
            try {
                this._nc.disable();
            } catch (e2) {
                /* the drawer may have failed before building anything */
            }
            this._nc = null;
        }
    }

    disable() {
        try {
            this._nc?.disable();
        } catch (e) {
            console.error(`macos-nc: disable() failed: ${e}`);
        }
        this._nc = null;
    }
}

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

export default class MacOSNotificationCenterExtension extends Extension {
    async enable() {
        let mod = null;
        try {
            const uri = Gio.File.new_for_path(
                GLib.build_filenamev([this.path, 'nc.js'])).get_uri();
            mod = await import(`${uri}?v=${Date.now()}`);
        } catch (e) {
            console.error(`macos-nc: nc.js could not be loaded: ${e}`);
            return;
        }

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

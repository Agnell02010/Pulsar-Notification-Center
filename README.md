# Pulsar Notification Center

macOS-style **Notification Center & Widgets** drawer for Pulsar OS, as a GNOME
Shell extension. It replaces the content of the date/time menu with a Mac-like
sidebar: notifications on top, then a grid of widgets (calendar, reminders,
performance, weather, music, battery, world clock).

- **UUID:** `macos-notification-center@pulsar.local`
- **Target:** GNOME Shell 45-51 (developed and tested on 51, Wayland)
- **Look:** the glass is drawn by the [Liquid Glass](https://github.com/Agnell02010/Pulsar-Liquid-Glass)
  extension; this extension only builds the widgets and tags them so Liquid
  Glass can glass them.
- **Companion:** the [Pulsar CC 27](https://github.com/Agnell02010/Pulsar-CC-27-Gnome)
  Control Center is the matching top-right panel.
- **License:** GPL-2.0-or-later (see `LICENSE`)

> **Coming from the stock Pulsar OS Control Centre?**
> `macos-control-centre@pulsar.local` (the one shipped with the ISO) contains
> its own **old** Notification Center with the same date menu. Keep only one
> drawer: disable the stock extension before using this one. The installer
> does it automatically when the stock extension is present.
>
> ```bash
> gnome-extensions disable macos-control-centre@pulsar.local
> ```

## Install

```bash
./install.sh
```

The installer copies the extension into
`~/.local/share/gnome-shell/extensions/` (user level: it needs no `sudo` and it
survives system updates) and enables it. On Wayland a **logout/login is
required** for the code to load.

Manage it with:

```bash
gnome-extensions disable macos-notification-center@pulsar.local
gnome-extensions enable  macos-notification-center@pulsar.local
```

## Layout of the repository

```
install.sh                              installer
macos-notification-center@pulsar.local/ the extension itself
    extension.js                        entry point, thin (shell-cached: needs a login)
    nc.js                               the whole drawer (hot-reloadable)
    stylesheet.css                      the look
    icons/                              bundled symbolic icons
    metadata.json
```

## Working on it

After the first install (and the one logout it needs), the development loop
does not require logging out again:

```bash
# 1. edit nc.js / stylesheet.css
# 2. reload
gnome-extensions disable macos-notification-center@pulsar.local
gnome-extensions enable  macos-notification-center@pulsar.local
```

Only changes to `extension.js` or `metadata.json` need a logout/login.

### Diagnosing startup lag

The extension has opt-in startup timings for the dynamic `nc.js` import,
building the widget UI, and the first refresh. They use the existing debug
flag and write only to the GNOME Shell journal; no usage data or extra files
are recorded:

```bash
touch /tmp/pulsar-nc-debug
# If extension.js changed, log out and back in so GNOME Shell reloads it.
# Otherwise, disable and enable the extension to repeat startup:
gnome-extensions disable macos-notification-center@pulsar.local
gnome-extensions enable  macos-notification-center@pulsar.local
journalctl -b _COMM=gnome-shell -o cat | grep 'pulsar-nc-dbg:'
rm -f /tmp/pulsar-nc-debug
```

Look for `startup import nc.js`, `startup build UI`, and `startup first
refresh`; the existing `refresh ...` lines break the first refresh down by
step. `extension.js` is cached by GNOME Shell, so the import timing will not
appear with an older already-loaded entry point until after logout/login. Remove
the flag after collecting the timings to disable diagnostics.

You can check that `nc.js` and `extension.js` at least parse and load, without
touching the running session, with `gjs` and stubbed `gi://` modules:

```bash
gjs -m /path/to/nc.js     # syntax + module load
```

### Rolling back

If the user-level copy misbehaves, put the original snapshot back and
reinstall (no logout needed):

```bash
cd ~/Pulsar-Notification-Center
git checkout e4ba32e -- macos-notification-center@pulsar.local
./install.sh
gnome-extensions disable macos-notification-center@pulsar.local
gnome-extensions enable  macos-notification-center@pulsar.local
```

To go back to the system copy for good, delete the user-level folder and log
out/in (the shell resolves extension paths at login): the extension shipped in
`/usr/share/gnome-shell/extensions/` takes over again.

## Notes

- **`extension.js` is cached by GNOME Shell.** Any change to it is only picked
  up after a logout/login. Code that must be iterated on without logging out
  lives in a separate module that `extension.js` imports with a cache-busting
  query (`import(uri + '?v=' + Date.now())`), so that a plain
  `disable` + `enable` reloads it — the same trick used by the Control Centre
  (`pannelli.js`).
- The extension hides the stock date-menu children instead of destroying them,
  and puts them back on `disable()`.
- Widgets read live data from `/proc`, UPower (D-Bus), MPRIS (D-Bus), the GNOME
  calendar server (D-Bus) and Open-Meteo (HTTPS).

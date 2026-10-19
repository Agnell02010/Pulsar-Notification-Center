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
- **License:** GPL-2.0-or-later (see `LICENSE`)

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
    extension.js                        entry point (shell-cached: needs a login)
    stylesheet.css                      the look
    icons/                              bundled symbolic icons
    metadata.json
```

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

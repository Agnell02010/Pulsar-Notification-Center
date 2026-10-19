/* macOS Notification Center - implementation for Pulsar OS.
 *
 * This file is imported by extension.js with a cache-busting query, so a plain
 * `gnome-extensions disable/enable` reloads it: no logout needed while working
 * on the drawer. Everything that can change lives here; extension.js is only
 * the thin shell the shell caches.
 *
 * Integrated with real Month Calendar Grid, GNOME Weather location,
 * Liquid Glass shader integration, MPRIS album art, UPower connected devices.
 */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const NONE = Gio.DBusCallFlags.NONE;
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const LG_UUID = 'liquid-glass@thinkingcoding1231.gmail.com';

/* The world clock card's cities. The panel lists the same ones, so the list
 * lives here once instead of inside the refresher. */
const CITY_LIST = [
    {name: 'Cupertino', tz: 'America/Los_Angeles'},
    {name: 'Tokio', tz: 'Asia/Tokyo'},
    {name: 'Sídney', tz: 'Australia/Sydney'},
    {name: 'París', tz: 'Europe/Paris'},
];

/* i18n strings dictionary */
const STRINGS = {
    es: {
        NOTIFICATIONS: 'NOTIFICACIONES',
        CLEAR_ALL: 'Borrar todo',
        EXPAND: 'Desplegar',
        COLLAPSE: 'Contraer',
        NO_NOTIFICATIONS: 'Sin notificaciones pendientes',
        MORE_NOTIFS: '+%d notificaciones más... (Toca para desplegar)',
        WIDGETS: 'WIDGETS',
        TODAY: 'HOY',
        NO_EVENTS: 'Sin eventos hoy',
        SCHEDULED: 'Evento programado',
        TASKS: 'Tareas',
        ALL_DONE: 'Todo al día hoy',
        NO_TASKS: 'Sin tareas pendientes',
        PERFORMANCE: 'Rendimiento Pulsar',
        OPTIMAL: 'SISTEMA ÓPTIMO',
        CPU: 'CPU',
        MEMORY: 'MEMORIA',
        UPTIME: 'TIEMPO ACTIVO',
        FREE: 'Libre',
        NOW: 'Ahora',
        UPDATED: 'Actualizado',
        MUSIC: 'Música',
        NO_MEDIA: 'Sin reproducción',
        BATTERY: 'Batería',
        CHARGING: 'Cargando',
        WORLD_CLOCK: 'Reloj mundial',
        SAME_TIME: 'Misma hora',
        AHEAD: '+%dh',
        BEHIND: '-%dh',
        CLEAR_SKY: 'Despejado',
        FEW_CLOUDS: 'Poco nuboso',
        CLOUDY: 'Nublado',
        RAIN: 'Lluvia',
        SNOW: 'Nieve',
        THUNDERSTORM: 'Tormenta',
        FOG: 'Niebla',
        WEATHER: 'Clima',
        PANEL_10DAY: 'Previsión de 10 días',
        PANEL_NO_DATA: 'Sin datos de previsión',
        PANEL_SOON: 'Panel en camino',
        PANEL_OPEN_CALENDAR: 'Abrir Calendario',
        PANEL_CALENDAR: 'Calendario',
        PANEL_ALLDAY: 'Todo el día',
        PANEL_OPEN_TASKS: 'Abrir Recordatorios',
        PANEL_POWER_SETTINGS: 'Ajustes de energía',
        PANEL_LOAD: 'Carga media',
        PANEL_DISCHARGING: 'Descargando',
        PANEL_ON_POWER: 'Conectado a la red',
        PANEL_OPEN_CLOCKS: 'Abrir Relojes',
        PANEL_OPEN_MONITOR: 'Abrir Monitor',
        PANEL_PREVIOUS: 'Anterior',
        PANEL_NEXT: 'Siguiente',
        PANEL_PLAY: 'Reproducir',
        PANEL_PAUSE: 'Pausa',
        PANEL_SHUFFLE: 'Aleatorio',
        PANEL_REPEAT: 'Repetir',
        CAL_DAYS: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    },
    en: {
        NOTIFICATIONS: 'NOTIFICATIONS',
        CLEAR_ALL: 'Clear All',
        EXPAND: 'Expand',
        COLLAPSE: 'Collapse',
        NO_NOTIFICATIONS: 'No notifications',
        MORE_NOTIFS: '+%d more notifications... (Click to expand)',
        WIDGETS: 'WIDGETS',
        TODAY: 'TODAY',
        NO_EVENTS: 'No events today',
        SCHEDULED: 'Scheduled event',
        TASKS: 'Reminders',
        ALL_DONE: 'All clear today',
        NO_TASKS: 'No tasks scheduled',
        PERFORMANCE: 'Pulsar Performance',
        OPTIMAL: 'SYSTEM OPTIMAL',
        CPU: 'CPU',
        MEMORY: 'MEMORY',
        UPTIME: 'UPTIME',
        FREE: 'Free',
        NOW: 'Now',
        UPDATED: 'Updated',
        MUSIC: 'Music',
        NO_MEDIA: 'Not playing',
        BATTERY: 'Battery',
        CHARGING: 'Charging',
        WORLD_CLOCK: 'World Clock',
        SAME_TIME: 'Same time',
        AHEAD: '+%dh',
        BEHIND: '-%dh',
        CLEAR_SKY: 'Clear Sky',
        FEW_CLOUDS: 'Partly Cloudy',
        CLOUDY: 'Cloudy',
        RAIN: 'Rain',
        SNOW: 'Snow',
        THUNDERSTORM: 'Thunderstorm',
        FOG: 'Fog',
        WEATHER: 'Weather',
        PANEL_10DAY: '10-Day Forecast',
        PANEL_NO_DATA: 'No forecast data',
        PANEL_SOON: 'Panel coming soon',
        PANEL_OPEN_CALENDAR: 'Open Calendar',
        PANEL_CALENDAR: 'Calendar',
        PANEL_ALLDAY: 'All day',
        PANEL_OPEN_TASKS: 'Open Reminders',
        PANEL_POWER_SETTINGS: 'Energy Settings',
        PANEL_LOAD: 'Load average',
        PANEL_DISCHARGING: 'On battery',
        PANEL_ON_POWER: 'On power',
        PANEL_OPEN_CLOCKS: 'Open Clocks',
        PANEL_OPEN_MONITOR: 'Open Monitor',
        PANEL_PREVIOUS: 'Previous',
        PANEL_NEXT: 'Next',
        PANEL_PLAY: 'Play',
        PANEL_PAUSE: 'Pause',
        PANEL_SHUFFLE: 'Shuffle',
        PANEL_REPEAT: 'Repeat',
        CAL_DAYS: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    }
};

function getLocale() {
    const langs = GLib.get_language_names();
    for (const l of langs) {
        if (l.startsWith('es')) return 'es';
    }
    return 'en';
}

function t(key, ...args) {
    const loc = getLocale();
    const dict = STRINGS[loc] || STRINGS.en;
    let str = dict[key] || STRINGS.en[key] || key;
    if (args.length > 0 && typeof str === 'string') {
        for (const arg of args) {
            str = str.replace(/%[ds]/, String(arg));
        }
    }
    return str;
}

const CALENDAR_SERVER_XML = `
<node>
  <interface name="org.gnome.Shell.CalendarServer">
    <method name="SetTimeRange">
      <arg type="x" direction="in" name="since"/>
      <arg type="x" direction="in" name="until"/>
      <arg type="b" direction="in" name="force_reload"/>
    </method>
    <signal name="EventsAddedOrUpdated">
      <arg type="a(ssxxa{sv})" name="events"/>
    </signal>
    <signal name="EventsRemoved">
      <arg type="as" name="ids"/>
    </signal>
  </interface>
</node>`;

let ICON_DIR = '';

/* Liquid Glass clears the background of the widgets it recognises inside a
 * pod, and it puts back the style it had captured the first time it saw the
 * widget. A widget that already carries this exact string is left alone
 * entirely: that is how the Control Centre protects the album art, which
 * would otherwise snap back to the previous track at every colour resample.
 * The string has to match exactly. */
const LG_OVERRIDE = 'background-color: transparent !important;';

function symbol(name) {
    try {
        return Gio.icon_new_for_string(`${ICON_DIR}/${name}-symbolic.svg`);
    } catch (e) {
        return Gio.ThemedIcon.new_with_default_fallbacks('image-missing');
    }
}

function icon(name, cls = '', size = 16) {
    const props = {
        style_class: `mac-nc-icon ${cls}`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        icon_size: size,
    };
    if (name.startsWith('nc:'))
        props.gicon = symbol(name.slice(3));
    else
        props.icon_name = name;
    return new St.Icon(props);
}

/* The animation timings are shared with the Control Centre: both read the same
 * file, so a change there moves the Notification Centre too. A missing file is
 * not an error — the values below are the ones the file ships with. */
const ANIM_FILE = GLib.build_filenamev([
    GLib.get_home_dir(), '.config', 'pulsar-cc', 'animazione.json',
]);

let ANIM = null;

function animazione() {
    if (ANIM)
        return ANIM;
    ANIM = {
        enabled: true,
        enterScale: 0.96,
        enterDuration: 240,
        enterSettle: 150,
        enterOvershoot: 1.02,
        enterRise: 4,
        popScale: 1.12,
        popDown: 110,
        popUp: 230,
    };
    try {
        const [ok, bytes] = GLib.file_get_contents(ANIM_FILE);
        if (ok) {
            const j = JSON.parse(new TextDecoder('utf-8').decode(bytes));
            if (j && typeof j === 'object')
                Object.assign(ANIM, j);
        }
    } catch (e) {
        /* the defaults are enough */
    }
    return ANIM;
}

/* Geometry probe.
 *
 * When /tmp/pulsar-nc-debug exists the drawer dumps its real geometry to the
 * journal every time it opens: the size of every pod, the corner radius its CSS
 * actually resolves to, and whether Liquid Glass will paint it (the
 * `quick-toggle` class). That is the only honest way to check the corners
 * without a working screenshot of an open popup — the screenshot portal closes
 * the menu before capturing it.
 *
 *     touch /tmp/pulsar-nc-debug      # on
 *     rm /tmp/pulsar-nc-debug         # off
 */
const DEBUG_FLAG = '/tmp/pulsar-nc-debug';
/* A second, separate flag: when it exists, opening the drawer makes the
 * extension walk through every widget panel in turn (see _provaPannelli). */
const DEBUG_PANELS = '/tmp/pulsar-nc-debug-pannelli';

function debugOn() {
    try {
        return GLib.file_test(DEBUG_FLAG, GLib.FileTest.EXISTS);
    } catch (e) {
        return false;
    }
}

function debug(msg) {
    if (debugOn())
        console.log(`pulsar-nc-dbg: ${msg}`);
}

/* Launches the first command that actually exists.
 *
 * `cmd` is either one command or a list of alternatives. A single string like
 * "gnome-calendar || xdg-open calendar:" does NOT work: Gio parses the string
 * into argv, so the shell operators are passed to the first program as
 * arguments and nothing is ever opened. Each alternative is therefore resolved
 * (and checked against PATH) explicitly. */
function launch(cmd) {
    for (const candidate of (Array.isArray(cmd) ? cmd : [cmd])) {
        try {
            const [ok, argv] = GLib.shell_parse_argv(candidate);
            if (!ok || argv.length === 0)
                continue;
            if (argv[0].includes('/')) {
                if (!GLib.file_test(argv[0], GLib.FileTest.IS_EXECUTABLE))
                    continue;
            } else if (!GLib.find_program_in_path(argv[0])) {
                continue;
            }
            Gio.AppInfo.create_from_commandline(candidate, null,
                Gio.AppInfoCreateFlags.NONE).launch([], null);
            return;
        } catch (e) {
            console.warn(`macos-nc: failed to launch ${candidate}: ${e}`);
        }
    }
}

function later(ms, fn) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        try {
            fn();
        } catch (e) {}
        return GLib.SOURCE_REMOVE;
    });
}

function findPlayer(cb) {
    try {
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, GLib.VariantType.new('(as)'),
            NONE, -1, null, (c, r) => {
                try {
                    const names = c.call_finish(r).deepUnpack()[0];
                    cb(names.find(n => n.startsWith(MPRIS_PREFIX)) ?? null);
                } catch (e) {
                    cb(null);
                }
            });
    } catch (e) {
        cb(null);
    }
}

/* Public API used by extension.js: one instance, created on enable.
 * `h.path` is the folder the extension is loaded from (used to find icons/). */
export function crea(h) {
    return new MacOSNotificationCenter(h);
}

class MacOSNotificationCenter {
    constructor(h) {
        this._h = h;
        this._path = h.path;
    }

    enable() {
        ICON_DIR = `${this._path}/icons`;
        this._dateMenu = Main.panel.statusArea.dateMenu;
        this._ids = [];
        this._subs = [];
        this._hiddenChildren = [];
        this._cards = [];
        this._pollId = 0;
        this._weatherPollId = 0;
        this._soupSession = new Soup.Session();
        this._soupSession.timeout = 10;
        this._weatherData = null;
        this._mprisPlayer = null;
        this._mprisPlaying = false;
        this._notifsExpanded = false;
        this._calendarEvents = [];
        this._calendarProxy = null;
        this._lastCpuTotal = 0;
        this._lastCpuIdle = 0;
        /* What the Performance and Battery panels read (see _refreshBatteryAndSystem). */
        this._sys = {cpu: 0, memFree: 0, memTotal: 0, uptime: '', load: ''};
        this._batteryDevices = [];
        this._mprisTitle = null;
        this._mprisArtist = null;
        this._mprisArtUrl = '';
        /* Track progress, kept as the reading plus the moment it was taken:
         * the panel draws a bar that has to move every second while the poll
         * below only asks MPRIS every 1.5, so it extrapolates from here. */
        this._mprisLength = 0;
        this._mprisPosition = 0;
        this._mprisPosTime = 0;
        this._mprisShuffle = false;
        this._mprisLoop = 'None';
        this._dead = false;

        try {
            this._ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        } catch (e) {
            this._ifaceSettings = null;
        }

        this._applyTransparentContainer(true);
        this._initCalendarProxy();
        this._buildUI();

        this._pan = null;
        this._loadPannelli();

        if (this._dateMenu?.menu?.box) {
            const box = this._dateMenu.menu.box;
            box.get_children().forEach(child => {
                if (child !== this._root && child.visible) {
                    child.visible = false;
                    this._hiddenChildren.push(child);
                }
            });
            box.add_child(this._root);
        }

        try {
            if (this._dateMenu?.menu?._boxPointer) {
                this._dateMenu.menu._boxPointer.setSourceAlignment(0.85);
            }
        } catch (e) {}

        if (this._dateMenu?.menu) {
            this._ids.push([this._dateMenu.menu, this._dateMenu.menu.connect('open-state-changed', (_m, open) => {
                if (open) {
                    this._applyTransparentContainer(true);
                    this._queryTodayEvents();
                    this._refresh();
                    this._updateLiquidGlass();
                    later(700, () => this._dumpGeometry());
                    this._startPolling();
                } else {
                    this._stopPolling();
                    /* Leave the drawer in its normal state: a panel left open
                     * would be rebuilt on the next open with stale data. */
                    try {
                        this._pan?.azzera();
                    } catch (e) {}
                }
            })]);
        }

        this._subs = [
            Gio.DBus.session.signal_subscribe(null, 'org.freedesktop.DBus.Properties',
                'PropertiesChanged', MPRIS_PATH, null, Gio.DBusSignalFlags.NONE,
                () => this._refreshMedia()),
            Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
                'NameOwnerChanged', null, null, Gio.DBusSignalFlags.NONE,
                () => later(200, () => this._refreshMedia())),
        ];

        this._fetchWeather();
        this._weatherPollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 900, () => {
            this._fetchWeather();
            return GLib.SOURCE_CONTINUE;
        });

        this._refresh();
        this._updateLiquidGlass();
    }

    disable() {
        // Anything already in flight (D-Bus replies, Soup requests, the poll)
        // must not touch the widgets after this point: writing to a destroyed
        // St actor logs "Object ... has been already disposed" on every tick.
        this._dead = true;
        this._stopPolling();

        try {
            this._pan?.azzera();
        } catch (e) {}
        this._pan = null;

        if (this._weatherPollId) {
            GLib.source_remove(this._weatherPollId);
            this._weatherPollId = 0;
        }

        if (this._soupSession) {
            try {
                this._soupSession.abort();
            } catch (e) {}
            this._soupSession = null;
        }

        for (const id of this._subs ?? []) {
            try {
                Gio.DBus.session.signal_unsubscribe(id);
            } catch (e) {}
        }
        this._subs = [];

        for (const [obj, id] of this._ids ?? []) {
            try {
                obj.disconnect(id);
            } catch (e) {}
        }
        this._ids = [];

        this._applyTransparentContainer(false);

        if (this._root) {
            try {
                this._dateMenu?.menu?.box?.remove_child(this._root);
                this._root.destroy();
            } catch (e) {}
            this._root = null;
        }

        for (const child of this._hiddenChildren ?? []) {
            try {
                child.visible = true;
            } catch (e) {}
        }
        this._hiddenChildren = [];

        this._dateMenu = null;
        this._calendarProxy = null;
    }

    /* False as soon as disable() runs (or before the drawer is built): every
     * asynchronous callback checks this before touching an actor. */
    _isAlive() {
        return !this._dead && !!this._root;
    }

    _applyTransparentContainer(enable) {
        const menu = this._dateMenu?.menu;
        if (!menu) return;
        const cls = 'mac-nc-datemenu';

        for (const actor of [menu.actor, menu.box, menu._boxPointer, menu._boxPointer?.bin]) {
            if (!actor) continue;
            if (enable)
                actor.add_style_class_name(cls);
            else
                actor.remove_style_class_name(cls);
        }
    }

    _updateLiquidGlass() {
        let lg = null;
        try {
            lg = Main.extensionManager?.lookup?.(LG_UUID)?.stateObj ?? null;
        } catch (e) {}
        const active = !!lg;

        for (const card of this._cards ?? []) {
            if (!card) continue;
            if (active)
                card.add_style_class_name('quick-toggle');
            else
                card.remove_style_class_name('quick-toggle');
        }
    }

    /* See DEBUG_FLAG at the top of the file. */
    _dumpGeometry() {
        if (!debugOn()) return;
        const info = a => {
            try {
                const [w, h] = a.get_transformed_size();
                let r = -1;
                try {
                    const node = a.get_theme_node();
                    r = node ? Math.round(node.get_border_radius(St.Corner.TOPLEFT)) : -1;
                } catch (e) {
                    r = -2;
                }
                const pod = a.has_style_class_name('quick-toggle') ? 'glass' : 'plain';
                return `${Math.round(w)}x${Math.round(h)} css-radius=${r} ${pod}`;
            } catch (e) {
                return `? (${e})`;
            }
        };
        try {
            const [w, h] = this._root ? this._root.get_transformed_size() : [0, 0];
            debug(`sidebar ${Math.round(w)}x${Math.round(h)} cards=${(this._cards ?? []).length}`);
        } catch (e) {}
        for (const card of this._cards ?? [])
            debug(`widget  ${card.get_style_class_name()}  ${info(card)}`);
        try {
            const kids = this._notifList ? this._notifList.get_children() : [];
            debug(`notifications=${kids.length}`);
            for (const k of kids)
                debug(`notif   ${k.get_style_class_name()}  ${info(k)}`);
        } catch (e) {}
        /* The calendar is the only card whose height depends on the month
         * (five or six week rows), so it is the one that can overflow. */
        try {
            if (this._calGrid) {
                const [gw, gh] = this._calGrid.get_transformed_size();
                debug(`calendar grid ${Math.round(gw)}x${Math.round(gh)} rows=${this._calGrid.get_n_children()}`);
            }
            const inner = this._calendarCard ? this._calendarCard.get_first_child() : null;
            if (inner) {
                const [iw, ih] = inner.get_transformed_size();
                debug(`calendar inner ${Math.round(iw)}x${Math.round(ih)}`);
            }
        } catch (e) {}

        /* Optional: walk through every panel in turn and let each one log its
         * own measurement. A second flag, so opening the drawer normally stays
         * quiet. */
        try {
            if (GLib.file_test(DEBUG_PANELS, GLib.FileTest.EXISTS))
                this._provaPannelli();
        } catch (e) {}
    }

    /* Debug only (DEBUG_PANELS): open each widget's panel in turn, 900ms apart,
     * and close it. Every builder is exercised — and measured — without anyone
     * having to click, which matters because the screenshot portal closes the
     * popup before it can be captured. */
    _provaPannelli() {
        if (!this._pan) {
            debug('pannelli: pannelli.js non caricato');
            return;
        }
        const prove = [
            ['weather', () => this._weatherCard],
            ['calendar', () => this._calendarCard],
            ['reminders', () => this._remindersCard],
            ['system', () => this._systemCard],
            ['music', () => this._musicCard],
            ['battery', () => this._batteryCard],
            ['worldclock', () => this._worldClockCard],
        ];
        let i = 0;
        const passo = () => {
            if (!this._isAlive())
                return;
            if (i >= prove.length) {
                debug('pannelli: prova finita');
                try {
                    this._pan.azzera();
                } catch (e) {}
                return;
            }
            const [chiave, prendi] = prove[i++];
            try {
                this._pan.azzera();
                this._pan.apri(chiave, prendi(), null);
            } catch (e) {
                debug(`pannelli: ${chiave} fallito (${e})`);
            }
            later(900, passo);
        };
        passo();
    }

    _initCalendarProxy() {
        try {
            const ProxyClass = Gio.DBusProxy.makeProxyWrapper(CALENDAR_SERVER_XML);
            new ProxyClass(
                Gio.DBus.session,
                'org.gnome.Shell.CalendarServer',
                '/org/gnome/Shell/CalendarServer',
                (proxy, error) => {
                    if (error) return;
                    this._calendarProxy = proxy;
                    this._calendarProxy.connectSignal('EventsAddedOrUpdated', (_p, _s, [events]) => {
                        this._calendarEvents = events || [];
                        this._refreshCalendar();
                    });
                    this._calendarProxy.connectSignal('EventsRemoved', () => {
                        this._refreshCalendar();
                    });
                    this._queryTodayEvents();
                }
            );
        } catch (e) {}
    }

    _queryTodayEvents() {
        if (!this._calendarProxy) return;
        try {
            const now = GLib.DateTime.new_now_local();
            const startOfDay = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0);
            const endOfDay = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 23, 59, 59);

            this._calendarProxy.SetTimeRangeRemote(
                startOfDay.to_unix(),
                endOfDay.to_unix(),
                true
            );
        } catch (e) {}
    }

    _refresh() {
        if (!this._isAlive()) return;
        this._refreshCalendar();
        this._refreshNotifications();
        this._refreshWorldClocks();
        this._refreshMedia();
        this._refreshWeatherUI();
        this._refreshBatteryAndSystem();
    }

    _startPolling() {
        if (this._pollId) return;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            try {
                if (!this._dateMenu?.menu?.isOpen) {
                    this._pollId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._updateLiveClocks();
                this._refreshMedia();
                this._refreshBatteryAndSystem();
                /* An open panel is a snapshot, so it is the panel's own job to
                 * say what has to be redrawn on every tick (cpu, battery,
                 * clock hands, track). */
                try {
                    this._pan?.aggiorna?.();
                } catch (e) {}
            } catch (e) {}
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    /* Build Entire UI Layout */
    /* ---------- widget detail panels (Fase 2) ----------
     * pannelli.js holds the panels. It is imported with a cache-busting query
     * on every enable, exactly as extension.js imports nc.js, so editing the
     * panels needs a disable/enable and never a login. */
    _helperPannelli() {
        return {
            t,
            icon,
            symbol,
            anim: animazione(),
            launch,
            later,
            cards: () => this._cards ?? [],
            weather: () => this._weatherData,
            iconOf: code => this._getWeatherIconAndName(code),
            cities: () => CITY_LIST,
            events: () => this._calendarEvents ?? [],
            system: () => this._sys,
            battery: () => this._batteryDevices ?? [],
            music: () => ({
                hasPlayer: !!this._mprisPlayer,
                playing: !!this._mprisPlaying,
                title: this._mprisTitle,
                artist: this._mprisArtist,
                artUrl: this._mprisArtUrl,
                /* Microseconds, straight from MPRIS. */
                length: this._mprisLength,
                position: this._mprisPosition,
                posTime: this._mprisPosTime,
                /* The state of the shuffle and of the repeat. */
                shuffle: !!this._mprisShuffle,
                loop: this._mprisLoop || 'None',
            }),
            mp: {
                play: () => this._mprisCmd('PlayPause', true),
                next: () => this._mprisCmd('Next', false),
                prev: () => this._mprisCmd('Previous', false),
                shuffle: () => this._mprisShuffle(!this._mprisShuffle),
                repeat: () => this._mprisRepeat(),
            },
            /* The album art as a local path: a remote cover is downloaded and
             * cached, because St cannot load an http image by itself. */
            art: (url, cb) => this._artPath(url, cb),
            lgOverride: LG_OVERRIDE,
            log: msg => debug(msg),
        };
    }

    _loadPannelli() {
        try {
            const uri = Gio.File.new_for_path(
                GLib.build_filenamev([this._path, 'pannelli.js'])).get_uri();
            import(`${uri}?v=${Date.now()}`).then(mod => {
                if (this._dead)
                    return;
                this._pan = mod.crea(this, this._helperPannelli());
            }).catch(e => console.warn(`macos-nc: pannelli.js could not be loaded: ${e}`));
        } catch (e) {
            console.warn(`macos-nc: pannelli.js could not be loaded: ${e}`);
        }
    }

    /* Hand a widget pod to pannelli.js: the panel opens inside the card's own
     * glass, and the pod is the anchor. `bersaglio` lets a card that holds
     * live controls (the music card's play button) open from its header only,
     * so the controls keep their own clicks.
     *
     * Clutter.ClickAction is gone in Clutter 51; ClickGesture is what St.Button
     * itself uses. The handler claims the sequence by returning true, which is
     * also what keeps a click on an inner button from reaching the card.
     *
     * A pod that is itself a button (the calendar) already has a gesture of its
     * own, and two gestures on the same actor cancel each other: there the
     * button's own `clicked` signal is used instead. */
    _pannello(card, chiave, bersaglio) {
        if (!card)
            return;
        try {
            if (card instanceof St.Button) {
                /* The pod *is* a button: instead of adding a second gesture (the
                 * button's own would cancel it), its `clicked` signal is used —
                 * and "disarming" it while its panel is open is switching
                 * `reactive` off, which is the same contract the gesture path
                 * gets through `gesto.enabled`. Inner buttons keep their own
                 * clicks: they are separate reactive actors. */
                const interruttore = {
                    get enabled() {
                        return card.reactive;
                    },
                    set enabled(v) {
                        card.reactive = v;
                    },
                };
                card.connect('clicked', () => {
                    if (!card.reactive || !this._pan)
                        return;
                    try {
                        this._pan.apri(chiave, card, interruttore);
                    } catch (e) {
                        console.warn(`macos-nc: panel ${chiave}: ${e}`);
                    }
                });
                return;
            }
            const gesto = new Clutter.ClickGesture();
            /* More than one target is allowed: the music pod is opened from
             * its header and from the cover, so the panel is easy to reach. */
            const bersagli = Array.isArray(bersaglio) ? bersaglio.filter(x => x) : [bersaglio || card];
            for (const b of bersagli)
                b.add_action(gesto);
            gesto.connect('recognize', () => {
                if (!this._pan)
                    return true;
                try {
                    this._pan.apri(chiave, card, gesto);
                } catch (e) {
                    console.warn(`macos-nc: panel ${chiave}: ${e}`);
                }
                return true;
            });
        } catch (e) {
            console.warn(`macos-nc: panel ${chiave} not wired: ${e}`);
        }
    }

    _buildUI() {
        this._cards = [];

        this._root = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-sidebar',
            reactive: true,
            x_expand: true,
        });

        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: 'mac-nc-scroll',
            x_expand: true,
            y_expand: true,
        });

        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-content',
            x_expand: true,
        });

        // 1. Notifications Section
        this._notifSection = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-section',
            x_expand: true,
        });

        const notifHeader = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-notif-header',
            x_expand: true,
        });
        this._notifTitle = new St.Label({
            text: `${t('NOTIFICATIONS')} (0)`,
            style_class: 'mac-nc-section-title',
            x_expand: true,
        });
        notifHeader.add_child(this._notifTitle);

        this._expandBtn = new St.Button({
            label: t('EXPAND'),
            style_class: 'mac-nc-clear-btn',
            can_focus: true,
            visible: false,
        });
        this._expandBtn.connect('clicked', () => {
            this._notifsExpanded = !this._notifsExpanded;
            this._expandBtn.label = this._notifsExpanded ? t('COLLAPSE') : t('EXPAND');
            this._refreshNotifications();
        });
        notifHeader.add_child(this._expandBtn);

        this._clearBtn = new St.Button({
            label: t('CLEAR_ALL'),
            style_class: 'mac-nc-clear-btn',
            can_focus: true,
            visible: false,
        });
        this._clearBtn.connect('clicked', () => this._clearAllNotifications());
        notifHeader.add_child(this._clearBtn);

        this._notifSection.add_child(notifHeader);

        this._notifList = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-section',
            x_expand: true,
        });
        this._notifSection.add_child(this._notifList);
        content.add_child(this._notifSection);

        // Section Title: Widgets
        const widgetHeaderBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-section-header',
            x_expand: true,
        });
        widgetHeaderBox.add_child(new St.Label({
            text: t('WIDGETS'),
            style_class: 'mac-nc-section-title',
            x_expand: true,
        }));
        content.add_child(widgetHeaderBox);

        // 2. Widgets Grid Section
        const widgetsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-widgets',
            x_expand: true,
        });

        // Row 1: Real Month Calendar (Square) + Tasks (Square)
        const row1 = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-row',
            x_expand: true,
        });
        this._calendarCard = this._buildCalendarCard();
        this._remindersCard = this._buildRemindersCard();
        this._cards.push(this._calendarCard, this._remindersCard);
        row1.add_child(this._calendarCard);
        row1.add_child(this._remindersCard);
        widgetsBox.add_child(row1);
        this._pannello(this._calendarCard, 'calendar');
        this._pannello(this._remindersCard, 'reminders');

        // Row 2: Performance (Wide Card)
        this._systemCard = this._buildSystemActivityCard();
        this._cards.push(this._systemCard);
        widgetsBox.add_child(this._systemCard);
        this._pannello(this._systemCard, 'system');

        // Row 3: Weather (Wide Card)
        this._weatherCard = this._buildWeatherCard();
        this._cards.push(this._weatherCard);
        widgetsBox.add_child(this._weatherCard);
        this._pannello(this._weatherCard, 'weather');

        // Row 4: Music (Square) + Real Battery (Square)
        const row4 = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-row',
            x_expand: true,
        });
        this._musicCard = this._buildMusicCard();
        this._batteryCard = this._buildBatteryCard();
        this._cards.push(this._musicCard, this._batteryCard);
        row4.add_child(this._musicCard);
        row4.add_child(this._batteryCard);
        widgetsBox.add_child(row4);
        /* The music pod opens from its header, from the cover and from the
         * name: the transport has its own clicks and a gesture on the whole
         * card would swallow them. */
        this._pannello(this._musicCard, 'music', [this._musicHeader, this._musicArt, this._musicArea]);
        this._pannello(this._batteryCard, 'battery');

        // Row 5: World Clock (Wide Card)
        this._worldClockCard = this._buildWorldClockCard();
        this._cards.push(this._worldClockCard);
        widgetsBox.add_child(this._worldClockCard);
        this._pannello(this._worldClockCard, 'worldclock');

        content.add_child(widgetsBox);
        scroll.set_child(content);
        this._root.add_child(scroll);
    }

    /* 1. Notifications UI */
    _refreshNotifications() {
        if (!this._isAlive()) return;
        if (!this._notifList) return;
        this._notifList.destroy_all_children();

        const notifModel = Main.panel.statusArea.dateMenu?._messageList?._notificationSection?._model
            || Main.messageTray?._notificationQueue;
        let notifs = [];

        try {
            if (notifModel?.get_n_items) {
                const count = notifModel.get_n_items();
                for (let i = 0; i < count; i++) {
                    const item = notifModel.get_item(i);
                    if (item) notifs.push(item);
                }
            } else if (Main.panel.statusArea.dateMenu?._messageList?._notificationSection?._messages) {
                notifs = Main.panel.statusArea.dateMenu._messageList._notificationSection._messages;
            }
        } catch (e) {}

        const total = notifs.length;
        this._notifTitle.text = `${t('NOTIFICATIONS')} (${total})`;
        this._clearBtn.visible = (total > 0);

        if (total === 0) {
            this._expandBtn.visible = false;
            const emptyCard = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'mac-nc-card mac-nc-empty-card',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            emptyCard.add_child(icon('nc:messages', 'mac-nc-empty-icon', 16));
            emptyCard.add_child(new St.Label({
                text: t('NO_NOTIFICATIONS'),
                style_class: 'mac-nc-empty-notif',
            }));
            this._notifList.add_child(emptyCard);
            return;
        }

        const maxVisible = this._notifsExpanded ? total : Math.min(3, total);
        this._expandBtn.visible = (total > 3);

        for (let i = 0; i < maxVisible; i++) {
            const notif = notifs[i];
            const card = this._buildNotificationCard(notif);
            this._notifList.add_child(card);
        }

        if (!this._notifsExpanded && total > 3) {
            const remaining = total - 3;
            const moreBtn = new St.Button({
                style_class: 'mac-nc-more-notifs-btn',
                can_focus: true,
                reactive: true,
                x_expand: true,
            });
            const moreBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.CENTER,
            });
            moreBox.add_child(new St.Label({
                text: t('MORE_NOTIFS', remaining),
                style_class: 'mac-nc-more-label',
            }));
            moreBtn.set_child(moreBox);
            moreBtn.connect('clicked', () => {
                this._notifsExpanded = true;
                this._expandBtn.label = t('COLLAPSE');
                this._refreshNotifications();
            });
            this._notifList.add_child(moreBtn);
        }
    }

    _buildNotificationCard(notification) {
        const card = new St.Button({
            style_class: 'mac-nc-card mac-nc-notif-card',
            can_focus: true,
            reactive: true,
            x_expand: true,
        });

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        const topRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-notif-top',
            x_expand: true,
        });

        let gicon = notification.gicon || notification.icon;
        if (!gicon && notification.source?.icon) gicon = notification.source.icon;

        const appIcon = new St.Icon({
            gicon: gicon || Gio.ThemedIcon.new_with_default_fallbacks('dialog-information-symbolic'),
            style_class: 'mac-nc-notif-icon',
            icon_size: 16,
        });
        topRow.add_child(appIcon);

        const appTitle = notification.source?.title || notification.source?.name || 'Sistema';
        const appLabel = new St.Label({
            text: appTitle,
            style_class: 'mac-nc-notif-app',
            x_expand: true,
        });
        topRow.add_child(appLabel);

        const timeLabel = new St.Label({
            text: t('NOW'),
            style_class: 'mac-nc-notif-time',
        });
        topRow.add_child(timeLabel);

        const closeBtn = new St.Button({
            style_class: 'mac-nc-notif-close',
            can_focus: true,
            reactive: true,
        });
        closeBtn.set_child(icon('window-close-symbolic', 'mac-nc-mini-icon', 10));
        closeBtn.connect('clicked', () => {
            try {
                if (typeof notification.destroy === 'function') notification.destroy();
                else if (typeof notification.close === 'function') notification.close();
            } catch (e) {}
            this._refreshNotifications();
        });
        topRow.add_child(closeBtn);
        box.add_child(topRow);

        const titleText = notification.title || notification.summary || '';
        if (titleText) {
            const title = new St.Label({
                text: titleText,
                style_class: 'mac-nc-notif-title',
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(title);
        }

        const bodyText = notification.bannerBodyText || notification.body || '';
        if (bodyText) {
            const body = new St.Label({
                text: bodyText,
                style_class: 'mac-nc-notif-body',
            });
            body.clutter_text.line_wrap = true;
            body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(body);
        }

        card.set_child(box);
        card.connect('clicked', () => {
            try {
                notification.activate();
            } catch (e) {}
            this._dateMenu?.menu?.close();
        });
        return card;
    }

    _clearAllNotifications() {
        try {
            const notifSection = Main.panel.statusArea.dateMenu?._messageList?._notificationSection;
            if (notifSection?.clear) notifSection.clear();
            else if (notifSection?._model?.clear) notifSection._model.clear();
        } catch (e) {}
        this._refreshNotifications();
    }

    /* 2. Calendar Widget (Real Interactive Month Grid) */
    _buildCalendarCard() {
        const card = new St.Button({
            style_class: 'mac-nc-card mac-nc-square mac-nc-calendar-card',
            can_focus: true,
            reactive: true,
            x_expand: true,
        });

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-card-inner',
            x_expand: true,
            y_expand: true,
        });

        this._calMonthHeader = new St.Label({
            text: 'OCTUBRE 2026',
            style_class: 'mac-nc-cal-month-title',
        });
        box.add_child(this._calMonthHeader);

        // Day of week labels (L M X J V S D)
        const headerRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-cal-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        const dayHeaders = t('CAL_DAYS');
        for (const h of dayHeaders) {
            headerRow.add_child(new St.Label({
                text: h,
                style_class: 'mac-nc-cal-header-day',
            }));
        }
        box.add_child(headerRow);

        // Month Grid Container
        this._calGrid = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-cal-grid',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._calGrid);

        this._calEventText = new St.Label({
            text: t('NO_EVENTS'),
            style_class: 'mac-nc-cal-event',
        });
        this._calEventText.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._calEventText);

        card.set_child(box);
        /* A click opens this card's own panel (Fase 2): launching GNOME Calendar
         * moved inside it, so the widget behaves like every other one. */
        return card;
    }

    _refreshCalendar() {
        if (!this._isAlive()) return;
        const now = GLib.DateTime.new_now_local();
        const year = now.get_year();
        const month = now.get_month(); // 1-12
        const todayDay = now.get_day_of_month();

        if (this._calMonthHeader) {
            const monthName = now.format('%B %Y') || 'CALENDARIO';
            this._calMonthHeader.text = monthName.toUpperCase();
        }

        if (this._calGrid) {
            this._calGrid.destroy_all_children();

            const firstDay = new Date(year, month - 1, 1).getDay(); // 0 is Sun
            const startCol = (firstDay + 6) % 7; // Mon is 0
            const daysInMonth = new Date(year, month, 0).getDate();
            const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

            let rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'mac-nc-cal-row',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });

            // Prev month trailing
            for (let i = startCol - 1; i >= 0; i--) {
                const cell = new St.Bin({style_class: 'mac-nc-cal-cell'});
                cell.set_child(new St.Label({
                    text: String(daysInPrevMonth - i),
                    style_class: 'mac-nc-cal-day-label mac-nc-cal-other-month',
                }));
                rowBox.add_child(cell);
            }

            // Current month days
            for (let d = 1; d <= daysInMonth; d++) {
                const isToday = (d === todayDay);
                const cell = new St.Bin({style_class: 'mac-nc-cal-cell'});

                if (isToday) {
                    const bubble = new St.Bin({
                        style_class: 'mac-nc-cal-today-bubble',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    bubble.set_child(new St.Label({
                        text: String(d),
                        style_class: 'mac-nc-cal-day-label',
                    }));
                    cell.set_child(bubble);
                } else {
                    cell.set_child(new St.Label({
                        text: String(d),
                        style_class: 'mac-nc-cal-day-label',
                    }));
                }

                rowBox.add_child(cell);

                if (rowBox.get_n_children() === 7) {
                    this._calGrid.add_child(rowBox);
                    rowBox = new St.BoxLayout({
                        orientation: Clutter.Orientation.HORIZONTAL,
                        style_class: 'mac-nc-cal-row',
                        x_expand: true,
                        x_align: Clutter.ActorAlign.CENTER,
                    });
                }
            }

            // Next month leading
            let nextD = 1;
            while (rowBox.get_n_children() > 0 && rowBox.get_n_children() < 7) {
                const cell = new St.Bin({style_class: 'mac-nc-cal-cell'});
                cell.set_child(new St.Label({
                    text: String(nextD++),
                    style_class: 'mac-nc-cal-day-label mac-nc-cal-other-month',
                }));
                rowBox.add_child(cell);
            }
            if (rowBox.get_n_children() > 0) {
                this._calGrid.add_child(rowBox);
            }
        }

        if (this._calEventText) {
            if (this._calendarEvents && this._calendarEvents.length > 0) {
                const first = this._calendarEvents[0];
                const summary = first[1] || t('SCHEDULED');
                this._calEventText.text = summary;
            } else {
                this._calEventText.text = t('NO_EVENTS');
            }
        }
    }

    /* 3. Tasks Widget (Square) */
    _buildRemindersCard() {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-card mac-nc-square mac-nc-reminders-card',
            reactive: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-card-header',
        });
        header.add_child(icon('object-select-symbolic', 'mac-nc-reminders-icon-bg', 12));
        header.add_child(new St.Label({
            text: t('TASKS'),
            style_class: 'mac-nc-card-title',
        }));
        card.add_child(header);

        const spacer = new St.Widget({y_expand: true});
        card.add_child(spacer);

        const list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-reminders-list',
        });

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-card-header',
        });
        row.add_child(icon('emblem-ok-symbolic', 'mac-nc-check-icon', 14));
        row.add_child(new St.Label({
            text: t('ALL_DONE'),
            style_class: 'mac-nc-reminders-status',
        }));
        list.add_child(row);

        list.add_child(new St.Label({
            text: t('NO_TASKS'),
            style_class: 'mac-nc-reminders-sub',
        }));
        card.add_child(list);
        return card;
    }

    /* 4. Performance Widget (Wide Card) */
    _buildSystemActivityCard() {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-card mac-nc-wide mac-nc-stocks-card',
            reactive: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-card-header',
            x_expand: true,
        });
        header.add_child(icon('utilities-system-monitor-symbolic', 'mac-nc-stocks-icon', 14));
        header.add_child(new St.Label({
            text: t('PERFORMANCE'),
            style_class: 'mac-nc-card-title',
            x_expand: true,
        }));
        header.add_child(new St.Label({
            text: t('OPTIMAL'),
            style_class: 'mac-nc-stocks-status',
        }));
        card.add_child(header);

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-stocks-row',
            x_expand: true,
        });

        // CPU
        const cpuCol = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mac-nc-stock-col', x_expand: true});
        cpuCol.add_child(new St.Label({text: t('CPU'), style_class: 'mac-nc-stock-sym'}));
        this._cpuVal = new St.Label({text: '12%', style_class: 'mac-nc-stock-price'});
        cpuCol.add_child(this._cpuVal);
        cpuCol.add_child(new St.Label({text: 'Normal', style_class: 'mac-nc-stock-delta positive'}));
        row.add_child(cpuCol);

        // Memory
        const memCol = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mac-nc-stock-col', x_expand: true});
        memCol.add_child(new St.Label({text: t('MEMORY'), style_class: 'mac-nc-stock-sym'}));
        this._memVal = new St.Label({text: '4.2 GB', style_class: 'mac-nc-stock-price'});
        memCol.add_child(this._memVal);
        memCol.add_child(new St.Label({text: t('FREE'), style_class: 'mac-nc-stock-delta positive'}));
        row.add_child(memCol);

        // Uptime
        const upCol = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'mac-nc-stock-col', x_expand: true});
        upCol.add_child(new St.Label({text: t('UPTIME'), style_class: 'mac-nc-stock-sym'}));
        this._uptimeVal = new St.Label({text: '2h 15m', style_class: 'mac-nc-stock-price'});
        upCol.add_child(this._uptimeVal);
        upCol.add_child(new St.Label({text: 'Pulsar OS', style_class: 'mac-nc-stock-delta positive'}));
        row.add_child(upCol);

        card.add_child(row);
        return card;
    }

    /* Reads what the Performance and Battery panels show. The values are kept
     * on the instance (`_sys`) instead of only being written into the card's
     * labels: the panels are snapshots that also refresh while open. */
    _refreshBatteryAndSystem() {
        if (!this._isAlive()) return;
        // Read CPU (the difference between two samples: the first of a session
        // has nothing to compare against and is skipped)
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/stat');
            if (ok) {
                const line = new TextDecoder().decode(contents).split('\n')[0];
                const parts = line.split(/\s+/).slice(1).map(Number);
                const idle = parts[3] + (parts[4] || 0);
                const total = parts.reduce((a, b) => a + b, 0);

                if (this._lastCpuTotal > 0) {
                    const diffTotal = total - this._lastCpuTotal;
                    const diffIdle = idle - this._lastCpuIdle;
                    if (diffTotal > 0) {
                        const usage = Math.round(100 * (1 - diffIdle / diffTotal));
                        this._sys.cpu = usage;
                        if (this._cpuVal) this._cpuVal.text = `${usage}%`;
                    }
                }
                this._lastCpuTotal = total;
                this._lastCpuIdle = idle;
            }
        } catch (e) {}

        // Read Memory: free and total, so the panel can show "used of total"
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/meminfo');
            if (ok) {
                const text = new TextDecoder().decode(contents);
                const availMatch = text.match(/MemAvailable:\s+(\d+)\s+kB/);
                const totalMatch = text.match(/MemTotal:\s+(\d+)\s+kB/);
                const toGb = v => parseInt(v, 10) / (1024 * 1024);
                if (availMatch) {
                    this._sys.memFree = toGb(availMatch[1]);
                    if (this._memVal) this._memVal.text = `${this._sys.memFree.toFixed(1)} GB`;
                }
                if (totalMatch) this._sys.memTotal = toGb(totalMatch[1]);
            }
        } catch (e) {}

        // Read Uptime
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/uptime');
            if (ok) {
                const seconds = Math.floor(parseFloat(new TextDecoder().decode(contents).split(' ')[0]));
                const hours = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                this._sys.uptime = `${hours}h ${mins}m`;
                if (this._uptimeVal) this._uptimeVal.text = this._sys.uptime;
            }
        } catch (e) {}

        // Load average: the three standard samples (1, 5 and 15 minutes)
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/loadavg');
            if (ok) {
                const p = new TextDecoder().decode(contents).trim().split(/\s+/);
                this._sys.load = `${p[0]}  ${p[1]}  ${p[2]}`;
            }
        } catch (e) {}

        this._queryBatteryDevices();
    }

    _queryBatteryDevices() {
        try {
            Gio.DBus.system.call('org.freedesktop.UPower', '/org/freedesktop/UPower',
                'org.freedesktop.UPower', 'EnumerateDevices', null,
                GLib.VariantType.new('(ao)'), NONE, -1, null, (conn, res) => {
                    try {
                        const paths = conn.call_finish(res).deepUnpack()[0];
                        const devices = [];

                        let pending = paths.length;
                        if (pending === 0) {
                            this._updateBatteryUI(devices);
                            return;
                        }

                        for (const path of paths) {
                            conn.call('org.freedesktop.UPower', path,
                                'org.freedesktop.DBus.Properties', 'GetAll',
                                GLib.Variant.new('(s)', ['org.freedesktop.UPower.Device']),
                                GLib.VariantType.new('(a{sv})'), NONE, -1, null, (c, r) => {
                                    pending--;
                                    try {
                                        const props = c.call_finish(r).deepUnpack()[0];
                                        const type = props['Type']?.deepUnpack() ?? 0;
                                        const percentage = Math.round(props['Percentage']?.deepUnpack() ?? 0);
                                        const state = props['State']?.deepUnpack() ?? 0;
                                        const model = props['Model']?.deepUnpack() ?? '';
                                        const isPresent = props['IsPresent']?.deepUnpack() ?? true;

                                        if (isPresent && (type === 2 || type === 5 || type === 6 || type === 9)) {
                                            let iconName = 'battery-good-symbolic';
                                            let name = model || t('BATTERY');
                                            if (type === 5) { iconName = 'input-mouse-symbolic'; name = model || 'Mouse'; }
                                            else if (type === 6) { iconName = 'input-keyboard-symbolic'; name = model || 'Keyboard'; }
                                            else if (type === 9) { iconName = 'audio-headphones-symbolic'; name = model || 'Headset'; }
                                            else if (state === 1) { iconName = 'battery-good-charging-symbolic'; }

                                            devices.push({name, percentage, iconName, state, type});
                                        }
                                    } catch (e) {}

                                    if (pending === 0) {
                                        this._updateBatteryUI(devices);
                                    }
                                });
                        }
                    } catch (e) {
                        this._updateBatteryUI([]);
                    }
                });
        } catch (e) {
            this._updateBatteryUI([]);
        }
    }

    _updateBatteryUI(devices) {
        if (!this._isAlive()) return;
        /* Kept for the battery panel; the card is rebuilt from the same list. */
        this._batteryDevices = devices;
        if (!this._batteryList) return;
        this._batteryList.destroy_all_children();

        if (devices.length === 0) {
            const row = new St.BoxLayout({orientation: Clutter.Orientation.HORIZONTAL, style_class: 'mac-nc-battery-row', x_expand: true});
            row.add_child(icon('ac-adapter-symbolic', 'mac-nc-device-icon', 14));
            row.add_child(new St.Label({text: 'Alimentación CA', style_class: 'mac-nc-device-name', x_expand: true}));
            row.add_child(new St.Label({text: '100%', style_class: 'mac-nc-device-level'}));
            this._batteryList.add_child(row);
            return;
        }

        for (const dev of devices) {
            const row = new St.BoxLayout({orientation: Clutter.Orientation.HORIZONTAL, style_class: 'mac-nc-battery-row', x_expand: true});
            row.add_child(icon(dev.iconName, 'mac-nc-device-icon', 14));
            const devLabel = new St.Label({text: dev.name, style_class: 'mac-nc-device-name', x_expand: true});
            devLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(devLabel);
            row.add_child(new St.Label({text: `${dev.percentage}%`, style_class: 'mac-nc-device-level'}));
            this._batteryList.add_child(row);
        }
    }

    /* 5. Weather Widget (Wide Card) */
    _buildWeatherCard() {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-card mac-nc-wide mac-nc-weather-card',
            reactive: true,
            x_expand: true,
        });

        const topRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });

        const cityBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._weatherCity = new St.Label({text: 'A Coruña', style_class: 'mac-nc-weather-city'});
        this._weatherCond = new St.Label({text: `${t('CLEAR_SKY')} • ${t('UPDATED')}`, style_class: 'mac-nc-weather-condition'});
        cityBox.add_child(this._weatherCity);
        cityBox.add_child(this._weatherCond);
        topRow.add_child(cityBox);

        this._weatherTemp = new St.Label({text: '19°', style_class: 'mac-nc-weather-temp'});
        topRow.add_child(this._weatherTemp);

        this._weatherIcon = icon('weather-clear-symbolic', 'mac-nc-weather-big-icon', 28);
        topRow.add_child(this._weatherIcon);
        card.add_child(topRow);

        this._forecastRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-weather-forecast-row',
            x_expand: true,
        });
        card.add_child(this._forecastRow);
        return card;
    }

    _getConfiguredLocation() {
        let name = 'A Coruña';
        let lat = 43.36;
        let lon = -8.41;

        try {
            const settings = new Gio.Settings({schema_id: 'org.gnome.Weather'});
            const locs = settings.get_value('locations').deepUnpack();
            if (locs && locs.length > 0) {
                const locTuple = locs[0];
                const inner = locTuple[1];
                if (inner && inner[0]) {
                    name = inner[0];
                    const coords = inner[3];
                    if (coords && coords.length > 0) {
                        lat = (coords[0][0] * 180 / Math.PI);
                        lon = (coords[0][1] * 180 / Math.PI);
                    }
                }
            }
        } catch (e) {
            try {
                const s2 = new Gio.Settings({schema_id: 'org.gnome.shell.weather'});
                const locs = s2.get_value('locations').deepUnpack();
                if (locs && locs.length > 0) {
                    const inner = locs[0][1];
                    if (inner && inner[0]) {
                        name = inner[0];
                        const coords = inner[3];
                        if (coords && coords.length > 0) {
                            lat = (coords[0][0] * 180 / Math.PI);
                            lon = (coords[0][1] * 180 / Math.PI);
                        }
                    }
                }
            } catch (e2) {}
        }
        return {name, lat: lat.toFixed(2), lon: lon.toFixed(2)};
    }

    _fetchWeather() {
        if (!this._soupSession) return;
        const loc = this._getConfiguredLocation();
        /* `daily` + 10 days feeds the weather widget's detail panel (the card
         * itself only shows the next few hours). One request, one payload: the
         * hourly part is still there for the card's strip. */
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=10&timezone=auto`;

        const msg = Soup.Message.new('GET', url);
        this._soupSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (_s, res) => {
            try {
                const bytes = this._soupSession.send_and_read_finish(res);
                if (msg.get_status() === 200 && bytes) {
                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    data.cityName = loc.name;
                    this._weatherData = data;
                    this._refreshWeatherUI();
                }
            } catch (e) {}
        });
    }

    _getWeatherIconAndName(code) {
        if (code === 0) return {icon: 'weather-clear-symbolic', name: t('CLEAR_SKY')};
        if (code >= 1 && code <= 3) return {icon: 'weather-few-clouds-symbolic', name: t('FEW_CLOUDS')};
        if (code >= 45 && code <= 48) return {icon: 'weather-fog-symbolic', name: t('FOG')};
        if (code >= 51 && code <= 67) return {icon: 'weather-showers-symbolic', name: t('RAIN')};
        if (code >= 71 && code <= 77) return {icon: 'weather-snow-symbolic', name: t('SNOW')};
        if (code >= 80 && code <= 82) return {icon: 'weather-showers-symbolic', name: t('RAIN')};
        if (code >= 95) return {icon: 'weather-storm-symbolic', name: t('THUNDERSTORM')};
        return {icon: 'weather-overcast-symbolic', name: t('CLOUDY')};
    }

    _refreshWeatherUI() {
        if (!this._isAlive()) return;
        if (!this._weatherData || !this._weatherCity) return;
        const current = this._weatherData.current;
        const cityName = this._weatherData.cityName || 'A Coruña';
        const code = current.weather_code ?? 0;
        const info = this._getWeatherIconAndName(code);

        this._weatherCity.text = cityName;
        this._weatherCond.text = `${info.name} • ${t('UPDATED')}`;
        this._weatherTemp.text = `${Math.round(current.temperature_2m)}°`;
        this._weatherIcon.icon_name = info.icon;

        if (this._forecastRow && this._weatherData.hourly) {
            this._forecastRow.destroy_all_children();
            const hourly = this._weatherData.hourly;
            const nowHour = new Date().getHours();
            const offsets = [0, 2, 4, 6, 8];

            for (const offset of offsets) {
                const targetHour = (nowHour + offset) % 24;
                const temp = Math.round(hourly.temperature_2m[targetHour] || current.temperature_2m);
                const hCode = hourly.weather_code[targetHour] || 0;
                const hInfo = this._getWeatherIconAndName(hCode);

                const pill = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    style_class: 'mac-nc-forecast-pill',
                    x_expand: true,
                });
                pill.add_child(new St.Label({
                    text: offset === 0 ? t('NOW') : `+${offset}h`,
                    style_class: 'mac-nc-forecast-time',
                }));
                pill.add_child(icon(hInfo.icon, 'mac-nc-forecast-icon', 14));
                pill.add_child(new St.Label({
                    text: `${temp}°`,
                    style_class: 'mac-nc-forecast-temp',
                }));
                this._forecastRow.add_child(pill);
            }
        }
    }

    /* 6. Music Widget (Square) with Real Cover Art
     *
     * The disposition is the one of the Control Centre's media tile: the
     * artwork in the top-left corner, the title and the artist under it, and
     * the transport as a row of three plain glyphs centred in the width of the
     * pod (two elastic spacers split the leftover space in half). The glyphs
     * are the Apple's ones the Control Centre uses as well.
     *
     * The panel of this pod opens from its header only: the transport has its
     * own clicks, and a gesture on the whole card would swallow them. */
    _buildMusicCard() {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-card mac-nc-square mac-nc-podcasts-card',
            reactive: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-card-header',
            reactive: true,
        });
        header.add_child(icon('audio-x-generic-symbolic', 'mac-nc-mini-white', 12));
        header.add_child(new St.Label({
            text: t('MUSIC'),
            style_class: 'mac-nc-card-title-white',
        }));
        card.add_child(header);
        this._musicHeader = header;

        /* The artwork is the BACKGROUND of the box, not an icon inside it:
         * that is the only way St crops it with the rounded corners and keeps
         * it centred when the album art is not square. The Liquid Glass
         * override keeps the extension from wiping that background. */
        this._musicArt = new St.Widget({
            style_class: 'mac-nc-music-art',
            style: LG_OVERRIDE,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        this._musicTitle = new St.Label({
            text: 'Pulsar Music',
            style_class: 'mac-nc-music-title',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._musicTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._musicArtist = new St.Label({
            text: t('NO_MEDIA'),
            style_class: 'mac-nc-music-artist',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._musicArtist.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        /* The cover and the name are one block, and that whole block opens the
         * panel: it is the easy target the pod was missing. */
        const area = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-music-area',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        area.add_child(this._musicArt);
        area.add_child(this._musicTitle);
        area.add_child(this._musicArtist);
        card.add_child(area);
        this._musicArea = area;

        const comandi = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-music-controls',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.END,
        });
        const spazio = () => new St.Widget({x_expand: true});
        const trasporto = (nomeIcona, etichetta, classe, metodo) => {
            const b = new St.Button({
                style_class: 'mac-nc-music-btn',
                can_focus: true,
                reactive: true,
                child: icon(nomeIcona, classe, 16),
            });
            try {
                b.set_accessible_name(String(etichetta));
            } catch (e) {}
            b.connect('clicked', () => this._mprisCmd(metodo, false));
            return b;
        };
        this._musicPrev = trasporto('nc:rewind', t('PANEL_PREVIOUS'), 'mac-nc-music-icon', 'Previous');
        this._musicNext = trasporto('nc:forward', t('PANEL_NEXT'), 'mac-nc-music-icon', 'Next');
        this._playBtn = new St.Button({
            style_class: 'mac-nc-music-btn',
            can_focus: true,
            reactive: true,
        });
        this._playIcon = icon('nc:play', 'mac-nc-music-play-icon', 18);
        this._playBtn.set_child(this._playIcon);
        this._playBtn.connect('clicked', () => this._togglePlayback());
        comandi.add_child(spazio());
        comandi.add_child(this._musicPrev);
        comandi.add_child(this._playBtn);
        comandi.add_child(this._musicNext);
        comandi.add_child(spazio());
        card.add_child(comandi);

        return card;
    }

    /* The album art, as a local path.
     *
     * A remote cover (some players hand out an http URL) is downloaded once
     * and cached: St cannot load an http image by itself. The Control Centre
     * does exactly the same, so both read the same file when they can. */
    _artPath(url, cb) {
        if (!url) {
            cb(null);
            return;
        }
        if (url.startsWith('file://')) {
            cb(decodeURIComponent(url.slice(7)));
            return;
        }
        if (!url.startsWith('http')) {
            cb(null);
            return;
        }
        const somma = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
        const cache = GLib.build_filenamev([GLib.get_user_cache_dir(), `macos-nc-art-${somma}.jpg`]);
        if (GLib.file_test(cache, GLib.FileTest.EXISTS)) {
            cb(cache);
            return;
        }
        try {
            const session = new Soup.Session();
            const msg = Soup.Message.new('GET', url);
            session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                try {
                    const bytes = sess.send_and_read_finish(res);
                    if (msg.get_status() !== Soup.Status.OK) {
                        cb(null);
                        return;
                    }
                    GLib.file_set_contents(cache, bytes.get_data());
                    cb(cache);
                } catch (e) {
                    cb(null);
                }
            });
        } catch (e) {
            cb(null);
        }
    }

    /* Paint the artwork of the closed pod. */
    _setMusicArt(url) {
        const box = this._musicArt;
        if (!box)
            return;
        if (!url) {
            try {
                box.set_style(LG_OVERRIDE);
            } catch (e) {}
            return;
        }
        this._artPath(url, path => {
            if (!path || !this._isAlive() || this._mprisArtUrl !== url)
                return;
            try {
                box.set_style(`${LG_OVERRIDE} background-image: url("file://${path}"); background-size: cover;`);
            } catch (e) {}
        });
    }

    _refreshMedia() {
        if (!this._isAlive()) return;
        findPlayer(busName => {
            // The callback may land after disable() destroyed the widgets.
            if (!this._isAlive()) return;
            if (!busName) {
                this._mprisPlayer = null;
                this._mprisPlaying = false;
                this._mprisTitle = null;
                this._mprisArtist = null;
                this._mprisArtUrl = '';
                this._mprisLength = 0;
                this._mprisPosition = 0;
                this._mprisPosTime = 0;
                if (this._musicTitle) this._musicTitle.text = 'Pulsar Music';
                if (this._musicArtist) this._musicArtist.text = t('NO_MEDIA');
                if (this._playIcon) this._playIcon.gicon = symbol('play');
                if (this._musicArt) this._setMusicArt('');
                return;
            }
            this._mprisPlayer = busName;

            Gio.DBus.session.call(busName, MPRIS_PATH, 'org.freedesktop.DBus.Properties',
                'GetAll', GLib.Variant.new('(s)', [PLAYER_IFACE]),
                GLib.VariantType.new('(a{sv})'), NONE, -1, null, (c, res) => {
                    try {
                        const props = c.call_finish(res).deepUnpack()[0];
                        const status = props['PlaybackStatus']?.deepUnpack() ?? 'Stopped';
                        const meta = props['Metadata']?.deepUnpack() ?? {};
                        const title = meta['xesam:title']?.deepUnpack() ?? 'Pulsar Music';
                        const artist = meta['xesam:artist']?.deepUnpack()?.[0] ?? meta['xesam:albumArtist']?.deepUnpack()?.[0] ?? 'Pulsar OS';
                        const artUrl = meta['mpris:artUrl']?.deepUnpack() ?? '';
                        const length = Number(meta['mpris:length']?.deepUnpack() ?? 0);
                        const position = Number(props['Position']?.deepUnpack() ?? 0);
                        /* The shuffle and the repeat of the phone's player. */
                        const shuffle = !!props['Shuffle']?.deepUnpack();
                        const loop = String(props['LoopStatus']?.deepUnpack() ?? 'None');

                        this._mprisPlaying = (status === 'Playing');
                        /* The artwork is only repainted when the track changes:
                         * rebuilding it on every poll tick would be a busy loop. */
                        const artePrima = this._mprisArtUrl;
                        /* Kept for the music panel: the card writes them into
                         * its labels, the panel reads them here. */
                        this._mprisTitle = title;
                        this._mprisArtist = artist;
                        this._mprisArtUrl = artUrl;
                        this._mprisLength = Number.isFinite(length) ? length : 0;
                        this._mprisPosition = Number.isFinite(position) ? position : 0;
                        this._mprisPosTime = GLib.get_monotonic_time();
                        this._mprisShuffle = shuffle;
                        this._mprisLoop = loop;
                        if (this._musicTitle) this._musicTitle.text = title;
                        if (this._musicArtist) this._musicArtist.text = artist;
                        if (this._playIcon) {
                            this._playIcon.gicon = symbol(this._mprisPlaying ? 'pause' : 'play');
                        }

                        if (artUrl !== artePrima && this._musicArt)
                            this._setMusicArt(artUrl);
                    } catch (e) {}
                });
        });
    }

    /* MPRIS transport. PlayPause is the card's play button; Next/Previous come
     * from the music panel. With no player running, play launches one. */
    _mprisCmd(method, lancioSeAssente) {
        if (!this._mprisPlayer) {
            if (lancioSeAssente)
                launch(['rhythmbox', 'spotify', 'amberol', 'elisa']);
            return;
        }
        try {
            Gio.DBus.session.call(this._mprisPlayer, MPRIS_PATH, PLAYER_IFACE, method,
                null, null, NONE, -1, null, () => this._refreshMedia());
        } catch (e) {}
    }

    _togglePlayback() {
        this._mprisCmd('PlayPause', true);
    }

    /* Write an MPRIS property. The shuffle and the repeat are properties, not
     * methods: the phone's player switches them with two taps and so does
     * this one. */
    _mprisSetProp(nome, valore) {
        if (!this._mprisPlayer)
            return;
        try {
            Gio.DBus.session.call(this._mprisPlayer, MPRIS_PATH, PLAYER_IFACE,
                'Set', GLib.Variant.new('(sv)', [nome, valore]), null, null,
                NONE, -1, null, () => this._refreshMedia());
        } catch (e) {}
    }

    _mprisShuffle(v) {
        this._mprisSetProp('Shuffle', new GLib.Variant('b', !!v));
    }

    /* The repeat cycles like the phone's: none, all, one. */
    _mprisRepeat() {
        const ordine = ['None', 'Playlist', 'Track'];
        const i = ordine.indexOf(this._mprisLoop || 'None');
        const prossimo = ordine[(i + 1) % ordine.length];
        this._mprisSetProp('LoopStatus', new GLib.Variant('s', prossimo));
    }

    /* 7. Battery Widget (Square) */
    _buildBatteryCard() {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-card mac-nc-square mac-nc-battery-card',
            reactive: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-card-header',
        });
        header.add_child(icon('battery-good-symbolic', 'mac-nc-battery-icon', 14));
        header.add_child(new St.Label({
            text: t('BATTERY'),
            style_class: 'mac-nc-card-title',
        }));
        card.add_child(header);

        this._batteryList = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-battery-list',
            x_expand: true,
            y_expand: true,
        });
        card.add_child(this._batteryList);
        return card;
    }

    /* 8. World Clock (Wide Card) */
    _buildWorldClockCard() {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-card mac-nc-wide mac-nc-worldclock-card',
            reactive: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-card-header',
        });
        header.add_child(icon('preferences-system-time-symbolic', 'mac-nc-worldclock-icon', 14));
        header.add_child(new St.Label({
            text: t('WORLD_CLOCK'),
            style_class: 'mac-nc-card-title',
        }));
        card.add_child(header);

        this._clocksRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-clocks-row',
            x_expand: true,
        });
        card.add_child(this._clocksRow);
        return card;
    }

    _refreshWorldClocks() {
        if (!this._isAlive()) return;
        if (!this._clocksRow) return;
        this._clocksRow.destroy_all_children();

        const cities = CITY_LIST;

        this._clockLabels = [];
        const localNow = GLib.DateTime.new_now_local();

        for (const city of cities) {
            const tz = GLib.TimeZone.new_identifier(city.tz) || GLib.TimeZone.new_utc();
            const cityTime = localNow.to_timezone(tz);

            const col = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'mac-nc-clock-col',
                x_expand: true,
            });

            col.add_child(new St.Label({
                text: city.name,
                style_class: 'mac-nc-clock-city',
            }));

            const diffHours = Math.round((cityTime.to_unix() - localNow.to_unix()) / 3600);
            let diffText = t('SAME_TIME');
            if (diffHours > 0) diffText = t('AHEAD', diffHours);
            else if (diffHours < 0) diffText = t('BEHIND', Math.abs(diffHours));

            col.add_child(new St.Label({
                text: diffText,
                style_class: 'mac-nc-clock-offset',
            }));

            const timeLabel = new St.Label({
                text: cityTime.format('%H:%M') || '12:00',
                style_class: 'mac-nc-clock-time',
            });
            this._clockLabels.push({label: timeLabel, tz});
            col.add_child(timeLabel);

            this._clocksRow.add_child(col);
        }
    }

    _updateLiveClocks() {
        if (!this._isAlive()) return;
        if (!this._clockLabels) return;
        const localNow = GLib.DateTime.new_now_local();
        for (const item of this._clockLabels) {
            const cityTime = localNow.to_timezone(item.tz);
            item.label.text = cityTime.format('%H:%M') || '12:00';
        }
    }
}

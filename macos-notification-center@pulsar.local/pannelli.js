/* macOS Notification Center — widget detail panels (Fase 2)
 *
 * Every widget is a Liquid Glass pod of its own, and it stays that way: opening
 * a widget does not add a container around anything. The card parks its own
 * content inside a plain wrapper, hides it, and gets one extra child — the
 * panel. So the panel is drawn *on the card's own glass*, which is what "un
 * blocchetto ciascuno come il cc per il vetro" means: one block per widget, no
 * outer sheet. The other widget pods are hidden for the duration, exactly like
 * the Control Centre hides its tiles behind its detail sheet, so the opened one
 * is alone in the column instead of pushing its neighbours down.
 *
 * Nothing new is added to `menu.box` either, so Liquid Glass keeps painting the
 * very same pods it was painting before the panel existed.
 *
 * Like the Control Centre's pannelli.js, this file is imported by nc.js with a
 * cache-busting query on every enable: editing it only needs
 *
 *     gnome-extensions disable macos-notification-center@pulsar.local
 *     gnome-extensions enable  macos-notification-center@pulsar.local
 *
 * and never a logout/login.
 */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

const EASE = Clutter.AnimationMode.EASE_OUT_CUBIC;

/* The track of the daily temperature bar, in pixels. It is a fixed width on
 * purpose: the segment inside it is positioned with plain arithmetic, and St
 * has no percentages, so a fixed track keeps the maths exact. */
const TRACK = 150;

/* One row of the forecast arrives every SOGLIA ms instead of all at once. The
 * card is content-sized, so the panel grows a row at a time: the reveal is the
 * same "trickle" the Control Centre uses for its Wi-Fi and Bluetooth lists. */
const SOGLIA = 32;

function delay(ms, fn) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        try {
            fn();
        } catch (e) {
            /* the panel may be gone by now: nothing to do */
        }
        return GLib.SOURCE_REMOVE;
    });
}

/* Weekday name for an ISO 'YYYY-MM-DD' date, localised by the system locale
 * (GLib does the translation; there is no table to keep in sync). */
function nomeGiorno(iso) {
    try {
        const [y, m, d] = String(iso).split('-').map(Number);
        if (!y || !m || !d)
            return String(iso);
        /* Noon, so that no timezone can push the date to the day before. */
        const dt = GLib.DateTime.new(GLib.TimeZone.new_local(), y, m, d, 12, 0, 0);
        const s = dt ? dt.format('%a') : null;
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(iso);
    } catch (e) {
        return String(iso);
    }
}

export function crea(nc, h) {
    let card = null;        // the pod currently expanded, if any
    let chiave = null;      // which widget that pod is
    let principale = null;  // the card's own content, parked while the panel is open
    let dettaglio = null;   // the panel: an extra child of the same card
    let morente = null;     // a panel being faded out, waiting to be removed
    let nascoste = [];      // the other pods, hidden while a panel is open
    let gen = 0;            // bumped on every open/close so stale timers bail out
    /* A panel is a snapshot, but some of them show live numbers. The builder
     * registers here what has to be redrawn; nc.js calls aggiorna() on every
     * poll tick while the drawer is open. */
    let aggiornaFn = null;

    const tr = (k, fb) => {
        let v = null;
        try {
            v = h.t(k);
        } catch (e) {}
        return v && v !== k ? v : fb;
    };
    const ic = (n, c, s) => {
        try {
            return h.icon(n, c, s);
        } catch (e) {
            return new St.Widget();
        }
    };
    /* nc.js routes this to the journal when /tmp/pulsar-nc-debug exists: it is
     * how a panel can be measured without anyone having to describe it. */
    const log = msg => {
        try {
            h.log && h.log(msg);
        } catch (e) {}
    };
    const vivente = g => g === gen && !!dettaglio;

    /* True for the pods that are a St.Button (the calendar). A St.Bin holds a
     * single child, set with set_child(): it will never allocate a second one,
     * so the panel cannot live directly on it the way it does on the others. */
    function eBin(c) {
        try {
            return c instanceof St.Button;
        } catch (e) {
            return false;
        }
    }

    /* Park the card's content. Reparenting rather than rebuilding keeps every
     * live label and icon the refreshers hold a reference to (the drawer keeps
     * updating the widgets while a panel is open), and the wrapper is reused on
     * later opens so the card never nests wrappers.
     *
     * The panel itself always goes *inside* the wrapper: that way a pod's own
     * layout never has to deal with it, and the one-child rule of a St.Bin pod
     * holds without a special case. */
    function impacchetta(c) {
        const figli = c.get_children();
        if (figli.length === 1 && figli[0].has_style_class_name &&
            figli[0].has_style_class_name('mac-nc-panel-main'))
            return figli[0];
        const p = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-panel-main',
            x_expand: true,
            y_expand: true,
        });
        if (eBin(c)) {
            /* set_child(null) detaches the pod's only child (and unparents it,
             * so it can be re-parented into the wrapper), then the wrapper is
             * adopted as that one child. */
            const unico = c.get_child();
            try {
                c.set_child(null);
            } catch (e) {}
            if (unico)
                p.add_child(unico);
            c.set_child(p);
            return p;
        }
        for (const figlio of figli) {
            c.remove_child(figlio);
            p.add_child(figlio);
        }
        c.add_child(p);
        return p;
    }

    /* ---------- shared pieces ---------- */
    function sep() {
        return new St.Widget({style_class: 'mac-nc-panel-sep', height: 1, x_expand: true});
    }

    function nota(testo) {
        const l = new St.Label({text: String(testo), style_class: 'mac-nc-panel-note', x_expand: true});
        try {
            l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        } catch (e) {}
        return l;
    }

    function titoloSezione(testo) {
        return new St.Label({text: String(testo), style_class: 'mac-nc-panel-section', x_expand: true});
    }

    /* The back affordance, macOS style: a chevron plus the widget's name. */
    function testata(titolo) {
        const r = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-panel-head',
            x_expand: true,
        });
        const b = new St.Button({
            style_class: 'mac-nc-panel-back',
            can_focus: true,
            reactive: true,
            x_align: Clutter.ActorAlign.START,
            child: new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'mac-nc-panel-back-inner',
            }),
        });
        const dentro = b.get_child();
        dentro.add_child(ic('go-previous-symbolic', 'mac-nc-panel-chevron', 14));
        dentro.add_child(new St.Label({text: String(titolo), style_class: 'mac-nc-panel-title'}));
        b.connect('clicked', () => chiudi());
        r.add_child(b);
        r.add_child(new St.Widget({x_expand: true}));
        return r;
    }

    /* ---------- the weather panel ---------- */
    function classeTemp(media) {
        if (media < 5) return 'mac-nc-pbar-freddo';
        if (media < 14) return 'mac-nc-pbar-fresco';
        if (media < 23) return 'mac-nc-pbar-mite';
        return 'mac-nc-pbar-caldo';
    }

    /* One day: weekday, icon, low, a bar for the day's range inside the week's
     * range, high. The bar is the macOS reading of a forecast: the eye compares
     * the days at a glance. */
    function rigaGiorno(iso, code, min, max, wMin, wMax) {
        const riga = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-prow',
            x_expand: true,
        });
        riga.add_child(new St.Label({text: nomeGiorno(iso), style_class: 'mac-nc-pday', x_expand: true}));

        let icona = 'weather-overcast-symbolic';
        try {
            icona = h.iconOf(code).icon;
        } catch (e) {}
        riga.add_child(ic(icona, 'mac-nc-picon', 14));

        riga.add_child(new St.Label({
            text: `${Math.round(min)}°`,
            style_class: 'mac-nc-pmin',
            x_align: Clutter.ActorAlign.END,
        }));

        const corsa = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-pbar',
        });
        const span = Math.max(1, wMax - wMin);
        const sinistra = Math.round(((min - wMin) / span) * TRACK);
        const larghezza = Math.max(6, Math.round(((max - min) / span) * TRACK));
        const segmento = new St.Widget({
            style_class: `mac-nc-pbar-fill ${classeTemp((min + max) / 2)}`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        /* St has no percentages and no flex weights, so the offset and the
         * length are inline CSS in pixels — inside a track whose width is
         * fixed by .mac-nc-pbar and kept equal to TRACK. */
        segmento.set_style(`margin-left: ${sinistra}px; width: ${larghezza}px;`);
        corsa.add_child(segmento);
        riga.add_child(corsa);

        riga.add_child(new St.Label({
            text: `${Math.round(max)}°`,
            style_class: 'mac-nc-pmax',
            x_align: Clutter.ActorAlign.END,
        }));
        return riga;
    }

    function pannelloMeteo(box, miaGen) {
        box.add_child(testata(tr('WEATHER', 'Weather')));

        const dati = h.weather();
        const corrente = dati ? dati.current : null;
        const rigaOra = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-prow-now',
            x_expand: true,
        });
        if (corrente) {
            let icona = 'weather-clear-symbolic';
            try {
                icona = h.iconOf(corrente.weather_code ?? 0).icon;
            } catch (e) {}
            rigaOra.add_child(ic(icona, 'mac-nc-pbig-icon', 30));

            const testo = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'mac-nc-pnow-text',
                x_expand: true,
            });
            testo.add_child(new St.Label({
                text: `${Math.round(corrente.temperature_2m)}°`,
                style_class: 'mac-nc-ptemp',
            }));
            testo.add_child(new St.Label({
                text: String((dati && dati.cityName) || ''),
                style_class: 'mac-nc-pcity',
            }));
            rigaOra.add_child(testo);
        }
        box.add_child(rigaOra);
        box.add_child(sep());

        const daily = dati ? dati.daily : null;
        const temps = daily && daily.temperature_2m_max ? daily.temperature_2m_max : null;
        const minime = daily && daily.temperature_2m_min ? daily.temperature_2m_min : null;
        if (!daily || !daily.time || !temps || !minime || temps.length === 0) {
            box.add_child(nota(tr('PANEL_NO_DATA', 'No forecast data')));
            return;
        }

        box.add_child(titoloSezione(tr('PANEL_10DAY', '10-Day Forecast')));
        const wMax = Math.max(...temps);
        const wMin = Math.min(...minime);
        const codici = daily.weather_code || [];
        daily.time.slice(0, 10).forEach((iso, i) => {
            const min = Number(minime[i]);
            const max = Number(temps[i]);
            if (!Number.isFinite(min) || !Number.isFinite(max))
                return;
            const riga = rigaGiorno(iso, codici[i] ?? 0, min, max, wMin, wMax);
            delay(i * SOGLIA, () => {
                if (vivente(miaGen))
                    box.add_child(riga);
            });
        });
    }

    /* ---------- shared rows ---------- */

    /* A row that opens an application, macOS style: icon, label, chevron. */
    function rigaApp(cmd, etichetta, nomeIcona) {
        const r = new St.Button({
            style_class: 'mac-nc-papp',
            can_focus: true,
            reactive: true,
            x_expand: true,
        });
        const dentro = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-papp-inner',
            x_expand: true,
        });
        dentro.add_child(ic(nomeIcona || 'application-x-executable-symbolic', 'mac-nc-papp-icon', 14));
        dentro.add_child(new St.Label({
            text: String(etichetta),
            style_class: 'mac-nc-papp-label',
            x_expand: true,
        }));
        dentro.add_child(ic('go-next-symbolic', 'mac-nc-papp-chevron', 12));
        r.set_child(dentro);
        r.connect('clicked', () => {
            try {
                h.launch(Array.isArray(cmd) ? cmd : [cmd]);
            } catch (e) {}
        });
        return r;
    }

    /* label on the left, value on the right. */
    function rigaInfo(etichetta) {
        const r = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-pinfo-row',
            x_expand: true,
        });
        r.add_child(new St.Label({text: String(etichetta), style_class: 'mac-nc-pinfo-label', x_expand: true}));
        const valore = new St.Label({text: '—', style_class: 'mac-nc-pinfo-value'});
        r.add_child(valore);
        return {riga: r, set: txt => { try { valore.text = String(txt); } catch (e) {} }};
    }

    /* A labelled bar. St has no percentages and no fractional widths, so the
     * fill is measured against the track each time it is set — and set again
     * once, a moment after the panel opens, when the track finally has a
     * width to measure. */
    function rigaBarra(etichetta, nomeIcona) {
        const r = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-pbar-row',
            x_expand: true,
        });
        const testa = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-pbar-head',
            x_expand: true,
        });
        if (nomeIcona)
            testa.add_child(ic(nomeIcona, 'mac-nc-pbar-icon', 14));
        testa.add_child(new St.Label({
            text: String(etichetta),
            style_class: 'mac-nc-pbar-label',
            x_expand: true,
        }));
        const valore = new St.Label({text: '', style_class: 'mac-nc-pbar-value'});
        testa.add_child(valore);
        r.add_child(testa);

        const traccia = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-ptrack',
            x_expand: true,
        });
        const riempi = new St.Widget({style_class: 'mac-nc-ptrack-fill'});
        traccia.add_child(riempi);
        r.add_child(traccia);

        const set = (txt, fraz, classe) => {
            try {
                valore.text = String(txt);
                const w = traccia.get_transformed_size()[0] || traccia.width || 0;
                const px = Math.max(0, Math.min(w, Math.round(w * (fraz || 0))));
                riempi.set_style(`width: ${px}px;`);
                const cls = `mac-nc-ptrack-fill ${classe || 'mac-nc-ptrack-ok'}`;
                if (riempi.get_style_class_name() !== cls)
                    riempi.set_style_class_name(cls);
            } catch (e) {}
        };
        return {riga: r, set};
    }

    /* A round transport button (music panel). */
    function pulsante(nomeIcona, etichetta, azione) {
        const b = new St.Button({style_class: 'mac-nc-pbutton', can_focus: true, reactive: true});
        const i = ic(nomeIcona, 'mac-nc-pbutton-icon', 16);
        b.set_child(i);
        try {
            b.set_accessible_name(String(etichetta));
        } catch (e) {}
        b.connect('clicked', () => {
            try {
                azione();
            } catch (e) {}
        });
        return {bottone: b, icona: i};
    }

    /* Green under 60%, amber under 85%, red above: the same reading a system
     * monitor gives at a glance. */
    function classeLivello(perc) {
        if (perc < 60) return 'mac-nc-ptrack-ok';
        if (perc < 85) return 'mac-nc-ptrack-warn';
        return 'mac-nc-ptrack-hot';
    }

    /* The seven short day names, localised by GLib. 1 January 2024 was a
     * Monday, so counting from it gives Monday..Sunday in the system language
     * without a table to keep in sync. */
    function nomiGiorni() {
        const out = [];
        try {
            const base = GLib.DateTime.new(GLib.TimeZone.new_local(), 2024, 1, 1, 12, 0, 0);
            for (let i = 0; i < 7; i++)
                out.push((base.add_days(i).format('%a') || '').slice(0, 2));
        } catch (e) {}
        return out;
    }

    /* ---------- the calendar panel ---------- */
    function rigaEvento(ev) {
        const r = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-pevent',
            x_expand: true,
        });
        const inizio = Number(ev[2]) || 0;
        const extra = ev[4] || {};
        let tuttoIlGiorno = false;
        try {
            tuttoIlGiorno = !!extra['allDay'];
        } catch (e) {}

        let ora = tr('PANEL_ALLDAY', 'All day');
        if (!tuttoIlGiorno && inizio) {
            try {
                const dt = GLib.DateTime.new_from_unix_local(inizio);
                ora = dt.format('%H:%M') || ora;
            } catch (e) {}
        }
        r.add_child(new St.Label({text: ora, style_class: 'mac-nc-ptime'}));

        const sommario = new St.Label({
            text: String(ev[1] || tr('SCHEDULED', 'Scheduled event')),
            style_class: 'mac-nc-psummary',
            x_expand: true,
        });
        try {
            sommario.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        } catch (e) {}
        r.add_child(sommario);
        return r;
    }

    /* A full month, Monday first, with today ringed, plus the day's events.
     * Same rules as the card's grid, but bigger: the card has to fit in 177px,
     * the panel has the width of the whole drawer. */
    function grigliaMese(box) {
        let now = null;
        try {
            now = GLib.DateTime.new_now_local();
        } catch (e) {
            return;
        }
        const anno = now.get_year();
        const mese = now.get_month();
        const oggi = now.get_day_of_month();
        const tz = GLib.TimeZone.new_local();
        const primo = GLib.DateTime.new(tz, anno, mese, 1, 12, 0, 0);
        const colonna = (primo.get_day_of_week() + 6) % 7;   /* Monday = 0 */
        /* GLib.DateTime has no day count (that one lives on GLib.Date): the
         * last day of the month is the day before the 1st of the next one. */
        const dopo = GLib.DateTime.new(tz, mese === 12 ? anno + 1 : anno, mese === 12 ? 1 : mese + 1, 1, 12, 0, 0);
        const nelMese = dopo.add_days(-1).get_day_of_month();
        const primaPrec = primo.add_days(-1).get_day_of_month();

        const titolo = new St.Label({
            text: (now.format('%B %Y') || '').toUpperCase(),
            style_class: 'mac-nc-pmonth',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(titolo);

        const settimana = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-pweek',
            x_align: Clutter.ActorAlign.CENTER,
        });
        for (const nome of nomiGiorni())
            settimana.add_child(new St.Label({text: nome, style_class: 'mac-nc-pweek-day'}));
        box.add_child(settimana);

        const griglia = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-pcal',
            x_align: Clutter.ActorAlign.CENTER,
        });

        let riga = null;
        let inRiga = 0;
        const nuovaRiga = () => {
            riga = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'mac-nc-pcal-row',
                x_align: Clutter.ActorAlign.CENTER,
            });
            inRiga = 0;
        };
        const aggiungi = cell => {
            riga.add_child(cell);
            inRiga++;
        };
        const cella = (testo, altro) => {
            const cell = new St.Bin({style_class: 'mac-nc-pcal-cell'});
            if (testo === oggi && !altro) {
                const bolla = new St.Bin({
                    style_class: 'mac-nc-pcal-today',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                bolla.set_child(new St.Label({text: String(testo), style_class: 'mac-nc-pcal-day'}));
                cell.set_child(bolla);
            } else {
                cell.set_child(new St.Label({
                    text: String(testo),
                    style_class: altro ? 'mac-nc-pcal-day mac-nc-pcal-other' : 'mac-nc-pcal-day',
                }));
            }
            return cell;
        };

        nuovaRiga();
        for (let i = colonna - 1; i >= 0; i--)
            aggiungi(cella(primaPrec - i, true));
        for (let d = 1; d <= nelMese; d++) {
            aggiungi(cella(d, false));
            if (inRiga === 7) {
                griglia.add_child(riga);
                nuovaRiga();
            }
        }
        let successivo = 1;
        while (inRiga > 0 && inRiga < 7)
            aggiungi(cella(successivo++, true));
        if (inRiga > 0)
            griglia.add_child(riga);
        box.add_child(griglia);
    }

    function pannelloCalendario(box) {
        box.add_child(testata(tr('PANEL_CALENDAR', 'Calendar')));
        grigliaMese(box);
        box.add_child(sep());

        box.add_child(titoloSezione(tr('TODAY', 'Today')));
        const eventi = h.events() || [];
        if (!eventi.length) {
            box.add_child(nota(tr('NO_EVENTS', 'No events today')));
        } else {
            for (const ev of eventi.slice(0, 8))
                box.add_child(rigaEvento(ev));
        }
        box.add_child(sep());
        box.add_child(rigaApp(['gnome-calendar'], tr('PANEL_OPEN_CALENDAR', 'Open Calendar'),
            'x-office-calendar-symbolic'));
    }

    /* ---------- the reminders panel ---------- */
    /* The widget has no task service behind it yet (it always shows the empty
     * state), so the panel says the same thing with room to breathe, and hands
     * over to the app. */
    function pannelloAttivita(box) {
        box.add_child(testata(tr('TASKS', 'Reminders')));
        const riga = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-prow-now',
            x_expand: true,
        });
        riga.add_child(ic('emblem-ok-symbolic', 'mac-nc-pbig-icon', 30));
        const testo = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-pnow-text',
            x_expand: true,
        });
        testo.add_child(new St.Label({
            text: tr('ALL_DONE', 'All clear today'),
            style_class: 'mac-nc-ptemp-small',
        }));
        testo.add_child(new St.Label({
            text: tr('NO_TASKS', 'No tasks scheduled'),
            style_class: 'mac-nc-pcity',
        }));
        riga.add_child(testo);
        box.add_child(riga);
        box.add_child(sep());
        box.add_child(rigaApp(['gnome-calendar'], tr('PANEL_OPEN_TASKS', 'Open Reminders'),
            'x-office-calendar-symbolic'));
    }

    /* ---------- the performance panel ---------- */
    function pannelloSistema(box, miaGen) {
        box.add_child(testata(tr('PERFORMANCE', 'Performance')));

        const cpu = rigaBarra(tr('CPU', 'CPU'), 'utilities-system-monitor-symbolic');
        const mem = rigaBarra(tr('MEMORY', 'Memory'), 'drive-harddisk-symbolic');
        box.add_child(cpu.riga);
        box.add_child(mem.riga);
        box.add_child(sep());

        const carico = rigaInfo(tr('PANEL_LOAD', 'Load average'));
        const attivo = rigaInfo(tr('UPTIME', 'Uptime'));
        box.add_child(carico.riga);
        box.add_child(attivo.riga);
        box.add_child(sep());
        box.add_child(rigaApp(['gnome-system-monitor'], tr('PANEL_OPEN_MONITOR', 'Open Monitor'),
            'utilities-system-monitor-symbolic'));

        const aggiornaLocale = () => {
            const s = h.system() || {};
            const cpuPerc = Math.max(0, Math.min(100, Math.round(s.cpu || 0)));
            cpu.set(`${cpuPerc}%`, cpuPerc / 100, classeLivello(cpuPerc));
            const totale = s.memTotal || 0;
            const usata = Math.max(0, totale - (s.memFree || 0));
            const memPerc = totale ? Math.round((usata / totale) * 100) : 0;
            mem.set(`${usata.toFixed(1)} / ${totale.toFixed(1)} GB`, memPerc / 100, classeLivello(memPerc));
            carico.set(s.load || '—');
            attivo.set(s.uptime || '—');
        };
        aggiornaFn = aggiornaLocale;
        aggiornaLocale();
        /* The first pass runs before the panel is allocated: measure the bars
         * again once it has a size. */
        delay(300, () => {
            if (vivente(miaGen))
                aggiornaLocale();
        });
    }

    /* ---------- the music panel ---------- */
    function pannelloMusica(box) {
        box.add_child(testata(tr('MUSIC', 'Music')));

        const copertina = new St.Bin({
            style_class: 'mac-nc-pcover',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(copertina);

        const titolo = new St.Label({text: 'Pulsar Music', style_class: 'mac-nc-pmusictitle', x_align: Clutter.ActorAlign.CENTER});
        const artista = new St.Label({text: '', style_class: 'mac-nc-partist', x_align: Clutter.ActorAlign.CENTER});
        for (const l of [titolo, artista]) {
            try {
                l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            } catch (e) {}
        }
        box.add_child(titolo);
        box.add_child(artista);

        const comandi = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'mac-nc-pcontrols',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const prev = pulsante('media-skip-backward-symbolic', tr('PANEL_PREVIOUS', 'Previous'), () => h.mp.prev());
        const play = pulsante('media-playback-start-symbolic', tr('PANEL_PLAY', 'Play'), () => h.mp.play());
        const next = pulsante('media-skip-forward-symbolic', tr('PANEL_NEXT', 'Next'), () => h.mp.next());
        comandi.add_child(prev.bottone);
        comandi.add_child(play.bottone);
        comandi.add_child(next.bottone);
        box.add_child(comandi);

        let ultimaCover = null;
        const aggiornaLocale = () => {
            const m = h.music() || {};
            titolo.text = String(m.title || 'Pulsar Music');
            artista.text = String(m.artist || tr('NO_MEDIA', 'Not playing'));
            play.icona.icon_name = m.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            /* The button does the same thing either way; only what a screen
             * reader announces changes. */
            try {
                play.bottone.set_accessible_name(String(m.playing
                    ? tr('PANEL_PAUSE', 'Pause')
                    : tr('PANEL_PLAY', 'Play')));
            } catch (e) {}

            const url = m.artUrl || '';
            /* Only touch the cover when the track actually changed: rebuilding
             * a Gio.FileIcon every poll tick would be a busy loop. */
            if (url === ultimaCover)
                return;
            ultimaCover = url;
            let fatto = false;
            if (url) {
                try {
                    const gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(url)});
                    copertina.set_child(new St.Icon({
                        gicon,
                        icon_size: 116,
                        style_class: 'mac-nc-pcover-art',
                    }));
                    fatto = true;
                } catch (e) {}
            }
            if (!fatto)
                copertina.set_child(ic('audio-x-generic-symbolic', 'mac-nc-pcover-generic', 44));
        };
        aggiornaFn = aggiornaLocale;
        aggiornaLocale();
    }

    /* ---------- the battery panel ---------- */
    function pannelloBatteria(box, miaGen) {
        box.add_child(testata(tr('BATTERY', 'Battery')));

        const stato = new St.Label({
            text: tr('PANEL_ON_POWER', 'On power'),
            style_class: 'mac-nc-pbattery-state',
            x_expand: true,
        });
        box.add_child(stato);

        const contenitore = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'mac-nc-pbattery',
            x_expand: true,
        });
        box.add_child(contenitore);
        box.add_child(sep());
        box.add_child(rigaApp(['gnome-control-center', 'power'], tr('PANEL_POWER_SETTINGS', 'Energy Settings'),
            'preferences-system-symbolic'));

        let firma = null;
        let righe = [];
        const aggiornaLocale = () => {
            const devices = h.battery() || [];
            /* Rebuild the rows only when the set of devices changed (a mouse
             * switched off, a headset connected): the percentages are then
             * written into the existing rows. */
            const firmaNuova = devices.map(d => `${d.name}|${d.iconName}`).join(',');
            if (firmaNuova !== firma) {
                firma = firmaNuova;
                contenitore.destroy_all_children();
                righe = [];
                if (!devices.length) {
                    const r = rigaBarra(tr('PANEL_ON_POWER', 'On power'), 'ac-adapter-symbolic');
                    contenitore.add_child(r.riga);
                    righe.push({r, pct: 100, state: 0, type: 1});
                } else {
                    for (const d of devices) {
                        const r = rigaBarra(d.name, d.iconName);
                        contenitore.add_child(r.riga);
                        righe.push({r, pct: d.percentage, state: d.state, type: d.type});
                    }
                }
            }

            let caricando = false;
            let batteria = false;
            for (let i = 0; i < righe.length; i++) {
                const it = righe[i];
                const d = devices[i];
                if (d) {
                    it.pct = d.percentage;
                    it.state = d.state;
                    it.type = d.type;
                }
                if (it.state === 1)
                    caricando = true;
                if (it.type === 2)
                    batteria = true;
            }
            stato.text = caricando ? tr('CHARGING', 'Charging')
                : (batteria ? tr('PANEL_DISCHARGING', 'On battery') : tr('PANEL_ON_POWER', 'On power'));
            for (const it of righe) {
                const pct = Math.max(0, Math.min(100, Math.round(it.pct || 0)));
                it.r.set(`${pct}%`, pct / 100, classeLivello(pct));
            }
        };
        aggiornaFn = aggiornaLocale;
        aggiornaLocale();
        delay(300, () => {
            if (vivente(miaGen))
                aggiornaLocale();
        });
    }

    /* ---------- the world clock panel ---------- */
    function pannelloOrologi(box) {
        box.add_child(testata(tr('WORLD_CLOCK', 'World Clock')));

        const righe = [];
        for (const c of (h.cities() || [])) {
            const r = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'mac-nc-pclock',
                x_expand: true,
            });
            const sinistra = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'mac-nc-pnow-text',
                x_expand: true,
            });
            sinistra.add_child(new St.Label({text: String(c.name), style_class: 'mac-nc-pclock-city'}));
            const offset = new St.Label({text: '', style_class: 'mac-nc-pclock-offset'});
            sinistra.add_child(offset);
            r.add_child(sinistra);

            const ora = new St.Label({text: '--:--', style_class: 'mac-nc-pclock-time'});
            r.add_child(ora);

            let tz = null;
            try {
                tz = GLib.TimeZone.new_identifier(c.tz) || GLib.TimeZone.new_utc();
            } catch (e) {
                tz = GLib.TimeZone.new_utc();
            }
            box.add_child(r);
            righe.push({ora, offset, tz});
        }
        box.add_child(sep());
        box.add_child(rigaApp(['gnome-clocks'], tr('PANEL_OPEN_CLOCKS', 'Open Clocks'),
            'preferences-system-time-symbolic'));

        /* The card's clocks tick while the drawer is open; this does the same
         * for the panel's, and it is the one panel that must never be stale. */
        aggiornaFn = () => {
            const locale = GLib.DateTime.new_now_local();
            for (const it of righe) {
                try {
                    const ct = locale.to_timezone(it.tz);
                    it.ora.text = ct.format('%H:%M') || '--:--';
                    const diff = Math.round((ct.to_unix() - locale.to_unix()) / 3600);
                    it.offset.text = diff > 0
                        ? String(tr('AHEAD', '+%dh')).replace('%d', String(diff))
                        : (diff < 0
                            ? String(tr('BEHIND', '-%dh')).replace('%d', String(Math.abs(diff)))
                            : tr('SAME_TIME', 'Same time'));
                } catch (e) {}
            }
        };
        aggiornaFn();
    }

    const pannelli = {
        calendar: pannelloCalendario,
        reminders: pannelloAttivita,
        system: pannelloSistema,
        weather: pannelloMeteo,
        music: pannelloMusica,
        battery: pannelloBatteria,
        worldclock: pannelloOrologi,
    };

    function costruisci(k, box, miaGen) {
        const f = pannelli[k];
        if (f) {
            try {
                f(box, miaGen);
                return;
            } catch (e) {
                console.warn(`macos-nc: panel ${k} could not be built: ${e}`);
            }
        }
        box.add_child(nota(tr('PANEL_SOON', 'Coming soon')));
    }

    /* Hide the other pods, and any row left with nothing visible in it. The
     * widget grid is rows of two: hiding only the pods would leave their empty
     * rows behind and the panel would start 24px too low. */
    function nascondiAltri(c) {
        nascoste = [];
        for (const x of (h.cards() || [])) {
            if (!x || x === c)
                continue;
            nascoste.push(x);
        }
        for (const x of nascoste) {
            try {
                x.hide();
            } catch (e) {}
        }
        for (const x of nascoste) {
            try {
                const p = x.get_parent();
                if (!p || !p.has_style_class_name || !p.has_style_class_name('mac-nc-row'))
                    continue;
                if (nascoste.includes(p))
                    continue;
                const figli = p.get_children();
                if (figli.every(f => f === c || nascoste.includes(f))) {
                    p.hide();
                    nascoste.push(p);
                }
            } catch (e) {}
        }
    }

    /* Reveal: the content fades in and the rows trickle in behind it. There is
     * no scale here on purpose — the card itself is the pod, and stretching a
     * pod makes Liquid Glass rebuild its blur region on every frame. Fase 3
     * owns the motion polish, timings included. */
    function mostra() {
        if (!dettaglio)
            return;
        dettaglio.opacity = 0;
        dettaglio.ease({opacity: 255, duration: 200, mode: EASE});
    }

    /* Instant reset, no animation: the drawer is closing, or another widget's
     * panel is about to open. */
    function azzera() {
        gen++;
        aggiornaFn = null;
        for (const a of [dettaglio, morente]) {
            if (!a)
                continue;
            try {
                if (a._gesto)
                    a._gesto.enabled = true;
            } catch (e) {}
            try {
                const padre = a.get_parent();
                if (padre)
                    padre.remove_child(a);
            } catch (e) {}
            try {
                a.destroy();
            } catch (e) {}
        }
        dettaglio = null;
        morente = null;
        chiave = null;
        card = null;
        if (principale) {
            try {
                principale.show();
            } catch (e) {}
            principale = null;
        }
        for (const x of nascoste) {
            try {
                x.show();
            } catch (e) {}
        }
        nascoste = [];
    }

    function apri(k, c, gesto) {
        try {
            if (!c)
                return false;
            if (dettaglio && chiave === k) {
                chiudi();
                return true;
            }
            /* Another panel open? Drop it first (azzera() re-arms its click
             * gesture), then take over. */
            azzera();
            gen++;
            const miaGen = gen;

            card = c;
            chiave = k;
            /* While the panel is open a click anywhere inside the card must not
             * re-enter here: the panel is a child of the card, so the card's own
             * click gesture would fire on every click on the panel. */
            try {
                if (gesto)
                    gesto.enabled = false;
            } catch (e) {}

            principale = impacchetta(c);
            principale.hide();

            nascondiAltri(c);

            dettaglio = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'mac-nc-panel',
                x_expand: true,
                y_expand: true,
            });
            try {
                dettaglio._gesto = gesto || null;
            } catch (e) {}
            principale.add_child(dettaglio);
            costruisci(k, dettaglio, miaGen);
            mostra();
            /* One line in the journal once the rows have trickled in: the host
             * (does it still carry the Liquid Glass hook?), its size, the
             * panel's size and how many rows it ended up with. */
            delay(SOGLIA * 12 + 300, () => {
                if (!vivente(miaGen))
                    return;
                try {
                    const [cw, ch] = c.get_transformed_size();
                    const [dw, dh] = dettaglio.get_transformed_size();
                    const pod = c.has_style_class_name('quick-toggle') ? 'glass' : 'plain';
                    log(`pannello ${k}: host ${Math.round(cw)}x${Math.round(ch)} ${pod}` +
                        ` | contenuto ${Math.round(dw)}x${Math.round(dh)}` +
                        ` | righe ${dettaglio.get_n_children()}`);
                } catch (e) {
                    log(`pannello ${k}: measure failed (${e})`);
                }
            });
            return true;
        } catch (e) {
            console.warn(`macos-nc: panel ${k} could not be opened: ${e}`);
            try {
                if (gesto)
                    gesto.enabled = true;
            } catch (e2) {}
            try {
                azzera();
            } catch (e2) {}
            return false;
        }
    }

    function chiudi() {
        if (!dettaglio)
            return false;
        const d = dettaglio;
        const miaGen = ++gen;
        const c = card;
        const p = principale;
        const ns = nascoste;
        dettaglio = null;
        morente = d;
        aggiornaFn = null;
        try {
            d.ease({opacity: 0, duration: 80, mode: EASE});
        } catch (e) {}
        delay(95, () => {
            if (gen !== miaGen)
                return;   /* azzera() or a new panel took over */
            try {
                if (p)
                    p.remove_child(d);
            } catch (e) {}
            try {
                d.destroy();
            } catch (e) {}
            if (morente === d)
                morente = null;
            try {
                if (d._gesto)
                    d._gesto.enabled = true;
            } catch (e) {}
            if (p) {
                try {
                    p.show();
                } catch (e) {}
            }
            for (const x of ns) {
                try {
                    x.show();
                } catch (e) {}
            }
            nascoste = [];
            chiave = null;
            card = null;
        });
        return true;
    }

    return {
        apri,
        chiudi,
        azzera,
        attivo: () => !!dettaglio,
        /* Called by nc.js on every poll tick while the drawer is open. */
        aggiorna: () => {
            try {
                if (aggiornaFn)
                    aggiornaFn();
            } catch (e) {}
        },
    };
}

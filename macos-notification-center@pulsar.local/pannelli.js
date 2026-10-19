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

    /* Park the card's content. Reparenting rather than rebuilding keeps every
     * live label and icon the refreshers hold a reference to (the drawer keeps
     * updating the widgets while a panel is open), and the wrapper is reused on
     * later opens so the card never nests wrappers. */
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

    const pannelli = {
        weather: pannelloMeteo,
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
            c.add_child(dettaglio);
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
        try {
            d.ease({opacity: 0, duration: 80, mode: EASE});
        } catch (e) {}
        delay(95, () => {
            if (gen !== miaGen)
                return;   /* azzera() or a new panel took over */
            try {
                if (c)
                    c.remove_child(d);
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
    };
}

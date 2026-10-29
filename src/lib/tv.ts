/**
 * The channel `tv` follows the device type `tv` of the ioBroker type-detector (>= 6.2.0), so visualizations and
 * the devices adapter find the TV. The keys of `common.states` of `tv.key`, `tv.input` and `tv.app` must be
 * fixed values of the type-detector (`TV_KEYS`, `TV_INPUTS`, `TV_APPS` in its tvValues.ts) - any subset,
 * no other keys. The labels are copied from there.
 */

/** IRCC code of every key of `TV_KEYS` (same codes as the button states in io-package.json) */
export const TV_KEY_CODES: Record<string, { label: string; code: string }> = {
    UP: { label: 'Up', code: 'AAAAAQAAAAEAAAB0Aw==' },
    DOWN: { label: 'Down', code: 'AAAAAQAAAAEAAAB1Aw==' },
    LEFT: { label: 'Left', code: 'AAAAAQAAAAEAAAA0Aw==' },
    RIGHT: { label: 'Right', code: 'AAAAAQAAAAEAAAAzAw==' },
    SELECT: { label: 'Select', code: 'AAAAAQAAAAEAAABlAw==' },
    BACK: { label: 'Back', code: 'AAAAAgAAAJcAAAAjAw==' },
    EXIT: { label: 'Exit', code: 'AAAAAQAAAAEAAABjAw==' },
    HOME: { label: 'Home', code: 'AAAAAQAAAAEAAABgAw==' },
    // Sony remotes have no MENU key, "Options" opens the menu of the current screen
    MENU: { label: 'Menu', code: 'AAAAAgAAAJcAAAA2Aw==' },
    INFO: { label: 'Info', code: 'AAAAAQAAAAEAAAA6Aw==' },
    GUIDE: { label: 'Guide', code: 'AAAAAgAAAKQAAABbAw==' },
    CHANNEL_UP: { label: 'Channel up', code: 'AAAAAQAAAAEAAAAQAw==' },
    CHANNEL_DOWN: { label: 'Channel down', code: 'AAAAAQAAAAEAAAARAw==' },
    NUMBER_0: { label: '0', code: 'AAAAAQAAAAEAAAAJAw==' },
    NUMBER_1: { label: '1', code: 'AAAAAQAAAAEAAAAAAw==' },
    NUMBER_2: { label: '2', code: 'AAAAAQAAAAEAAAABAw==' },
    NUMBER_3: { label: '3', code: 'AAAAAQAAAAEAAAACAw==' },
    NUMBER_4: { label: '4', code: 'AAAAAQAAAAEAAAADAw==' },
    NUMBER_5: { label: '5', code: 'AAAAAQAAAAEAAAAEAw==' },
    NUMBER_6: { label: '6', code: 'AAAAAQAAAAEAAAAFAw==' },
    NUMBER_7: { label: '7', code: 'AAAAAQAAAAEAAAAGAw==' },
    NUMBER_8: { label: '8', code: 'AAAAAQAAAAEAAAAHAw==' },
    NUMBER_9: { label: '9', code: 'AAAAAQAAAAEAAAAIAw==' },
    PLAY: { label: 'Play', code: 'AAAAAgAAAJcAAAAaAw==' },
    PAUSE: { label: 'Pause', code: 'AAAAAgAAAJcAAAAZAw==' },
    STOP: { label: 'Stop', code: 'AAAAAgAAAJcAAAAYAw==' },
    REWIND: { label: 'Rewind', code: 'AAAAAgAAAJcAAAAbAw==' },
    FAST_FORWARD: { label: 'Fast forward', code: 'AAAAAgAAAJcAAAAcAw==' },
    RED: { label: 'Red', code: 'AAAAAgAAAJcAAAAlAw==' },
    GREEN: { label: 'Green', code: 'AAAAAgAAAJcAAAAmAw==' },
    YELLOW: { label: 'Yellow', code: 'AAAAAgAAAJcAAAAnAw==' },
    BLUE: { label: 'Blue', code: 'AAAAAgAAAJcAAAAkAw==' },
};

export const VOLUME_UP_CODE = 'AAAAAQAAAAEAAAASAw==';
export const VOLUME_DOWN_CODE = 'AAAAAQAAAAEAAAATAw==';

/** Labels of `TV_INPUTS` */
export const TV_INPUT_LABELS: Record<string, string> = {
    TV: 'TV',
    SAT: 'Satellite',
    HDMI1: 'HDMI 1',
    HDMI2: 'HDMI 2',
    HDMI3: 'HDMI 3',
    HDMI4: 'HDMI 4',
    USB: 'USB',
    AV: 'AV',
    COMPONENT: 'Component',
    SCART: 'SCART',
    OPTICAL: 'Optical',
    AUX: 'AUX',
};

/** Inputs offered before the TV reported its own (most Bravia have 4 HDMI) */
export const DEFAULT_INPUTS = ['TV', 'HDMI1', 'HDMI2', 'HDMI3', 'HDMI4'];

/** The tuners are selected by IRCC key, there is no stable URI for "the TV tuner" */
export const TUNER_CODES: Record<string, string> = {
    TV: 'AAAAAQAAAAEAAAAkAw==',
    SAT: 'AAAAAgAAAMQAAABOAw==',
};

/** URI of an external input, e.g. `extInput:hdmi?port=2` (`avContent/setPlayContent`) */
export function inputToUri(input: string): string | null {
    const hdmi = input.match(/^HDMI([1-4])$/);
    if (hdmi) {
        return `extInput:hdmi?port=${hdmi[1]}`;
    }
    switch (input) {
        case 'AV':
            return 'extInput:composite?port=1';
        case 'COMPONENT':
            return 'extInput:component?port=1';
        case 'SCART':
            return 'extInput:scart?port=1';
        default:
            return null;
    }
}

/** The input of a URI of `getPlayingContentInfo` / `getContentList`, null if it is none of `TV_INPUTS` */
export function uriToInput(uri: string | undefined): string | null {
    if (!uri) {
        return null;
    }
    if (uri.startsWith('tv:')) {
        return uri.startsWith('tv:dvbs') ? 'SAT' : 'TV';
    }
    const match = uri.match(/^extInput:(hdmi|composite|component|scart)\?port=(\d+)/);
    if (!match) {
        return null;
    }
    switch (match[1]) {
        case 'hdmi':
            return Number(match[2]) >= 1 && Number(match[2]) <= 4 ? `HDMI${match[2]}` : null;
        case 'composite':
            return 'AV';
        case 'component':
            return 'COMPONENT';
        default:
            return 'SCART';
    }
}

/** `TV_APPS` with a pattern for the title the TV reports in `getApplicationList` */
const TV_APP_TITLES: { key: string; label: string; pattern: RegExp }[] = [
    { key: 'YOUTUBE_MUSIC', label: 'YouTube Music', pattern: /^youtube ?music/ },
    { key: 'YOUTUBE', label: 'YouTube', pattern: /^youtube$/ },
    { key: 'NETFLIX', label: 'Netflix', pattern: /^netflix/ },
    { key: 'DISNEY_PLUS', label: 'Disney+', pattern: /^disney/ },
    { key: 'PRIME_VIDEO', label: 'Prime Video', pattern: /prime ?video/ },
    { key: 'APPLE_TV', label: 'Apple TV', pattern: /^apple ?tv/ },
    { key: 'MAX', label: 'Max', pattern: /^(hbo ?)?max$/ },
    { key: 'PARAMOUNT_PLUS', label: 'Paramount+', pattern: /^paramount/ },
    { key: 'DAZN', label: 'DAZN', pattern: /^dazn/ },
    { key: 'WOW', label: 'WOW', pattern: /^wow\b/ },
    { key: 'JOYN', label: 'Joyn', pattern: /^joyn/ },
    { key: 'RTL_PLUS', label: 'RTL+', pattern: /^rtl ?(\+|plus)/ },
    { key: 'MAGENTA_TV', label: 'MagentaTV', pattern: /^magenta ?tv/ },
    { key: 'ARD_MEDIATHEK', label: 'ARD Mediathek', pattern: /^ard mediathek/ },
    { key: 'ZDF_MEDIATHEK', label: 'ZDF Mediathek', pattern: /^zdf/ },
    { key: 'SPOTIFY', label: 'Spotify', pattern: /^spotify/ },
    { key: 'TWITCH', label: 'Twitch', pattern: /^twitch/ },
    { key: 'PLEX', label: 'Plex', pattern: /^plex/ },
    { key: 'BROWSER', label: 'Browser', pattern: /^(internet )?browser$|^chrome$/ },
];

/**
 * The apps of the TV that are one of `TV_APPS`
 *
 * @returns key of `TV_APPS` → `{ label, uri }`
 */
export function matchTvApps(apps: { title: string; uri: string }[]): Record<string, { label: string; uri: string }> {
    const result: Record<string, { label: string; uri: string }> = {};
    for (const app of apps) {
        const title = (app.title || '').trim().toLowerCase();
        const found = TV_APP_TITLES.find(entry => entry.pattern.test(title));
        if (found && !result[found.key]) {
            result[found.key] = { label: found.label, uri: app.uri };
        }
    }
    return result;
}

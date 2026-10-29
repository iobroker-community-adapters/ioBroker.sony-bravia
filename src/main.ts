import * as utils from '@iobroker/adapter-core';

import { Bravia } from './lib/bravia';
import { probe, type PingResult } from './lib/ping';
import {
    DEFAULT_INPUTS,
    inputToUri,
    matchTvApps,
    TUNER_CODES,
    TV_INPUT_LABELS,
    TV_KEY_CODES,
    uriToInput,
    VOLUME_DOWN_CODE,
    VOLUME_UP_CODE,
} from './lib/tv';
import type { Scheme, Source } from './lib/types';

/** Polling interval of checkStatus() */
const STATUS_INTERVAL = 10_000; /* TODO: make this a config variable? */
/** Number of channels read per source */
const CONTENT_COUNT = 150; /* TODO: make this a config variable? */

/** Payload of the `sendTo` commands of the remote control */
interface RemoteMessage {
    key?: string;
    on?: boolean;
    id?: string;
}

type RemoteResponse =
    | { result: 'ok' }
    | { apps: { id: string; name: string }[]; inputs: { id: string; name: string }[] }
    | { value: string; label: string }[];

/** @returns '' if `str` contains no latin letters or digits (e.g. a title in Cyrillic or Chinese only) */
const toSnakeCase = (str: string): string => {
    const parts = str.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]+|[0-9]+/g);
    return parts ? parts.map(x => x.toLowerCase()).join('_') : '';
};

class SonyBraviaAdapter extends utils.Adapter {
    private isConnected: boolean | null = null;
    private device: Bravia | null = null;
    private statusInterval: ioBroker.Interval | undefined;
    /** Apps of the TV that are one of the type-detector apps (`tv.app`): key → label and URI */
    private tvApps: Record<string, { label: string; uri: string }> = {};
    /** Inputs offered in `tv.input` */
    private tvInputs = new Set<string>(DEFAULT_INPUTS);

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'sony-bravia' });

        this.on('ready', () => void this.onReady());
        this.on('stateChange', (id, state) => this.onStateChange(id, state));
        this.on('message', obj => this.onMessage(obj));
        this.on('unload', callback => this.onUnload(callback));
    }

    /**
     * Commands of the remote control in the admin (src-admin/src/RemoteControlComponent.tsx):
     * - `remoteInfo` → `{ apps, inputs }`: the app and external input objects to show as buttons
     * - `remote` `{ key }`: an IRCC code (raw or by name)
     * - `power` `{ on }`, `launchApp` `{ id }`, `input` `{ id }` (IDs relative to the namespace)
     *
     * And of the IP field (`autocompleteSendTo` in admin/jsonConfig.json):
     * - `discover` → `[{ value: ip, label }]`: TVs found via SSDP
     *
     * Every command answers `{ result: 'ok' }` or `{ error }` once the TV answered.
     */
    private onMessage(obj: ioBroker.Message): void {
        if (!obj?.callback) {
            return;
        }
        this.handleMessage(obj)
            .then(response => this.sendTo(obj.from, obj.command, response, obj.callback))
            .catch(err =>
                this.sendTo(obj.from, obj.command, { error: (err as Error).message || String(err) }, obj.callback),
            );
    }

    private async handleMessage(obj: ioBroker.Message): Promise<RemoteResponse> {
        const message = (obj.message || {}) as RemoteMessage;
        if (obj.command === 'discover') {
            const devices = await Bravia.discover(this);
            this.log.debug(`Discovery: ${JSON.stringify(devices)}`);
            return devices.map(device => ({
                value: device.ip,
                label: `${device.friendlyName || device.modelName} (${device.ip})`,
            }));
        }
        if (obj.command === 'remoteInfo') {
            return {
                apps: await this.getButtons('appControl.app.'),
                inputs: await this.getButtons('avContent.extInput.'),
            };
        }

        const device = this.device;
        if (!device) {
            throw new Error('Please configure the Sony Bravia adapter');
        }

        switch (obj.command) {
            case 'remote':
                if (typeof message.key !== 'string' || !message.key) {
                    throw new Error('No key given');
                }
                await device.send(message.key);
                break;

            case 'power':
                await device.setPowerStatus(!!message.on);
                this.checkStatusLater(500);
                break;

            case 'launchApp':
            case 'input': {
                const prefix = obj.command === 'launchApp' ? 'appControl.app.' : 'avContent.extInput.';
                if (typeof message.id !== 'string' || !message.id.startsWith(prefix)) {
                    throw new Error(`Invalid ID ${message.id}`);
                }
                const uri = await this.getUriIfPowerIsActive(`${this.namespace}.${message.id}`, null);
                if (uri === null) {
                    throw new Error('Device have to turned on');
                }
                if (obj.command === 'launchApp') {
                    await device.setActiveApp(uri);
                    this.checkStatusLater(2000);
                } else {
                    await device.setPlayContent(uri);
                    this.checkStatusLater(500);
                }
                break;
            }

            default:
                throw new Error(`Unknown command ${obj.command}`);
        }
        return { result: 'ok' };
    }

    /** All button states below `prefix` (e.g. `appControl.app.`), sorted by name */
    private async getButtons(prefix: string): Promise<{ id: string; name: string }[]> {
        const objects = await this.getObjectViewAsync('system', 'state', {
            startkey: `${this.namespace}.${prefix}`,
            endkey: `${this.namespace}.${prefix}香`,
        });
        return objects.rows
            .filter(row => row.value?.native?.uri)
            .map(row => {
                const name = row.value.common.name;
                return {
                    id: row.id.substring(this.namespace.length + 1),
                    name: typeof name === 'object' ? name.en : name,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private async onReady(): Promise<void> {
        await this.createTvObjects();

        if (this.config.ip && this.config.ip !== '0.0.0.0' && this.config.psk) {
            const device = new Bravia(this, this.config.ip, '80', this.config.psk, 5000);
            this.device = device;
            // all state changes inside the adapters namespace are subscribed
            this.subscribeStates('*');
            void this.checkStatus();

            this.statusInterval = this.setInterval(() => void this.checkStatus(), STATUS_INTERVAL);

            device
                .getInterfaceInformation()
                .then(model => this.setState('info.modelInformation', { val: model, ack: true }))
                .catch(err => this.log.error((err as Error).message));

            void this.createAvContentObjects(device);
            void this.createAppObjects(device);
        } else {
            this.log.error('Please configure the Sony Bravia adapter');
        }
    }

    /**
     * The channel `tv` for the device type `tv` of the type-detector, parallel to the old objects.
     * extendObject: existing installations get changed roles/ranges on the next start.
     */
    private async createTvObjects(): Promise<void> {
        const state = (
            id: string,
            name: string,
            common: Partial<ioBroker.StateCommon> & Pick<ioBroker.StateCommon, 'role' | 'type'>,
        ): Promise<unknown> =>
            this.extendObjectAsync(`tv.${id}`, {
                type: 'state',
                common: { name, read: true, write: true, ...common },
                native: {},
            });

        await this.extendObjectAsync('tv', {
            type: 'channel',
            common: { name: 'TV (type-detector)' },
            native: {},
        });
        await state('power', 'Power', { role: 'switch.power', type: 'boolean' });
        await state('key', 'Remote control key', {
            role: 'media.key',
            type: 'string',
            states: Object.fromEntries(Object.entries(TV_KEY_CODES).map(([key, entry]) => [key, entry.label])),
        });
        await state('volume', 'Volume', { role: 'level.volume', type: 'number', min: 0, max: 100, unit: '%' });
        await state('muted', 'Muted', { role: 'media.mute', type: 'boolean' });
        await state('volumeUp', 'Volume up', { role: 'button.volume.up', type: 'boolean', read: false });
        await state('volumeDown', 'Volume down', { role: 'button.volume.down', type: 'boolean', read: false });
        await state('input', 'Input', { role: 'media.input', type: 'string' });
        await state('app', 'App', { role: 'media.app', type: 'string' });
        await state('unreach', 'Unreachable', { role: 'indicator.maintenance.unreach', type: 'boolean', write: false });
        await this.updateTvInputStates();
    }

    /** Replaces `common.states` (extendObject would merge the old keys into the new ones) */
    private async setCommonStates(id: string, states: Record<string, string>): Promise<void> {
        const obj = await this.getObjectAsync(id);
        if (obj && JSON.stringify(obj.common.states) !== JSON.stringify(states)) {
            obj.common.states = states;
            await this.setObjectAsync(id, obj);
        }
    }

    private updateTvInputStates(): Promise<void> {
        const states: Record<string, string> = {};
        // in the order of TV_INPUTS
        for (const [key, label] of Object.entries(TV_INPUT_LABELS)) {
            if (this.tvInputs.has(key)) {
                states[key] = label;
            }
        }
        return this.setCommonStates('tv.input', states);
    }

    /** Writes to `tv.*` */
    private async handleTvCommand(device: Bravia, id: string, val: ioBroker.StateValue): Promise<void> {
        const name = id.substring(`${this.namespace}.tv.`.length);
        switch (name) {
            case 'power':
                await device.setPowerStatus(!!val);
                this.checkStatusLater(500);
                return;

            case 'key': {
                const entry = TV_KEY_CODES[String(val)];
                if (!entry) {
                    throw new Error(`Unknown key ${val}`);
                }
                await device.send(entry.code);
                await this.setState(id, { val, ack: true });
                return;
            }

            case 'volumeUp':
            case 'volumeDown':
                await device.send(name === 'volumeUp' ? VOLUME_UP_CODE : VOLUME_DOWN_CODE);
                await this.setState(id, { val, ack: true });
                this.checkStatusLater(1000);
                return;

            case 'volume':
                if (await this.isPowerActive()) {
                    // the TV takes the volume as string, like audio.volume.*.volume
                    await device.setVolume('speaker', String(Math.round(Number(val))));
                    this.checkStatusLater(1000);
                }
                return;

            case 'muted':
                await device.setMute(!!val);
                this.checkStatusLater(1000);
                return;

            case 'input': {
                const input = String(val);
                if (!(await this.isPowerActive())) {
                    return;
                }
                if (TUNER_CODES[input]) {
                    await device.send(TUNER_CODES[input]);
                } else {
                    const uri = inputToUri(input);
                    if (!uri) {
                        throw new Error(`Unknown input ${input}`);
                    }
                    await device.setPlayContent(uri);
                }
                this.checkStatusLater(1000);
                return;
            }

            case 'app': {
                const app = this.tvApps[String(val)];
                if (!app) {
                    throw new Error(`Unknown app ${val}`);
                }
                if (await this.isPowerActive()) {
                    await device.setActiveApp(app.uri);
                    await this.setState(id, { val, ack: true });
                    this.checkStatusLater(2000);
                }
                return;
            }

            default:
                // tv.unreach is read only
                return;
        }
    }

    private onUnload(callback: () => void): void {
        try {
            // all other timers are cleared by adapter-core
            this.clearInterval(this.statusInterval);
            void this.setState('info.modelInformation', { val: '', ack: true });
            callback();
        } catch {
            callback();
        }
    }

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack || !this.device) {
            return;
        }
        this.handleCommand(this.device, id, state.val).catch(err => this.log.error((err as Error).message));
    }

    private async handleCommand(device: Bravia, id: string, val: ioBroker.StateValue): Promise<void> {
        if (id.startsWith(`${this.namespace}.tv.`)) {
            // before everything else: the last branch would send any unknown ID as IRCC code
            await this.handleTvCommand(device, id, val);
        } else if (id.endsWith('info.powerStatusActive')) {
            await device.setPowerStatus(val);
            this.checkStatusLater(500);
        } else if (id.includes('.avContent.')) {
            const uri = await this.getUriIfPowerIsActive(id, val);
            if (uri !== null) {
                await device.setPlayContent(uri);
                this.checkStatusLater(500);
            }
        } else if (id.includes('.appControl.terminateApps')) {
            if (await this.isPowerActive()) {
                await device.terminateApps();
                this.checkStatusLater(1000);
            }
        } else if (id.includes('.appControl.app.')) {
            const uri = await this.getUriIfPowerIsActive(id, val);
            if (uri !== null) {
                await device.setActiveApp(uri);
                this.checkStatusLater(2000);
            }
        } else if (id.includes('.audio.volume.') && id.endsWith('mute')) {
            await device.setMute(val);
            this.checkStatusLater(2000);
        } else if (id.includes('.audio.volume.') && id.endsWith('volume')) {
            if (await this.isPowerActive()) {
                const obj = await this.getObjectAsync(id);
                if (!obj) {
                    throw new Error(`Object ${id} not found`);
                }
                const target: string = obj.native.target;
                this.log.debug(`Controll volumne ${target}`);
                await device.setVolume(target, val);
                this.checkStatusLater(2000);
            }
        } else {
            // everything else is an IRCC code: the last part of the ID is the code
            await device.send(id.substring(id.lastIndexOf('.') + 1));
        }
    }

    private checkStatusLater(ms: number): void {
        this.setTimeout(() => void this.checkStatus(), ms);
    }

    /**
     * Reads the URI to switch to from the object of `id`: `<scheme>Selection` states hold a map
     * `value -> uri` in `native`, all other states the URI itself in `native.uri`.
     *
     * @returns null if the TV is turned off
     */
    private async getUriIfPowerIsActive(id: string, value: ioBroker.StateValue): Promise<string | undefined | null> {
        if (!(await this.isPowerActive())) {
            return null;
        }
        const obj = await this.getObjectAsync(id);
        if (!obj) {
            throw new Error(`Object ${id} not found`);
        }
        let uri: string | undefined;
        if (id.endsWith('Selection')) {
            uri = obj.native[String(value)];
        } else {
            uri = obj.native.uri;
        }
        this.log.debug(`Turn over to ${uri}`);
        return uri;
    }

    private async isPowerActive(): Promise<boolean> {
        const powerState = await this.getStateAsync('info.powerStatusActive');
        if (powerState?.val) {
            return true;
        }
        this.log.info('Device have to turned on');
        return false;
    }

    private setConnected(isConnected: boolean): void {
        if (this.isConnected !== isConnected) {
            this.isConnected = isConnected;
            void this.setState('info.connection', { val: isConnected, ack: true });
        }
    }

    private async createAppObjects(device: Bravia): Promise<void> {
        try {
            const apps = await device.getApplicationList();
            if (Array.isArray(apps)) {
                for (const app of apps) {
                    if (app.title && app.title.length > 1) {
                        const snakeTitle = toSnakeCase(app.title);
                        if (!snakeTitle) {
                            this.log.warn(`Cannot create an object ID for app "${app.title}", skipped`);
                            continue;
                        }
                        this.log.debug(`Create App ${app.title} at ${app.uri}`);
                        await this.setObjectNotExistsAsync(`appControl.app.${snakeTitle}`, {
                            type: 'state',
                            common: {
                                name: app.title,
                                role: 'button',
                                type: 'boolean',
                                read: false,
                                write: true,
                            },
                            native: {
                                uri: app.uri,
                            },
                        });
                    }
                }
                this.tvApps = matchTvApps(apps);
                await this.setCommonStates(
                    'tv.app',
                    Object.fromEntries(Object.entries(this.tvApps).map(([key, app]) => [key, app.label])),
                );
            } else {
                this.log.error(`Application List. Unknown content response ${JSON.stringify(apps)}`);
            }
        } catch (err) {
            this.log.error(`ApplicationList ${err}`);
        }
    }

    private async createAvContentObjects(device: Bravia): Promise<void> {
        let schemes: Scheme[];
        try {
            schemes = await device.getSchemeList();
        } catch (err) {
            this.log.error(`SchemeList ${err}`);
            return;
        }
        if (!Array.isArray(schemes)) {
            this.log.error(`Scheme List. Unknown content response ${JSON.stringify(schemes)}`);
            return;
        }
        for (const schema of schemes) {
            device
                .getSourceList(schema.scheme)
                .then(sources => this.createAvContentSourceObjects(device, schema, sources))
                .catch(err => this.log.error(`SourceList ${err}`));
        }
    }

    private async createAvContentSourceObjects(device: Bravia, schema: Scheme, sources: Source[]): Promise<void> {
        if (!Array.isArray(sources)) {
            this.log.error(`Source List. Unknown content response ${JSON.stringify(sources)}`);
            return;
        }
        const states: Record<string, string> = {};
        const uris: Record<string, string> = {};
        for (const source of sources) {
            try {
                const channels = await device.getContentList(0, CONTENT_COUNT, source.source);
                if (Array.isArray(channels)) {
                    for (const channel of channels) {
                        if (channel.title && channel.title.length > 1) {
                            const snakeTitle = toSnakeCase(channel.title);
                            if (!snakeTitle) {
                                this.log.warn(`Cannot create an object ID for "${channel.title}", skipped`);
                                continue;
                            }
                            this.log.debug(`Create ${schema.scheme} AV Content ${channel.title} at ${channel.uri}`);
                            await this.setObjectNotExistsAsync(`avContent.${schema.scheme}.${snakeTitle}`, {
                                type: 'state',
                                common: {
                                    name: channel.title,
                                    role: 'button',
                                    type: 'boolean',
                                    read: false,
                                    write: true,
                                },
                                native: {
                                    uri: channel.uri,
                                },
                            });
                            states[snakeTitle] = channel.title;
                            uris[snakeTitle] = channel.uri;
                        }
                    }
                } else {
                    this.log.error(`Content List. Unknown content response ${JSON.stringify(channels)}`);
                }
            } catch (err) {
                this.log.error(`ContentList ${err}`);
            }
        }
        if (schema.scheme === 'extInput') {
            // the external inputs the TV really has, instead of the defaults
            const found = Object.values(uris)
                .map(uri => uriToInput(uri))
                .filter((input): input is string => !!input);
            if (found.length) {
                this.tvInputs = new Set([...this.tvInputs].filter(input => input === 'TV' || input === 'SAT'));
                found.forEach(input => this.tvInputs.add(input));
                await this.updateTvInputStates();
            }
        } else if (schema.scheme === 'tv' && sources.some(source => source.source.startsWith('tv:dvbs'))) {
            this.tvInputs.add('SAT');
            await this.updateTvInputStates();
        }

        // value list of all channels of this scheme: value = snake title, native[value] = uri
        await this.setObjectAsync(`avContent.${schema.scheme}Selection`, {
            type: 'state',
            common: {
                name: 'content selection',
                type: 'string',
                role: 'state',
                read: false,
                write: true,
                states,
            },
            native: uris,
        });
    }

    private async checkStatus(): Promise<void> {
        let result: PingResult;
        try {
            result = await probe(this.config.ip, { log: msg => this.log.debug(msg) });
        } catch (err) {
            this.log.info(`ping cannot be executed ${err}`);
            this.setConnected(false);
            await this.setState('tv.unreach', { val: true, ack: true });
            return;
        }
        this.log.debug(`Ping result: ${JSON.stringify(result)}`);

        this.setConnected(result.alive);
        await this.setState('tv.unreach', { val: !result.alive, ack: true });

        if (result.alive && this.device) {
            // Check other read only objects
            await Promise.all([
                this.updatePowerStatus(this.device),
                this.updatePlayingContentInfo(this.device),
                this.updateVolumeInformation(this.device),
            ]);
        } else {
            await this.setState('info.powerStatusActive', { val: false, ack: true });
            await this.setState('tv.power', { val: false, ack: true });
            await this.setState('info.playingContentInfo', { val: '', ack: true });
        }
    }

    private async updatePowerStatus(device: Bravia): Promise<void> {
        try {
            const states = await device.getPowerStatus();
            const on = states.result[0].status == 'active';
            await this.setState('info.powerStatusActive', { val: on, ack: true });
            await this.setState('tv.power', { val: on, ack: true });
        } catch (err) {
            await this.setState('info.powerStatusActive', { val: false, ack: true });
            await this.setState('tv.power', { val: false, ack: true });
            this.log.info(`powerStatus cannot be determined ${err}`);
        }
    }

    private async updatePlayingContentInfo(device: Bravia): Promise<void> {
        try {
            const content = await device.getPlayingContentInfo();
            this.log.debug(`Aktiv content: ${JSON.stringify(content)}`);
            await this.setState('info.playingContentInfo', { val: content.title, ack: true });
            const input = uriToInput(content.uri) ?? uriToInput(content.source);
            if (input) {
                await this.setState('tv.input', { val: input, ack: true });
            }
            // TODO set StateSelector value
            /* const snakeTitle = toSnakeCase(content.title);
            const scheme = content.source.substring(0, content.source.lastIndexOf(":"));
            this.setState("avContent." + scheme + "Selection", { val: snakeTitle, ack: true }); */
        } catch (err) {
            await this.setState('info.playingContentInfo', { val: 'Illegal State', ack: true });
            this.log.debug(`contentInfo cannot be determined ${JSON.stringify(err)}`);
        }
    }

    private async updateVolumeInformation(device: Bravia): Promise<void> {
        try {
            const setups = await device.getVolumeInformation();
            if (!Array.isArray(setups)) {
                this.log.error(`Volume Information. Unknown content response ${JSON.stringify(setups)}`);
                return;
            }
            for (const setup of setups) {
                if (!Array.isArray(setup)) {
                    continue;
                }
                for (const audio of setup) {
                    if (audio.target && audio.target.length > 1 && toSnakeCase(audio.target)) {
                        const id = `audio.volume.${toSnakeCase(audio.target)}`;
                        await this.setObjectNotExistsAsync(id, {
                            type: 'channel',
                            common: {
                                name: audio.target,
                            },
                            native: {},
                        });
                        await this.setObjectNotExistsAsync(`${id}.volume`, {
                            type: 'state',
                            common: {
                                name: 'Volumen',
                                role: 'state',
                                type: 'string',
                                read: true,
                                write: true,
                            },
                            native: {
                                target: audio.target,
                            },
                        });
                        await this.setState(`${id}.volume`, { val: audio.volume.toString(), ack: true });
                        await this.setObjectNotExistsAsync(`${id}.mute`, {
                            type: 'state',
                            common: {
                                name: 'Stumm',
                                role: 'switch',
                                type: 'boolean',
                                read: true,
                                write: true,
                            },
                            native: {
                                target: audio.target,
                            },
                        });
                        await this.setState(`${id}.mute`, { val: audio.mute, ack: true });
                        if (audio.target === 'speaker') {
                            await this.setState('tv.volume', { val: Number(audio.volume), ack: true });
                            await this.setState('tv.muted', { val: audio.mute, ack: true });
                        }
                    }
                }
            }
        } catch (err) {
            this.log.info(`volumeInformation cannot be determined ${err}`);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new SonyBraviaAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new SonyBraviaAdapter())();
}

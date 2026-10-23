import * as utils from '@iobroker/adapter-core';

import { Bravia } from './lib/bravia';
import { probe, type PingResult } from './lib/ping';
import type { Scheme, Source } from './lib/types';

/** Polling interval of checkStatus() */
const STATUS_INTERVAL = 10_000; /* TODO: make this a config variable? */
/** Number of channels read per source */
const CONTENT_COUNT = 150; /* TODO: make this a config variable? */

/** @returns '' if `str` contains no latin letters or digits (e.g. a title in Cyrillic or Chinese only) */
const toSnakeCase = (str: string): string => {
    const parts = str.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]+|[0-9]+/g);
    return parts ? parts.map(x => x.toLowerCase()).join('_') : '';
};

class SonyBraviaAdapter extends utils.Adapter {
    private isConnected: boolean | null = null;
    private device: Bravia | null = null;
    private statusInterval: ioBroker.Interval | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'sony-bravia' });

        this.on('ready', () => this.onReady());
        this.on('stateChange', (id, state) => this.onStateChange(id, state));
        this.on('unload', callback => this.onUnload(callback));
    }

    private onReady(): void {
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
        if (id.endsWith('info.powerStatusActive')) {
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
            return;
        }
        this.log.debug(`Ping result: ${JSON.stringify(result)}`);

        this.setConnected(result.alive);

        if (result.alive && this.device) {
            // Check other read only objects
            await Promise.all([
                this.updatePowerStatus(this.device),
                this.updatePlayingContentInfo(this.device),
                this.updateVolumeInformation(this.device),
            ]);
        } else {
            await this.setState('info.powerStatusActive', { val: false, ack: true });
            await this.setState('info.playingContentInfo', { val: '', ack: true });
        }
    }

    private async updatePowerStatus(device: Bravia): Promise<void> {
        try {
            const states = await device.getPowerStatus();
            await this.setState('info.powerStatusActive', { val: states.result[0].status == 'active', ack: true });
        } catch (err) {
            await this.setState('info.powerStatusActive', { val: false, ack: true });
            this.log.info(`powerStatus cannot be determined ${err}`);
        }
    }

    private async updatePlayingContentInfo(device: Bravia): Promise<void> {
        try {
            const content = await device.getPlayingContentInfo();
            this.log.debug(`Aktiv content: ${JSON.stringify(content)}`);
            await this.setState('info.playingContentInfo', { val: content.title, ack: true });
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

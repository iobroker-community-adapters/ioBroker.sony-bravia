import axios from 'axios';
import { Client as SsdpClient } from 'node-ssdp';
import { parseString } from 'xml2js';

import { ServiceProtocol } from './service-protocol';
import type {
    ApplicationInfo,
    ContentItem,
    DiscoveredDevice,
    InterfaceInformation,
    IrccCode,
    JsonRpcError,
    JsonRpcResponse,
    PlayingContentInfo,
    PowerStatus,
    Scheme,
    ServiceApiInfo,
    Source,
    UpnpDescription,
    VolumeInformation,
} from './types';

const SSDP_SERVICE_TYPE = 'urn:schemas-sony-com:service:IRCC:1';
const SERVICE_PROTOCOLS = [
    'accessControl',
    'appControl',
    'audio',
    'avContent',
    'browser',
    'cec',
    'encryption',
    'guide',
    'recording',
    'system',
    'videoScreen',
] as const;
type ServiceProtocolName = (typeof SERVICE_PROTOCOLS)[number];

const DEFAULT_TIME_BETWEEN_COMMANDS = 350;
/** A raw IRCC code like `AAAAAQAAAAEAAAAuAw==`. Everything else is looked up by name. */
const IRCC_CODE_REGEX = /^[A]{5}[a-zA-Z0-9]{13}={2}$/;

/** Client for the Sony Bravia REST API (https://pro-bravia.sony.net/develop/integrate/rest-api/spec/) */
export class Bravia {
    private readonly adapter: ioBroker.Adapter;
    public readonly host: string;
    public readonly port: number | string;
    private readonly psk: string;
    private readonly timeout: number;
    /** Milliseconds between two IRCC codes in `send()` */
    public delay = DEFAULT_TIME_BETWEEN_COMMANDS;
    public readonly services: Record<ServiceProtocolName, ServiceProtocol>;

    private readonly url: string;
    private codes: IrccCode[] = [];
    private readonly apiInfoMap = new Map<string, ServiceApiInfo[]>();

    public constructor(
        adapter: ioBroker.Adapter,
        host: string,
        port: number | string = 80,
        psk = '0000',
        timeout = 5000,
    ) {
        this.adapter = adapter;
        this.host = host;
        this.port = port;
        this.psk = psk;
        this.timeout = timeout;

        const services: Partial<Record<ServiceProtocolName, ServiceProtocol>> = {};
        for (const protocol of SERVICE_PROTOCOLS) {
            services[protocol] = new ServiceProtocol(this, protocol);
        }
        this.services = services as Record<ServiceProtocolName, ServiceProtocol>;

        this.url = `http://${this.host}:${this.port}/sony`;
    }

    /** Searches the network via SSDP for TVs. Not used by the adapter itself. */
    public static discover(adapter: ioBroker.Adapter, timeout = 3000): Promise<DiscoveredDevice[]> {
        return new Promise((resolve, reject) => {
            const ssdp = new SsdpClient();
            const discovered: DiscoveredDevice[] = [];
            const timer = adapter.setTimeout(() => {
                void ssdp.stop();
                resolve(discovered);
            }, timeout);

            const failed = (error: Error): void => {
                void ssdp.stop();
                adapter.clearTimeout(timer);
                reject(error);
            };

            ssdp.on('response', (headers, statusCode, data) => {
                if (statusCode !== 200) {
                    return;
                }
                axios
                    .get<string>(String(headers.LOCATION), {
                        responseType: 'text',
                        validateStatus: () => true,
                    })
                    .then(response => {
                        if (response.status !== 200) {
                            failed(new Error(`Error retrieving the description metadata for device ${data.address}.`));
                            return;
                        }
                        const body = response.data;
                        parseString(body, (err: Error | null, result: UpnpDescription) => {
                            if (err) {
                                failed(new Error(`Failed to parse the discovery response: ${body}.`));
                                return;
                            }
                            try {
                                const device = result.root.device[0];
                                if (!device.serviceList) {
                                    // Not all devices return a serviceList (e.g. Philips Hue gateway responds without serviceList)
                                    return;
                                }
                                const service = device.serviceList[0].service.find(
                                    service => service.serviceType[0] === SSDP_SERVICE_TYPE,
                                );
                                if (!service) {
                                    throw new Error('IRCC service not found');
                                }

                                const api = new URL(service.controlURL[0]);
                                discovered.push({
                                    host: api.host,
                                    port: api.port || 80,
                                    friendlyName: device.friendlyName[0],
                                    manufacturer: device.manufacturer[0],
                                    manufacturerURL: device.manufacturerURL[0],
                                    modelName: device.modelName[0],
                                    UDN: device.UDN[0],
                                });
                            } catch {
                                failed(
                                    new Error(`Unexpected or malformed discovery response: ${JSON.stringify(result)}.`),
                                );
                            }
                        });
                    })
                    .catch(() =>
                        failed(new Error(`Error retrieving the description metadata for device ${data.address}.`)),
                    );
            });

            void ssdp.search(SSDP_SERVICE_TYPE);
        });
    }

    public get system(): ServiceProtocol {
        return this.services.system;
    }

    public async getIRCCCodes(): Promise<IrccCode[]> {
        if (this.codes.length > 0) {
            return this.codes;
        }

        this.codes = (await this.system.invoke<IrccCode[]>('getRemoteControllerInfo')) || [];
        return this.codes;
    }

    /** Sends one or more IRCC codes (raw like `AAAAAQAAAAEAAAAuAw==` or by name like `PowerOff`) */
    public async send(codes: string | string[]): Promise<void> {
        if (typeof codes === 'string') {
            codes = [codes];
        }

        for (const code of codes) {
            let value = code;
            if (!IRCC_CODE_REGEX.test(code)) {
                const response = await this.getIRCCCodes();
                const ircc = response.find(ircc => ircc.name === code);
                if (!ircc) {
                    throw new Error(`Unknown IRCC code ${code}.`);
                }
                value = ircc.value;
            }

            const body = `<?xml version="1.0"?>
          <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                  <u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1">
                      <IRCCCode>${value}</IRCCCode>
                  </u:X_SendIRCC>
              </s:Body>
          </s:Envelope>`;

            await this.request({ path: '/IRCC', body });
            // the pause is also made after the last code
            await this.wait(this.delay);
        }
    }

    private wait(ms: number): Promise<void> {
        return new Promise(resolve => this.adapter.setTimeout(resolve, ms));
    }

    /**
     * POST with the IRCC SOAP headers. With `json` the payload is sent as JSON and the answer is parsed as
     * JSON if possible (that is how `request({ json })` behaved), otherwise the answer is returned as string.
     */
    public async request(options: { path: string; body?: string; json?: unknown }): Promise<unknown> {
        const response = await axios.post<string>(
            this.url + options.path,
            options.json !== undefined ? JSON.stringify(options.json) : options.body,
            {
                timeout: this.timeout,
                // axios' timeout starts after the connection is established, `request` also covered the connect
                signal: AbortSignal.timeout(this.timeout),
                headers: {
                    'Content-Type': 'text/xml; charset=UTF-8',
                    SOAPACTION: '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
                    'X-Auth-PSK': this.psk,
                },
                responseType: 'text',
                validateStatus: () => true,
            },
        );

        if (response.status !== 200) {
            throw new Error(`Response error, status code: ${response.status}.`);
        }

        if (options.json !== undefined) {
            try {
                return JSON.parse(response.data);
            } catch {
                return response.data;
            }
        }
        return response.data;
    }

    /**
     * https://pro-bravia.sony.net/develop/integrate/rest-api/spec/service/system/v1_0/getInterfaceInformation/
     *
     * @returns `modelName productName/interfaceVersion`
     */
    public async getInterfaceInformation(): Promise<string> {
        const body = await this.jsonRequest<InterfaceInformation>('system', 'getInterfaceInformation');
        if (body.result) {
            return `${body.result[0].modelName} ${body.result[0].productName}/${body.result[0].interfaceVersion}`;
        }
        throw new Error(`getInterfaceInformation. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    /**
     * https://pro-bravia.sony.net/develop/integrate/rest-api/spec/service/avcontent/v1_0/getPlayingContentInfo/
     *
     * Rejects with the raw `error` tuple (e.g. `[40005, "Display Is Turned off"]`) if the TV answers with an error.
     */
    public async getPlayingContentInfo(): Promise<PlayingContentInfo> {
        const body = await this.jsonRequest<PlayingContentInfo>('avContent', 'getPlayingContentInfo');
        if (body.result) {
            return body.result[0];
        }
        if (body.error) {
            // What to return when display ist turned off. The caller only logs JSON.stringify(err).
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw body.error;
        }
        throw new Error(`getPlayingContentInfo. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    /**
     * https://pro-bravia.sony.net/develop/integrate/rest-api/spec/service/audio/v1_0/getVolumeInformation/
     *
     * @returns `result` (one array of targets) or, if the display is turned off, the `error` tuple
     */
    public async getVolumeInformation(): Promise<(VolumeInformation[] | JsonRpcError[number])[]> {
        const body = await this.jsonRequest<VolumeInformation[]>('audio', 'getVolumeInformation');
        if (body.result) {
            return body.result;
        }
        if (body.error && body.error[0] == 40005) {
            // Display Is Turned off
            return body.error;
        }
        throw new Error(`getVolumeInformation. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async setVolume(target: string, volume: ioBroker.StateValue): Promise<unknown> {
        let version: string;
        try {
            version = await this.getSupportedApiVersion('audio', 'setAudioVolume');
        } catch {
            // error handling issue #92 - test user fixed version
            try {
                return await this.setVolumeInternal(target, volume, '1.0');
            } catch {
                return [];
            }
        }
        return this.setVolumeInternal(target, volume, version);
    }

    private async setVolumeInternal(target: string, volume: ioBroker.StateValue, version: string): Promise<unknown> {
        const body = await this.jsonRequest('audio', 'setAudioVolume', [{ volume, target }], version);
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`setAudioVolume ${target} ${version}. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async setMute(status: ioBroker.StateValue): Promise<unknown> {
        const body = await this.jsonRequest('audio', 'setAudioMute', [{ status }], '1.0');
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`setAudioMute. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async getPowerStatus(): Promise<JsonRpcResponse<PowerStatus> & { result: PowerStatus[] }> {
        const body = await this.jsonRequest<PowerStatus>('system', 'getPowerStatus');
        if (body.result) {
            return body as JsonRpcResponse<PowerStatus> & { result: PowerStatus[] };
        }
        throw new Error(`getPowerStatus. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async setPowerStatus(status: ioBroker.StateValue): Promise<JsonRpcResponse<unknown>> {
        const body = await this.jsonRequest('system', 'setPowerStatus', [{ status }]);
        if (body.result) {
            return body;
        }
        throw new Error(`setPowerStatus. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async getSchemeList(): Promise<Scheme[]> {
        const body = await this.jsonRequest<Scheme[]>('avContent', 'getSchemeList');
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`getSchemeList. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async getSourceList(scheme: string): Promise<Source[]> {
        const body = await this.jsonRequest<Source[]>('avContent', 'getSourceList', [{ scheme }]);
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`getSourceList. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async getSupportedApiInfo(schema: string): Promise<ServiceApiInfo[]> {
        const body = await this.jsonRequest<ServiceApiInfo[]>('guide', 'getSupportedApiInfo', [{ services: [schema] }]);
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`getSupportedApiInfo. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    /** Returns the newest version of `method` the TV supports */
    public async getSupportedApiVersion(schema: string, method: string): Promise<string> {
        let apiInfo = this.apiInfoMap.get(schema);
        if (!apiInfo) {
            apiInfo = await this.getSupportedApiInfo(schema);
            this.apiInfoMap.set(schema, apiInfo);
        }
        for (const api of apiInfo[0].apis) {
            if (api.name == method) {
                return api.versions[api.versions.length - 1].version;
            }
        }
        return '1.0';
    }

    public async getContentList(startIndex: number, count: number, source: string): Promise<ContentItem[]> {
        let version: string;
        try {
            version = await this.getSupportedApiVersion('avContent', 'getContentList');
        } catch {
            // error handling issue #92 - test user fixed version
            try {
                return await this.getContentListInternal(startIndex, count, source, '1.0');
            } catch {
                return [];
            }
        }
        return this.getContentListInternal(startIndex, count, source, version);
    }

    private async getContentListInternal(
        startIndex: number,
        count: number,
        source: string,
        version: string,
    ): Promise<ContentItem[]> {
        const body = await this.jsonRequest<ContentItem[]>(
            'avContent',
            'getContentList',
            [{ stIdx: startIndex, cnt: count, uri: source }],
            version,
        );
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`getContentList ${version} ${source}. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async setPlayContent(uri: string | undefined): Promise<unknown> {
        const body = await this.jsonRequest('avContent', 'setPlayContent', [{ uri }]);
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`setPlayContent. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async getApplicationList(): Promise<ApplicationInfo[]> {
        const body = await this.jsonRequest<ApplicationInfo[]>('appControl', 'getApplicationList');
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`getApplicationList. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async setActiveApp(uri: string | undefined): Promise<unknown> {
        const body = await this.jsonRequest('appControl', 'setActiveApp', [{ uri }]);
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`setActiveApp. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    public async terminateApps(): Promise<unknown> {
        const body = await this.jsonRequest('appControl', 'terminateApps');
        if (body.result) {
            return body.result[0];
        }
        throw new Error(`terminateApps. Response error. Missing result. ${JSON.stringify(body)}`);
    }

    private async jsonRequest<T = unknown>(
        serviceProtocol: string,
        method: string,
        params: unknown[] = [],
        version = '1.0',
        id = 1337,
    ): Promise<JsonRpcResponse<T>> {
        const response = await axios.post<string>(
            `${this.url}/${serviceProtocol}`,
            JSON.stringify({ method, id, params, version }),
            {
                timeout: this.timeout,
                // axios' timeout starts after the connection is established, `request` also covered the connect
                signal: AbortSignal.timeout(this.timeout),
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Auth-PSK': this.psk,
                },
                responseType: 'text',
                validateStatus: () => true,
            },
        );

        if (response.status !== 200) {
            throw new Error(`${method}. Response error, status code: ${response.status}.`);
        }
        return JSON.parse(response.data) as JsonRpcResponse<T>;
    }
}

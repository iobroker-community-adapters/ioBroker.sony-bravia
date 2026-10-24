/** `error` member of a Sony JSON-RPC answer: `[code, message]`, e.g. `[40005, "Display Is Turned off"]` */
export type JsonRpcError = [number, string];

/** Answer of `POST /sony/<service>` (https://pro-bravia.sony.net/develop/integrate/rest-api/spec/) */
export interface JsonRpcResponse<T> {
    result?: T[];
    /** some services (e.g. getMethodTypes) answer with `results` instead of `result` */
    results?: T;
    error?: JsonRpcError;
    id: number;
}

/** system/getInterfaceInformation */
export interface InterfaceInformation {
    modelName: string;
    serverName: string;
    interfaceVersion: string;
    productName: string;
    productCategory: string;
}

/** avContent/getPlayingContentInfo */
export interface PlayingContentInfo {
    source: string;
    title: string;
    uri: string;
}

/** audio/getVolumeInformation */
export interface VolumeInformation {
    volume: number;
    minVolume: number;
    mute: boolean;
    maxVolume: number;
    target: string;
}

/** system/getPowerStatus */
export interface PowerStatus {
    /** 'active' or 'standby' */
    status: string;
}

/** avContent/getSchemeList */
export interface Scheme {
    scheme: string;
}

/** avContent/getSourceList */
export interface Source {
    source: string;
}

/** avContent/getContentList */
export interface ContentItem {
    title: string;
    uri: string;
    index?: number;
    dispNum?: string;
    programMediaType?: string;
}

/** appControl/getApplicationList */
export interface ApplicationInfo {
    title: string;
    uri: string;
    icon?: string;
    data?: string;
}

/** guide/getSupportedApiInfo */
export interface ServiceApiInfo {
    service: string;
    protocols: string[];
    apis: {
        name: string;
        versions: { version: string; protocols?: string[] }[];
    }[];
}

/** system/getRemoteControllerInfo (second entry of `result`) */
export interface IrccCode {
    name: string;
    value: string;
}

/** A TV found by `Bravia.discover()` */
export interface DiscoveredDevice {
    /** IP address (or host name) of the TV, what goes into `native.ip` */
    ip: string;
    /** host incl. port if it is not 80 */
    host: string;
    port: string | number;
    friendlyName: string;
    manufacturer: string;
    manufacturerURL: string;
    modelName: string;
    UDN: string;
}

/** UPnP device description as parsed by xml2js (every element is an array) */
export interface UpnpDescription {
    root: {
        device: {
            friendlyName: string[];
            manufacturer: string[];
            manufacturerURL?: string[];
            modelName: string[];
            UDN: string[];
            serviceList?: {
                service: {
                    serviceType: string[];
                    controlURL: string[];
                }[];
            }[];
        }[];
    };
}

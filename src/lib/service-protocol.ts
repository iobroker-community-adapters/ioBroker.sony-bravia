import type { Bravia } from './bravia';
import type { JsonRpcResponse } from './types';

export interface MethodTypes {
    version: string;
    methods: unknown;
}

/** One service (`/sony/<protocol>`) of the TV, invoked via the IRCC request with a JSON body */
export class ServiceProtocol {
    private readonly bravia: Bravia;
    public readonly protocol: string;
    private readonly methods: MethodTypes[] = [];

    public constructor(bravia: Bravia, protocol: string) {
        this.bravia = bravia;
        this.protocol = protocol;
    }

    public getVersions(): Promise<string[] | undefined> {
        return this.invoke<string[]>('getVersions');
    }

    public async getMethodTypes(version?: string): Promise<MethodTypes | MethodTypes[] | undefined> {
        if (!this.methods.length) {
            const versions = (await this.getVersions()) || [];
            for (const v of versions) {
                const results = await this.invoke('getMethodTypes', '1.0', v);
                if (results) {
                    this.methods.push({ version: v, methods: results });
                }
            }
        }

        if (version) {
            return this.methods.find(method => method.version === version);
        }
        return this.methods;
    }

    public async invoke<T = unknown>(method: string, version = '1.0', params?: unknown): Promise<T | undefined> {
        // the answer is parsed as JSON if possible, otherwise it is a string and has none of the properties below
        const response = (await this.bravia.request({
            path: `/${this.protocol}`,
            json: {
                id: 3,
                method,
                version,
                params: params ? [params] : [],
            },
        })) as JsonRpcResponse<T>;

        if (response.error) {
            throw new Error(response.error[1]);
        }

        if (response.results) {
            return response.results;
        }
        if (response.result) {
            return response.result[response.result.length > 1 ? 1 : 0];
        }
        return undefined;
    }
}

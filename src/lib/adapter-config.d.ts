// Augments the globally declared ioBroker types with everything this adapter adds.
// Keep in sync with `native` in io-package.json and with admin/jsonConfig.json.
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** IP address of the TV, e.g. 192.168.1.20 */
            ip: string;
            /** Pre-Shared Key configured on the TV (IP Control -> Authentication) */
            psk: string;
        }
    }
}

export {};

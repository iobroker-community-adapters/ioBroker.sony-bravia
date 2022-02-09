'use strict';

const SsdpClient = require('node-ssdp').Client;
const Request = require('request');
const URL = require('url');
const parseString = require('xml2js').parseString;

const ServiceProtocol = require('./service-protocol');

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
    'videoScreen'
];
const DEFAULT_TIME_BETWEEN_COMMANDS = 350;

class Bravia {
    constructor(host, port = 80, psk = '0000', timeout = 5000) {
        this.host = host;
        this.port = port;
        this.psk = psk;
        this.timeout = timeout;
        this.protocols = SERVICE_PROTOCOLS;
        this.delay = DEFAULT_TIME_BETWEEN_COMMANDS;

        for (let key in this.protocols) {
            let protocol = this.protocols[key];
            this[protocol] = new ServiceProtocol(this, protocol);
        }

        this._url = `http://${this.host}:${this.port}/sony`;
        this._codes = [];

        this.apiInfoMap = new Map();
    }

    static discover(timeout = 3000) {
        return new Promise((resolve, reject) => {
            let ssdp = new SsdpClient();
            let discovered = [];

            ssdp.on('response', (headers, statusCode, data) => {
                if (statusCode === 200) {
                    Request.get(headers.LOCATION, (error, response, body) => {
                        if (!error && response.statusCode === 200) {
                            parseString(body, (err, result) => {
                                if (!err) {
                                    try {
                                        let device = result.root.device[0];
                                        if (!device.serviceList) {  // Not all devices return a serviceList (e.g. Philips Hue gateway responds without serviceList)
                                            return;
                                        }
                                        let service = device.serviceList[0].service
                                            .find(service => service.serviceType[0] === SSDP_SERVICE_TYPE);

                                        let api = URL.parse(service.controlURL[0]);
                                        discovered.push({
                                            host: api.host,
                                            port: (api.port || 80),
                                            friendlyName: device.friendlyName[0],
                                            manufacturer: device.manufacturer[0],
                                            manufacturerURL: device.manufacturerURL[0],
                                            modelName: device.modelName[0],
                                            UDN: device.UDN[0]
                                        });
                                    } catch (e) {
                                        failed(new Error(`Unexpected or malformed discovery response: ${result}.`));
                                    }
                                } else {
                                    failed(new Error(`Failed to parse the discovery response: ${body}.`));
                                }
                            });
                        } else {
                            failed(new Error(`Error retrieving the description metadata for device ${data.address}.`));
                        }
                    });
                }
            });

            ssdp.search(SSDP_SERVICE_TYPE);

            let failed = error => {
                ssdp.stop();
                clearTimeout(timer);
                reject(error);
            };

            let timer = setTimeout(() => {
                ssdp.stop();
                resolve(discovered);
            }, timeout);
        });
    }

    getIRCCCodes() {
        return new Promise((resolve, reject) => {
            if (this._codes.length > 0) {
                resolve(this._codes);
                return;
            }

            this.system
                .invoke('getRemoteControllerInfo')
                .then(codes => {
                    this._codes = codes;
                    resolve(this._codes);
                }, reject);
        });
    }

    send(codes) {
        return new Promise((resolve, reject) => {
            if (typeof codes === 'string') {
                codes = [codes];
            }

            let index = 0;
            let next = () => {
                if (index < codes.length) {
                    let code = codes[index++];
                    if (/^[A]{5}[a-zA-Z0-9]{13}[\=]{2}$/.test(code)) {
                        send(code);
                    } else {
                        this.getIRCCCodes()
                            .then(response => {
                                let ircc = response.find(ircc => ircc.name === code);
                                if (!ircc) {
                                    reject(new Error(`Unknown IRCC code ${code}.`));
                                    return;
                                }

                                send(ircc.value);
                            }, reject);
                    }
                } else {
                    resolve();
                }
            };

            let send = code => {
                let body = `<?xml version="1.0"?>
          <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                  <u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1">
                      <IRCCCode>${code}</IRCCCode>
                  </u:X_SendIRCC>
              </s:Body>
          </s:Envelope>`;

                this._request({
                    path: '/IRCC',
                    body: body
                }).then(() => setTimeout(() => next(), this.delay), reject);
            };

            next();
        });
    }

    _request(options) {
        return new Promise((resolve, reject) => {
            options.timeout = this.timeout;
            options.url = this._url + options.path;
            options.headers = {
                'Content-Type': 'text/xml; charset=UTF-8',
                'SOAPACTION': '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
                'X-Auth-PSK': this.psk
            };

            Request.post(options, (error, response, body) => {
                if (!error && response.statusCode === 200) {
                    resolve(body);
                } else {
                    if (error) {
                        reject(error);
                    } else if (response.statusCode != 200) {
                        reject(new Error(`Response error, status code: ${response.statusCode}.`))
                    } else if (body.error) {
                        reject(new Error(body.error[1]));
                    } else {
                        parseString(body, (err, result) => {
                            if (!err) {
                                try {
                                    reject(new Error(result['s:Envelope']['s:Body'][0]['s:Fault'][0]['detail'][0]['UPnPError'][0]['errorDescription'][0]));
                                } catch (e) {
                                    reject(new Error(`Unexpected or malformed error response: ${result}.`));
                                }
                            } else {
                                reject(new Error(`Failed to parse the error response: ${body}.`));
                            }
                        });
                    }
                }
            });
        });
    }

    /**
     * https://pro-bravia.sony.net/develop/integrate/rest-api/spec/service/system/v1_0/getInterfaceInformation/
     * {
     *   "result": [{
     *     "modelName": "FW-55BZ35F",
     *     "serverName": "",
     *     "interfaceVersion": "5.0.1",
     *     "productName": "BRAVIA",
     *     "productCategory": "tv"
     *   }],
     *   "id": 33
     * }
     * @returns result.productName/result.interfaceVersion result.modelName 
     */
    getInterfaceInformation() {
        return new Promise((resolve, reject) => {
            this._jsonRequest("system", "getInterfaceInformation").then(body => {
                if (body.result) {
                    resolve(`${body.result[0].modelName} ${body.result[0].productName}/${body.result[0].interfaceVersion}`);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`getInterfaceInformation. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    /**
     * https://pro-bravia.sony.net/develop/integrate/rest-api/spec/service/avcontent/v1_0/getPlayingContentInfo/
     * {
     *     "result": [{
     *         "source": "extInput:hdmi",
     *         "title": "HDMI 2",
     *         "uri": "extInput:hdmi?port=2"
     *     }],
     *     "id": 103
     * }
     * {
     *     "error": [
     *         40005,
     *         "Display Is Turned off"
     *     ],
     *     "id": 103
     * }
     * @returns result.title
     */
    getPlayingContentInfo() {
        return new Promise((resolve, reject) => {
            this._jsonRequest("avContent", "getPlayingContentInfo").then(body => {
                if (body.result) {
                    resolve(body.result[0].title);
                } else if (body.error) {
                    // What to return when display ist turned off
                    resolve(body.error[1]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`getPlayingContentInfo. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    getPowerStatus() {
        return new Promise((resolve, reject) => {
            this._jsonRequest("system", "getPowerStatus").then(body => {
                if (body.result) {
                    resolve(body);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`getPowerStatus. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    setPowerStatus(_status) {
        return new Promise((resolve, reject) => {
            this._jsonRequest("system", "setPowerStatus", [{ "status": (_status) }]).then(body => {
                if (body.result) {
                    resolve(body);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`setPowerStatus. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    getSchemeList() {
        return new Promise((resolve, reject) => {
            this._jsonRequest("avContent", "getSchemeList").then(body => {
                if (body.result) {
                    resolve(body.result[0]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`getSchemeList. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    getSourceList(_scheme) {
        return new Promise((resolve, reject) => {
            this._jsonRequest("avContent", "getSourceList", [{ scheme: _scheme }]).then(body => {
                if (body.result) {
                    resolve(body.result[0]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`getSourceList. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    getSupportedApiInfo(_schema) {
        return new Promise((resolve, reject) => {
            this._jsonRequest("guide", "getSupportedApiInfo", [{ services: [_schema] }]).then(body => {
                if (body.result) {
                    resolve(body.result[0]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`getSupportedApiInfo. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    async getSupportedApiVersion(_schema, _methode) {
        let apiInfo = this.apiInfoMap.get(_schema);
        if (!apiInfo) {
            apiInfo = await this.getSupportedApiInfo(_schema);
            this.apiInfoMap.set(_schema, apiInfo);
        }
        for (const api of apiInfo[0].apis) {
            if (api.name == _methode) {
                return api.versions[api.versions.length - 1].version;
            }
        }
        return "1.0";
    }

    getContentList(_startIndex, _count, _source) {
        return new Promise((resolve, reject) => {
            this.getSupportedApiVersion("avContent", "getContentList").then(version => {
                this._jsonRequest("avContent", "getContentList", [{ stIdx: _startIndex, cnt: _count, uri: _source }], version).then(body => {
                    if (body.result) {
                        resolve(body.result[0]);
                    } else {
                        let err = JSON.stringify(body);
                        reject(new Error(`getContentList ${_source}. Response error. Missing result. ${err}`));
                    }
                }).catch(error => {
                    reject(error);
                });
            }).catch(error => {
                reject(error);
            });
        });
    }

    setPlayContent(_uri) {
        return new Promise((resolve, reject) => {
            this._jsonRequest("avContent", "setPlayContent", [{ uri: _uri }]).then(body => {
                if (body.result) {
                    resolve(body.result[0]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`setPlayContent. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    getApplicationList() {
        return new Promise((resolve, reject) => {
            this._jsonRequest("appControl", "getApplicationList").then(body => {
                if (body.result) {
                    resolve(body.result[0]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`getApplicationList. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    setActiveApp(_uri) {
        return new Promise((resolve, reject) => {
            this._jsonRequest("appControl", "setActiveApp", [{ uri: _uri }]).then(body => {
                if (body.result) {
                    resolve(body.result[0]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`setActiveApp. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    terminateApps() {
        return new Promise((resolve, reject) => {
            this._jsonRequest("appControl", "terminateApps").then(body => {
                if (body.result) {
                    resolve(body.result[0]);
                } else {
                    let err = JSON.stringify(body);
                    reject(new Error(`terminateApps. Response error. Missing result. ${err}`));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    _jsonRequest(_serviceProtocol/*: string*/, _method/*: string*/, _params/*: string[]*/ = [], _version = "1.0", _id = 1337) {
        return new Promise((resolve, reject) => {
            Request.post({
                timeout: this.timeout,
                url: this._url + "/" + _serviceProtocol,
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Auth-PSK': this.psk
                },
                method: 'POST',
                body: JSON.stringify({
                    method: _method,
                    id: _id,
                    params: _params,
                    version: _version,
                }),
            }, (error, response, body) => {
                if (!error && response.statusCode === 200) {
                    resolve(JSON.parse(body));
                } else {
                    if (error) {
                        reject(error);
                    } else if (response.statusCode != 200) {
                        reject(new Error(`${_method}. Response error, status code: ${response.statusCode}.`))
                    } else if (body.error) {
                        reject(new Error(body.error[1]));
                    } else {
                        reject(body);
                    }
                }
            });
        });
    }
}

module.exports = Bravia;
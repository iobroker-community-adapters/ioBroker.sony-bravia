import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { platform } from 'node:os';

const p = platform().toLowerCase();

export interface PingConfig {
    numeric?: boolean;
    /** seconds */
    timeout?: number;
    minReply?: number;
    extra?: string[];
    log?: (message: string) => void;
}

export interface PingResult {
    host: string;
    alive: boolean;
    ms: string | null;
}

/** Pings `addr` once with the system ping command */
export function probe(addr: string, config: PingConfig = {}): Promise<PingResult> {
    return new Promise((resolve, reject) => {
        let ls: ChildProcessWithoutNullStreams;
        const log = config.log || console.log;
        let outstring = '';

        const numeric = config.numeric === undefined ? true : config.numeric;
        const timeout = config.timeout === undefined ? 2 : config.timeout;
        const minReply = config.minReply === undefined ? 1 : config.minReply;
        const extra = config.extra || [];

        const xfamily = ['linux', 'sunos', 'unix'];
        const regex = /=.*[<|=]([0-9]*).*TTL|ttl..*=([0-9.]*)/;

        // Note: options and their values are passed as ONE argument (e.g. '-w 2') - this was always like this
        if (xfamily.includes(p)) {
            // linux
            let args: string[] = [];
            if (numeric !== false) {
                args.push('-n');
            }
            args.push(`-w ${timeout}`);
            args.push(`-c ${minReply}`);
            args = args.concat(extra);
            args.push(addr);

            log(`System command: /bin/ping ${args.join(' ')}`);
            ls = spawn('/bin/ping', args);
        } else if (p.match(/^win/)) {
            // windows
            let args: string[] = [];
            args.push(`-n ${minReply}`);
            args.push(`-w ${timeout * 1000}`);
            args = args.concat(extra);
            args.push(addr);

            const allArgs = [
                '/s', // leave quotes as they are
                '/c', // run and exit
                // !!! order of c and s is important - c must come last!!!
                '"', // enforce starting quote
                `${process.env.SystemRoot}\\system32\\ping.exe`, // command itself. Notice that you'll have to pass it quoted if it contains spaces
            ]
                .concat(args)
                .concat('"'); // enforce closing quote

            log(`System command: ${process.env.comspec || 'cmd.exe'} ${allArgs.join(' ')}`);
            // switch the command to cmd shell instead of the original command
            ls = spawn(process.env.comspec || 'cmd.exe', allArgs, { windowsVerbatimArguments: true });
        } else if (p === 'darwin' || p === 'freebsd') {
            // mac osx or freebsd
            let args: string[] = [];
            if (numeric !== false) {
                args.push('-n');
            }
            args.push(`-t ${timeout}`);
            args.push(`-c ${minReply}`);
            args = args.concat(extra);
            args.push(addr);

            log(`System command: /sbin/ping ${args.join(' ')}`);
            ls = spawn('/sbin/ping', args);
        } else {
            reject(new Error(`Your platform "${p}" is not supported`));
            return;
        }

        ls.on('error', () => {
            reject(
                new Error(
                    'ping.probe: there was an error while executing the ping program. check the path or permissions...',
                ),
            );
        });

        ls.stdout.on('data', (data: Buffer) => {
            outstring += String(data);
        });

        ls.on('exit', (code: number | null) => {
            const lines = outstring.split('\n');
            let ms: string | null = null;

            for (const line of lines) {
                const m = regex.exec(line);
                if (m) {
                    ms = m[1] || m[2];
                    break;
                }
            }

            let alive: boolean;
            if (p.match(/^win/)) {
                alive = ms !== null;
            } else {
                alive = !code;
            }

            resolve({ host: addr, alive, ms });
        });
    });
}

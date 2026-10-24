import React from 'react';

import { Box, ButtonBase, CircularProgress, Tooltip, Typography } from '@mui/material';
import {
    Add,
    ArrowBack,
    Dialpad,
    FastForward,
    FastRewind,
    Home,
    Info,
    Input,
    KeyboardArrowDown,
    KeyboardArrowLeft,
    KeyboardArrowRight,
    KeyboardArrowUp,
    ListAlt,
    Pause,
    PlayArrow,
    PowerSettingsNew,
    Refresh,
    Remove,
    Stop,
    Tune,
    VolumeOff,
} from '@mui/icons-material';
import { I18n } from '@iobroker/gui-components';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

/** How long a command may take before the remote reports that the instance does not answer, in ms */
const SEND_TIMEOUT = 15_000;

/**
 * IRCC codes of the keys. The same codes are used by the button states in io-package.json
 * (e.g. `others.AAAAAQAAAAEAAAB0Aw==` = Up), the adapter sends them unchanged.
 */
const IRCC = {
    Input: 'AAAAAQAAAAEAAAAlAw==',
    Home: 'AAAAAQAAAAEAAABgAw==',
    Options: 'AAAAAgAAAJcAAAA2Aw==',
    Display: 'AAAAAQAAAAEAAAA6Aw==',
    EPG: 'AAAAAgAAAKQAAABbAw==',
    Up: 'AAAAAQAAAAEAAAB0Aw==',
    Down: 'AAAAAQAAAAEAAAB1Aw==',
    Left: 'AAAAAQAAAAEAAAA0Aw==',
    Right: 'AAAAAQAAAAEAAAAzAw==',
    Confirm: 'AAAAAQAAAAEAAABlAw==',
    Return: 'AAAAAgAAAJcAAAAjAw==',
    Mute: 'AAAAAQAAAAEAAAAUAw==',
    VolumeUp: 'AAAAAQAAAAEAAAASAw==',
    VolumeDown: 'AAAAAQAAAAEAAAATAw==',
    ChannelUp: 'AAAAAQAAAAEAAAAQAw==',
    ChannelDown: 'AAAAAQAAAAEAAAARAw==',
    Red: 'AAAAAgAAAJcAAAAlAw==',
    Green: 'AAAAAgAAAJcAAAAmAw==',
    Yellow: 'AAAAAgAAAJcAAAAnAw==',
    Blue: 'AAAAAgAAAJcAAAAkAw==',
    Rewind: 'AAAAAgAAAJcAAAAbAw==',
    Play: 'AAAAAgAAAJcAAAAaAw==',
    Pause: 'AAAAAgAAAJcAAAAZAw==',
    Stop: 'AAAAAgAAAJcAAAAYAw==',
    Forward: 'AAAAAgAAAJcAAAAcAw==',
    Num1: 'AAAAAQAAAAEAAAAAAw==',
    Num2: 'AAAAAQAAAAEAAAABAw==',
    Num3: 'AAAAAQAAAAEAAAACAw==',
    Num4: 'AAAAAQAAAAEAAAADAw==',
    Num5: 'AAAAAQAAAAEAAAAEAw==',
    Num6: 'AAAAAQAAAAEAAAAFAw==',
    Num7: 'AAAAAQAAAAEAAAAGAw==',
    Num8: 'AAAAAQAAAAEAAAAHAw==',
    Num9: 'AAAAAQAAAAEAAAAIAw==',
    Num0: 'AAAAAQAAAAEAAAAJAw==',
} as const;

/** Keyboard keys that work while the remote has the focus */
const KEYBOARD: Record<string, string> = {
    ArrowUp: IRCC.Up,
    ArrowDown: IRCC.Down,
    ArrowLeft: IRCC.Left,
    ArrowRight: IRCC.Right,
    Enter: IRCC.Confirm,
    Backspace: IRCC.Return,
    Escape: IRCC.Return,
    Home: IRCC.Home,
    '+': IRCC.VolumeUp,
    '-': IRCC.VolumeDown,
    m: IRCC.Mute,
    ' ': IRCC.Play,
    '0': IRCC.Num0,
    '1': IRCC.Num1,
    '2': IRCC.Num2,
    '3': IRCC.Num3,
    '4': IRCC.Num4,
    '5': IRCC.Num5,
    '6': IRCC.Num6,
    '7': IRCC.Num7,
    '8': IRCC.Num8,
    '9': IRCC.Num9,
};

/** What a press sends to the instance */
type Command = { key: string } | { app: string } | { input: string } | { power: boolean };

/** An app or input as `remoteInfo` of the instance reports it; `id` is relative to the namespace */
interface Button {
    id: string;
    name: string;
}

const COLORS = {
    body: 'linear-gradient(180deg, #2b2f36 0%, #1c1f24 100%)',
    key: '#3a3f47',
    keyHover: '#4a505a',
    keyActive: '#5b626e',
    text: '#e8eaed',
    textDim: '#9aa0a6',
    power: '#c62828',
    powerHover: '#e53935',
    ring: '#30343b',
    ok: '#454b54',
    red: '#d32f2f',
    green: '#388e3c',
    yellow: '#fbc02d',
    blue: '#1976d2',
};

interface RemoteControlComponentState extends ConfigGenericState {
    /** Apps and inputs of the TV, `null` while asking */
    apps: Button[] | null;
    inputs: Button[] | null;
    /** Command that is being sent right now */
    busy: string | null;
    /** Text of the last error, empty if the last command went through */
    error: string;
    online: boolean | null;
    power: boolean | null;
    playing: string;
    numbers: boolean;
}

/**
 * A remote control in the settings, so a user sees right away whether the TV answers.
 *
 * Every press goes as `sendTo` to the running instance (`remote`, `power`, `launchApp`, `input`), which
 * answers once the TV got it - or with an error that is shown below the remote. It works with the IP and
 * PSK of the running instance, not with unsaved settings.
 */
export default class RemoteControlComponent extends ConfigGeneric<ConfigGenericProps, RemoteControlComponentState> {
    private mounted = false;

    private subscribed: string[] = [];

    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = {
            ...this.state,
            apps: null,
            inputs: null,
            busy: null,
            error: '',
            online: null,
            power: null,
            playing: '',
            numbers: false,
        };
    }

    get target(): string {
        return `${this.props.oContext.adapterName}.${this.props.oContext.instance}`;
    }

    /**
     * The TV is known to be off: only the power key works then.
     * While the state is unknown the keys stay usable.
     */
    get isOff(): boolean {
        return this.state.power === false || this.state.online === false;
    }

    async componentDidMount(): Promise<void> {
        void super.componentDidMount();
        this.mounted = true;
        this.subscribe();
        await this.loadInfo();
    }

    componentWillUnmount(): void {
        this.mounted = false;
        super.componentWillUnmount();
        this.unsubscribe();
    }

    async loadInfo(): Promise<void> {
        if (!this.props.alive) {
            this.setState({ apps: [], inputs: [] });
            return;
        }
        try {
            const response: { apps?: Button[]; inputs?: Button[] } | null = await this.props.oContext.socket.sendTo(
                this.target,
                'remoteInfo',
                {},
            );
            if (this.mounted) {
                this.setState({ apps: response?.apps ?? [], inputs: response?.inputs ?? [] });
            }
        } catch {
            if (this.mounted) {
                this.setState({ apps: [], inputs: [] });
            }
        }
    }

    /** Follow the connection, power and playing content of the TV */
    subscribe(): void {
        this.subscribed = [
            `${this.target}.info.connection`,
            `${this.target}.info.powerStatusActive`,
            `${this.target}.info.playingContentInfo`,
        ];
        for (const id of this.subscribed) {
            void this.props.oContext.socket.subscribeState(id, this.onStateChanged);
        }
    }

    unsubscribe(): void {
        for (const id of this.subscribed) {
            this.props.oContext.socket.unsubscribeState(id, this.onStateChanged);
        }
        this.subscribed = [];
    }

    onStateChanged = (id: string, state: ioBroker.State | null | undefined): void => {
        if (!this.mounted || !this.subscribed.includes(id)) {
            return;
        }
        if (id.endsWith('.info.playingContentInfo')) {
            const val = state?.val;
            // the adapter writes 'Illegal State' if the TV does not tell what is playing
            this.setState({ playing: typeof val === 'string' && val !== 'Illegal State' ? val : '' });
            return;
        }
        const value = state ? !!state.val : null;
        if (id.endsWith('.info.connection')) {
            this.setState({ online: value });
        } else {
            this.setState({ power: value });
        }
    };

    async send(name: string, command: Command): Promise<void> {
        if (this.state.busy || !this.props.alive) {
            return;
        }
        this.setState({ busy: name, error: '' });

        let request: [string, Record<string, unknown>];
        if ('key' in command) {
            request = ['remote', { key: command.key }];
        } else if ('app' in command) {
            request = ['launchApp', { id: command.app }];
        } else if ('input' in command) {
            request = ['input', { id: command.input }];
        } else {
            request = ['power', { on: command.power }];
        }

        let error = '';
        try {
            const response = (await Promise.race([
                this.props.oContext.socket.sendTo(this.target, request[0], request[1]),
                new Promise(resolve =>
                    setTimeout(() => resolve({ error: I18n.t('custom_sonybravia_no_answer') }), SEND_TIMEOUT),
                ),
            ])) as { error?: string } | null;
            error = response?.error || '';
        } catch (e) {
            error = (e as Error).message || String(e);
        }

        if (this.mounted) {
            this.setState({ busy: null, error });
        }
    }

    onKeyDown = (event: React.KeyboardEvent): void => {
        const key = KEYBOARD[event.key];
        if (key && !this.isOff) {
            event.preventDefault();
            void this.send(key, { key });
        }
    };

    renderKey(
        name: string,
        command: Command,
        content: React.ReactNode,
        title: string,
        sx: Record<string, unknown> = {},
    ): React.JSX.Element {
        const busy = this.state.busy === name;
        return (
            <Tooltip
                title={title}
                placement="top"
                enterDelay={600}
            >
                <span>
                    <ButtonBase
                        aria-label={title}
                        disabled={!this.props.alive || (!!this.state.busy && !busy) || (name !== 'power' && this.isOff)}
                        onClick={() => void this.send(name, command)}
                        sx={{
                            width: 52,
                            height: 52,
                            borderRadius: '50%',
                            backgroundColor: COLORS.key,
                            color: COLORS.text,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
                            transition: 'background-color 120ms, transform 80ms',
                            '&:hover': { backgroundColor: COLORS.keyHover },
                            '&:active': { backgroundColor: COLORS.keyActive, transform: 'scale(0.95)' },
                            '&.Mui-disabled': { opacity: 0.45 },
                            ...sx,
                        }}
                    >
                        {busy ? (
                            <CircularProgress
                                size={20}
                                sx={{ color: COLORS.text }}
                            />
                        ) : (
                            content
                        )}
                    </ButtonBase>
                </span>
            </Tooltip>
        );
    }

    /** One key of the remote control by its IRCC code */
    code(code: string, content: React.ReactNode, title: string, sx?: Record<string, unknown>): React.JSX.Element {
        return this.renderKey(code, { key: code }, content, title, sx);
    }

    /** A vertical rocker like the volume and channel keys of a real remote */
    renderRocker(
        up: string,
        down: string,
        label: string,
        upTitle: string,
        downTitle: string,
        icons: [React.ReactNode, React.ReactNode],
    ): React.JSX.Element {
        const half = { width: 52, height: 52, backgroundColor: 'transparent', boxShadow: 'none' };
        return (
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    borderRadius: 26,
                    backgroundColor: COLORS.key,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
            >
                {this.code(up, icons[0], upTitle, half)}
                <Typography sx={{ fontSize: 11, fontWeight: 'bold', color: COLORS.textDim, letterSpacing: 1 }}>
                    {label}
                </Typography>
                {this.code(down, icons[1], downTitle, half)}
            </Box>
        );
    }

    renderDpad(): React.JSX.Element {
        const arrow = { position: 'absolute', backgroundColor: 'transparent', boxShadow: 'none' };
        return (
            <Box
                sx={{
                    position: 'relative',
                    width: 190,
                    height: 190,
                    borderRadius: '50%',
                    backgroundColor: COLORS.ring,
                    boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05)',
                    my: 1,
                }}
            >
                {this.code(IRCC.Up, <KeyboardArrowUp fontSize="large" />, I18n.t('custom_sonybravia_up'), {
                    ...arrow,
                    top: 4,
                    left: 69,
                })}
                {this.code(IRCC.Down, <KeyboardArrowDown fontSize="large" />, I18n.t('custom_sonybravia_down'), {
                    ...arrow,
                    bottom: 4,
                    left: 69,
                })}
                {this.code(IRCC.Left, <KeyboardArrowLeft fontSize="large" />, I18n.t('custom_sonybravia_left'), {
                    ...arrow,
                    left: 4,
                    top: 69,
                })}
                {this.code(IRCC.Right, <KeyboardArrowRight fontSize="large" />, I18n.t('custom_sonybravia_right'), {
                    ...arrow,
                    right: 4,
                    top: 69,
                })}
                {this.code(IRCC.Confirm, <span style={{ fontWeight: 'bold', fontSize: 16 }}>OK</span>, 'OK', {
                    position: 'absolute',
                    top: 55,
                    left: 55,
                    width: 80,
                    height: 80,
                    backgroundColor: COLORS.ok,
                })}
            </Box>
        );
    }

    /** The four color keys as flat bars */
    renderColorKeys(): React.JSX.Element {
        const bar = { width: 44, height: 18, borderRadius: '9px' };
        return (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                {this.code(IRCC.Red, null, I18n.t('custom_sonybravia_red'), { ...bar, backgroundColor: COLORS.red })}
                {this.code(IRCC.Green, null, I18n.t('custom_sonybravia_green'), {
                    ...bar,
                    backgroundColor: COLORS.green,
                })}
                {this.code(IRCC.Yellow, null, I18n.t('custom_sonybravia_yellow'), {
                    ...bar,
                    backgroundColor: COLORS.yellow,
                })}
                {this.code(IRCC.Blue, null, I18n.t('custom_sonybravia_blue'), { ...bar, backgroundColor: COLORS.blue })}
            </Box>
        );
    }

    renderNumbers(): React.JSX.Element {
        const keys = [
            IRCC.Num1,
            IRCC.Num2,
            IRCC.Num3,
            IRCC.Num4,
            IRCC.Num5,
            IRCC.Num6,
            IRCC.Num7,
            IRCC.Num8,
            IRCC.Num9,
        ];
        const digit = (code: string, label: string): React.JSX.Element =>
            this.code(code, <span style={{ fontSize: 16 }}>{label}</span>, label, { width: 44, height: 44 });
        return (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, justifyItems: 'center' }}>
                {keys.map((code, i) => (
                    <React.Fragment key={code}>{digit(code, String(i + 1))}</React.Fragment>
                ))}
                <span />
                {digit(IRCC.Num0, '0')}
                <span />
            </Box>
        );
    }

    /** A grid of rounded text buttons: apps or inputs */
    renderPills(items: { id: string; label: string; command: Command }[], columns: number): React.JSX.Element {
        return (
            <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 1, width: '100%' }}>
                {items.map(item => {
                    const busy = this.state.busy === item.id;
                    return (
                        <Tooltip
                            key={item.id}
                            title={item.label}
                            enterDelay={600}
                        >
                            <span>
                                <ButtonBase
                                    aria-label={item.label}
                                    disabled={!this.props.alive || (!!this.state.busy && !busy) || this.isOff}
                                    onClick={() => void this.send(item.id, item.command)}
                                    sx={{
                                        width: '100%',
                                        height: 34,
                                        borderRadius: '17px',
                                        border: `1px solid ${COLORS.textDim}`,
                                        color: COLORS.text,
                                        fontSize: 12,
                                        fontWeight: 'bold',
                                        px: 1,
                                        overflow: 'hidden',
                                        whiteSpace: 'nowrap',
                                        textOverflow: 'ellipsis',
                                        display: 'block',
                                        transition: 'background-color 120ms, transform 80ms',
                                        '&:hover': { backgroundColor: COLORS.keyHover },
                                        '&:active': { transform: 'scale(0.96)' },
                                        '&.Mui-disabled': { opacity: 0.45 },
                                    }}
                                >
                                    {busy ? (
                                        <CircularProgress
                                            size={16}
                                            sx={{ color: COLORS.text }}
                                        />
                                    ) : (
                                        item.label
                                    )}
                                </ButtonBase>
                            </span>
                        </Tooltip>
                    );
                })}
            </Box>
        );
    }

    renderApps(): React.JSX.Element {
        const apps = this.state.apps ?? [];
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: '100%' }}>
                {apps.length
                    ? this.renderPills(
                          apps.map(app => ({ id: `app:${app.id}`, label: app.name, command: { app: app.id } })),
                          2,
                      )
                    : null}
                <ButtonBase
                    onClick={() => void this.loadInfo()}
                    disabled={!this.props.alive || !!this.state.busy}
                    sx={{ color: COLORS.textDim, fontSize: 12, borderRadius: 1, px: 1, gap: 0.5 }}
                >
                    <Refresh sx={{ fontSize: 14 }} />
                    {I18n.t(apps.length ? 'custom_sonybravia_apps_reload' : 'custom_sonybravia_no_apps')}
                </ButtonBase>
            </Box>
        );
    }

    renderStatus(): React.JSX.Element {
        const { online, power, playing } = this.state;
        let color = '#5f6368';
        let text = I18n.t('custom_sonybravia_state_unknown');
        if (!this.props.alive) {
            text = I18n.t('custom_sonybravia_not_alive');
        } else if (online === false) {
            text = I18n.t('custom_sonybravia_state_offline');
        } else if (power === true) {
            color = '#34a853';
            text = I18n.t('custom_sonybravia_state_on');
        } else if (power === false) {
            color = '#ea4335';
            text = I18n.t('custom_sonybravia_state_off');
        }
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: color,
                            boxShadow: power ? `0 0 6px ${color}` : 'none',
                        }}
                    />
                    <Typography sx={{ fontSize: 12, color: COLORS.textDim }}>{text}</Typography>
                </Box>
                {power && playing ? (
                    <Typography
                        sx={{
                            fontSize: 12,
                            color: COLORS.text,
                            maxWidth: 200,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                        }}
                        title={playing}
                    >
                        {playing}
                    </Typography>
                ) : null}
            </Box>
        );
    }

    renderItem(): React.JSX.Element {
        const { apps, inputs, power } = this.state;
        if (apps === null || inputs === null) {
            return (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                </Box>
            );
        }
        if (!this.props.alive) {
            return (
                <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    {I18n.t('custom_sonybravia_not_alive')}
                </Typography>
            );
        }

        const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' };
        const small = { width: 40, height: 40 };
        // while the TV is off only power works
        const off = this.isOff;

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', py: 2 }}>
                <Box
                    tabIndex={0}
                    onKeyDown={this.onKeyDown}
                    sx={{
                        width: 260,
                        px: 3,
                        py: 3,
                        borderRadius: '44px',
                        background: COLORS.body,
                        boxShadow: '0 10px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        outline: 'none',
                        '&:focus-visible': { boxShadow: '0 0 0 2px #1976d2, 0 10px 30px rgba(0,0,0,0.45)' },
                    }}
                >
                    <Box sx={off ? { ...row, justifyContent: 'center' } : row}>
                        {this.renderKey(
                            'power',
                            { power: !power },
                            <PowerSettingsNew />,
                            I18n.t(power ? 'custom_sonybravia_power_off' : 'custom_sonybravia_power_on'),
                            { backgroundColor: COLORS.power, '&:hover': { backgroundColor: COLORS.powerHover } },
                        )}
                        {off ? null : this.code(IRCC.Input, <Input />, I18n.t('custom_sonybravia_input'))}
                    </Box>

                    {this.renderStatus()}

                    {off ? null : (
                        <>
                            {inputs.length
                                ? this.renderPills(
                                      inputs.map(input => ({
                                          id: `input:${input.id}`,
                                          label: input.name,
                                          command: { input: input.id },
                                      })),
                                      Math.min(inputs.length, 3),
                                  )
                                : null}

                            <Box sx={row}>
                                {this.code(IRCC.Home, <Home />, I18n.t('custom_sonybravia_home'))}
                                {this.code(IRCC.Options, <Tune />, I18n.t('custom_sonybravia_options'))}
                                {this.code(IRCC.Display, <Info />, I18n.t('custom_sonybravia_display'))}
                            </Box>

                            {this.renderDpad()}

                            <Box sx={row}>
                                {this.code(IRCC.Return, <ArrowBack />, I18n.t('custom_sonybravia_back'))}
                                {this.code(IRCC.EPG, <ListAlt />, I18n.t('custom_sonybravia_guide'))}
                                {this.code(IRCC.Mute, <VolumeOff />, I18n.t('custom_sonybravia_mute'))}
                            </Box>

                            <Box sx={{ ...row, alignItems: 'stretch' }}>
                                {this.renderRocker(
                                    IRCC.VolumeUp,
                                    IRCC.VolumeDown,
                                    'VOL',
                                    I18n.t('custom_sonybravia_volume_up'),
                                    I18n.t('custom_sonybravia_volume_down'),
                                    [<Add key="up" />, <Remove key="down" />],
                                )}
                                <ButtonBase
                                    aria-label={I18n.t('custom_sonybravia_numbers')}
                                    onClick={() => this.setState({ numbers: !this.state.numbers })}
                                    sx={{
                                        alignSelf: 'center',
                                        width: 44,
                                        height: 44,
                                        borderRadius: '50%',
                                        color: this.state.numbers ? COLORS.text : COLORS.textDim,
                                        backgroundColor: this.state.numbers ? COLORS.keyActive : 'transparent',
                                    }}
                                >
                                    <Dialpad />
                                </ButtonBase>
                                {this.renderRocker(
                                    IRCC.ChannelUp,
                                    IRCC.ChannelDown,
                                    'CH',
                                    I18n.t('custom_sonybravia_channel_up'),
                                    I18n.t('custom_sonybravia_channel_down'),
                                    [<KeyboardArrowUp key="up" />, <KeyboardArrowDown key="down" />],
                                )}
                            </Box>

                            {this.state.numbers ? this.renderNumbers() : null}

                            {this.renderColorKeys()}

                            <Box sx={{ ...row, gap: 0.5 }}>
                                {this.code(
                                    IRCC.Rewind,
                                    <FastRewind fontSize="small" />,
                                    I18n.t('custom_sonybravia_rewind'),
                                    small,
                                )}
                                {this.code(
                                    IRCC.Play,
                                    <PlayArrow fontSize="small" />,
                                    I18n.t('custom_sonybravia_play'),
                                    small,
                                )}
                                {this.code(
                                    IRCC.Pause,
                                    <Pause fontSize="small" />,
                                    I18n.t('custom_sonybravia_pause'),
                                    small,
                                )}
                                {this.code(
                                    IRCC.Stop,
                                    <Stop fontSize="small" />,
                                    I18n.t('custom_sonybravia_stop'),
                                    small,
                                )}
                                {this.code(
                                    IRCC.Forward,
                                    <FastForward fontSize="small" />,
                                    I18n.t('custom_sonybravia_forward'),
                                    small,
                                )}
                            </Box>

                            {this.renderApps()}
                        </>
                    )}

                    <Typography
                        sx={{
                            mt: 1,
                            fontSize: 13,
                            fontWeight: 'bold',
                            letterSpacing: 4,
                            color: COLORS.textDim,
                            userSelect: 'none',
                        }}
                    >
                        SONY
                    </Typography>
                </Box>

                <Typography
                    role="status"
                    sx={{
                        mt: 2,
                        minHeight: 24,
                        maxWidth: 420,
                        textAlign: 'center',
                        color: this.state.error ? 'error.main' : 'text.secondary',
                        fontSize: 14,
                    }}
                >
                    {this.state.error || I18n.t(off ? 'custom_sonybravia_switch_on_first' : 'custom_sonybravia_hint')}
                </Typography>
            </Box>
        );
    }
}

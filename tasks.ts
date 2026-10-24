/*!
 * ioBroker build tasks: builds the custom JsonConfig component (remote control) of src-admin/ into admin/custom/
 */
import { buildReact, copyFiles, deleteFoldersRecursive, npmInstall } from '@iobroker/build-tools';

const srcAdmin = `${__dirname}/src-admin/`;

function clean(): void {
    deleteFoldersRecursive(`${__dirname}/admin/custom`);
    deleteFoldersRecursive(`${srcAdmin}build`);
}

function build(): Promise<void> {
    return buildReact(srcAdmin, { rootDir: srcAdmin, vite: true });
}

// `mf-manifest.json` is copied on purpose: admin fetches it next to the remote entry to decide
// from the shared modules which GUI API generation this component was built against.
function copyAllFiles(): void {
    copyFiles(['src-admin/build/**/*', '!src-admin/build/index.html'], 'admin/custom/');
    copyFiles(['src-admin/src/i18n/*.json'], 'admin/custom/i18n');
}

function fail(step: string): (e: unknown) => never {
    return (e: unknown) => {
        console.error(`Cannot ${step}: ${e as string}`);
        process.exit(1);
    };
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-npm')) {
    npmInstall(srcAdmin).catch(fail('install npm'));
} else if (process.argv.includes('--2-build')) {
    build().catch(fail('build admin'));
} else if (process.argv.includes('--3-copy')) {
    copyAllFiles();
} else {
    clean();
    npmInstall(srcAdmin)
        .then(() => build())
        .then(() => copyAllFiles())
        .catch(fail('build admin'));
}

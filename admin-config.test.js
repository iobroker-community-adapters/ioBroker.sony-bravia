const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

describe('admin jsonConfig migration', () => {
    const rootDir = __dirname;
    const adminDir = path.join(rootDir, 'admin');
    const languages = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];

    function collectTexts(node, target) {
        if (!node || typeof node !== 'object') {
            return;
        }

        for (const key of ['label', 'help', 'text']) {
            if (typeof node[key] === 'string') {
                target.add(node[key]);
            }
        }

        if (node.items && typeof node.items === 'object') {
            Object.values(node.items).forEach(item => collectTexts(item, target));
        }
    }

    it('uses jsonConfig in io-package', () => {
        const ioPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'io-package.json'), 'utf8'));

        expect(ioPackage.common.adminUI).to.deep.equal({ config: 'json' });
        expect(ioPackage.native).to.deep.equal({ ip: '', psk: '' });
    });

    it('provides jsonConfig, short-form translations, and removes legacy admin files', () => {
        const jsonConfig = JSON.parse(fs.readFileSync(path.join(adminDir, 'jsonConfig.json'), 'utf8'));
        const requiredTexts = new Set();

        expect(jsonConfig.i18n).to.equal(true);
        expect(jsonConfig.type).to.equal('panel');

        for (const item of Object.values(jsonConfig.items)) {
            expect(item).to.include.all.keys('xs', 'sm', 'md', 'lg', 'xl');
        }

        collectTexts(jsonConfig, requiredTexts);

        for (const lang of languages) {
            const translationPath = path.join(adminDir, 'i18n', `${lang}.json`);
            expect(fs.existsSync(translationPath), `missing translation file for ${lang}`).to.equal(true);

            const translations = JSON.parse(fs.readFileSync(translationPath, 'utf8'));
            for (const text of requiredTexts) {
                expect(translations, `missing "${text}" in ${lang}.json`).to.have.property(text);
            }
        }

        expect(fs.existsSync(path.join(adminDir, 'index.html'))).to.equal(false);
        expect(fs.existsSync(path.join(adminDir, 'index_m.html'))).to.equal(false);
        expect(fs.existsSync(path.join(adminDir, 'words.js'))).to.equal(false);
    });
});

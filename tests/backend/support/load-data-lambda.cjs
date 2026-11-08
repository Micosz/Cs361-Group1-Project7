const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
module.exports = async function load(name, replies) {
    const calls = [];
    class DynamoDBClient {}
    class ScanCommand { constructor(input) { this.input = input; } }
    const DynamoDBDocumentClient = { from: () => ({ send: async command => {
        calls.push(command.input);
        if (!replies.length) throw Error('Unexpected DynamoDB request');
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply;
    } }) };
    const sandbox = vm.createContext({ process: { env: { PARTNER_TABLE: 'test-partners' } }, console: { error() {} }, exports: {} });
    const sdk = { DynamoDBClient, ScanCommand, DynamoDBDocumentClient };
    const file = path.resolve(__dirname, '../../..', 'backend/lambda', name, name === 'getPublicPartners' ? 'index.cjs' : 'index.mjs');
    const source = fs.readFileSync(file, 'utf8');
    let handler;
    if (file.endsWith('.cjs')) {
        sandbox.require = specifier => { if (!specifier.startsWith('@aws-sdk/')) throw Error(specifier); return sdk; };
        vm.runInContext(source, sandbox, { filename: file });
        handler = sandbox.exports.handler;
    } else {
        const mod = new vm.SourceTextModule(source, { context: sandbox });
        await mod.link(async specifier => {
            if (!specifier.startsWith('@aws-sdk/')) throw Error(specifier);
            return new vm.SyntheticModule(Object.keys(sdk), function() { for (const [key, value] of Object.entries(sdk)) this.setExport(key, value); }, { context: sandbox });
        });
        await mod.evaluate(); handler = mod.namespace.handler;
    }
    return { handler, calls };
};

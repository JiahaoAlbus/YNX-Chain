'use strict';
// Synthetic only: execute the exact read-only DOM classifier in the Java source.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/com/ynxweb4/browser/qa/instrumentation/BrowserJourneyInstrumentation.java'), 'utf8');
const literal = source.split('\n').find(line => line.includes('String script = "JSON.stringify((function(){var b='));
assert.ok(literal, 'Actual document classifier must exist');
// This Java string uses the shared JSON-compatible quote/backslash escape subset.
const script = JSON.parse(literal.slice(literal.indexOf('"'), literal.lastIndexOf(';')));
new vm.Script(script);
function classify(options = {}) {
    const document = {
        body: options.noBody ? null : {innerText: options.body || 'Synthetic search results'},
        title: 'SYNTHETIC ONLY', readyState: 'complete',
        documentElement: {getAttribute: () => options.errorPage ? 'true' : null},
        querySelector: () => options.captcha === undefined ? null : {getClientRects: () => options.captcha ? [{}] : []},
        querySelectorAll: selector => ({length: selector.startsWith('li.b_algo') ? options.bing || 0 : options.ddg || 0})
    };
    return JSON.parse(vm.runInNewContext(script, {document, location: {href: options.url || 'https://duckduckgo.com/?q=synthetic'}}));
}
let checks = 0;
function check(name, options, expected) {
    const actual = classify(options);
    for (const [field, value] of Object.entries(expected)) assert.deepEqual(actual[field], value, `${name}: ${field}`);
    checks++;
}
check('synthetic DDG anchors', {ddg: 3}, {ddgResultCount: 3, bingResultCount: 0, challenge: false, refusal: false});
check('synthetic Bing anchors', {bing: 2}, {bingResultCount: 2, ddgResultCount: 0});
check('unknown markup is no result evidence', {}, {ddgResultCount: 0, bingResultCount: 0});
check('visible challenge widget', {captcha: true}, {challenge: true});
check('hidden challenge widget is not proof', {captcha: false}, {challenge: false});
check('visible human verification text', {body: 'Please verify you are human'}, {challenge: true});
check('DDG bot challenge text', {body: 'Unfortunately, bots use DuckDuckGo too.'}, {challenge: true});
check('provider error path', {url: 'https://duckduckgo.com/static-pages/home-error/?error=418'}, {refusal: true});
check('provider error DOM attribute', {errorPage: true}, {refusal: true});
check('actual known Tor refusal wording', {body: 'We have detected that you have connected over Tor'}, {refusal: true});
check('generic error wording does not invent CAPTCHA', {body: 'Unexpected error. Please try again'}, {refusal: true, challenge: false});
check('absent document body', {noBody: true}, {body: '', challenge: false, refusal: false});
assert.equal(classify({body: 'x'.repeat(40000)}).body.length, 30000, 'Body evidence must remain bounded');
checks++;
console.log(JSON.stringify({scope: 'SYNTHETIC_CLASSIFIER_ONLY', status: 'PASS', checks, androidRuntime: 'NOT_RUN', network: 'NOT_RUN'}));

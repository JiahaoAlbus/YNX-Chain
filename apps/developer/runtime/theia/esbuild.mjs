/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';

import esbuild from 'esbuild';
import { pythonTerminalCreationPlugin } from './scripts/python-terminal-creation-build.mjs';

// This editable production entry is owned source. Leaving it as an ignored
// generated template omitted the augmentation even though fixture builds used
// it correctly. Keep the original generator plugins and pinned vendor guard.
if (!Array.isArray(nodeOptions.plugins)) throw Error('The retained Node build plugin contract changed.');
nodeOptions.plugins = [pythonTerminalCreationPlugin(), ...nodeOptions.plugins];

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);


if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}

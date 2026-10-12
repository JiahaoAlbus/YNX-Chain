// Presentation state only. Authentication, workspace trust and extension
// credentials keep their existing browser/private-service storage paths.
const UI_KEYS = new Set(['layout', 'perspective-layouts', 'keyboard', 'commands', 'editor-navigation-contribution', 'recently-closed-editors', 'debug.configurations', 'debug:watch', 'breakpoints', 'mergeEditor/layoutMode']);
function uiKey(key) { return typeof key === 'string' && key.length <= 4096 && !/[\u0000-\u001f]/.test(key) && (UI_KEYS.has(key) || [...UI_KEYS].some(name => key.endsWith(':' + name))); }
module.exports = { uiKey, UI_KEYS };

// Minimal stand-in for @decky/api: connects to Decky Loader's plugin API the
// same way the real package does. __PLUGIN_NAME__ is replaced at build time.
const api = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit.connect(1, __PLUGIN_NAME__);

export const routerHook = api.routerHook;
export const toaster = api.toaster;
export const call = (method, ...args) => api.call(method, ...args);
export const openFilePicker = (...args) => api.openFilePicker(...args);
export const FileSelectionType = { FILE: 0, FOLDER: 1 };
export const definePlugin = (fn) => (...args) => fn(...args);

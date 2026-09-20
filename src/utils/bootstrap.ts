/**
 * Application Bootstrap & Polyfills
 * Intercepts legacy Node.js API calls in third-party dependencies (e.g. http-proxy util._extend)
 * to use modern Object.assign() and prevent DEP0060 DeprecationWarnings.
 */
import util from 'util';

if (util) {
  Object.defineProperty(util, '_extend', {
    value: function (target: object, source: object): object {
      return Object.assign(target ?? {}, source ?? {});
    },
    writable: true,
    configurable: true
  });
}

export default true;

const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
// NodeNext shared sources name emitted .js modules. Metro consumes their .ts
// sources directly; resolve only an existing adjacent source, never an alias.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const source = path.resolve(
      path.dirname(context.originModulePath),
      moduleName.slice(0, -3) + '.ts',
    );
    const sharedRoot = path.resolve(__dirname, '../../packages') + path.sep;
    if (source.startsWith(sharedRoot) && fs.existsSync(source))
      return context.resolveRequest(context, source, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;

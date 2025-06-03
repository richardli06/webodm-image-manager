const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    ignore: [
      // Exclude the image handler server (MAIN CULPRIT - likely has huge node_modules)
      /^\/image_request_handler/,
      
      // Exclude development files
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/\.nyc_output/,
      /^\/coverage/,
      /^\/src/,
      /^\/docs/,
      /^\/test/,
      /^\/tests/,
      
      // Exclude large data folders that might exist
      /^\/data/,
      /^\/logs/,
      /^\/temp/,
      /^\/uploads/,
      /^\/output/,
      /^\/maps/,
      /^\/orthophotos/,
      
      // Exclude OS files
      /^\/\.DS_Store/,
      /^\/Thumbs\.db/,
      
      // Exclude npm cache
      /^\/node_modules\/\.cache/,
      
      // Exclude any log files
      /\.log$/,
      
      // Exclude any large image files that might be in root
      /\.(tif|tiff|jpg|jpeg|png|bmp)$/i
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

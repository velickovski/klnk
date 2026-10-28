import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const bundleIdentifier = process.env.IOS_BUNDLE_IDENTIFIER ?? config.ios?.bundleIdentifier;
  const owner = process.env.EXPO_OWNER;
  const projectId = process.env.EAS_PROJECT_ID;
  const localNetworking = process.env.IOS_ALLOW_LOCAL_NETWORK === 'true';
  const cloudBuild = process.env.EAS_BUILD === 'true';
  if (cloudBuild && (!process.env.IOS_BUNDLE_IDENTIFIER || !owner || !projectId))
    throw new Error(
      'Set IOS_BUNDLE_IDENTIFIER, EXPO_OWNER and EAS_PROJECT_ID for your own signing/project before an EAS build.',
    );
  if (bundleIdentifier && !/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier))
    throw new Error('IOS_BUNDLE_IDENTIFIER must be a valid, unique reverse-domain identifier.');
  if (
    projectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
  )
    throw new Error('EAS_PROJECT_ID must be the real UUID from your Expo project.');
  const infoPlist = { ...config.ios?.infoPlist };
  if (localNetworking) {
    infoPlist.NSLocalNetworkUsageDescription =
      'Connect to your Personal Voice Agent backend on your private Wi-Fi network during development.';
    infoPlist.NSAppTransportSecurity = {
      NSAllowsLocalNetworking: true,
      NSExceptionDomains: Object.fromEntries(
        ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].map((range) => [
          range,
          { NSExceptionAllowsInsecureHTTPLoads: true },
        ]),
      ),
    };
  }
  return {
    ...config,
    name: config.name ?? 'Personal Voice Agent',
    slug: config.slug ?? 'personal-voice-agent',
    ...(owner ? { owner } : {}),
    ios: { ...config.ios, bundleIdentifier, infoPlist },
    plugins: [
      ...(config.plugins ?? []).filter(
        (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-audio',
      ),
      [
        'expo-audio',
        {
          microphonePermission: 'Talk to your personal agent by voice. You can use text instead.',
          enableBackgroundRecording: false,
          enableBackgroundPlayback: false,
        },
      ],
    ],
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { projectId } } : {}),
      setup: {
        localNetworking,
        signingConfigured: !!process.env.IOS_BUNDLE_IDENTIFIER && !!owner && !!projectId,
      },
    },
  };
};

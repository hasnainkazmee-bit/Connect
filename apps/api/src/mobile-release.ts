// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 6,
  versionName: "0.4.1",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.4.1/connect-phone-0.4.1-debug.apk",
  sha256: "55498c034f151db093fda89f5ff2b365f3dda5eb3bc682254e03c0a460545e0d",
  notes: [
    "Connect's original solar orange and capsule-shaped controls throughout the app.",
    "Softer cards, dialogs, and a rounded bottom navigation, with the same fast publishing and messaging flows.",
  ],
};

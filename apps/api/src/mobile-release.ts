// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 3,
  versionName: "0.2.0",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.2.0/connect-phone-0.2.0-debug.apk",
  sha256: "13fec9378f19ef80a504c16d09e92d6b54dc1894df3cff2aea2e6a933ebc195e",
  notes: ["Connect Android preview with company profiles and messaging."],
};

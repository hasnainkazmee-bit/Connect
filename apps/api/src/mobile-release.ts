// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 8,
  versionName: "0.5.1",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.1/connect-phone-0.5.1-debug.apk",
  sha256: "7bbcd7d8c9f25e4f2782a8294a8fbd04813a48278e2e1ef34792731187f5b0a0",
  notes: [
    "Photos now appear in the editor with the same framing as the published post.",
    "Adjust photos before uploading: drag, zoom, and choose portrait or square crops.",
    "Write in one box and choose Update or Press release when publishing.",
    "A cleaner feed, smaller reactions, and compact comments with replies.",
  ],
};

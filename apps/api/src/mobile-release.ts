// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 5,
  versionName: "0.4.0",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.4.0/connect-phone-0.4.0-debug.apk",
  sha256: "030ec756b74f894efb9307e9041c1d2b3ab17c1a0ff22fb4dda58b45c932c0c5",
  notes: [
    "A company newsroom that adapts to your phone or tablet, with consistent orange actions.",
    "Share a Post or Press release with drafts, photo galleries, cover images, and pictures inside announcements.",
    "Celebrate company milestones and follow their updates. Your existing content stays accessible.",
  ],
};

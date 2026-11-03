// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 10,
  versionName: "0.5.3",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.3/connect-phone-0.5.3-debug.apk",
  sha256: "fd44dc3e57ac558569cc6a5a931e8b95c2125195e178599d14713cee313125b6",
  notes: [
    "Start with a Post, or choose Press release for a longer announcement.",
    "Keep your caption above a separate photo, video, or file attachment.",
    "Preview attachments in the same square frame used by the feed.",
  ],
};

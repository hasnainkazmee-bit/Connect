// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 11,
  versionName: "0.5.4",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.4/connect-phone-0.5.4-debug.apk",
  sha256: "333b04747ef0129e199cd18b4d51b66b4ffbb3ede98aa1eb121981b4e9ea2792",
  notes: [
    "Get notifications for messages, comments, replies, reactions and app updates.",
    "Viewed notifications mark themselves read and clear matching device alerts.",
    "Start writing without waiting for a network request, with tighter paragraph spacing.",
  ],
};

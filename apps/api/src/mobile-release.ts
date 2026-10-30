// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 4,
  versionName: "0.3.0",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.3.0/connect-phone-0.3.0-debug.apk",
  sha256: "79052bbd709df2053cfbd580ac14aff509fc28520a8426c5722658b5bbaa27ee",
  notes: [
    "Bottom navigation and swipe gestures keep your main screens within reach.",
    "Publish posts, articles, press releases, and case studies with drafts and media.",
    "Build your company profile, share readable employee invites, and talk to customers.",
  ],
};

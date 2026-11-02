// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 7,
  versionName: "0.5.0",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.0/connect-phone-0.5.0-debug.apk",
  sha256: "172e34b129de52003586275344b5ad79f879340e2dd22fe0b766f06fdf4ad2e7",
  notes: [
    "Floating navigation with a Create button and a simpler writing canvas for posts and press releases.",
    "React with any emoji, tap existing reactions, and see who reacted.",
    "Threaded comment replies with saved drafts, plus a fresh company profile layout.",
  ],
};

// Deploy this manifest only after the matching signed APK is published.
// API clients never receive private storage credentials or an executable URL from user content.
export const androidRelease = {
  versionCode: 9,
  versionName: "0.5.2",
  packageName: "com.sunhub.community.debug",
  minSdk: 26,
  url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.2/connect-phone-0.5.2-debug.apk",
  sha256: "7b7203ab3128fe6c667b047b81cf73e6fc809e7c2666671577109e8d76f65bc7",
  notes: [
    "Sign in with a Sunhub account, using any email address.",
    "Connect email and password sign-in remains available as usual.",
    "Create and verify a Sunhub account in your browser, then return to Connect.",
  ],
};

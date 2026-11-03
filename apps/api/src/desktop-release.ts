// Publish the matching verified installers before deploying this manifest.
// Download URLs are deliberately limited to this repository's release assets.
export const desktopRelease = {
  macos: {
    versionName: "0.1.5",
    buildNumber: 6,
    downloads: [
      {
        arch: "universal",
        url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.4/Connect-0.1.5-macos-universal.pkg",
        sha256:
          "c626874da8bfdf5b6045968048fbf11ff877f5faa8e61ccf825fe94bc60c1eca",
      },
    ],
  },
  windows: {
    versionName: "0.1.1",
    downloads: [
      {
        arch: "x64",
        url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.4/Connect-0.1.1-win-x64-Setup.exe",
        sha256:
          "5a156e6b0b82bc0b1255fa1e62ebd42127c01cedb859501d0334dfa95e10a288",
      },
      {
        arch: "arm64",
        url: "https://github.com/hasnainkazmee-bit/Connect/releases/download/v0.5.4/Connect-0.1.1-win-arm64-Setup.exe",
        sha256:
          "431a9f92ce2db5a230c40708675ddeee813b9303e404d002663af0446c2bb712",
      },
    ],
  },
};

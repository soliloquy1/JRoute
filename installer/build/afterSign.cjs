// installer/build/afterSign.cjs
//
// Reserved signing hook (electron-builder calls this after code signing, if configured).
// v0.2.0-beta ships UNSIGNED. When CI provides signing material
// (CSC_LINK / CSC_KEY_PASSWORD, or macOS notarization secrets), add the signing logic
// here. Until then this is a no-op so local + CI builds succeed without certs.
module.exports = async function afterSign(context) {
  // context.appOutDir, context.packager, etc. are available if you need to
  // post-process or notarize the signed artifacts.
  if (process.env.CSC_LINK || process.env.APPLE_ID) {
    console.log("[afterSign] Signing environment detected — add notarization here.");
  } else {
    console.log("[afterSign] No signing environment — skipping (unsigned build).");
  }
};

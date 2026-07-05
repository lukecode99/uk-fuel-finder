// Forces manual distribution signing on every app target in the prebuilt
// Xcode project. xcodebuild's CLI build settings are global, which breaks a
// two-target (app + widget) archive — each target needs its own provisioning
// profile, so we patch PROVISIONING_PROFILE_SPECIFIER per bundle id here.
// Runs on the CI runner after `expo prebuild`; never committed output.
const fs = require('fs');

const pbxPath = process.argv[2];
const appProfile = process.env.FF_PROVISION_APP_NAME;
const widgetProfile = process.env.FF_PROVISION_WIDGET_NAME;
const team = process.env.IOS_TEAM_ID;
if (!pbxPath || !appProfile || !widgetProfile || !team) {
  console.error('usage: patch-signing.cjs <project.pbxproj> (env: FF_PROVISION_APP_NAME, FF_PROVISION_WIDGET_NAME, IOS_TEAM_ID)');
  process.exit(1);
}

const src = fs.readFileSync(pbxPath, 'utf8');
let patched = 0;
const out = src.replace(/buildSettings = \{([\s\S]*?)\n(\t+)\};/g, (m, body, indent) => {
  const id = body.match(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/);
  if (!id) return m; // project-level block — leave alone
  const profile = id[1].endsWith('.widget') ? widgetProfile : appProfile;
  const cleaned = body
    .replace(/\n\t+CODE_SIGN_STYLE = [^;]+;/g, '')
    .replace(/\n\t+PROVISIONING_PROFILE_SPECIFIER = [^;]+;/g, '')
    .replace(/\n\t+"?CODE_SIGN_IDENTITY(\[[^\]]*\])?"? = [^;]+;/g, '')
    .replace(/\n\t+DEVELOPMENT_TEAM = [^;]+;/g, '');
  patched++;
  return (
    'buildSettings = {' + cleaned +
    `\n${indent}\tCODE_SIGN_STYLE = Manual;` +
    `\n${indent}\tCODE_SIGN_IDENTITY = "iPhone Distribution";` +
    `\n${indent}\tDEVELOPMENT_TEAM = ${team};` +
    `\n${indent}\tPROVISIONING_PROFILE_SPECIFIER = "${profile}";` +
    `\n${indent}};`
  );
});

if (patched < 4) {
  console.error(`expected >=4 target build-setting blocks, patched ${patched} — pbxproj layout changed?`);
  process.exit(1);
}
fs.writeFileSync(pbxPath, out);
console.log(`patched ${patched} build-setting blocks in ${pbxPath}`);

/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'widget',
  name: 'FuelWidget',
  displayName: 'Fuel Finder',
  // Appended to the main app bundle id → com.lukeholder.ukfuelfinder.widget
  bundleIdentifier: '.widget',
  // AppIntent widget configuration needs iOS 17.
  deploymentTarget: '17.0',
  appleTeamId: 'V628699P6F',
  frameworks: ['SwiftUI', 'WidgetKit', 'CoreLocation'],
  // Mirrors app/src/theme.ts so the widget matches the app.
  colors: {
    widgetBg: '#0F1420',
    widgetCard: '#1A2233',
    widgetText: '#F2F5FA',
    widgetTextDim: '#8D9AB5',
    widgetAccent: '#34D399',
    widgetAmber: '#F5B841',
  },
};

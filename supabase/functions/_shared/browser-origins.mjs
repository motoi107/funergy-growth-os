// Origins that may call Funergy+ from the published site or the installed app.
// capacitor://localhost is the iOS app WebView. A normal browser cannot choose it.
// Authentication and permissions stay as they are. The published site remains first
// so existing redirects keep using https://funergy-plus.com.
export const PUBLISHED_WEB_ORIGIN = 'https://funergy-plus.com';
export const INSTALLED_APP_ORIGIN = 'capacitor://localhost';

export function browserOrigins(envValue, extra = []) {
  const fromEnv = String(envValue || '').split(',').map(part => part.trim()).filter(Boolean);
  return [...new Set([PUBLISHED_WEB_ORIGIN, INSTALLED_APP_ORIGIN, ...extra, ...fromEnv])];
}

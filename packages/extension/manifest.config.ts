import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// MV3, least-privilege (SPEC §6 / docs/04 §1). v1: Netflix only.
export default defineManifest({
  manifest_version: 3,
  name: 'MovieFinder',
  version: pkg.version,
  description: 'In-page AI movie & TV recommendations on the sites you already use.',
  // storage: settings/sync state. alarms: the ephemeral SW needs a timer for periodic sync.
  permissions: ['storage', 'alarms'],
  host_permissions: ['*://*.netflix.com/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['*://*.netflix.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_title: 'MovieFinder',
    default_popup: 'src/pages/popup.html',
  },
  web_accessible_resources: [
    {
      resources: ['assets/*'],
      matches: ['*://*.netflix.com/*'],
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
});

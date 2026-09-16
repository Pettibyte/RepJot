// Audit regression probes for checklist area 19.
//
// ARCHITECTURE §14 "Browser policy and supply chain" prohibits remote UI
// dependencies, and §17 gate 7 requires the bundle to contain no unexpected
// remote code. RELEASE §3 says check 7 rejects every remote origin outside its
// allowlist in a network call. These probes use browser network surfaces that
// the shipped scanner currently overlooks.

import { describe, expect, test } from 'bun:test';

import { disallowedHosts } from '../scripts/compat-scan';

const REMOTE_HOST = 'audit-origin.example';
const REMOTE_URL = `https://${REMOTE_HOST}/asset`;

describe('production origin gate covers browser network surfaces', () => {
  test('rejects a remote asset assigned with setAttribute', () => {
    const source = `image.setAttribute('src', '${REMOTE_URL}.svg');`;

    expect(disallowedHosts(source)).toContain(REMOTE_HOST);
  });

  test('rejects a remote stylesheet URL', () => {
    const css = `.remote-icon { background-image: url('${REMOTE_URL}.svg'); }`;

    expect(disallowedHosts(css)).toContain(REMOTE_HOST);
  });
});

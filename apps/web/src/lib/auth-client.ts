'use client';

import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Cliente do navegador: chama os endpoints do Better Auth no próprio host do painel. */
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), twoFactorClient()],
});

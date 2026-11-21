import { googleProvider } from "./providers/google";
import { metaProvider } from "./providers/meta";
import type { ConnectionProviderId, Env, ProviderDefinition } from "./types";

const PROVIDERS: Record<ConnectionProviderId, ProviderDefinition> = {
  meta: metaProvider,
  google: googleProvider,
};

export function getConnectionProvider(id: string): ProviderDefinition | undefined {
  return Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as ConnectionProviderId] : undefined;
}

export function listConnectionProviders(env: Env = process.env) {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    configured: p.isConfigured(env),
  }));
}

/** Where the provider sends the user back after consent. Must be registered in the provider's app settings. */
export function callbackUrl(provider: ConnectionProviderId, env: Env = process.env): string {
  const base = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/connections/${provider}/callback`;
}

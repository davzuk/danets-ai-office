// Shared types for OAuth connections. No runtime imports.

export type ConnectionProviderId = "meta" | "google" | "linkedin";

export const CONNECTION_PROVIDER_IDS: readonly ConnectionProviderId[] = ["meta", "google", "linkedin"];

export type ConnectionStatus = "active" | "expired" | "revoked" | "error";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** null = the provider says the token does not expire. */
  expiresAt: Date | null;
  scopes: string[];
}

export interface ConnectedAccount {
  externalAccountId: string;
  name?: string;
  email?: string;
  /** Provider extras shown in the UI. No secrets, encrypted or not. */
  metadata?: Record<string, unknown>;
  /** Publishable / inbox-able assets (Pages, IG accounts), stored as SocialAccount rows. */
  assets?: SocialAssetInput[];
}

export type SocialPlatform = "facebook_page" | "instagram" | "linkedin_page";

export interface SocialAssetInput {
  platform: SocialPlatform;
  externalId: string;
  /** IG: id of the Facebook Page the account is linked to. */
  parentExternalId?: string | null;
  name: string;
  username?: string | null;
  pictureUrl?: string | null;
  /** Meta Page roles, e.g. ["MANAGE", "CREATE_CONTENT", "MODERATE"]. */
  tasks?: string[];
  /** Asset-level token as an encrypted envelope (Meta page token). */
  accessToken?: unknown;
}

export type Env = Record<string, string | undefined>;

export interface ProviderDefinition {
  id: ConnectionProviderId;
  label: string;
  /** What the tenant gets from connecting, shown in the UI. */
  description: string;
  usesPkce: boolean;
  isConfigured(env: Env): boolean;
  authorizeUrl(args: { state: string; redirectUri: string; codeChallenge?: string; env: Env }): string;
  exchangeCode(args: { code: string; redirectUri: string; codeVerifier?: string; env: Env }): Promise<TokenSet>;
  /** Absent when the provider has no refresh-token grant (Meta). */
  refresh?(args: { refreshToken: string; env: Env }): Promise<TokenSet>;
  fetchAccount(args: { tokens: TokenSet; env: Env }): Promise<ConnectedAccount>;
  /** Best-effort revocation at the provider. */
  revoke(args: { accessToken: string; refreshToken?: string; env: Env }): Promise<void>;
}

/** A provider rejected our credentials or a grant (token revoked, expired, bad code). */
export class OAuthGrantError extends Error {
  constructor(message: string, public readonly providerCode?: string) {
    super(message);
    this.name = "OAuthGrantError";
  }
}

/** Transient failure talking to a provider (network, 5xx, rate limit). */
export class OAuthProviderError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "OAuthProviderError";
  }
}

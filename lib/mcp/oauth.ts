import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { discoverMcpServer } from "./client";
import { assessMcpProfile } from "./profiles";
import { getConnection, upsertConnection } from "../store";

type OAuthVault = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
};

function encryptionKey() {
  const secret = process.env.TEMPORAL_CREDENTIAL_KEY || process.env.TEMPORAL_COLLECTOR_TOKEN;
  if (!secret) throw new Error("Set TEMPORAL_CREDENTIAL_KEY before connecting an OAuth MCP server.");
  return createHash("sha256").update(secret).digest();
}

export function encryptOAuthVault(value: OAuthVault) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptOAuthVault(value?: string): OAuthVault {
  if (!value) return {};
  const [iv, tag, ciphertext] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted MCP credentials.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as OAuthVault;
}

export class TemporalMcpOAuthProvider implements OAuthClientProvider {
  private vault: OAuthVault;
  private connectionId: string;
  readonly redirectUrl: URL;

  constructor(connectionId: string) {
    const connection = getConnection(connectionId);
    if (!connection) throw new Error("Unknown MCP connection.");
    this.connectionId = connectionId;
    this.vault = decryptOAuthVault(typeof connection.metadata?.oauthVault === "string" ? connection.metadata.oauthVault : undefined);
    const base = (process.env.TEMPORAL_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    this.redirectUrl = new URL(`${base}/api/auth/mcp/callback?connection=${encodeURIComponent(connectionId)}`);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl.toString()],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Temporal",
      client_uri: process.env.TEMPORAL_APP_URL || "http://localhost:3000",
    };
  }

  async state() {
    const connection = getConnection(this.connectionId)!;
    const existing = typeof connection.metadata?.oauthState === "string" ? connection.metadata.oauthState : null;
    if (existing) return existing;
    const state = randomUUID();
    upsertConnection({ ...connection, metadata: { ...connection.metadata, oauthState: state } });
    return state;
  }

  clientInformation() { return this.vault.clientInformation; }
  async saveClientInformation(value: OAuthClientInformationMixed) { this.vault.clientInformation = value; this.persistVault(); }
  tokens() { return this.vault.tokens; }
  async saveTokens(value: OAuthTokens) { this.vault.tokens = value; this.persistVault(); }
  async saveCodeVerifier(value: string) { this.vault.codeVerifier = value; this.persistVault(); }
  codeVerifier() {
    if (!this.vault.codeVerifier) throw new Error("Missing OAuth PKCE verifier.");
    return this.vault.codeVerifier;
  }
  async saveDiscoveryState(value: OAuthDiscoveryState) { this.vault.discoveryState = value; this.persistVault(); }
  discoveryState() { return this.vault.discoveryState; }
  async redirectToAuthorization(url: URL) {
    const connection = getConnection(this.connectionId)!;
    upsertConnection({ ...connection, status: "authorizing", metadata: { ...connection.metadata, authorizationUrl: url.toString() } });
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") delete this.vault.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.vault.tokens;
    if (scope === "all" || scope === "verifier") delete this.vault.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.vault.discoveryState;
    this.persistVault();
  }

  private persistVault() {
    const connection = getConnection(this.connectionId)!;
    upsertConnection({ ...connection, metadata: { ...connection.metadata, oauthVault: encryptOAuthVault(this.vault) } });
  }
}

export async function beginMcpOAuth(connectionId: string) {
  const connection = getConnection(connectionId);
  if (!connection?.serverUrl) throw new Error("Unknown MCP connection.");
  const provider = new TemporalMcpOAuthProvider(connectionId);
  await auth(provider, { serverUrl: connection.serverUrl });
  const updated = getConnection(connectionId)!;
  const authorizationUrl = typeof updated.metadata?.authorizationUrl === "string" ? updated.metadata.authorizationUrl : null;
  if (!authorizationUrl) throw new Error("The MCP authorization server did not provide an authorization URL.");
  return authorizationUrl;
}

export async function finishMcpOAuth(connectionId: string, code: string, state: string) {
  const connection = getConnection(connectionId);
  if (!connection?.serverUrl) throw new Error("Unknown MCP connection.");
  if (!state || state !== connection.metadata?.oauthState) throw new Error("Invalid or expired MCP OAuth state.");
  const provider = new TemporalMcpOAuthProvider(connectionId);
  await auth(provider, { serverUrl: connection.serverUrl, authorizationCode: code });
  const capabilities = await discoverMcpServer({ serverUrl: connection.serverUrl, authProvider: provider });
  const profile = typeof connection.configuration?.profile === "string" ? connection.configuration.profile : "generic";
  const assessment = assessMcpProfile(profile, capabilities);
  upsertConnection({
    ...getConnection(connectionId)!, capabilities, authType: "oauth",
    status: assessment.compatible ? "connected" : "needs_attention",
    description: `${capabilities.tools.length} tools · ${capabilities.resources.length} resources`,
    metadata: { ...getConnection(connectionId)!.metadata, oauthState: undefined, authorizationUrl: undefined, compatibilityWarnings: assessment.missing },
  });
  return { capabilities, assessment };
}

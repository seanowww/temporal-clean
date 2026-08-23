import { auditGitHubInstallation } from "../lib/github-app-manifest";
import { getGitHubAppConfig, getGitHubInstallation, getStoredGitHubInstallationId, listInstallationRepositories } from "../lib/github-app";

const config = getGitHubAppConfig();
if (!config) throw new Error("GitHub App credentials are missing. Open /connections and choose Create Temporal app.");
const installationId = getStoredGitHubInstallationId();
if (!installationId) throw new Error("Temporal is not installed on a GitHub account. Open /connections and choose Connect GitHub.");
const [installation, repositories] = await Promise.all([getGitHubInstallation(installationId), listInstallationRepositories(installationId)]);
const audit = auditGitHubInstallation(installation.permissions, installation.events);
console.log(`Temporal GitHub App: ${config.slug}`);
console.log(`Installed for: ${installation.account.login}`);
console.log(`Repository access: ${repositories.length} (${installation.repository_selection})`);
if (!audit.ready) {
  if (audit.missingPermissions.length) console.error(`Missing permissions: ${audit.missingPermissions.join(", ")}`);
  if (audit.missingEvents.length) console.error(`Missing events: ${audit.missingEvents.join(", ")}`);
  process.exitCode = 1;
} else console.log("Ready: webhook, PR context, checks, comments, and deployment preview permissions are present.");

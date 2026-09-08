# Publishing Acpira

Publishing a stable GitHub Release triggers `.github/workflows/release.yml`. The workflow checks the tag against `package.json`, installs locked dependencies, runs type checks and tests, and builds one VSIX. Separate jobs publish that same package to Visual Studio Marketplace and Open VSX and attach it, with its SHA-256 checksum, to the GitHub Release.

## One-time credentials

Add these repository secrets under [Settings → Secrets and variables → Actions](https://github.com/hotic/acpira/settings/secrets/actions). Never commit tokens or paste them into issues, release notes, or workflow inputs.

| Secret | Source and required access |
| --- | --- |
| `VSCE_PAT` | Azure DevOps personal access token for the Microsoft account that owns the `hotic` Marketplace publisher; Marketplace → Manage permission, with the organization selection required by the [VS Code publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). |
| `OVSX_PAT` | [Open VSX access token](https://open-vsx.org/user-settings/tokens) for the account that signed the publisher agreement and can publish under `hotic`. |

Tokens expire or can be revoked. Update the corresponding secret when rotating one. Microsoft currently documents retirement of global Azure DevOps PATs on December 1, 2026; migrate the Marketplace job to Microsoft Entra ID before that date. The current workflow uses PATs, not Entra ID or Open VSX trusted publishing.

Creating the Open VSX namespace does not verify ownership. Follow [Namespace Access](https://github.com/eclipse-openvsx/openvsx/wiki/Namespace-Access) to claim exclusive publishing rights.

## Release an update

1. Update `package.json` and `CHANGELOG.md`, then commit and push the release changes.
2. Create a GitHub Release whose tag exactly matches the manifest version, for example `v1.0.1` for version `1.0.1`. Select the commit containing the release changes. Publish it as a stable release.
3. Check the four jobs in [Publish extension](https://github.com/hotic/acpira/actions/workflows/release.yml). Green build status alone does not confirm marketplace publication.
4. Confirm the version on [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=hotic.acpira) and [Open VSX](https://open-vsx.org/extension/hotic/acpira). Cursor discovery can lag Open VSX publication because its marketplace proxy performs additional checks. Installed copies update according to each editor's automatic-update settings.

Drafts, standalone tag pushes, and prereleases do not publish to the marketplaces. Create the Release in the GitHub UI or using a personal `gh` login; a Release created by another workflow's default `GITHUB_TOKEN` does not trigger this workflow.

## Validate or retry

Use **Run workflow** with `ref: main` and publishing unchecked to run checks and download the resulting `extension-vsix` artifact without publishing. This requires no marketplace secrets.

If one marketplace fails, fix its credential or the reported error and choose **Re-run failed jobs**. Both publishers use `--skip-duplicate`, so an already-published version is not uploaded again. Existing GitHub Release assets are also retained. These retries do not replace an existing version; package changes require a new version and tag.

To publish an existing stable Release manually, use **Run workflow**, set `ref` to its exact tag, and check the publishing option. The Release must already exist and its tag must match the version at that commit. This also supports a Release created before the workflow was installed.

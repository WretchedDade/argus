# Shared Azure DevOps authentication

Argus and Athena use this package for Azure DevOps authentication and REST calls. It uses the official Azure Identity broker plugin to authenticate through Windows Web Account Manager (WAM). The extensions do not use Azure CLI credentials.

## Microsoft Entra app registration

Create one single-tenant app registration for both extensions:

1. Set **Supported account types** to accounts in the Microsoft organizational directory only.
2. Add the mobile and desktop redirect URI `ms-appx-web://Microsoft.AAD.BrokerPlugin/<application-client-id>`.
3. Enable **Allow public client flows**.
4. Add delegated Azure DevOps permissions:
    - `vso.code` for Argus pull request, policy, thread, and attachment reads.
    - `vso.work_write` for Athena work-item reads and updates. This permission includes `vso.work`.
5. Grant tenant consent if tenant policy requires it.

No client secret is used.

## Extension configuration

Store the non-secret registration identifiers in `%LOCALAPPDATA%\devstart\ado-auth-config.json`:

```json
{
    "clientId": "<application-client-id>",
    "tenantId": "<microsoft-tenant-id>"
}
```

Environment variables override the local configuration when needed:

```text
DEVSTART_ADO_CLIENT_ID=<application-client-id>
DEVSTART_ADO_TENANT_ID=<microsoft-tenant-id>
DEVSTART_ADO_CONFIG_PATH=<optional-config-file-path>
```

Both values are identifiers, not secrets. WAM owns and protects the token cache for the signed-in Windows user. The package stores only the non-secret Azure Identity authentication record in `%LOCALAPPDATA%\devstart\ado-auth.json` so it can select the same broker account after restart.

The **Sign in** control first attempts the default Windows broker account and shows native WAM interaction only when required for account selection, MFA, consent, or Conditional Access. Normal refreshes use silent broker token acquisition.

## Build note

`@azure/identity` and `@azure/identity-broker` remain external to each extension's esbuild bundle. Their native Windows components load from the extension's `node_modules`.

# Security

## Report a vulnerability privately

Do not put credentials, exploit details or personal data in a public issue or pull request.

When GitHub private vulnerability reporting is enabled, use **Security → Report a vulnerability** in this repository. If that option is unavailable, contact Diego Romero privately through [his published LinkedIn profile](https://www.linkedin.com/in/diegoromerosm/) and ask for a secure way to share the report. Do not post the details publicly or send sensitive material in the initial message.

Include the affected commit, the component, expected and observed behaviour, impact, and the smallest safe reproduction. Redact tokens and personal information. Please coordinate disclosure while the report is assessed and a fix is prepared. No response time or bug bounty is promised.

## Supported code

Security fixes are made on `main`. Older commits and forks are not maintained release lines. Use the latest checked commit when deploying.

## Scope and safeguards

The Worker accepts bounded requests, restricts upstream destinations, applies browser security headers and keeps search behind a shared provider gate. CI scans Git history for secrets and audits known dependency vulnerabilities. These checks do not guarantee that the project is free of defects.

Tests should use a local deployment and controlled responses. Do not load-test Nominatim, OpenFreeMap or another person's Cloudflare deployment. For provider-specific issues, use that provider's reporting process.

If a credential enters Git, revoke or rotate it first. Removing the file or adding it to `.gitignore` does not remove the credential from history.

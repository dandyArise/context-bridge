# Security

## Assets

Chat history, MCP results, API key, summaries, and optional archives.

## Actors

The local user, LM Studio/plugin process, MCP servers, and configured external provider.

## Trust boundaries

Provider HTTP(S) is external. Archive paths and MCP servers are user-configured local boundaries.

## Threats and controls

- Secret disclosure: API key is a protected global field, sent only as `Authorization: Bearer`, and
  never logged, archived, cached, or placed in URLs.
- URL confusion: only HTTP(S) endpoints without embedded credentials/query/fragment are accepted.
- Context denial of service: configurable reserve, single-result cap, and shared reply budget.
- Malformed tool structure: deep text-only truncation preserves discriminators and object shape.
- State corruption: serialized atomic writes; cached prefixes are invalidated after history edits.
- Sensitive archival: disabled by default and documented as local plaintext chosen by the user.

## Residual risks

TLS authenticity depends on the Node/OS trust store. A user-selected HTTP endpoint is unencrypted.
External providers receive the prompt by design. Identical first three messages can still share a
conversation fingerprint until LM Studio exposes a stable chat identifier to plugins.

# System context

```mermaid
flowchart LR
  User[LM Studio user] --> LMS[LM Studio chat]
  LMS --> Plugin[Context Bridge plugin]
  Plugin --> Local[Local LM Studio model]
  Plugin --> External[Configured OpenAI-compatible endpoint]
  Plugin --> Archive[(Optional local archive)]
  LMS --> MCP[MCP tool plugins]
  Plugin --> MCP
```

LM Studio and the local filesystem are trusted local boundaries. The configured external endpoint
is a separate network trust boundary. Only prompts, tool definitions/results, and generation
parameters required by the selected external path cross it.

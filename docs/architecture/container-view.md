# Container view

The deployment has one plugin process started by LM Studio. It contains no database and no server.
LM Studio invokes it through the SDK. Optional JSON/Markdown state is stored under the configured
archive directory. External calls use HTTP(S): `GET /v1/models`, `POST /llm/tokenize`, and
`POST /v1/chat/completions` with SSE responses.

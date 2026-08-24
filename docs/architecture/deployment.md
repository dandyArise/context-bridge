# Deployment

Build and install from this directory with `pnpm run build` then `lms dev --install -y`. LM Studio
copies/registers the plugin under its extensions directory. Rollback by reinstalling a previously
saved plugin revision; persisted per-chat/global configuration is owned by LM Studio. Archives are
backward-readable Markdown and JSON and need no migration for revision 1.

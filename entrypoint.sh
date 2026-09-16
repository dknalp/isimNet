#!/bin/sh
# Ensure /data is writable by the nextjs user (uid 1001).
# Needed when the host bind-mount dir is created by Docker as root.
if [ "$(stat -c '%u' /data)" != "1001" ]; then
  chown -R 1001:1001 /data
fi
exec su-exec nextjs node server.js

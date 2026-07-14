#!/bin/sh
# Replace the passcode placeholder with the env var at deploy time
if [ -n "$ADMIN_PASSCODE" ]; then
  sed -i "s/changeme/$ADMIN_PASSCODE/g" firebase-config.js
fi

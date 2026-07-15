#!/bin/sh
# Replace placeholders with env vars at deploy time
if [ -n "$ADMIN_PASSCODE" ]; then
  sed -i "s/changeme/$ADMIN_PASSCODE/g" config.js
fi
if [ -n "$SUPABASE_ANON_KEY" ]; then
  sed -i "s|YOUR_SUPABASE_ANON_KEY|$SUPABASE_ANON_KEY|g" config.js
fi

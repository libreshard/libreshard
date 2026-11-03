#!/usr/bin/env bash
# Runs inside the Linux test container (see Dockerfile)
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
export DISPLAY=:99
sleep 1
openbox >/dev/null 2>&1 &
sleep 1

status=0
echo "== active-win installed: $(node -e "try{require.resolve('active-win');console.log('yes')}catch{console.log('no')}")"
echo "== unit tests"
npm test || status=1
echo "== key injection and app detection"
node test/linux/injection.js || status=1
exit $status

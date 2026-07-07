#!/bin/bash
# Persistent dev server launcher — keeps next dev alive across shell sessions.
cd /home/z/my-project

# Kill any existing next dev
pkill -f "next dev -p 3000" 2>/dev/null
sleep 1

# Start in a fully detached session, logging to dev.log
setsid bash -c './node_modules/.bin/next dev -p 3000 > /home/z/my-project/dev.log 2>&1' < /dev/null &
echo "dev server launched, pid $!"
sleep 1
disown 2>/dev/null

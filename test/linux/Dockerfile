# Linux check: the test suite plus real key injection and app detection under a virtual X server.
#   npm run test:linux     (needs Docker)
FROM node:22-bookworm

# Xvfb (virtual X server), openbox (a window manager, so there is an "active window"),
# x11-utils (xev, xprop, xwininfo), xdotool, x11-xserver-utils (xmodmap), plus the X libraries nut-js loads
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb openbox x11-utils x11-xserver-utils xdotool libxtst6 libxt6 libxinerama1 libxrandr2 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# Electron isn't needed here (dev dependency); optional active-win may or may not install on Linux
RUN npm ci --omit=dev
COPY . .
CMD ["bash", "test/linux/run.sh"]

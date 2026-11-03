#!/bin/bash
# LibreShard .deb post-install script: electron-builder's default (app-builder-lib/templates/linux/
# after-install.tpl) plus an AppArmor profile for Ubuntu 24.04+. electron-builder fills in the
# macros in braces with a dollar sign; don't use that syntax for shell variables here.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

# Ubuntu 24.04+ restricts unprivileged user namespaces through AppArmor. Creating one still works, so
# the test above passes, but the namespace gets no capabilities and Chromium's sandbox aborts at start.
# As Ubuntu does for Chrome and VS Code, a profile lets this one program use them. Only installed
# where that restriction exists (AppArmor 4, which the profile's "abi" line needs).
if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] && [ -d /etc/apparmor.d ] && hash apparmor_parser 2>/dev/null; then
    cat > '/etc/apparmor.d/${executable}' <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile ${executable} /opt/${sanitizedProductName}/${executable} flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
PROFILE
    apparmor_parser --replace --write-cache --skip-read-cache '/etc/apparmor.d/${executable}' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

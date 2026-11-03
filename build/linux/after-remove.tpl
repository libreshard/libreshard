#!/bin/bash
# LibreShard .deb post-remove script: electron-builder's default (app-builder-lib/templates/linux/
# after-remove.tpl) plus removing the AppArmor profile that after-install.tpl may have added.

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

if [ -f '/etc/apparmor.d/${executable}' ]; then
    if hash apparmor_parser 2>/dev/null; then
        apparmor_parser --remove '/etc/apparmor.d/${executable}' 2>/dev/null || true
    fi
    rm -f '/etc/apparmor.d/${executable}'
fi

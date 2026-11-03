#!/usr/bin/env bash
# Creates an Ubuntu 24.04 desktop VM on a Proxmox VE host, for testing LibreShard's Linux packages on a
# real Ubuntu kernel (AppArmor restricts unprivileged user namespaces there, unlike in an LXC).
#
# What you get:
#   - Ubuntu 24.04 (official cloud image) with ubuntu-desktop-minimal (GNOME)
#   - GDM on Xorg (Wayland disabled: LibreShard supports X11 on Linux), automatic login, no screen lock,
#     so the session can be driven over SSH with DISPLAY=:0
#   - SSH with your public key, qemu-guest-agent, and the tools the LibreShard tests use
#   - a "clean" snapshot once everything is installed, to roll back between test runs
#
# Run it on the Proxmox host, as root:
#   scp test/linux/proxmox-ubuntu-desktop-vm.sh ~/.ssh/id_rsa.pub root@<proxmox>:/root/
#   ssh root@<proxmox>
#   SSH_PUBKEY_FILE=/root/id_rsa.pub bash /root/proxmox-ubuntu-desktop-vm.sh
#
# It takes 15-25 minutes. Run it inside tmux or screen (or from the Proxmox web shell, kept open):
# if the terminal closes, the script stops before the snapshot and the summary with the VM's IP.
# Lost the IP? On the host: qm guest cmd <VMID> network-get-interfaces | grep '"ip-address"'
#
# Everything can be changed with environment variables (defaults below). It's a test VM: the user gets
# passwordless sudo and the session logs in automatically. Don't reuse this setup for anything else.
set -euo pipefail

VMID="${VMID:-9124}"
NAME="${NAME:-libreshard-ubuntu-desktop}"
STORAGE="${STORAGE:-local-lvm}"          # where the VM disk goes
SNIPPETS="${SNIPPETS:-local}"            # a storage with the "snippets" content type (for cloud-init)
BRIDGE="${BRIDGE:-vmbr0}"
MEMORY="${MEMORY:-6144}"                 # MiB
CORES="${CORES:-4}"
DISK_SIZE="${DISK_SIZE:-40G}"
VM_USER="${VM_USER:-gabriel}"
SSH_PUBKEY_FILE="${SSH_PUBKEY_FILE:-/root/.ssh/id_rsa.pub}"
IMAGE_URL="${IMAGE_URL:-https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img}"
CACHE_DIR="${CACHE_DIR:-/var/tmp/libreshard-vm}"

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

[ "$(id -u)" = 0 ] || die "run as root on the Proxmox host"
command -v qm >/dev/null || die "qm not found: this must run on a Proxmox VE host"
qm status "$VMID" >/dev/null 2>&1 && die "VM $VMID already exists (set VMID=... or remove it: qm destroy $VMID --purge)"
[ -f "$SSH_PUBKEY_FILE" ] || die "public key not found: $SSH_PUBKEY_FILE (copy your id_rsa.pub to the host and set SSH_PUBKEY_FILE)"
pvesm status --content snippets 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$SNIPPETS" || die \
  "storage '$SNIPPETS' doesn't allow snippets. Enable it in Datacenter > Storage > $SNIPPETS > Content > Snippets
       (or: pvesm set $SNIPPETS --content <current types>,snippets), or set SNIPPETS=<another storage>"

if [ -z "${VM_PASSWORD:-}" ]; then
  read -r -s -p "Password for $VM_USER in the VM (console/RDP login and sudo): " VM_PASSWORD; echo
  [ -n "$VM_PASSWORD" ] || die "empty password"
fi
PASSWORD_HASH="$(openssl passwd -6 "$VM_PASSWORD")"
SSH_KEY="$(head -n1 "$SSH_PUBKEY_FILE")"

step "Downloading the Ubuntu 24.04 cloud image (cached in $CACHE_DIR)"
mkdir -p "$CACHE_DIR"
IMAGE="$CACHE_DIR/$(basename "$IMAGE_URL")"
if [ ! -f "$IMAGE" ]; then
  wget -q --show-progress -O "$IMAGE.part" "$IMAGE_URL"
  wget -q -O "$CACHE_DIR/SHA256SUMS" "$(dirname "$IMAGE_URL")/SHA256SUMS"
  (cd "$CACHE_DIR" && mv "$IMAGE.part" "$IMAGE" && grep " \*$(basename "$IMAGE")\$" SHA256SUMS | sha256sum -c -) \
    || { rm -f "$IMAGE"; die "checksum mismatch"; }
fi

step "Writing the cloud-init configuration"
SNIPPET_FILE="libreshard-vm-$VMID.yaml"
SNIPPET_PATH="$(pvesm path "$SNIPPETS:snippets/$SNIPPET_FILE")"
mkdir -p "$(dirname "$SNIPPET_PATH")"
cat > "$SNIPPET_PATH" <<EOF
#cloud-config
hostname: $NAME
users:
  - name: $VM_USER
    groups: [adm, sudo]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    lock_passwd: false
    passwd: "$PASSWORD_HASH"
    ssh_authorized_keys:
      - $SSH_KEY
ssh_pwauth: false
package_update: true
package_upgrade: true
packages:
  - ubuntu-desktop-minimal
  - qemu-guest-agent
  - openssh-server
  - x11-utils          # xprop, xwininfo, xev: LibreShard's app detection and the tests
  - x11-xserver-utils  # xmodmap: LibreShard's F13-F24 check
  - xdotool
  - imagemagick        # screenshots of the session
  - curl
write_files:
  # Xorg instead of Wayland, and automatic login so the session exists right after boot
  - path: /etc/gdm3/custom.conf
    content: |
      [daemon]
      WaylandEnable=false
      AutomaticLoginEnable=true
      AutomaticLogin=$VM_USER
  # No idle blanking or screen lock: injected keys must reach the session, not a lock screen
  - path: /etc/dconf/profile/user
    content: |
      user-db:user
      system-db:local
  - path: /etc/dconf/db/local.d/00-libreshard-test
    content: |
      [org/gnome/desktop/session]
      idle-delay=uint32 0
      [org/gnome/desktop/screensaver]
      lock-enabled=false
      [org/gnome/settings-daemon/plugins/power]
      sleep-inactive-ac-type='nothing'
runcmd:
  - dconf update
  # No welcome wizard and no "upgrade to the next release" prompt: they'd cover the test windows,
  # and the tests must run on 24.04
  - sed -i 's/^Prompt=.*/Prompt=never/' /etc/update-manager/release-upgrades
  - install -d -o $VM_USER -g $VM_USER /home/$VM_USER/.config
  - install -o $VM_USER -g $VM_USER -m 644 /dev/null /home/$VM_USER/.config/gnome-initial-setup-done
  - systemctl enable --now qemu-guest-agent
  - systemctl set-default graphical.target
power_state:
  mode: reboot
  message: "Desktop installed, rebooting into the graphical session"
  condition: true
EOF

step "Creating VM $VMID ($NAME)"
qm create "$VMID" --name "$NAME" --ostype l26 --machine q35 --cpu host \
  --cores "$CORES" --memory "$MEMORY" --balloon 0 \
  --net0 "virtio,bridge=$BRIDGE" --scsihw virtio-scsi-single \
  --vga virtio --agent enabled=1 --serial0 socket
qm set "$VMID" --scsi0 "$STORAGE:0,import-from=$IMAGE,discard=on,ssd=1,iothread=1" >/dev/null
qm disk resize "$VMID" scsi0 "$DISK_SIZE" >/dev/null
qm set "$VMID" --ide2 "$STORAGE:cloudinit" --boot order=scsi0 \
  --ipconfig0 ip=dhcp --cicustom "user=$SNIPPETS:snippets/$SNIPPET_FILE" >/dev/null

step "Starting it. The first boot installs the desktop (10-20 minutes) and then reboots."
qm start "$VMID"

echo "   Waiting for the guest agent..."
for _ in $(seq 1 120); do qm guest cmd "$VMID" ping >/dev/null 2>&1 && break; sleep 10; done
qm guest cmd "$VMID" ping >/dev/null 2>&1 || die "the guest agent didn't answer; check the VM console"

echo "   Waiting for cloud-init to finish (installing packages)..."
qm guest exec "$VMID" --timeout 3600 -- cloud-init status --wait >/dev/null 2>&1 || true

echo "   Waiting for the reboot into the desktop..."
sleep 30
for _ in $(seq 1 60); do qm guest cmd "$VMID" ping >/dev/null 2>&1 && break; sleep 10; done
sleep 30 # let GDM log the user in

IP="$(qm guest cmd "$VMID" network-get-interfaces 2>/dev/null \
  | grep -o '"ip-address" *: *"[0-9.]*"' | grep -o '[0-9.]*"$' | tr -d '"' | grep -v '^127\.' | head -n1 || true)"
USERNS="$(qm guest exec "$VMID" -- sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null \
  | grep -o '"out-data" *: *"[0-9]' | grep -o '[0-9]$' || true)"

step "Taking the 'clean' snapshot"
qm snapshot "$VMID" clean --description "Fresh Ubuntu 24.04 desktop, before installing LibreShard" >/dev/null

cat <<EOF

Done.
  VM:        $VMID ($NAME)
  IP:        ${IP:-unknown (see the VM summary in the Proxmox UI)}
  User:      $VM_USER (key-based SSH; the password is for the console and sudo)
  Desktop:   Proxmox console (noVNC), GNOME on Xorg, logged in automatically
  AppArmor:  kernel.apparmor_restrict_unprivileged_userns = ${USERNS:-?} (1 is what we want to test against)

On the Windows PC, add to ~/.ssh/config:
  Host libreshard-vm
      HostName ${IP:-<vm-ip>}
      User $VM_USER
      IdentityFile ~/.ssh/id_rsa

Roll back after a test run:  qm rollback $VMID clean
EOF

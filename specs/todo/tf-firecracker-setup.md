# Terraform + Firecracker Setup

## Overview

Latitude.sh uses a two-resource approach for server bootstrapping:
1. `latitudesh_user_data` — cloud-init script (base64 encoded), runs on first boot
2. `latitudesh_server` — references the user_data ID
3. `null_resource` with `remote-exec` — runs after provisioning for complex setup steps

## Why Two Stages

Cloud-init handles initial OS-level bootstrap (packages, sysctl, hostname fix). The heavier Firecracker binary download and rootfs setup runs via `remote-exec` after cloud-init finishes, giving us more control and debuggability.

---

## Stage 1 — Cloud-init (`latitudesh_user_data`)

Add to `infra/cluster/environments/dev/main.tf`:

```hcl
resource "latitudesh_user_data" "firecracker_bootstrap" {
  description = "Firecracker host bootstrap"
  content = base64encode(<<-YAML
    #cloud-config
    packages:
      - jq
      - wget
      - curl
      - squashfs-tools
      - e2fsprogs
      - iptables

    runcmd:
      # Fix hostname resolution (avoids "sudo: unable to resolve host" error)
      - echo "127.0.0.1 localhost $(hostname)" >> /etc/hosts
      # Enable KVM access for the ubuntu user
      - usermod -aG kvm ubuntu
      # Enable IPv4 forwarding permanently
      - echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
      - sysctl -p
    YAML
  )
}
```

---

## Stage 2 — Attach to Server

Update `latitudesh_server.nodes` in `main.tf` to reference the user_data ID:

```hcl
resource "latitudesh_server" "nodes" {
  count = var.cluster_config.num_nodes

  hostname         = "${var.project_name}-node-${count.index + 1}"
  billing          = var.cluster_config.billing
  operating_system = var.cluster_config.os
  plan             = var.cluster_config.node_instance
  project          = latitudesh_project.project.id
  site             = data.latitudesh_region.region.slug
  ssh_keys         = [latitudesh_ssh_key.ssh_key.id]
  user_data        = latitudesh_user_data.firecracker_bootstrap.id  # <-- add this
}
```

> **Warning:** Changing `user_data` on an existing server triggers a full OS reinstall.

---

## Stage 3 — Firecracker Setup via `remote-exec`

Add to `main.tf`:

```hcl
resource "null_resource" "firecracker_setup" {
  count = var.cluster_config.num_nodes

  depends_on = [latitudesh_server.nodes]

  connection {
    type        = "ssh"
    user        = "ubuntu"
    private_key = file(var.cluster_config.ssh_private_key_path)
    host        = latitudesh_server.nodes[count.index].primary_ipv4
  }

  # Copy the setup script to the server
  provisioner "file" {
    source      = "${path.module}/scripts/firecracker-setup.sh"
    destination = "/home/ubuntu/firecracker-setup.sh"
  }

  provisioner "remote-exec" {
    inline = [
      # Wait for cloud-init to finish before running our script
      "cloud-init status --wait",
      "chmod +x /home/ubuntu/firecracker-setup.sh",
      "sudo /home/ubuntu/firecracker-setup.sh",
    ]
  }
}
```

---

## Stage 4 — Create the Setup Script

Create `infra/cluster/environments/dev/scripts/firecracker-setup.sh` based on `specs/firecracker-setup.md`:

```bash
#!/bin/bash
set -euo pipefail

ARCH="$(uname -m)"
WORKDIR="/home/ubuntu/firecracker"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

# --- Install Firecracker binary ---
release_url="https://github.com/firecracker-microvm/firecracker/releases"
latest=$(basename $(curl -fsSLI -o /dev/null -w %{url_effective} ${release_url}/latest))
curl -L ${release_url}/download/${latest}/firecracker-${latest}-${ARCH}.tgz | tar -xz
mv release-${latest}-$(uname -m)/firecracker-${latest}-${ARCH} firecracker
chmod +x firecracker

# --- Download kernel and rootfs ---
CI_VERSION=${latest%.*}
latest_kernel_key=$(curl "http://spec.ccfc.min.s3.amazonaws.com/?prefix=firecracker-ci/$CI_VERSION/$ARCH/vmlinux-&list-type=2" \
    | grep -oP "(?<=<Key>)(firecracker-ci/$CI_VERSION/$ARCH/vmlinux-[0-9]+\.[0-9]+\.[0-9]{1,3})(?=</Key>)" \
    | sort -V | tail -1)
wget "https://s3.amazonaws.com/spec.ccfc.min/${latest_kernel_key}"

latest_ubuntu_key=$(curl "http://spec.ccfc.min.s3.amazonaws.com/?prefix=firecracker-ci/$CI_VERSION/$ARCH/ubuntu-&list-type=2" \
    | grep -oP "(?<=<Key>)(firecracker-ci/$CI_VERSION/$ARCH/ubuntu-[0-9]+\.[0-9]+\.squashfs)(?=</Key>)" \
    | sort -V | tail -1)
ubuntu_version=$(basename $latest_ubuntu_key .squashfs | grep -oE '[0-9]+\.[0-9]+')
wget -O ubuntu-$ubuntu_version.squashfs.upstream "https://s3.amazonaws.com/spec.ccfc.min/$latest_ubuntu_key"

# --- Build ext4 rootfs with SSH key ---
unsquashfs ubuntu-$ubuntu_version.squashfs.upstream
ssh-keygen -f id_rsa -N ""
cp -v id_rsa.pub squashfs-root/root/.ssh/authorized_keys
mv -v id_rsa ./ubuntu-$ubuntu_version.id_rsa
chown -R root:root squashfs-root
truncate -s 1G ubuntu-$ubuntu_version.ext4
mkfs.ext4 -d squashfs-root -F ubuntu-$ubuntu_version.ext4

# --- Verify ---
echo ""
echo "The following files were set up:"
KERNEL=$(ls vmlinux-* | tail -1)
[ -f "$KERNEL" ] && echo "Kernel: $KERNEL" || echo "ERROR: Kernel $KERNEL not found"
ROOTFS=$(ls *.ext4 | tail -1)
e2fsck -fn "$ROOTFS" &>/dev/null && echo "Rootfs: $ROOTFS" || echo "ERROR: $ROOTFS is not a valid ext4 fs"
KEY_NAME=$(ls *.id_rsa | tail -1)
[ -f "$KEY_NAME" ] && echo "SSH Key: $KEY_NAME" || echo "ERROR: Key $KEY_NAME not found"
```

---

## Variables to Add

Add `ssh_private_key_path` to `variables.tf` and `terraform.tfvars`:

```hcl
# variables.tf
variable "cluster_config" {
  type = object({
    ...
    ssh_private_key_path = string  # path to private key matching ssh_key pubkey
  })
}
```

```hcl
# terraform.tfvars
cluster_config = {
  ...
  ssh_private_key_path = "~/.ssh/id_rsa"
}
```

---

## File Structure After Implementation

```
infra/cluster/environments/dev/
├── main.tf                        # updated with user_data + null_resource
├── variables.tf                   # add ssh_private_key_path
├── terraform.tfvars               # add ssh_private_key_path value
├── provider.tf
└── scripts/
    └── firecracker-setup.sh       # new
```

---

## References

- [latitudesh_user_data resource docs](https://github.com/latitudesh/terraform-provider-latitudesh/blob/main/docs/resources/user_data.md)
- [latitudesh_server resource docs](https://github.com/latitudesh/terraform-provider-latitudesh/blob/main/docs/resources/server.md)
- [Latitude.sh examples — user-data](https://github.com/latitudesh/examples/tree/main/user-data)
- `specs/firecracker-setup.md` — source of the Firecracker setup steps

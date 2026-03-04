# Provisioning Bare Metal Cluster with Terraform

## Create SSH Key Pair
```sh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_latitude_crack402 -C "<name>@github.io"
```

## Terraform Apply
1. setup terraform variables in `terraform/environments/dev/terraform.tfvars`:
```hcl
project_name      = "crack402"
environment       = "Development"
provisioning_type = "on_demand"
region            = "CHI"
cluster_config = {
  node_instance = "c2-small-x86"
  billing       = "hourly"
  num_nodes     = 1
  os            = "ubuntu_24_04_x64_lts"
  // NOTE: key create in previous step
  ssh_key       = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILPVXwvzI0qvd3Jdz2rLwT9cl1pDBUaWL8/+i4KaF9B8 <name>@github.io"
}
```

## Useful Commands

```sh
terraform init
export LATITUDE_API_KEY="<your_api_key>" terraform plan
# create project
export LATITUDE_API_KEY="<your_api_key>" terraform apply -target=latitudesh_project.project
# create the nodes, vnet, etc
export LATITUDE_API_KEY="<your_api_key>" terraform apply
```
```
Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value: yes

latitudesh_user_data.setup: Creating...
latitudesh_server.nodes[0]: Creating...
latitudesh_user_data.setup: Creation complete after 0s [id=ud_PVwea4vZ2NB9O]
latitudesh_server.nodes[0]: Still creating... [10s elapsed]
latitudesh_server.nodes[0]: Still creating... [20s elapsed]
latitudesh_server.nodes[0]: Still creating... [30s elapsed]
latitudesh_server.nodes[0]: Creation complete after 32s [id=sv_dexA0qBqdNlQV]
latitudesh_vlan_assignment.vlan_assignment["0"]: Creating...
latitudesh_vlan_assignment.vlan_assignment["0"]: Creation complete after 2s [id=vnasg_nPRbajMDK5koM]

Apply complete! Resources: 3 added, 0 changed, 0 destroyed.

Outputs:

nodes = [
  {
    "id" = "sv_dexA0qBqdNlQV"
    "ipv4" = "185.209.176.53"
  },
]
project_details = {
  "environment" = "Development"
  "id" = "proj_7pWRawVM65rD6"
  "name" = "crack402"
  "provisioning_type" = "on_demand"
  "slug" = "crack402"
}
```

- setup firewall rules & assignments

## Ansible
1. setup ansible inventory in `ansible/inventory.ini`:
```ini
[worker_nodes]
// NOTE: from terraform output above
185.209.176.53 ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/id_ed25519_latitude_crack402
```

2. test connectivity:
```sh
ssh-keyscan -H 185.209.176.53 >> ~/.ssh/known_hosts
ansible -i ansible/inventory.ini worker_nodes -m ping
```

3. run the full playbook:
```sh
ansible-playbook -i ansible/inventory.ini ansible/playbook.yaml
```

### Partial runs (by role)
```sh
# cloudflared only
ansible-playbook -i ansible/inventory.ini ansible/playbook.yaml --tags cloudflared

# firecracker only
ansible-playbook -i ansible/inventory.ini ansible/playbook.yaml --tags firecracker

# rust binaries only (build first: cargo build --release)
ansible-playbook -i ansible/inventory.ini ansible/playbook.yaml --tags crack402_node
```

### Upgrading versions
Edit `ansible/group_vars/all.yml` and change the relevant version pin, then re-run the playbook (or the specific tag above).

## todo
- what happens when you upgrade one of the group_vars. how does ansible handle state & figure out change set


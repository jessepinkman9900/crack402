# Provisioning Bare Metal Cluster with Terraform

## Sample tfvars

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
  ssh_key       = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILPVXwvzI0qvd3Jdz2rLwT9cl1pDBUaWL8/+i4KaF9B8 jessepinkman9900@github.io"
}
```

## Useful Commands

```sh
terraform init
export LATITUDE_API_KEY="<your_api_key>" terraform plan
export LATITUDE_API_KEY="<your_api_key>" terraform apply
export LATITUDE_API_KEY="<your_api_key>" terraform destroy
```

## Notes
- node count behaviour
  - 0 is valid value
  - if you bump up count from 1 to 2, terraform will create a new node and add it to the cluster
  - if you reduce count from 2 to 1, terraform will destroy the latest node that was created i.e node-2

## Todo
- setup firewall rules & assignments

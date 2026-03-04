
project_name      = "crack402"
environment       = "Development"
provisioning_type = "on_demand"
region            = "LAX"
cluster_config = {
  node_instance = "c2-small-x86"
  billing       = "hourly"
  num_nodes     = 1
  os            = "ubuntu_24_04_x64_lts"
  ssh_key       = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILPVXwvzI0qvd3Jdz2rLwT9cl1pDBUaWL8/+i4KaF9B8 jessepinkman9900@github.io"
}

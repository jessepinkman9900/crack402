provider "latitudesh" {}

# create project
resource "latitudesh_project" "project" {
  name              = var.project_name
  environment       = var.environment
  provisioning_type = var.provisioning_type
}

output "project_details" {
  value = {
    id                = latitudesh_project.project.id
    slug              = latitudesh_project.project.slug
    name              = latitudesh_project.project.name
    environment       = latitudesh_project.project.environment
    provisioning_type = latitudesh_project.project.provisioning_type
    # created_at = latitudesh_project.project.created
  }
}

# create virtual network
data "latitudesh_region" "region" {
  slug = var.region
}

resource "latitudesh_virtual_network" "vnet" {
  project     = latitudesh_project.project.id
  site        = data.latitudesh_region.region.slug
  description = "VNET for ${var.project_name} in ${var.environment} environment"
}

# ssh key
resource "latitudesh_ssh_key" "ssh_key" {
  name       = "${var.project_name}-default-ssh-key"
  public_key = var.cluster_config.ssh_key
}

# create node pool
resource "latitudesh_server" "nodes" {
  count = var.cluster_config.num_nodes

  hostname         = "${var.project_name}-node-${count.index + 1}"
  billing          = var.cluster_config.billing
  operating_system = var.cluster_config.os
  plan             = var.cluster_config.node_instance
  project          = latitudesh_project.project.id
  site             = data.latitudesh_region.region.slug
  ssh_keys         = [latitudesh_ssh_key.ssh_key.id]
}

output "nodes" {
  value = [
    for node in latitudesh_server.nodes : {
      id   = node.id
      ipv4 = node.primary_ipv4
    }
  ]
}

# vnet assignments
resource "latitudesh_vlan_assignment" "vlan_assignment" {
  for_each = { for i, node in latitudesh_server.nodes : i => node }

  server_id          = each.value.id
  virtual_network_id = latitudesh_virtual_network.vnet.id
}

# todo: firewall assignments


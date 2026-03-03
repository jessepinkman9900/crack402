# Terraform Latitude Provisioning

## Modules
1. create project
  - name: `crack402`
  - environment: `<environment>`
  - provisioning_type: `on_demand`
  - tfvars: 
    - environment = Development | Staging | Production

2. create virtual network
  - name: `crack402-vnet`
  - project: `crack402`
  - site: `<site>`
  - tvars:
    - site = chicago for now

3. create ssh key
  - name: `crack402-ssh-key`
  - project: `crack402`
  - tfvars:

4. create server
  - name: `node-<id>`
  - project: `crack402`
  - site: `<site>`
  - tfvars:
    - site = chicago for now

## Usage

1. Create project
{
  name = "crack402"
  environment = "Development"
  provisioning_type = "on_demand"
}

2. Create virtual network
{
  name = project.name + "-vnet"
  project = project.id
  site = "chicago"
}

3. Create server
for i in range number of nodes:
{
  name = "node-" + i
  project = project.id
  site = "chicago"
}

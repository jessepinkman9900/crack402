# Infrastrucute as Code

Pre-Requisite
1. latitude.sh api key
2. cloudflare api key



# Step 1 - setup control plane on cloudflare
- deploy workers
  - auth endpoints
  - maganement endpoints
  - internal node endpoints
  - workload api
  - observability api

# Step 2 - setup data plane on latitude
- run terraform
  - create latitude project
  - create vnet, server, vnet-server assignments
- run ansible
  - install cloudflare tunnel client with tunnel token on server
  - setup firecracker vms on server
  - install node-agent on server

## Sequence




#
- traffic north to south. no east to west traffic.

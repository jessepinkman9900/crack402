variable "project_name" {
  type    = string
  default = "crack402"
}

variable "environment" {
  type    = string
  default = "Development"

  validation {
    condition     = contains(["Development", "Staging", "Production"], var.environment)
    error_message = "Environment must be one of 'Development', 'Staging', or 'Production'."
  }

}

variable "provisioning_type" {
  type    = string
  default = "on_demand"

  validation {
    condition     = contains(["on_demand"], var.provisioning_type)
    error_message = "Provisioning type must be 'on_demand'."
  }

}

variable "region" {
  type        = string
  default     = "CHI"
  description = "Region slug for latitude.sh - CHI, MIA, DAL, LAX, NYC, LON, SAO, TYO"
}

variable "cluster_config" {
  type = object({
    node_instance = optional(string, "c2-small-x86")
    billing       = optional(string, "hourly")
    num_nodes     = optional(number, 1)
    os            = optional(string, "ubuntu_24_04_x64_lts")
    ssh_key       = string
  })
}

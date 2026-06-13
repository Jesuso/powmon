variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID (Dashboard > any domain > Overview, right sidebar)."
}

variable "domain" {
  type        = string
  description = "Apex domain to add to Cloudflare, e.g. example.com."
}

variable "hostname" {
  type        = string
  description = "Public hostname to expose the Pi on, e.g. powmon.example.com."
}

variable "origin_service" {
  type        = string
  default     = "http://localhost:80"
  description = "Local service cloudflared forwards to on the Pi. nginx is :80; the web app is :3001."
}

variable "tunnel_name" {
  type        = string
  default     = "powmon-pi"
  description = "Friendly name for the Cloudflare Tunnel."
}

variable "state_passphrase" {
  type        = string
  sensitive   = true
  description = "Passphrase for local state encryption (>= 16 chars). Set via TF_VAR_state_passphrase; never commit it."
}

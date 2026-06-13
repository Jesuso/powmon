output "cloudflare_nameservers" {
  value       = cloudflare_zone.this.name_servers
  description = "Set THESE two nameservers at your domain registrar to activate the zone."
}

output "zone_status" {
  value       = cloudflare_zone.this.status
  description = "pending until the registrar nameservers propagate, then active."
}

output "tunnel_id" {
  value       = cloudflare_zero_trust_tunnel_cloudflared.this.id
  description = "UUID of the tunnel."
}

output "public_url" {
  value       = "https://${var.hostname}"
  description = "Where the Pi will be reachable once the zone is active and cloudflared is running."
}

output "cloudflared_connector_token" {
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.this.token
  sensitive   = true
  description = "Run on the Pi: sudo cloudflared service install <token>. View with: tofu output -raw cloudflared_connector_token"
}

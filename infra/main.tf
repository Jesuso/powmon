# 32-byte secret that authenticates the cloudflared connector to this tunnel.
resource "random_bytes" "tunnel_secret" {
  length = 32
}

# Adds the domain to Cloudflare. Created in "pending" status until you point
# the registrar's nameservers at the values in the cloudflare_nameservers output.
resource "cloudflare_zone" "this" {
  account = {
    id = var.cloudflare_account_id
  }
  name = var.domain
  type = "full"
}

# The tunnel itself. config_src = "cloudflare" => ingress is managed remotely
# (here, via the _config resource below), not by a config.yml on the Pi.
resource "cloudflare_zero_trust_tunnel_cloudflared" "this" {
  account_id    = var.cloudflare_account_id
  name          = var.tunnel_name
  config_src    = "cloudflare"
  tunnel_secret = random_bytes.tunnel_secret.base64
}

# Ingress rules: route the public hostname to the local origin, everything else 404.
# The final rule must be a catch-all with no hostname.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "this" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.this.id

  config = {
    ingress = [
      {
        hostname = var.hostname
        service  = var.origin_service
      },
      {
        service = "http_status:404"
      }
    ]
  }
}

# Connector token to run cloudflared on the Pi (sudo cloudflared service install <token>).
data "cloudflare_zero_trust_tunnel_cloudflared_token" "this" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.this.id
}

# Proxied CNAME pointing the public hostname at the tunnel.
resource "cloudflare_dns_record" "this" {
  zone_id = cloudflare_zone.this.id
  name    = var.hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.this.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # 1 = automatic; required field, ignored while proxied
}

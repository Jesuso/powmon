# PowMon infra — Cloudflare Tunnel (OpenTofu)

Exposes the host running PowMon (e.g. a Raspberry Pi at `$PI`) to the internet
through a Cloudflare Tunnel. Outbound-only — defeats CGNAT (carrier-grade NAT,
a `10.x`/`100.64.x` WAN) and double-NAT that make port forwarding impossible.
No inbound ports, no public IP needed.

## What this creates

- `cloudflare_zone` — adds your domain to Cloudflare (pending until NS switch)
- `cloudflare_zero_trust_tunnel_cloudflared` — the tunnel + its secret
- `cloudflare_zero_trust_tunnel_cloudflared_config` — ingress: hostname → local origin
- `cloudflare_dns_record` — proxied CNAME `hostname` → `<id>.cfargotunnel.com`
- outputs the **nameservers** (for your registrar) and the **connector token** (for the Pi)

State is local and **encrypted** (AES-GCM, PBKDF2 from `TF_VAR_state_passphrase`).

## Prerequisites

1. **Cloudflare API token** — Dashboard → My Profile → API Tokens → Create Token →
   Custom token, with:
   - Account → Cloudflare Tunnel → **Edit**
   - Account → Account Settings → **Read**
   - Zone → Zone → **Edit** (lets it create the zone)
   - Zone → DNS → **Edit**
   - Account Resources: include your account
   - Zone Resources: **All zones from an account** (the zone doesn't exist yet)
2. **Account ID** — Cloudflare dashboard, right sidebar of any domain (or API tokens page).

## Usage

```bash
cd infra

# secrets via env — never in files
export CLOUDFLARE_API_TOKEN='<your-token>'
export TF_VAR_state_passphrase='<>=16 char passphrase>'

cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars        # account id, domain, hostname

tofu init
tofu plan
tofu apply
```

## After apply

1. **Point your registrar at Cloudflare.** Read the assigned nameservers:
   ```bash
   tofu output cloudflare_nameservers
   ```
   Set those two NS at your domain registrar. Wait for Cloudflare to mark the
   zone `active` (minutes–hours). Check with `tofu output zone_status` after a
   later `tofu refresh`.

2. **Install the connector on the Pi:**
   ```bash
   PI=user@your-pi.lan          # your host's ssh target
   TOKEN=$(tofu output -raw cloudflared_connector_token)
   ssh "$PI" "sudo cloudflared service install $TOKEN"
   ```
   (Install cloudflared first if missing — see below.) This registers a systemd
   service that dials out and pulls its ingress config from Cloudflare. The
   tunnel connects immediately; the public hostname resolves once the zone is active.

3. Browse to `tofu output public_url`.

### Installing cloudflared on the Pi (Debian/arm64)

```bash
ssh "$PI"
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

## Notes

- Never commit `terraform.tfvars`, `*.tfstate`, or the token/passphrase — see `.gitignore`.
- The old port-forward (80/3001) + DMZ on the routers can be removed once this works.
- To switch the exposed origin to the web app directly, set
  `origin_service = "http://localhost:3001"` and re-apply.

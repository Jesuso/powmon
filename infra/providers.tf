provider "cloudflare" {
  # API token is read from the CLOUDFLARE_API_TOKEN environment variable.
  # Do NOT hardcode it here. Required token permissions (custom token):
  #   Account  > Cloudflare Tunnel > Edit
  #   Account  > Account Settings  > Read
  #   Zone     > Zone              > Edit   (allows creating the zone)
  #   Zone     > DNS               > Edit
  # Account Resources: include your account.
  # Zone Resources:    include "All zones from an account" (zone doesn't exist yet).
}

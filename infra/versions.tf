terraform {
  required_version = ">= 1.12.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Local state, encrypted at rest with AES-GCM. The key is derived from a
  # passphrase via PBKDF2. Set the passphrase with TF_VAR_state_passphrase
  # (>= 16 chars). enforced = true refuses to read/write plaintext state.
  encryption {
    key_provider "pbkdf2" "this" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "this" {
      keys = key_provider.pbkdf2.this
    }

    state {
      method   = method.aes_gcm.this
      enforced = true
    }

    plan {
      method   = method.aes_gcm.this
      enforced = true
    }
  }
}

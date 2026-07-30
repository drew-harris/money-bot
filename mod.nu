def profiles [] {
  fnox profile --complete | lines
}

export-env {
  load-secrets "default"
}

# Load secrets from FNOX based on profile. (default = default)
export def --env load-secrets [profile: string@profiles = "default"] {
  fnox export --profile $profile --format json | from json | get secrets | load-env
}

# install packages via pnpm
export def install [] {
    pnpm install
}

# start dev server
export def dev [profile: string@profiles="default"] {
  load-secrets $profile
  pnpm run dev
}
